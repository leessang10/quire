/**
 * 문서 모델: 단일 스토리, 평평한 원소 열 + 문단 표식(¶) + 구획.
 * 설계: docs/design/01-document-model.md
 *
 * - 원소 1개 = 유니코드 코드포인트 1개 또는 문단 표식 1개 또는 구획 표식 1개
 * - 삭제는 묘비(tombstone) 처리 → ID 기반 위치가 삭제 후에도 해석됨
 * - 스토리는 항상 살아 있는 ¶로 끝난다
 *
 * 저장 구조 (성능)
 * - 원소 열을 청크로 나누고, 청크는 원소별 객체 없이 typed array 세 개(코드포인트, 카운터, 상태)로 저장한다.
 *   원소 수백만 개에서도 GC가 추적할 객체가 거의 없다.
 * - 청크마다 보이는 원소 수를 유지 → 오프셋 ↔ 원소 변환이 O(청크 수 + 청크 크기)
 * - 원소 ID는 `${peer}:${counter}`. 카운터 → 청크 표로 ID에서 청크를 바로 찾는다
 * - 문단 목록은 변경된 구간만 다시 만든다 (뒤쪽 문단은 오프셋만 이동)
 *
 * 구획 (ADR-0003, 01 §2 구획 표식)
 * - 저장 열은 보이지 않는 구획 표식(BRK) 원소로 구획들로 나뉜다. 구획 ID = 구획을 끝내는 BRK의 원소 ID,
 *   마지막 구획은 'tail'. 화면 순서는 구획 순서 목록(order)이 정하고, 숨긴 구획은 화면에 나오지 않는다.
 * - 공개 API의 오프셋은 모두 **화면 오프셋**이다: 화면 순서로 이어 붙인 구획들에서 BRK·묘비·숨긴 구획을 뺀 위치.
 *   내부의 "raw 오프셋"은 저장 순서에서 살아 있는 원소(숨긴 구획 포함, BRK 제외)의 위치다.
 * - 문단 이동은 글자를 옮기지 않고 구획 순서만 바꾼다. 문단 삭제(숨김)는 구획을 숨긴다.
 * - 불변식: 화면에 나오는 비어 있지 않은 구획은 ¶로 끝난다 → 문단이 구획 경계에 걸치지 않는다.
 *   구획 끝 ¶를 지우는 삭제는 남은 꼬리 글자를 다음 구획 첫 문단 앞으로 옮긴다(복사 후 원본 삭제).
 * - 구획이 하나뿐이면(이동·숨김을 한 적 없는 문서) 화면 오프셋 = raw 오프셋인 빠른 경로를 쓴다.
 *
 * 0단계 한계: 단일 피어만 지원 (다른 피어 ID는 해석하지 않음). CRDT 통합 시 교체 (05, ADR-0003).
 * 동시 편집용 보초·자리표시 구획(spikes/crdt M4)은 CRDT 통합 때 들인다. 구획 수에 비례하는 선형 탐색을 쓴다
 * (구획은 이동·삭제 횟수만큼만 생기므로 적다. 많아지면 균형 트리로 바꾼다).
 */

export type ElementId = string;
export type Side = 'before' | 'after';

/** 원소 사이의 틈을 원소 ID 기준으로 가리키는 안정적 위치 (01 §3.2) */
export interface Position {
  anchor: ElementId;
  side: Side;
}

/** 문서 텍스트에서 문단 표식을 나타내는 문자 */
export const PARA = '\n';
const PARA_CODE = 10;
/** 구획 표식. 유니코드 범위 밖 값이라 사용자 글자와 겹치지 않는다 */
const BRK_CODE = 0x110000;
/** 원소 상태(dead 배열): 0 = 살아 있음, TOMB = 묘비, STRUCT = 구획 표식(보이지 않지만 살아 있음) */
const TOMB = 1;
const STRUCT = 2;

export type SegId = string;

/** 구획 순서·숨김 상태 (실행 취소 단위) */
export interface SegState {
  order: SegId[];
  hidden: SegId[];
}

/** 연산은 "어떤 원소들이 보이게/안 보이게 되었는가" 또는 "구획 상태가 어떻게 바뀌었는가"로 기록한다 */
export type Op =
  | { type: 'insert'; ids: ElementId[] }
  | { type: 'delete'; ids: ElementId[] }
  | { type: 'segments'; before: SegState; after: SegState };

/**
 * 원소 열 변경 기록 (CRDT 브리지용, 09 §4). 위치·길이는 UTF-16 단위이고 구획 표식은 U+E000 한 글자로 센다.
 * 순서대로 적용하면 상대 텍스트가 이 Doc의 살아 있는 원소 열(구획 표식 포함)과 같아진다.
 */
export type RawChange =
  | { kind: 'insert'; at: number; text: string }
  | { kind: 'delete'; at: number; len: number };

/** 원격 텍스트 델타 (UTF-16 단위) */
export type TextDelta = Array<{ retain?: number; insert?: string; delete?: number }>;

/** 구획 표식이 외부(CRDT) 텍스트에서 쓰는 문자 */
export const BRK_CHAR = '';

export interface ParagraphInfo {
  /** 문단 ID = 문단을 끝내는 ¶ 원소의 ID */
  id: ElementId;
  /** 문단 첫 원소의 (화면) 오프셋 */
  start: number;
  /** 문단 ¶의 오프셋 (문단 텍스트는 [start, end)) */
  end: number;
  /** 변경되지 않은 문단은 같은 문자열 객체를 유지한다 (레이아웃 재사용 판단용) */
  text: string;
}

interface Seg {
  id: SegId;
  /** raw 길이: 살아 있는 원소 수 (BRK 제외) */
  len: number;
  hidden: boolean;
}

/** 변경 기록용: 저장 순서로 이어진 원소 구간 */
interface Run {
  chunk: Chunk;
  i: number;
  /** UTF-16 위치 (묘비로 만들 때는 바꾸기 전) */
  at: number;
  len: number;
  codes: number[];
}

const CHUNK = 512;
const CAP = CHUNK * 2;
/** 처음 불러올 때 청크를 채우는 양. 입력할 여유를 남기고 거의 채워 메모리를 아낀다 */
const LOAD_FILL = CAP - 64;

class Chunk {
  /** 청크 배열 안의 위치 (분할 시 바뀜) */
  index = 0;
  /** 고유 번호 (바뀌지 않음). 카운터 → 청크 표에 저장된다 */
  id = 0;
  len = 0;
  /** 살아 있는 원소 수 (구획 표식 제외) */
  visible = 0;
  /** 묘비가 아닌 원소의 UTF-16 길이 (구획 표식은 1) */
  u16 = 0;
  readonly codes = new Uint32Array(CAP);
  readonly ctrs = new Int32Array(CAP);
  readonly dead = new Uint8Array(CAP);

