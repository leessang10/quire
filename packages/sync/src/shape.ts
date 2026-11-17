/**
 * Loro 문서 모양 (09 §6): 텍스트 'body' + 구획 순서 리스트 + 상태 맵. 같은 스레드 브리지와 Worker 코어가 함께 쓴다.
 *
 * - 텍스트 'body': Doc의 살아 있는 원소 열. 구획 표식은 U+E000이고 그 글자에 마크 seg=<구획 키>.
 * - 이동 리스트 'order': 구획 키의 화면 순서 + 끝 고정 항목 END. 목록에 없는 구획은 저장 순서상 다음 구획 앞.
 * - 맵 'hidden', 'placeholder', 'used': 구획 키 → true.
 * - 처음 문서: [사용자 문단들 BRK(t)][¶ BRK(p)][¶ 보초]. t는 순서 목록에, p는 자리표시.
 */
import { LoroDoc, type LoroMap, type LoroMovableList, type LoroText } from 'loro-crdt';
import { BRK_CHAR, type RawChange, type SegId, type SegState, type TextDelta } from '@quire/model';

export const TEXT = 'body';
export const ORDER = 'order';
export const END = '$end';
export const SEG_MARK = 'seg';
const NL = String.fromCharCode(10);

export type PeerId = number | bigint | `${number}`;

export function newLoro(peer: PeerId): LoroDoc {
  const loro = new LoroDoc();
  loro.setPeerId(peer);
  // 구획 표식 마크는 옆에 입력한 글자로 번지지 않게 한다
  loro.configTextStyle({ [SEG_MARK]: { expand: 'none' } });
  return loro;
}

/** 새 문서의 처음 내용을 넣는다 (커밋 포함) */
export function initLoro(loro: LoroDoc, text: string, peer: PeerId): void {
  const body = loro.getText(TEXT);
  const user = text.replace(/\r\n?/g, NL) + NL;
  body.insert(0, user + BRK_CHAR + NL + BRK_CHAR + NL);
  const t = `${String(peer)}.t`;
  const p = `${String(peer)}.p`;
  const u = user.length;
  body.mark({ start: u, end: u + 1 }, SEG_MARK, t);
  body.mark({ start: u + 2, end: u + 3 }, SEG_MARK, p);
  const order = loro.getMovableList(ORDER);
  order.insert(0, t);
  order.insert(1, 'tail');
  order.insert(2, END);
  loro.getMap('placeholder').set(p, true);
  loro.commit();
}

/** Loro 텍스트 → Doc.fromRaw 입력 (살아 있는 원소 열과 저장 순서의 구획 키) */
export function readRaw(loro: LoroDoc): { raw: string; keys: SegId[] } {
  const keys: SegId[] = [];
  let raw = '';
  for (const op of loro.getText(TEXT).toDelta()) {
    if (typeof op.insert !== 'string') continue;
    raw += op.insert;
    const key = op.attributes?.[SEG_MARK];
    if (typeof key === 'string') keys.push(key);
  }
  return { raw, keys };
}

function keysOf(map: LoroMap): SegId[] {
  const out: SegId[] = [];
  for (const [k, v] of Object.entries(map.toJSON() as Record<string, unknown>)) if (v === true) out.push(k);
  return out;
}

export function readState(loro: LoroDoc): SegState {
  return {
    order: (loro.getMovableList(ORDER).toJSON() as string[]).filter((v) => v !== END),
    hidden: keysOf(loro.getMap('hidden')),
    placeholder: keysOf(loro.getMap('placeholder')),
    used: keysOf(loro.getMap('used')),
  };
}

/**
 * Loro만으로 화면 순서의 구획 키를 구한다 (Doc.setSegState와 같은 규칙: 목록에 없는 구획은 저장 순서상 다음 구획 앞).
 * 텍스트 전체를 훑으므로 큰 문서에서는 느리다. Worker 코어가 목록에 없는 구획 앞으로 옮길 때만 쓴다.
 */
