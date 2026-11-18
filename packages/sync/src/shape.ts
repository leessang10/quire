/**
 * Loro 문서 모양 (09 §6): 텍스트 'body' + 구획 순서 리스트 + 상태 맵. 같은 스레드 브리지와 Worker 코어가 함께 쓴다.
 *
 * - 텍스트 'body': Doc의 살아 있는 원소 열. 구획 표식은 U+E000이고 그 글자에 마크 seg=<구획 키>.
 * - 이동 리스트 'order': 구획 키의 화면 순서 + 끝 고정 항목 END. 목록에 없는 구획은 저장 순서상 다음 구획 앞.
 * - 맵 'hidden', 'placeholder', 'used': 구획 키 → true.
 * - 처음 문서: [사용자 문단들 BRK(t)][¶ BRK(p)][¶ 보초]. t는 순서 목록에, p는 자리표시.
 * - 서식 (10 §3): 글자 서식 키는 'body'의 마크 (이어받는 키는 expand after, link는 none). 문단 속성은 그 문단 ¶ 글자의
 *   마크 p_<키> (expand none, ¶에 붙은 것만 읽는다). 스타일·목록 정의는 맵 'styles'·'lists' (이름·id → 정의, null = 지움).
 */
import { LoroDoc, type LoroMap, type LoroMovableList, type LoroText } from 'loro-crdt';
import {
  BRK_CHAR,
  DEFAULT_STYLES,
  Doc,
  INHERITED_MARKS,
  MARK_KEYS,
  PARA_KEYS,
  PARA_MARK_PREFIX,
  type ListDef,
  type MarkKey,
  type RawChange,
  type SegId,
  type SegState,
  type Style,
  type TextDelta,
} from '@quire/model';

export const TEXT = 'body';
export const ORDER = 'order';
export const END = '$end';
export const SEG_MARK = 'seg';
export const STYLES = 'styles';
export const LISTS = 'lists';
const NL = String.fromCharCode(10);

export type PeerId = number | bigint | `${number}`;