  /** 카운터의 청크 내 위치 */
  find(ctr: number): number {
    const { ctrs, len } = this;
    for (let i = 0; i < len; i++) if (ctrs[i] === ctr) return i;
    return -1;
  }
}

export class Doc {
  private chunks: Chunk[] = [];
  /** 카운터 → 그 원소가 들어 있는 청크의 id. GC가 추적하지 않는 typed array로 둔다 */
  private chunkIdOf = new Int32Array(1024);
  /** 청크 id → 청크 (분할로 사라진 청크는 null) */
  private chunkById: Array<Chunk | null> = [];
  private counter = 0;
  /** raw 길이 (숨긴 구획 포함) */
  private visible = 0;
  private _version = 0;
  private paras: ParagraphInfo[] = [];
  /** 마지막 takeParagraphChanges() 이후 바뀐 문단 구간: 앞에서 changeFrom개, 뒤에서 changeSuffix개는 그대로 */
  private changeFrom = Infinity;
  private changeSuffix = Infinity;
  /** 저장 순서의 구획 */
  private segs: Seg[] = [{ id: 'tail', len: 0, hidden: false }];
  /** 화면 순서의 구획 (숨긴 구획 포함) */
  private order: Seg[] = [this.segs[0]!];
  private segMap = new Map<SegId, Seg>([['tail', this.segs[0]!]]);
  private listener: ((c: RawChange) => void) | null = null;
  /** 원격 델타 적용 중 (변경 기록을 보내지 않음) */
  private muted = false;
  /** false면 구획 연산(문단 이동·숨김)을 거부한다 (구획을 동기화하지 않는 브리지가 붙었을 때) */
  segmentsEnabled = true;

  constructor(readonly peer = 'local') {}

  /** 원소 열 변경 기록을 받는다 (하나만). null이면 해제 */
  observe(fn: ((c: RawChange) => void) | null): void {
    this.listener = fn;
  }

  private emit(c: RawChange): void {
    if (this.listener && !this.muted) this.listener(c);
  }

  /** 살아 있는 원소 열 전체 (구획 표식은 U+E000, 숨긴 구획 포함, 저장 순서). CRDT 텍스트와 같아야 한다 */
  rawText(): string {
    const out: number[] = [];
    for (const c of this.chunks)
      for (let i = 0; i < c.len; i++) {
        if (c.dead[i] === TOMB) continue;
        out.push(c.dead[i] === STRUCT ? BRK_CHAR.codePointAt(0)! : c.codes[i]!);
      }
    return fromCodes(out);
  }

  /**
   * 원격 텍스트 델타를 적용한다 (UTF-16 단위, 구획 표식 포함 위치). 변경 기록은 보내지 않는다.
   * 1단계: 구획이 하나인 문서만 (구획 동기화는 2단계).
   */
  applyDelta(delta: TextDelta): void {
    if (!this.simple) throw new Error('applyDelta: segmented documents are not synced yet');
    this.muted = true;
    try {
      let pos = 0;
      for (const op of delta) {
        if (op.retain !== undefined) {
          pos += op.retain;
        } else if (op.insert !== undefined) {
          const codes = toCodes(op.insert);
          if (codes.length === 0) continue;
          if (codes.includes(BRK_CHAR.codePointAt(0)!)) throw new Error('applyDelta: segment marks are not synced yet');
          const { chunk, index, raw } = this.locateU16(pos);
          this.insertIntoChunk(chunk, index, codes, 0);
          this.visible += codes.length;
          this.segs[0]!.len += codes.length;
          this.updateParagraphs(raw, raw + codes.length, codes.length);
          this._version++;
          pos += op.insert.length;
        } else if (op.delete !== undefined && op.delete > 0) {
          const { raw } = this.locateU16(pos);
          let left = op.delete;
          let n = 0;
          this.rawForEach(raw, (code, _ctr, chunk, i) => {
            chunk.dead[i] = TOMB;
            chunk.visible--;
            const w = width16(code);
            chunk.u16 -= w;
            left -= w;
            n++;
            return left <= 0;
          });
          this.visible -= n;
          this.segs[0]!.len -= n;
          this.updateParagraphs(raw, raw, -n);
          this._version++;
        }
      }
    } finally {
      this.muted = false;
    }
  }