export function displayOrderFromLoro(loro: LoroDoc): SegId[] {
  const segs = [...readRaw(loro).keys, 'tail'];
  const order: SegId[] = [];
  const placed = new Set<SegId>();
  const known = new Set(segs);
  for (const id of readState(loro).order) {
    if (known.has(id) && !placed.has(id)) {
      order.push(id);
      placed.add(id);
    }
  }
  for (let k = segs.length - 1; k >= 0; k--) {
    const s = segs[k]!;
    if (placed.has(s)) continue;
    const succ = segs[k + 1];
    const at = succ !== undefined ? order.indexOf(succ) : -1;
    order.splice(at < 0 ? order.length : at, 0, s);
    placed.add(s);
  }
  return order;
}

/**
 * Doc의 로컬 변경 하나를 Loro에 적용한다 (커밋은 부르는 쪽에서).
 * displayOrder: 목록에 없는 구획을 목록에 넣을 자리를 정할 때 쓰는 화면 순서 (필요할 때만 부른다).
 */
export class LoroWriter {
  private readonly text: LoroText;
  private readonly order: LoroMovableList;
  private readonly maps: Record<'hidden' | 'placeholder' | 'used', LoroMap>;

  constructor(
    loro: LoroDoc,
    private readonly displayOrder: () => SegId[],
  ) {
    this.text = loro.getText(TEXT);
    this.order = loro.getMovableList(ORDER);
    this.maps = { hidden: loro.getMap('hidden'), placeholder: loro.getMap('placeholder'), used: loro.getMap('used') };
  }

  apply(c: RawChange): void {
    switch (c.kind) {
      case 'insert': {
        this.text.insert(c.at, c.text);
        if (c.segs) {
          let k = 0;
          for (let j = 0; j < c.text.length; j++) {
            if (c.text[j] !== BRK_CHAR) continue;
            this.text.mark({ start: c.at + j, end: c.at + j + 1 }, SEG_MARK, c.segs[k++]!);
          }
        }
        break;
      }
      case 'delete':
        this.text.delete(c.at, c.len);
        break;
      case 'order':
        for (const m of c.moves) this.placeBefore(m.seg, m.before);
        break;
      case 'list':
        this.placeBefore(c.seg, c.before);
        break;
      case 'hidden':
        for (const s of c.segs) {
          if (c.value) this.maps.hidden.set(s, true);
          else this.maps.hidden.delete(s);
        }
        break;
      case 'flag':
        this.maps[c.flag].set(c.seg, true);
        break;
    }
  }

  /** 순서 목록에서 seg를 before 앞으로 (null이면 END 앞). 목록에 없으면 그 자리에 넣고, 중복 항목은 지운다 */
  private placeBefore(seg: SegId, before: SegId | null): void {
    if (before !== null) this.ensureListed(before);
    const list = this.order.toJSON() as string[];
    const idxs: number[] = [];
    list.forEach((v, k) => v === seg && idxs.push(k));
    // 동시에 같은 구획을 넣어 생긴 중복은 하나만 남긴다
    for (let k = idxs.length - 1; k >= 1; k--) this.order.delete(idxs[k]!, 1);
    const now = this.order.toJSON() as string[];
    const cur = now.indexOf(seg);
    let to = before !== null ? now.indexOf(before) : now.indexOf(END);
    if (cur < 0) {
      this.order.insert(to, seg);
      return;
    }
    if (cur < to) to -= 1;
    if (cur !== to) this.order.move(cur, to);
  }

  /** 순서 목록에 없는 구획을, 화면 순서에서 그 뒤로 가장 가까운 목록 항목 앞에 넣는다 */
  private ensureListed(seg: SegId): void {
    const list = this.order.toJSON() as string[];
    if (list.includes(seg)) return;
    const docOrder = this.displayOrder();
    const listed = new Set(list);
    let to = list.indexOf(END);
    for (let k = docOrder.indexOf(seg) + 1; k < docOrder.length; k++) {
      if (listed.has(docOrder[k]!)) {
        to = list.indexOf(docOrder[k]!);
        break;
      }
    }
    this.order.insert(to, seg);
  }
}

export type { TextDelta };
