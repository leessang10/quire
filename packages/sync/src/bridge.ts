/**
 * 편집 모델(Doc) ↔ Loro 브리지 (09)
 *
 * - Doc이 화면의 원본이다. 로컬 편집은 Doc에 먼저 반영되고, Doc의 변경 기록(UTF-16 위치)을 받아
 *   같은 변경을 Loro에 바로 적용한다 (Loro 로컬 입력 + 커밋은 0.1 ms 미만).
 * - 업데이트 내보내기·가져오기는 batchMs마다 한 번으로 묶는다 (큰 문서에서 1회 고정 비용이 크다).
 * - 원격 업데이트를 가져오면 텍스트 델타를 Doc에 적용하고, 구획 상태(순서·숨김·자리표시)를 Loro에서 읽어 맞춘다.
 *
 * Loro 표현 (V4 M4)
 * - 텍스트 'body': Doc의 살아 있는 원소 열. 구획 표식은 U+E000이고 그 글자에 마크 seg=<구획 키>를 붙인다
 *   (원격 델타에 키가 함께 실려 오므로 ID 대응표가 필요 없다).
 * - 이동 리스트 'order': 구획 키의 화면 순서 + 끝 고정 항목 END. 목록에 없는 구획은 저장 순서상 다음 구획 앞.
 * - 맵 'hidden', 'placeholder', 'used': 구획 키 → true.
 * - 처음 문서: [사용자 문단들 BRK(t)][¶ BRK(p)][¶ 보초]. t는 순서 목록에, p는 자리표시.
 */
import { LoroDoc, type LoroEventBatch, type LoroMap, type LoroMovableList, type LoroText, type VersionVector } from 'loro-crdt';
import { BRK_CHAR, Doc, type RawChange, type SegId, type SegState, type TextDelta } from '@quire/model';

const TEXT = 'body';
const ORDER = 'order';
const END = '$end';
const SEG_MARK = 'seg';
const LOCAL_ORIGIN = 'quire-local';
const NL = String.fromCharCode(10);

export interface SyncOptions {
  /** 이 피어의 ID (피어마다 달라야 한다) */
  peer: number | bigint | `${number}`;
  /** 내보낼 업데이트가 생기면 호출된다 (묶음 단위) */
  onUpdate?: (update: Uint8Array) => void;
  /** 원격 업데이트를 Doc에 반영한 뒤 호출된다 (화면 갱신용) */
  onRemoteChange?: () => void;
  /** 내보내기·가져오기 묶음 간격 (ms). null이면 자동으로 하지 않고 flush()를 직접 부른다 */
  batchMs?: number | null;
}

export class SyncBridge {
  readonly doc: Doc;
  readonly loro: LoroDoc;
  private readonly text: LoroText;
  private readonly order: LoroMovableList;
  private readonly maps: Record<'hidden' | 'placeholder' | 'used', LoroMap>;
  private readonly opts: SyncOptions;
  /** 마지막으로 내보낸 시점의 버전 (그 사이 가져온 원격 연산 포함) */
  private exported: VersionVector;
  private inbox: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribe: () => void;
  private destroyed = false;

  /** 새 문서를 만든다 (처음 만드는 피어) */
  static create(text: string, opts: SyncOptions): SyncBridge {
    const loro = newLoro(opts.peer);
    const body = loro.getText(TEXT);
    const user = text.replace(/\r\n?/g, NL) + NL;
    body.insert(0, user + BRK_CHAR + NL + BRK_CHAR + NL);
    const t = `${String(opts.peer)}.t`;
    const p = `${String(opts.peer)}.p`;
    const u = user.length;
    body.mark({ start: u, end: u + 1 }, SEG_MARK, t);
    body.mark({ start: u + 2, end: u + 3 }, SEG_MARK, p);
    const order = loro.getMovableList(ORDER);
    order.insert(0, t);
    order.insert(1, 'tail');
    order.insert(2, END);
    loro.getMap('placeholder').set(p, true);
    loro.commit();
    return SyncBridge.fromLoro(loro, opts);
  }

  /** 다른 피어가 내보낸 스냅샷에서 시작한다 */
  static fromSnapshot(snapshot: Uint8Array, opts: SyncOptions): SyncBridge {
    const loro = newLoro(opts.peer);
    loro.import(snapshot);
    return SyncBridge.fromLoro(loro, opts);
  }

  private static fromLoro(loro: LoroDoc, opts: SyncOptions): SyncBridge {
    const body = loro.getText(TEXT);
    const keys: SegId[] = [];
    let raw = '';
    for (const op of body.toDelta()) {
      if (typeof op.insert !== 'string') continue;
      raw += op.insert;
      const key = op.attributes?.[SEG_MARK];
      if (typeof key === 'string') keys.push(key);
    }
    const doc = Doc.fromRaw(raw, keys, readState(loro), String(opts.peer));
    return new SyncBridge(doc, loro, opts);
  }