  static fromText(text: string, peer?: string): Doc {
    const doc = new Doc(peer);
    const norm = normalizeNewlines(text);

    // 중간 배열 없이 문자열에서 바로 청크를 채운다
    doc.chunkIdOf = new Int32Array(norm.length + 1 + 1024); // 코드포인트 수 ≤ UTF-16 길이
    const chunks: Chunk[] = [];
    let chunk = doc.newChunk();
    chunks.push(chunk);
    const paraCtrs: number[] = [];
    const paraOffsets: number[] = [];
    let off = 0;
    const push = (code: number) => {
      if (chunk.len === LOAD_FILL) {
        chunk = doc.newChunk();
        chunk.index = chunks.length;
        chunks.push(chunk);
      }
      const ctr = doc.nextCtr();
      const i = chunk.len++;
      chunk.codes[i] = code;
      chunk.ctrs[i] = ctr;
      chunk.visible++;
      chunk.u16 += width16(code);
      doc.chunkIdOf[ctr] = chunk.id;
      if (code === PARA_CODE) {
        paraCtrs.push(ctr);
        paraOffsets.push(off);
      }
      off++;
    };
    for (let i = 0; i < norm.length; i++) {
      let c = norm.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < norm.length) {
        const d = norm.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        }
      }
      push(c);
    }
    push(PARA_CODE); // 스토리는 항상 ¶로 끝난다
    doc.chunks = chunks;
    doc.visible = off;
    doc.segs[0]!.len = off;

    // 문단 텍스트는 원문을 나눠서 얻는다 (코드포인트에서 문자열을 다시 만들지 않음)
    const parts = norm.split(PARA);
    doc.paras = parts.map((t, k) => ({
      id: doc.idOf(paraCtrs[k]!),
      start: k === 0 ? 0 : paraOffsets[k - 1]! + 1,
      end: paraOffsets[k]!,
      text: t,
    }));
    doc._version++;
    return doc;
  }

  /** 변경될 때마다 증가 */
  get version(): number {
    return this._version;
  }

  /** 화면에 나오는 원소 수 (마지막 ¶ 포함) */
  get length(): number {
    return this.dispTotal();
  }

  /** 커서가 놓일 수 있는 최대 오프셋 (마지막 ¶ 앞) */
  get maxCaret(): number {
    return this.dispTotal() - 1;
  }

  /** 구획 수 (진단용) */
  get segmentCount(): number {
    return this.segs.length;
  }

  text(): string {
    return this.slice(0, this.length);
  }

  slice(from: number, to: number): string {
    const out: number[] = [];
    let n = to - from;
    if (n <= 0) return '';
    this.forEachFrom(from, (code) => {
      out.push(code);
      return --n <= 0;
    });
    return fromCodes(out);
  }

  /**
   * 마지막 호출 이후 문단 목록에서 바뀐 구간을 돌려주고 기록을 비운다.
   * from: 앞에서부터 그대로인 문단 수, suffix: 뒤에서부터 그대로인 문단 수 (그대로인 문단은 같은 객체).
   * 레이아웃이 문단 목록 전체를 비교하지 않아도 되게 하는 힌트다.
   */
  takeParagraphChanges(): { from: number; suffix: number } {
    const r = { from: this.changeFrom, suffix: this.changeSuffix };
    this.changeFrom = Infinity;
    this.changeSuffix = Infinity;
    return r;
  }

  /** 문단 목록 (화면 순서). 내부 배열을 그대로 돌려주므로 호출 측에서 수정하면 안 된다 */
  paragraphs(): readonly ParagraphInfo[] {
    return this.paras;
  }

  /** offset을 포함하는 문단의 인덱스 */
  paragraphIndexAt(offset: number): number {
    return findParaByStart(this.paras, offset);
  }

  /**
   * offset 위치(틈)에 텍스트를 삽입한다. '\n'은 문단 표식이 된다.
   * @returns 새로 만든 원소 ID 목록 (실행 취소용)
   */
  insertText(offset: number, text: string): ElementId[] {
    const codes = toCodes(normalizeNewlines(text));
    if (codes.length === 0) return [];
    offset = clamp(offset, 0, this.maxCaret);
    const { seg, raw } = this.toRaw(offset);
    const { chunk, index } = this.locateRaw(raw);
    const at = this.listener ? this.u16At(chunk, index) : 0;
    const first = this.insertIntoChunk(chunk, index, codes, 0);
    this.visible += codes.length;
    seg.len += codes.length;
    this.updateParagraphs(offset, offset + codes.length, codes.length);
    this._version++;
    this.emit({ kind: 'insert', at, text: fromCodes(codes) });
    return this.idRange(first, codes.length);
  }

  /**
   * [from, to) 구간을 삭제(묘비 처리)한다. 마지막 ¶는 지울 수 없다.
   * 구간이 구획 끝 ¶를 지우면, 그 구획에 남은 꼬리 글자를 다음 구획 첫 문단 앞으로 옮긴다(복사 + 원본 삭제).
   * @returns 실행 취소용 연산 목록 (보통 delete 하나)
   */
  deleteRange(from: number, to: number): Op[] {
    from = clamp(from, 0, this.maxCaret);
    to = clamp(to, from, this.maxCaret);
    if (from === to) return [];
    if (this.simple) {
      const ids: ElementId[] = [];
      let n = to - from;
      let at = 0;
      if (this.listener) {
        const { chunk, index } = this.locateRaw(from);
        at = this.u16At(chunk, index);
      }
      let len16 = 0;
      this.rawForEach(from, (code, ctr, chunk, i) => {
        chunk.dead[i] = TOMB;
        chunk.visible--;
        const w = width16(code);
        chunk.u16 -= w;
        len16 += w;
        ids.push(this.idOf(ctr));
        return --n <= 0;
      });
      this.visible -= ids.length;
      this.segs[0]!.len -= ids.length;
      this.updateParagraphs(from, from, -ids.length);
      this._version++;
      this.emit({ kind: 'delete', at, len: len16 });
      return [{ type: 'delete', ids }];
    }

    // 화면 구간을 구획별 raw 구간으로 나눈다
    const pieces: Array<{ seg: Seg; raw: number; n: number; endsSeg: boolean; ids: ElementId[] }> = [];
    let ds = 0;
    for (const s of this.order) {
      if (s.hidden || s.len === 0) continue;
      const a = Math.max(from, ds);
      const b = Math.min(to, ds + s.len);
      if (a < b) pieces.push({ seg: s, raw: this.rawStartOf(s) + a - ds, n: b - a, endsSeg: b === ds + s.len, ids: [] });
      ds += s.len;
      if (ds >= to) break;
    }
    // 저장 순서상 뒤에서부터 지워야 앞서 계산한 raw 위치가 그대로 맞다
    for (const p of [...pieces].sort((x, y) => y.raw - x.raw)) {
      let n = p.n;
      let at = 0;
      if (this.listener) {
        const { chunk, index } = this.locateRaw(p.raw);
        at = this.u16At(chunk, index);
      }
      let len16 = 0;
      this.rawForEach(p.raw, (code, ctr, chunk, i) => {
        chunk.dead[i] = TOMB;
        chunk.visible--;
        const w = width16(code);
        chunk.u16 -= w;
        len16 += w;
        p.ids.push(this.idOf(ctr));
        return --n <= 0;
      });
      p.seg.len -= p.n;
      this.emit({ kind: 'delete', at, len: len16 });
    }
    const ids = pieces.flatMap((p) => p.ids);
    this.visible -= ids.length;
    this.updateParagraphs(from, from, -ids.length);
    this._version++;
    const ops: Op[] = [{ type: 'delete', ids }];

    // 첫 구획이 끝 ¶를 잃었으면 남은 꼬리를 다음 구획으로 옮긴다
    const first = pieces[0]!;
    if (first.endsSeg && first.seg.len > 0) {
      const segStart = this.dispStartOf(first.seg);
      const segEnd = segStart + first.seg.len;
      if (this.slice(segEnd - 1, segEnd) !== PARA) {
        const p = this.paras[findParaByStart(this.paras, segEnd - 1)]!;
        const tStart = Math.max(p.start, segStart);
        const tail = this.slice(tStart, segEnd);
        ops.push(...this.deleteRange(tStart, segEnd));
        // 꼬리를 지우면 첫 구획은 tStart에서 끝나므로, 같은 화면 위치는 다음 구획의 첫 글자를 가리킨다
        ops.push({ type: 'insert', ids: this.insertText(tStart, tail) });
      }
    }
    return ops;
  }

  // ── 구획 연산 ────────────────────────────────────────

  /**
   * 문단 i..j(화면 인덱스, 포함)를 문단 to 앞으로 옮긴다. to === 문단 수면 맨 뒤로.
   * 글자는 그대로 두고 구획 순서만 바꾼다.
   */
  moveParagraphs(i: number, j: number, to: number): Op[] {
    const n = this.paras.length;
    if (!this.segmentsEnabled) return [];
    if (i < 0 || j < i || j >= n || to < 0 || to > n || (to >= i && to <= j + 1)) return [];
    const before = this.segState();
    const targetOffset = to < n ? this.paras[to]!.start : -1;
    const run = this.isolateRun(i, j);
    let target: Seg | null = null;
    if (targetOffset >= 0) {
      this.splitAt(targetOffset);
      target = this.toRaw(targetOffset).seg;
    }
    const snap = this.displaySnapshot();
    const rest = this.order.filter((s) => !run.includes(s));
    rest.splice(target ? rest.indexOf(target) : rest.length, 0, ...run);
    this.order = rest;
    this.relist(snap);
    return [{ type: 'segments', before, after: this.segState() }];
  }

  /** 문단 i..j를 숨긴다(문단 삭제). 보이는 문단을 모두 숨기는 요청은 무시한다 */
  hideParagraphs(i: number, j: number): Op[] {
    const n = this.paras.length;
    if (!this.segmentsEnabled) return [];
    if (i < 0 || j < i || j >= n || (i === 0 && j === n - 1)) return [];
    const before = this.segState();
    const run = this.isolateRun(i, j);
    const snap = this.displaySnapshot();
    for (const s of run) s.hidden = true;
    this.relist(snap);
    return [{ type: 'segments', before, after: this.segState() }];
  }

  /** 연산 적용 (실행 취소·다시 실행) */
  apply(op: Op): void {
    if (op.type === 'insert') this.setDead(op.ids, false);
    else if (op.type === 'delete') this.setDead(op.ids, true);
    else this.applySegState(op.after);
  }

  /** 묘비가 된 원소들을 되살린다 (실행 취소·다시 실행). ids는 문서 순서여야 한다 */
  revive(ids: ElementId[]): void {
    this.setDead(ids, false);
  }

  /** 원소들을 묘비로 만든다 (실행 취소·다시 실행). ids는 문서 순서여야 한다 */
  hide(ids: ElementId[]): void {
    this.setDead(ids, true);
  }

  /** 오프셋 → 안정적 위치 */
  positionAt(offset: number): Position {
    const total = this.length;
    offset = clamp(offset, 0, total);
    const at = offset < total ? offset : total - 1;
    const { chunk, index } = this.locateRaw(this.toRaw(at).raw);
    return { anchor: this.idOf(chunk.ctrs[index]!), side: offset < total ? 'before' : 'after' };
  }

  /** 안정적 위치 → 현재 오프셋. 기준 원소가 삭제되었거나 숨긴 구획에 있으면 그 자리의 오프셋 */
  resolve(pos: Position): number {
    const ctr = this.ctrOf(pos.anchor);
    const chunk = this.chunkOfCtr(ctr);
    const i = chunk.find(ctr);
    const { off, hidden } = this.elementDisplay(chunk, i);
    return !chunk.dead[i] && !hidden && pos.side === 'after' ? off + 1 : off;
  }

  /** 디버그·테스트용: 문단 목록을 처음부터 다시 계산한 결과 */
  paragraphsFromScratch(): ParagraphInfo[] {
    return this.scanParagraphs(0, Infinity).paras;
  }

  /** 디버그·테스트용: 청크·구획 불변식 검사 */
  checkInvariants(): void {
    let visible = 0;
    this.chunks.forEach((c, k) => {
      if (c.index !== k) throw new Error(`chunk ${k} has index ${c.index}`);
      if (c.len > CAP) throw new Error(`chunk ${k} overflow`);
      let v = 0;
      let u = 0;
      for (let i = 0; i < c.len; i++) {
        if (!c.dead[i]) v++;
        if (c.dead[i] !== TOMB) u += width16(c.codes[i]!);
        if (this.chunkOfCtr(c.ctrs[i]!) !== c) throw new Error(`chunk table out of sync for ${c.ctrs[i]}`);
      }
      if (v !== c.visible) throw new Error(`chunk ${k} visible ${c.visible} != ${v}`);
      if (u !== c.u16) throw new Error(`chunk ${k} u16 ${c.u16} != ${u}`);
      visible += v;
    });
    if (visible !== this.visible) throw new Error(`visible ${this.visible} != ${visible}`);

    // 구획: 저장 열의 BRK와 구획 목록, 길이, 끝 ¶, 순서
    const lastCode = new Map<Seg, number>();
    let k = 0;
    let len = 0;
    let last = -1;
    const close = (seg: Seg | undefined, id: string) => {
      if (!seg || seg.id !== id) throw new Error(`segment list out of sync at ${id}`);
      if (seg.len !== len) throw new Error(`segment ${seg.id} len ${seg.len} != ${len}`);
      lastCode.set(seg, last);
    };
    for (const c of this.chunks) {
      for (let i = 0; i < c.len; i++) {
        if (c.dead[i] === STRUCT) {
          close(this.segs[k++], this.idOf(c.ctrs[i]!));
          len = 0;
          last = -1;
        } else if (!c.dead[i]) {
          len++;
          last = c.codes[i]!;
        }
      }
    }
    close(this.segs[k++], 'tail');
    if (k !== this.segs.length) throw new Error('segment list length out of sync');
    if (this.order.length !== this.segs.length || new Set(this.order).size !== this.segs.length)
      throw new Error('segment order is not a permutation');
    const shown = this.order.filter((s) => !s.hidden && s.len > 0);
    for (const s of shown) {
      if (!this.segs.includes(s)) throw new Error(`unknown segment ${s.id} in order`);
      if (lastCode.get(s) !== PARA_CODE) throw new Error(`segment ${s.id} does not end with a paragraph mark`);
    }
  }

  // ── 내부: ID ──────────────────────────────────────────

  private idOf(ctr: number): ElementId {
    return `${this.peer}:${ctr}`;
  }

  private ctrOf(id: ElementId): number {
    const k = id.lastIndexOf(':');
    const ctr = k >= 0 && id.slice(0, k) === this.peer ? Number(id.slice(k + 1)) : NaN;
    if (!Number.isInteger(ctr) || ctr < 0 || ctr >= this.counter) throw new Error(`unknown element ${id}`);
    return ctr;
  }

  private idRange(first: number, n: number): ElementId[] {
    const ids = new Array<ElementId>(n);
    for (let k = 0; k < n; k++) ids[k] = this.idOf(first + k);
    return ids;
  }

  // ── 내부: 청크 ────────────────────────────────────────

  private newChunk(): Chunk {
    const c = new Chunk();
    c.id = this.chunkById.length;
    this.chunkById.push(c);
    return c;
  }

  /** 새 카운터를 발급하고 카운터 → 청크 표 용량을 보장한다 */
  private nextCtr(): number {
    const ctr = this.counter++;
    if (ctr >= this.chunkIdOf.length) {
      const grown = new Int32Array(Math.max(1024, this.chunkIdOf.length * 2));
      grown.set(this.chunkIdOf);
      this.chunkIdOf = grown;
    }
    return ctr;
  }

  private chunkOfCtr(ctr: number): Chunk {
    return this.chunkById[this.chunkIdOf[ctr]!]!;
  }

  /**
   * 코드포인트 열로 청크들을 만든다. ctrs/dead를 주면 기존 원소를 옮기는 것이고,
   * 주지 않으면 새 카운터를 발급한다.
   */
  private buildChunks(
    codes: ArrayLike<number>,
    ctrs: ArrayLike<number> | null,
    dead: ArrayLike<number> | null,
    startIndex: number,
  ): Chunk[] {
    const out: Chunk[] = [];
    const n = codes.length;
    for (let s = 0; s < n || out.length === 0; s += CHUNK) {
      const c = this.newChunk();
      c.index = startIndex + out.length;
      const e = Math.min(n, s + CHUNK);
      for (let k = s; k < e; k++) {
        const i = k - s;
        const ctr = ctrs ? ctrs[k]! : this.nextCtr();
        c.codes[i] = codes[k]!;
        c.ctrs[i] = ctr;
        const d = dead ? dead[k]! : 0;
        c.dead[i] = d;
        if (!d) c.visible++;
        if (d !== TOMB) c.u16 += width16(codes[k]!);
        this.chunkIdOf[ctr] = c.id;
      }
      c.len = e - s;
      out.push(c);
      if (n === 0) break;
    }
    return out;
  }

  /** 원소들을 넣고 첫 카운터를 돌려준다. flag가 STRUCT면 보이지 않는 구획 표식 */
  private insertIntoChunk(chunk: Chunk, index: number, codes: number[], flag: number): number {
    const n = codes.length;
    const first = this.counter;
    if (chunk.len + n <= CAP) {
      chunk.codes.copyWithin(index + n, index, chunk.len);
      chunk.ctrs.copyWithin(index + n, index, chunk.len);
      chunk.dead.copyWithin(index + n, index, chunk.len);
      for (let k = 0; k < n; k++) {
        const ctr = this.nextCtr();
        chunk.codes[index + k] = codes[k]!;
        chunk.ctrs[index + k] = ctr;
        chunk.dead[index + k] = flag;
        this.chunkIdOf[ctr] = chunk.id;
      }
      chunk.len += n;
      if (!flag) chunk.visible += n;
      for (let k = 0; k < n; k++) chunk.u16 += width16(codes[k]!);
      return first;
    }
    // 넘치면 청크 내용 + 삽입 내용을 합쳐 여러 청크로 다시 나눈다
    const total = chunk.len + n;
    const allCodes = new Uint32Array(total);
    const allCtrs = new Int32Array(total);
    const allDead = new Uint8Array(total);
    allCodes.set(chunk.codes.subarray(0, index), 0);
    allCtrs.set(chunk.ctrs.subarray(0, index), 0);
    allDead.set(chunk.dead.subarray(0, index), 0);
    for (let k = 0; k < n; k++) {
      allCodes[index + k] = codes[k]!;
      allCtrs[index + k] = this.nextCtr();
      allDead[index + k] = flag;
    }
    allCodes.set(chunk.codes.subarray(index, chunk.len), index + n);
    allCtrs.set(chunk.ctrs.subarray(index, chunk.len), index + n);
    allDead.set(chunk.dead.subarray(index, chunk.len), index + n);
    const pieces = this.buildChunks(allCodes, allCtrs, allDead, chunk.index);
    this.chunkById[chunk.id] = null; // 대체된 청크 해제
    this.chunks.splice(chunk.index, 1, ...pieces);
    for (let c = chunk.index; c < this.chunks.length; c++) this.chunks[c]!.index = c;
    return first;
  }

  /** raw offset번째 살아 있는 원소의 위치. offset === raw 길이면 마지막 청크 끝 */
  private locateRaw(offset: number): { chunk: Chunk; index: number } {
    let remaining = offset;
    for (const chunk of this.chunks) {
      if (remaining < chunk.visible) {
        const { dead, len } = chunk;
        for (let i = 0; i < len; i++) {
          if (dead[i]) continue;
          if (remaining === 0) return { chunk, index: i };
          remaining--;
        }
      }
      remaining -= chunk.visible;
    }
    const last = this.chunks[this.chunks.length - 1]!;
    return { chunk: last, index: last.len };
  }

  /** 청크의 i번째 원소 앞에 있는 살아 있는 원소 수 (raw 오프셋) */
  private offsetAtRaw(chunk: Chunk, i: number): number {
    let off = 0;
    for (let c = 0; c < chunk.index; c++) off += this.chunks[c]!.visible;
    for (let k = 0; k < i; k++) if (!chunk.dead[k]) off++;
    return off;
  }

  /** raw offset부터 저장 순서로 살아 있는 원소를 방문. 콜백이 true를 반환하면 멈춘다 */
  private rawForEach(
    offset: number,
    fn: (code: number, ctr: number, chunk: Chunk, i: number) => boolean | void,
  ): void {
    const { chunk, index } = this.locateRaw(offset);
    for (let c = chunk.index; c < this.chunks.length; c++) {
      const ch = this.chunks[c]!;
      const { codes, ctrs, dead, len } = ch;
      for (let i = c === chunk.index ? index : 0; i < len; i++) {
        if (dead[i]) continue;
        if (fn(codes[i]!, ctrs[i]!, ch, i)) return;
      }
    }
  }

  /** 화면 오프셋부터 화면 순서로 원소를 방문. 콜백이 true를 반환하면 멈춘다 */
  private forEachFrom(
    offset: number,
    fn: (code: number, ctr: number, chunk: Chunk, i: number) => boolean | void,
  ): void {
    if (this.simple) {
      this.rawForEach(offset, fn);
      return;
    }
    let ds = 0;
    for (const s of this.order) {
      if (s.hidden || s.len === 0) continue;
      if (offset >= ds + s.len) {
        ds += s.len;
        continue;
      }
      const within = Math.max(0, offset - ds);
      let n = s.len - within;
      let stop = false;
      this.rawForEach(this.rawStartOf(s) + within, (code, ctr, ch, i) => {
        if (fn(code, ctr, ch, i)) {
          stop = true;
          return true;
        }
        return --n <= 0;
      });
      if (stop) return;
      ds += s.len;
    }
  }

  private setDead(ids: ElementId[], dead: boolean): void {
    const flag = dead ? TOMB : 0;
    const track = this.listener !== null && !this.muted;
    if (this.simple) {
      const changed: Array<{ chunk: Chunk; i: number }> = [];
      for (const id of ids) {
        const ctr = this.ctrOf(id);
        const chunk = this.chunkOfCtr(ctr);
        const i = chunk.find(ctr);
        if (chunk.dead[i] !== flag) changed.push({ chunk, i });
      }
      if (changed.length === 0) return;
      const runs = track ? this.runsOf(changed, dead) : null;
      let firstOffset = -1;
      for (const { chunk, i } of changed) {
        // 숨기기: 숨기기 전 첫 원소의 오프셋 = 변경 구간 시작
        if (dead && firstOffset < 0) firstOffset = this.offsetAtRaw(chunk, i);
        chunk.dead[i] = flag;
        chunk.visible += dead ? -1 : 1;
        chunk.u16 += dead ? -width16(chunk.codes[i]!) : width16(chunk.codes[i]!);
      }
      if (runs) this.emitRuns(runs, dead);
      const delta = dead ? -changed.length : changed.length;
      this.visible += delta;
      this.segs[0]!.len += delta;
      const first = changed[0]!;
      const last = changed[changed.length - 1]!;
      const a = dead ? firstOffset : this.offsetAtRaw(first.chunk, first.i);
      // ids가 연속이 아닐 수 있으므로 마지막 원소 자리까지를 변경 구간으로 본다
      const b = this.offsetAtRaw(last.chunk, last.i) + (dead ? 0 : 1);
      this.updateParagraphs(a, b, delta);
      this._version++;
      return;
    }

    const items: Array<{ chunk: Chunk; i: number; seg: Seg | null }> = [];
    for (const id of ids) {
      const ctr = this.ctrOf(id);
      const chunk = this.chunkOfCtr(ctr);
      const i = chunk.find(ctr);
      if (chunk.dead[i] !== flag) items.push({ chunk, i, seg: null });
    }
    if (items.length === 0) return;
    // 원소마다 구획을 정한다: 저장 순서로 정렬해 BRK를 세며 한 번 훑는다
    const sorted = [...items].sort((x, y) => x.chunk.index - y.chunk.index || x.i - y.i);
    const s0 = sorted[0]!;
    let seg = this.segOfElement(s0.chunk, s0.i).seg;
    let k = 0;
    sweep: for (let c = s0.chunk.index; c < this.chunks.length; c++) {
      const ch = this.chunks[c]!;
      for (let e = c === s0.chunk.index ? s0.i : 0; e < ch.len; e++) {
        if (ch.dead[e] === STRUCT) {
          seg = this.segs[this.segs.indexOf(this.segMap.get(this.idOf(ch.ctrs[e]!))!) + 1]!;
          continue;
        }
        while (k < sorted.length && sorted[k]!.chunk === ch && sorted[k]!.i === e) sorted[k++]!.seg = seg;
        if (k >= sorted.length) break sweep;
      }
    }
    const shown = items.filter((it) => !it.seg!.hidden);
    let a = 0;
    if (dead && shown.length > 0) a = this.elementDisplay(shown[0]!.chunk, shown[0]!.i).off;
    const runs = track ? this.runsOf(items, dead) : null;
    for (const it of items) {
      it.chunk.dead[it.i] = flag;
      it.chunk.visible += dead ? -1 : 1;
      it.chunk.u16 += dead ? -width16(it.chunk.codes[it.i]!) : width16(it.chunk.codes[it.i]!);
      it.seg!.len += dead ? -1 : 1;
    }
    if (runs) this.emitRuns(runs, dead);
    this.visible += dead ? -items.length : items.length;
    if (shown.length > 0) {
      const last = shown[shown.length - 1]!;
      if (!dead) a = this.elementDisplay(shown[0]!.chunk, shown[0]!.i).off;
      const b = this.elementDisplay(last.chunk, last.i).off + (dead ? 0 : 1);
      this.updateParagraphs(a, b, dead ? -shown.length : shown.length);
    }
    this._version++;
  }

  // ── 내부: UTF-16 위치 (CRDT 브리지) ─────────────────

  /** 청크의 i번째 원소 앞에 있는, 묘비가 아닌 원소의 UTF-16 길이 합 */
  private u16At(chunk: Chunk, i: number): number {
    let n = 0;
    for (let c = 0; c < chunk.index; c++) n += this.chunks[c]!.u16;
    for (let k = 0; k < i; k++) if (chunk.dead[k] !== TOMB) n += width16(chunk.codes[k]!);
    return n;
  }

  /** UTF-16 위치 pos에 있는 원소(묘비 제외)와 그 앞의 raw 오프셋. 끝이면 마지막 청크 끝 */
  private locateU16(pos: number): { chunk: Chunk; index: number; raw: number } {
    let remaining = pos;
    let raw = 0;
    for (const chunk of this.chunks) {
      if (remaining < chunk.u16) {
        for (let i = 0; i < chunk.len; i++) {
          const d = chunk.dead[i];
          if (d === TOMB) continue;
          if (remaining === 0) return { chunk, index: i, raw };
          remaining -= width16(chunk.codes[i]!);
          if (!d) raw++;
        }
      }
      remaining -= chunk.u16;
      raw += chunk.visible;
    }
    const last = this.chunks[this.chunks.length - 1]!;
    return { chunk: last, index: last.len, raw };
  }

  /**
   * 되살리거나 묘비로 만들 원소들을 저장 순서의 연속 구간으로 묶는다. 두 원소 사이에 다른 살아 있는 원소
   * (묘비가 아닌 원소)가 없으면 같은 구간. 묘비로 만들 때는 바꾸기 전 위치를 미리 잰다.
   */
  private runsOf(items: Array<{ chunk: Chunk; i: number }>, dead: boolean): Run[] {
    const sorted = [...items].sort((x, y) => x.chunk.index - y.chunk.index || x.i - y.i);
    const runs: Run[] = [];
    let k = 0;
    let cur: Run | null = null;
    const s0 = sorted[0]!;
    sweep: for (let c = s0.chunk.index; c < this.chunks.length; c++) {
      const ch = this.chunks[c]!;
      for (let e = c === s0.chunk.index ? s0.i : 0; e < ch.len; e++) {
        const item = sorted[k]!;
        if (item.chunk === ch && item.i === e) {
          if (!cur) {
            cur = { chunk: ch, i: e, at: dead ? this.u16At(ch, e) : 0, len: 0, codes: [] };
            runs.push(cur);
          }
          cur.len += width16(ch.codes[e]!);
          cur.codes.push(ch.codes[e]!);
          if (++k >= sorted.length) break sweep;
        } else if (ch.dead[e] !== TOMB) {
          cur = null;
        }
      }
    }
    return runs;
  }

  /** 묶은 구간을 변경 기록으로 보낸다: 묘비는 뒤에서부터, 되살리기는 앞에서부터 (바뀐 뒤 위치) */
  private emitRuns(runs: Run[], dead: boolean): void {
    if (dead) {
      for (let r = runs.length - 1; r >= 0; r--) this.emit({ kind: 'delete', at: runs[r]!.at, len: runs[r]!.len });
    } else {
      for (const run of runs) this.emit({ kind: 'insert', at: this.u16At(run.chunk, run.i), text: fromCodes(run.codes) });
    }
  }

  // ── 내부: 구획 ────────────────────────────────────────

  private get simple(): boolean {
    return this.segs.length === 1;
  }

  private dispTotal(): number {
    if (this.simple) return this.visible;
    let n = 0;
    for (const s of this.order) if (!s.hidden) n += s.len;
    return n;
  }

  private rawStartOf(seg: Seg): number {
    let r = 0;
    for (const s of this.segs) {
      if (s === seg) return r;
      r += s.len;
    }
    throw new Error(`unknown segment ${seg.id}`);
  }

  private dispStartOf(seg: Seg): number {
    let d = 0;
    for (const s of this.order) {
      if (s === seg) return d;
      if (!s.hidden) d += s.len;
    }
    throw new Error(`unknown segment ${seg.id}`);
  }

  /** 화면 오프셋 → 그 자리 원소가 있는 구획과 raw 오프셋. 끝(= 길이)이면 마지막 구획의 끝 */
  private toRaw(d: number): { seg: Seg; raw: number } {
    if (this.simple) return { seg: this.segs[0]!, raw: d };
    let ds = 0;
    let last: Seg | null = null;
    for (const s of this.order) {
      if (s.hidden || s.len === 0) continue;
      if (d < ds + s.len) return { seg: s, raw: this.rawStartOf(s) + d - ds };
      ds += s.len;
      last = s;
    }
    return { seg: last!, raw: this.rawStartOf(last!) + last!.len };
  }

  /** raw 오프셋 r의 살아 있는 원소가 있는 구획 */
  private segAtRaw(r: number): Seg {
    let rs = 0;
    for (const s of this.segs) {
      if (r < rs + s.len) return s;
      rs += s.len;
    }
    return this.segs[this.segs.length - 1]!;
  }

  /**
   * 원소(묘비 포함)가 속한 구획과 raw 오프셋. 묘비는 저장 순서로 다음 살아 있는 원소 또는 BRK를 찾아 정한다
   * (묘비 바로 뒤에 BRK가 있으면 그 BRK가 끝내는 구획).
   */
  private segOfElement(chunk: Chunk, i: number): { seg: Seg; raw: number } {
    const raw = this.offsetAtRaw(chunk, i);
    if (this.simple) return { seg: this.segs[0]!, raw };
    for (let c = chunk.index; c < this.chunks.length; c++) {
      const ch = this.chunks[c]!;
      for (let k = c === chunk.index ? i : 0; k < ch.len; k++) {
        const d = ch.dead[k];
        if (d === 0) return { seg: this.segAtRaw(raw), raw };
        if (d === STRUCT) return { seg: this.segMap.get(this.idOf(ch.ctrs[k]!))!, raw };
      }
    }
    return { seg: this.segs[this.segs.length - 1]!, raw };
  }

  /** 원소의 화면 오프셋. 숨긴 구획이면 그 구획이 놓였을 자리 */
  private elementDisplay(chunk: Chunk, i: number): { off: number; hidden: boolean } {
    const { seg, raw } = this.segOfElement(chunk, i);
    if (this.simple) return { off: raw, hidden: false };
    const ds = this.dispStartOf(seg);
    return seg.hidden ? { off: ds, hidden: true } : { off: ds + raw - this.rawStartOf(seg), hidden: false };
  }

  /**
   * 화면 오프셋 d의 원소 앞에서 구획을 나눈다 (이미 구획 시작이면 아무것도 안 함).
   * 앞부분이 새 BRK를 ID로 받고 뒷부분은 원래 ID를 유지한다 (끝 표식 구획). 화면은 바뀌지 않는다.
   */
  private splitAt(d: number): void {
    if (d <= 0 || d >= this.length) return;
    const { seg, raw } = this.toRaw(d);
    const rs = this.rawStartOf(seg);
    if (raw === rs) return;
    const { chunk, index } = this.locateRaw(raw);
    const at = this.listener ? this.u16At(chunk, index) : 0;
    const ctr = this.insertIntoChunk(chunk, index, [BRK_CODE], STRUCT);
    this.emit({ kind: 'insert', at, text: BRK_CHAR });
    const left: Seg = { id: this.idOf(ctr), len: raw - rs, hidden: seg.hidden };
    seg.len -= left.len;
    this.segs.splice(this.segs.indexOf(seg), 0, left);
    this.order.splice(this.order.indexOf(seg), 0, left);
    this.segMap.set(left.id, left);
  }

  /** 문단 i..j만 담는 연속 구획들(화면 순서)을 만들어 돌려준다 */
  private isolateRun(i: number, j: number): Seg[] {
    const P = this.paras[i]!;
    const Q = this.paras[j]!;
    this.splitAt(Q.end + 1);
    this.splitAt(P.start);
    const a = this.order.indexOf(this.toRaw(P.start).seg);
    const b = this.order.indexOf(this.toRaw(Q.end).seg);
    return this.order.slice(a, b + 1);
  }

  private segState(): SegState {
    return { order: this.order.map((s) => s.id), hidden: this.order.filter((s) => s.hidden).map((s) => s.id) };
  }

  /** 구획 상태를 되돌리거나 다시 적용한다. 상태에 없는 구획(그 뒤에 나뉜 것)은 저장 순서상 다음 구획 바로 앞에 둔다 */
  private applySegState(state: SegState): void {
    const snap = this.displaySnapshot();
    const order: Seg[] = [];
    const placed = new Set<Seg>();
    for (const id of state.order) {
      const s = this.segMap.get(id);
      if (s && !placed.has(s)) {
        order.push(s);
        placed.add(s);
      }
    }
    for (let k = this.segs.length - 1; k >= 0; k--) {
      const s = this.segs[k]!;
      if (placed.has(s)) continue;
      const succ = this.segs[k + 1];
      const at = succ ? order.indexOf(succ) : -1;
      order.splice(at < 0 ? order.length : at, 0, s);
      placed.add(s);
    }
    const hidden = new Set(state.hidden);
    for (const s of this.segs) s.hidden = hidden.has(s.id);
    this.order = order;
    this.relist(snap);
  }

  /** 화면에 나오는 구획의 화면 시작 오프셋 */
  private displaySnapshot(): Map<Seg, number> {
    const m = new Map<Seg, number>();
    let ds = 0;
    for (const s of this.order) {
      if (s.hidden || s.len === 0) continue;
      m.set(s, ds);
      ds += s.len;
    }
    return m;
  }

  /**
   * 구획 순서·숨김이 바뀐 뒤 문단 목록을 다시 엮는다. 전에도 보이던 구획의 문단은 같은 객체를 오프셋만 옮겨 쓰고,
   * 새로 보이는 구획만 글자를 읽어 만든다.
   */
  private relist(snap: Map<Seg, number>): void {
    const old = this.paras;
    const next: ParagraphInfo[] = [];
    const shift: number[] = [];
    let ds = 0;
    for (const s of this.order) {
      if (s.hidden || s.len === 0) continue;
      const o = snap.get(s);
      if (o !== undefined) {
        for (let k = findParaByStart(old, o); k < old.length && old[k]!.start < o + s.len; k++) {
          next.push(old[k]!);
          shift.push(ds - o);
        }
      } else {
        for (const p of this.scanSegment(s, ds)) {
          next.push(p);
          shift.push(0);
        }
      }
      ds += s.len;
    }
    for (let k = 0; k < next.length; k++) {
      if (shift[k] === 0) continue;
      next[k]!.start += shift[k]!;
      next[k]!.end += shift[k]!;
    }
    let from = 0;
    while (from < old.length && from < next.length && old[from] === next[from]) from++;
    let suffix = 0;
    while (
      suffix < old.length - from &&
      suffix < next.length - from &&
      old[old.length - 1 - suffix] === next[next.length - 1 - suffix]
    )
      suffix++;
    this.changeFrom = Math.min(this.changeFrom, from);
    this.changeSuffix = Math.min(this.changeSuffix, suffix);
    this.paras = next;
    this._version++;
  }

  /** 구획 하나의 문단들을 화면 시작 오프셋 ds 기준으로 만든다 */
  private scanSegment(seg: Seg, ds: number): ParagraphInfo[] {
    const paras: ParagraphInfo[] = [];
    let n = seg.len;
    let off = ds;
    let pStart = ds;
    let buf: number[] = [];
    this.rawForEach(this.rawStartOf(seg), (code, ctr) => {
      if (code === PARA_CODE) {
        paras.push({ id: this.idOf(ctr), start: pStart, end: off, text: fromCodes(buf) });
        pStart = off + 1;
        buf = [];
      } else {
        buf.push(code);
      }
      off++;
      return --n <= 0;
    });
    return paras;
  }

  // ── 내부: 문단 목록 증분 갱신 ──────────────────────────

  /**
   * 변경 후 [a, b) 구간(새 화면 오프셋)의 원소가 바뀌었고 전체 길이가 delta만큼 변했을 때 문단 목록을 갱신한다.
   * a를 포함하던 문단부터 b 이후 첫 ¶까지만 다시 만든다. b 이후의 ¶는 변경 전에도 있던 원소이므로
   * 그 문단까지 교체하고, 뒤 문단들은 오프셋만 delta만큼 옮긴다.
   */
  private updateParagraphs(a: number, b: number, delta: number): void {
    const old = this.paras;
    const i = findParaByStart(old, a);
    const { paras: rebuilt, lastParaOffset } = this.scanParagraphs(old[i]!.start, b);
    const j = findParaByEnd(old, lastParaOffset - delta);
    // 바뀐 구간 기록: [0, i)와 뒤쪽 old.length-(j+1)개 문단은 같은 객체로 남는다
    this.changeFrom = Math.min(this.changeFrom, i);
    this.changeSuffix = Math.min(this.changeSuffix, old.length - (j + 1));
    old.splice(i, j - i + 1, ...rebuilt);
    for (let k = i + rebuilt.length; k < old.length; k++) {
      const p = old[k]!;
      p.start += delta;
      p.end += delta;
    }
  }

  /** start부터 문단을 만들어 가다가, 오프셋 stopAfter 이상인 ¶를 만나면 그 문단까지 만들고 멈춘다 */
  private scanParagraphs(start: number, stopAfter: number): { paras: ParagraphInfo[]; lastParaOffset: number } {
    const paras: ParagraphInfo[] = [];
    let off = start;
    let pStart = start;
    let buf: number[] = [];
    let lastParaOffset = start;
    this.forEachFrom(start, (code, ctr) => {
      if (code === PARA_CODE) {
        paras.push({ id: this.idOf(ctr), start: pStart, end: off, text: fromCodes(buf) });
        lastParaOffset = off;
        if (off >= stopAfter) return true;
        pStart = off + 1;
        buf = [];
      } else {
        buf.push(code);
      }
      off++;
      return false;
    });
    return { paras, lastParaOffset };
  }
}

/** start ≤ offset인 마지막 문단 */
function findParaByStart(paras: ParagraphInfo[], offset: number): number {
  let lo = 0;
  let hi = paras.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (paras[mid]!.start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** end === offset인 문단 */
function findParaByEnd(paras: ParagraphInfo[], offset: number): number {
  let lo = 0;
  let hi = paras.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (paras[mid]!.end < offset) lo = mid + 1;
    else hi = mid;
  }
  if (paras[lo]!.end !== offset) throw new Error(`paragraph index out of sync at ${offset}`);
  return lo;
}

/** 원소의 UTF-16 길이. 구획 표식은 U+E000 한 글자 */
function width16(code: number): number {
  return code > 0xffff && code !== BRK_CODE ? 2 : 1;
}

function toCodes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) out.push(ch.codePointAt(0)!);
  return out;
}

function fromCodes(codes: number[]): string {
  // 인자 수 제한을 피하려고 나눠서 변환
  let s = '';
  for (let i = 0; i < codes.length; i += 8192) {
    s += String.fromCodePoint(...codes.slice(i, i + 8192));
  }
  return s;
}

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