export function newLoro(peer: PeerId): LoroDoc {
  const loro = new LoroDoc();
  loro.setPeerId(peer);
  // 구획 표식·문단 속성·링크 마크는 옆에 입력한 글자로 번지지 않게 하고, 나머지 글자 서식은 끝에 입력하면 이어받는다 (10 §2.6)
  const styles: Record<string, { expand: 'after' | 'none' }> = { [SEG_MARK]: { expand: 'none' } };
  for (const k of MARK_KEYS) styles[k] = { expand: INHERITED_MARKS.has(k) ? 'after' : 'none' };
  for (const k of PARA_KEYS) styles[PARA_MARK_PREFIX + k] = { expand: 'none' };
  loro.configTextStyle(styles);
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

/** Loro 텍스트의 서식 → 서식만 바꾸는 델타 (retain + attributes). Doc.fromRaw로 만든 문서에 applyDelta로 입힌다 */
export function formatDelta(loro: LoroDoc): TextDelta {
  const out: TextDelta = [];
  let plain = 0;
  for (const op of loro.getText(TEXT).toDelta()) {
    if (typeof op.insert !== 'string') continue;
    const n = op.insert.length;
    const attrs: Record<string, unknown> = {};
    let any = false;
    for (const [k, v] of Object.entries(op.attributes ?? {})) {
      if (k === SEG_MARK || v === null || v === undefined) continue;
      attrs[k] = v;
      any = true;
    }
    if (!any) {
      plain += n;
      continue;
    }
    if (plain) out.push({ retain: plain });
    plain = 0;
    out.push({ retain: n, attributes: attrs });
  }
  return out;
}

/** 맵 'styles'·'lists'의 내용 (비었으면 null) */
export function readDefs(loro: LoroDoc): { styles: Record<string, Style | null> | null; lists: Record<string, ListDef | null> | null } {
  const st = loro.getMap(STYLES).toJSON() as Record<string, Style | null>;
  const li = loro.getMap(LISTS).toJSON() as Record<string, ListDef | null>;
  return { styles: Object.keys(st).length ? st : null, lists: Object.keys(li).length ? li : null };
}

/** 서식까지 담은 처음 상태 (Worker → 메인의 init·reset에 싣는다) */
export interface FormatState {
  fmt: TextDelta;
  styles: Record<string, Style | null> | null;
  lists: Record<string, ListDef | null> | null;
}

export function readFormats(loro: LoroDoc): FormatState {
  return { fmt: formatDelta(loro), ...readDefs(loro) };
}

/** Doc.fromRaw로 만든 문서에 서식·정의를 입힌다 (기록 없음) */
export function applyFormats(doc: Doc, f: FormatState): void {
  if (f.fmt.length) doc.applyDelta(f.fmt);
  if (f.styles || f.lists) doc.applyRemoteDefs(f.styles, f.lists);
  doc.takeParagraphChanges();
}

/** Loro 문서 → 서식까지 담은 Doc (텍스트와 서식을 한 번에 읽는다) */
export function docFromLoro(loro: LoroDoc, peer?: string): Doc {
  const keys: SegId[] = [];
  const fmt: TextDelta = [];
  let raw = '';
  let plain = 0;
  for (const op of loro.getText(TEXT).toDelta()) {
    if (typeof op.insert !== 'string') continue;
    raw += op.insert;
    const n = op.insert.length;
    let attrs: Record<string, unknown> | null = null;
    for (const [k, v] of Object.entries(op.attributes ?? {})) {
      if (k === SEG_MARK) {
        if (typeof v === 'string') keys.push(v);
        continue;
      }
      if (v === null || v === undefined) continue;
      (attrs ??= {})[k] = v;
    }
    if (!attrs) {
      plain += n;
      continue;
    }
    if (plain) fmt.push({ retain: plain });
    plain = 0;
    fmt.push({ retain: n, attributes: attrs });
  }
  const doc = Doc.fromRaw(raw, keys, readState(loro), peer ?? loro.peerIdStr);
  applyFormats(doc, { fmt, ...readDefs(loro) });
  return doc;
}

/**
 * 압축한 새 Loro 문서(initLoro로 화면 텍스트를 넣은 것, 구획 하나)에 doc의 서식·문단 속성·정의를 쓴다 (커밋은 부르는 쪽).
 * 화면 텍스트 위치 = Loro 위치 (UTF-16).
 */
export function writeFormats(loro: LoroDoc, doc: Doc): void {
  const text = loro.getText(TEXT);
  let u = 0;
  const paras = doc.paragraphs();
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]!;
    const cps = Array.from(p.text);
    let k = 0;
    while (k < cps.length) {
      const f = p.fmt ? p.fmt[k]! : 0;
      let j = k + 1;
      let w = cps[k]!.length;
      while (j < cps.length && (p.fmt ? p.fmt[j]! : 0) === f) w += cps[j++]!.length;
      if (f !== 0) for (const [key, v] of Object.entries(doc.markSet(f))) text.mark({ start: u, end: u + w }, key, v);
      u += w;
      k = j;
    }
    // ¶: 글자 서식(빈 줄 높이)과 문단 속성
    if (p.mark !== 0) for (const [key, v] of Object.entries(doc.markSet(p.mark))) text.mark({ start: u, end: u + 1 }, key, v);
    for (const [key, v] of Object.entries(p.attrs)) if (v !== undefined) text.mark({ start: u, end: u + 1 }, PARA_MARK_PREFIX + key, v);
    u += 1;
  }
  const defaults = new Map(DEFAULT_STYLES.map((st) => [st.name, JSON.stringify(st)]));
  const sm = loro.getMap(STYLES);
  for (const st of doc.styles()) if (defaults.get(st.name) !== JSON.stringify(st)) sm.set(st.name, structuredClone(st));
  for (const name of defaults.keys()) if (!doc.style(name)) sm.set(name, null);
  const lm = loro.getMap(LISTS);
  for (const l of doc.lists()) lm.set(l.id, structuredClone(l));
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
  private readonly styles: LoroMap;
  private readonly lists: LoroMap;

  constructor(
    loro: LoroDoc,
    private readonly displayOrder: () => SegId[],
  ) {
    this.text = loro.getText(TEXT);
    this.order = loro.getMovableList(ORDER);
    this.maps = { hidden: loro.getMap('hidden'), placeholder: loro.getMap('placeholder'), used: loro.getMap('used') };
    this.styles = loro.getMap(STYLES);
    this.lists = loro.getMap(LISTS);
  }

  /**
   * 넣은 글자의 서식을 Doc과 같게 맞춘다. Loro는 앞 글자 서식을 이어받게(expand after) 해 두었으므로 보통은 이미 같고,
   * 다를 때(보류 서식, 문단 첫머리, 서식 범위 안 입력)만 마크를 고친다.
   */
  private fixInsertedMarks(at: number, len: number, want: Record<string, unknown>): void {
    let u = at;
    for (const op of this.text.sliceDelta(at, at + len)) {
      if (typeof op.insert !== 'string') continue;
      const n = op.insert.length;
      const have = op.attributes ?? {};
      if (have[SEG_MARK] === undefined) {
        for (const k of MARK_KEYS) {
          const h = have[k] ?? undefined;
          const w = want[k];
          if (sameJson(h, w)) continue;
          if (w === undefined) this.text.unmark({ start: u, end: u + n }, k);
          else this.text.mark({ start: u, end: u + n }, k, w);
        }
        for (const k of Object.keys(have)) if (k.startsWith(PARA_MARK_PREFIX)) this.text.unmark({ start: u, end: u + n }, k);
      }
      u += n;
    }
  }

  apply(c: RawChange): void {
    switch (c.kind) {
      case 'insert': {
        this.text.insert(c.at, c.text);
        this.fixInsertedMarks(c.at, c.text.length, (c.marks ?? {}) as Record<string, unknown>);
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
      case 'mark':
        if (c.value === undefined || c.value === null) this.text.unmark({ start: c.at, end: c.at + c.len }, c.key);
        else this.text.mark({ start: c.at, end: c.at + c.len }, c.key, c.value);
        break;
      case 'para': {
        const key = PARA_MARK_PREFIX + c.key;
        if (c.value === undefined || c.value === null) this.text.unmark({ start: c.at, end: c.at + 1 }, key);
        else this.text.mark({ start: c.at, end: c.at + 1 }, key, c.value);
        break;
      }
      case 'style':
        this.styles.set(c.name, c.def);
        break;
      case 'listDef':
        this.lists.set(c.id, c.def);
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

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  return typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
}

export type { MarkKey };