  private constructor(doc: Doc, loro: LoroDoc, opts: SyncOptions) {
    this.doc = doc;
    this.loro = loro;
    this.opts = opts;
    this.text = loro.getText(TEXT);
    this.order = loro.getMovableList(ORDER);
    this.maps = { hidden: loro.getMap('hidden'), placeholder: loro.getMap('placeholder'), used: loro.getMap('used') };
    this.exported = loro.oplogVersion();
    doc.observe((c) => this.onLocal(c));
    this.unsubscribe = loro.subscribe((e) => this.onEvent(e));
  }

  /** 전체 스냅샷 (새 피어가 참여할 때) */
  snapshot(): Uint8Array {
    return this.loro.export({ mode: 'snapshot' });
  }

  /** 원격 업데이트를 받는다. 다음 묶음 때 적용한다 */
  receive(update: Uint8Array): void {
    this.inbox.push(update);
    this.schedule();
  }

  /**
   * 묶음 처리: 지난번 이후의 로컬 변경을 내보내고, 받아 둔 원격 업데이트를 가져와 Doc에 적용한다.
   * 내보내기를 먼저 해야 이번에 가져온 원격 연산이 다음 내보내기에 섞이지 않는다.
   */
  flush(): void {
    if (this.destroyed) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const now = this.loro.oplogVersion();
    if (now.compare(this.exported) !== 0) {
      const update = this.loro.export({ mode: 'update', from: this.exported });
      this.opts.onUpdate?.(update);
    }
    if (this.inbox.length > 0) {
      const batch = this.inbox;
      this.inbox = [];
      this.loro.importBatch(batch);
      this.opts.onRemoteChange?.();
    }
    this.exported = this.loro.oplogVersion();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.unsubscribe();
    this.doc.observe(null);
  }

  // ── 로컬 → Loro ───────────────────────────────────────

  private onLocal(c: RawChange): void {
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
    this.loro.commit({ origin: LOCAL_ORIGIN });
    this.schedule();
  }

  /** 순서 목록에서 seg를 before 앞으로 (null이면 END 앞). 목록에 없으면 그 자리에 넣고, 중복 항목은 지운다 */
  private placeBefore(seg: SegId, before: SegId | null): void {
    if (before !== null) this.ensureListed(before);
    const list = this.order.toJSON() as string[];
    const idxs: number[] = [];
    list.forEach((v, k) => v === seg && idxs.push(k));
    // 동시에 같은 구획을 넣어 생긴 중복은 하나만 남긴다
    for (let k = idxs.length - 1; k >= 1; k--) this.order.delete(idxs[k]!, 1);
    const cur = (this.order.toJSON() as string[]).indexOf(seg);
    const now = this.order.toJSON() as string[];
    let to = before !== null ? now.indexOf(before) : now.indexOf(END);
    if (cur < 0) {
      this.order.insert(to, seg);
      return;
    }
    if (cur < to) to -= 1;
    if (cur !== to) this.order.move(cur, to);
  }

  /** 순서 목록에 없는 구획을, Doc의 화면 순서에서 그 뒤로 가장 가까운 목록 항목 앞에 넣는다 */
  private ensureListed(seg: SegId): void {
    const list = this.order.toJSON() as string[];
    if (list.includes(seg)) return;
    const docOrder = this.doc.segmentOrder();
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

  // ── Loro → Doc ────────────────────────────────────────

  private onEvent(e: LoroEventBatch): void {
    // 로컬 커밋은 이미 Doc에 반영되어 있다. 가져오기는 'import', 여러 업데이트를 한꺼번에 가져오면
    // (importBatch) 'checkout'으로 온다 → 로컬이 아닌 것은 모두 적용한다.
    if (e.by === 'local') return;
    let segDirty = false;
    for (const ev of e.events) {
      if (ev.target === this.text.id && ev.diff.type === 'text') {
        const delta = ev.diff.diff as TextDelta;
        this.doc.applyDelta(delta);
        if (delta.some((d) => d.attributes?.[SEG_MARK] !== undefined)) segDirty = true;
      } else {
        segDirty = true;
      }
    }
    // 텍스트(새 구획 표식)를 먼저 적용한 뒤 구획 상태를 맞춘다
    if (segDirty) this.doc.applySegState(readState(this.loro));
  }

  private schedule(): void {
    const ms = this.opts.batchMs === undefined ? 50 : this.opts.batchMs;
    if (ms === null || this.timer !== null || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, ms);
  }
}

function newLoro(peer: SyncOptions['peer']): LoroDoc {
  const loro = new LoroDoc();
  loro.setPeerId(peer);
  // 구획 표식 마크는 옆에 입력한 글자로 번지지 않게 한다
  loro.configTextStyle({ [SEG_MARK]: { expand: 'none' } });
  return loro;
}

function keysOf(map: LoroMap): SegId[] {
  const out: SegId[] = [];
  for (const [k, v] of Object.entries(map.toJSON() as Record<string, unknown>)) if (v === true) out.push(k);
  return out;
}

function readState(loro: LoroDoc): SegState {
  return {
    order: (loro.getMovableList(ORDER).toJSON() as string[]).filter((v) => v !== END),
    hidden: keysOf(loro.getMap('hidden')),
    placeholder: keysOf(loro.getMap('placeholder')),
    used: keysOf(loro.getMap('used')),
  };
}
