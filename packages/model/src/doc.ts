/**
 * 문서 모델: 단일 스토리, 평평한 원소 열 + 문단 표식(¶).
 * 설계: docs/design/01-document-model.md
 *
 * - 원소 1개 = 유니코드 코드포인트 1개 또는 문단 표식 1개
 * - 삭제는 묘비(tombstone) 처리 → ID 기반 위치가 삭제 후에도 해석됨
 * - 스토리는 항상 살아 있는 ¶로 끝난다
 *
 * 저장 구조 (성능)
 * - 원소 열을 청크로 나누고, 청크는 원소별 객체 없이 typed array 세 개(코드포인트, 카운터, 삭제 여부)로 저장한다.
 *   원소 수백만 개에서도 GC가 추적할 객체가 거의 없다.
 * - 청크마다 보이는 원소 수를 유지 → 오프셋 ↔ 원소 변환이 O(청크 수 + 청크 크기)
 * - 원소 ID는 `${peer}:${counter}`. 카운터 → 청크 표로 ID에서 청크를 바로 찾는다
 * - 문단 목록은 변경된 구간만 다시 만든다 (뒤쪽 문단은 오프셋만 이동)
 *
 * 0단계 한계: 단일 피어만 지원 (다른 피어 ID는 해석하지 않음). CRDT 통합 시 교체 (05, ADR-0003)
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

export interface ParagraphInfo {
  /** 문단 ID = 문단을 끝내는 ¶ 원소의 ID */
  id: ElementId;
  /** 문단 첫 원소의 오프셋 */
  start: number;
  /** 문단 ¶의 오프셋 (문단 텍스트는 [start, end)) */
  end: number;
  /** 변경되지 않은 문단은 같은 문자열 객체를 유지한다 (레이아웃 재사용 판단용) */
  text: string;
}

const CHUNK = 512;
const CAP = CHUNK * 2;

class Chunk {
  index = 0;
  len = 0;
  visible = 0;
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
  /** 카운터 → 그 원소가 들어 있는 청크 */
  private chunkOf: Chunk[] = [];
  private counter = 0;
  private visible = 0;
  private _version = 0;
  private paras: ParagraphInfo[] = [];

  constructor(readonly peer = 'local') {}

  static fromText(text: string, peer?: string): Doc {
    const doc = new Doc(peer);
    const codes = toCodes(normalizeNewlines(text));
    codes.push(PARA_CODE); // 스토리는 항상 ¶로 끝난다
    doc.chunks = doc.buildChunks(codes, null, null, 0);
    doc.visible = codes.length;
    doc.paras = doc.scanParagraphs(0, Infinity).paras;
    doc._version++;
    return doc;
  }

  /** 변경될 때마다 증가 */
  get version(): number {
    return this._version;
  }

  /** 살아 있는 원소 수 (마지막 ¶ 포함) */
  get length(): number {
    return this.visible;
  }

  /** 커서가 놓일 수 있는 최대 오프셋 (마지막 ¶ 앞) */
  get maxCaret(): number {
    return this.visible - 1;
  }

  text(): string {
    return this.slice(0, this.visible);
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

  /** 문단 목록. 내부 배열을 그대로 돌려주므로 호출 측에서 수정하면 안 된다 */
  paragraphs(): readonly ParagraphInfo[] {
    return this.paras;
  }

  /**
   * offset 위치(틈)에 텍스트를 삽입한다. '\n'은 문단 표식이 된다.
   * @returns 새로 만든 원소 ID 목록 (실행 취소용)
   */
  insertText(offset: number, text: string): ElementId[] {
    const codes = toCodes(normalizeNewlines(text));
    if (codes.length === 0) return [];
    offset = clamp(offset, 0, this.maxCaret);
    const { chunk, index } = this.locate(offset);
    const first = this.counter;
    this.insertIntoChunk(chunk, index, codes);
    this.visible += codes.length;
    this.updateParagraphs(offset, offset + codes.length, codes.length);
    this._version++;
    return this.idRange(first, codes.length);
  }

  /**
   * [from, to) 구간을 삭제(묘비 처리)한다. 마지막 ¶는 지울 수 없다.
   * @returns 삭제된 원소 ID 목록 (실행 취소용)
   */
  deleteRange(from: number, to: number): ElementId[] {
    from = clamp(from, 0, this.maxCaret);
    to = clamp(to, from, this.maxCaret);
    if (from === to) return [];
    const ids: ElementId[] = [];
    let n = to - from;
    this.forEachFrom(from, (_code, ctr, chunk, i) => {
      chunk.dead[i] = 1;
      chunk.visible--;
      ids.push(this.idOf(ctr));
      return --n <= 0;
    });
    this.visible -= ids.length;
    this.updateParagraphs(from, from, -ids.length);
    this._version++;
    return ids;
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
    offset = clamp(offset, 0, this.visible);
    if (offset < this.visible) {
      const { chunk, index } = this.locate(offset);
      return { anchor: this.idOf(chunk.ctrs[index]!), side: 'before' };
    }
    return { anchor: this.idOf(this.lastVisibleCtr()), side: 'after' };
  }

  /** 안정적 위치 → 현재 오프셋. 기준 원소가 삭제되었으면 그 자리의 오프셋 */
  resolve(pos: Position): number {
    const ctr = this.ctrOf(pos.anchor);
    const chunk = this.chunkOf[ctr]!;
    const i = chunk.find(ctr);
    const off = this.offsetAt(chunk, i);
    return !chunk.dead[i] && pos.side === 'after' ? off + 1 : off;
  }

  /** 디버그·테스트용: 문단 목록을 처음부터 다시 계산한 결과 */
  paragraphsFromScratch(): ParagraphInfo[] {
    return this.scanParagraphs(0, Infinity).paras;
  }

  /** 디버그·테스트용: 청크 불변식 검사 */
  checkInvariants(): void {
    let visible = 0;
    this.chunks.forEach((c, k) => {
      if (c.index !== k) throw new Error(`chunk ${k} has index ${c.index}`);
      if (c.len > CAP) throw new Error(`chunk ${k} overflow`);
      let v = 0;
      for (let i = 0; i < c.len; i++) {
        if (!c.dead[i]) v++;
        if (this.chunkOf[c.ctrs[i]!] !== c) throw new Error(`chunkOf out of sync for ${c.ctrs[i]}`);
      }
      if (v !== c.visible) throw new Error(`chunk ${k} visible ${c.visible} != ${v}`);
      visible += v;
    });
    if (visible !== this.visible) throw new Error(`visible ${this.visible} != ${visible}`);
  }

  // ── 내부: ID ──────────────────────────────────────────

  private idOf(ctr: number): ElementId {
    return `${this.peer}:${ctr}`;
  }

  private ctrOf(id: ElementId): number {
    const k = id.lastIndexOf(':');
    const ctr = k >= 0 && id.slice(0, k) === this.peer ? Number(id.slice(k + 1)) : NaN;
    if (!Number.isInteger(ctr) || !this.chunkOf[ctr]) throw new Error(`unknown element ${id}`);
    return ctr;
  }

  private idRange(first: number, n: number): ElementId[] {
    const ids = new Array<ElementId>(n);
    for (let k = 0; k < n; k++) ids[k] = this.idOf(first + k);
    return ids;
  }

  // ── 내부: 청크 ────────────────────────────────────────

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
      const c = new Chunk();
      c.index = startIndex + out.length;
      const e = Math.min(n, s + CHUNK);
      for (let k = s; k < e; k++) {
        const i = k - s;
        const ctr = ctrs ? ctrs[k]! : this.counter++;
        c.codes[i] = codes[k]!;
        c.ctrs[i] = ctr;
        const d = dead ? dead[k]! : 0;
        c.dead[i] = d;
        if (!d) c.visible++;
        this.chunkOf[ctr] = c;
      }
      c.len = e - s;
      out.push(c);
      if (n === 0) break;
    }
    return out;
  }

  private insertIntoChunk(chunk: Chunk, index: number, codes: number[]): void {
    const n = codes.length;
    if (chunk.len + n <= CAP) {
      chunk.codes.copyWithin(index + n, index, chunk.len);
      chunk.ctrs.copyWithin(index + n, index, chunk.len);
      chunk.dead.copyWithin(index + n, index, chunk.len);
      for (let k = 0; k < n; k++) {
        const ctr = this.counter++;
        chunk.codes[index + k] = codes[k]!;
        chunk.ctrs[index + k] = ctr;
        chunk.dead[index + k] = 0;
        this.chunkOf[ctr] = chunk;
      }
      chunk.len += n;
      chunk.visible += n;
      return;
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
      allCtrs[index + k] = this.counter++;
    }
    allCodes.set(chunk.codes.subarray(index, chunk.len), index + n);
    allCtrs.set(chunk.ctrs.subarray(index, chunk.len), index + n);
    allDead.set(chunk.dead.subarray(index, chunk.len), index + n);
    const pieces = this.buildChunks(allCodes, allCtrs, allDead, chunk.index);
    this.chunks.splice(chunk.index, 1, ...pieces);
    for (let c = chunk.index; c < this.chunks.length; c++) this.chunks[c]!.index = c;
  }

  /** 살아 있는 offset번째 원소의 위치. offset === length면 마지막 청크 끝 */
  private locate(offset: number): { chunk: Chunk; index: number } {
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

  /** 청크의 i번째 원소 앞에 있는 살아 있는 원소 수 */
  private offsetAt(chunk: Chunk, i: number): number {
    let off = 0;
    for (let c = 0; c < chunk.index; c++) off += this.chunks[c]!.visible;
    for (let k = 0; k < i; k++) if (!chunk.dead[k]) off++;
    return off;
  }

  /** offset부터 살아 있는 원소를 차례로 방문. 콜백이 true를 반환하면 멈춘다 */
  private forEachFrom(
    offset: number,
    fn: (code: number, ctr: number, chunk: Chunk, i: number) => boolean | void,
  ): void {
    const { chunk, index } = this.locate(offset);
    for (let c = chunk.index; c < this.chunks.length; c++) {
      const ch = this.chunks[c]!;
      const { codes, ctrs, dead, len } = ch;
      for (let i = c === chunk.index ? index : 0; i < len; i++) {
        if (dead[i]) continue;
        if (fn(codes[i]!, ctrs[i]!, ch, i)) return;
      }
    }
  }

  private lastVisibleCtr(): number {
    for (let c = this.chunks.length - 1; c >= 0; c--) {
      const ch = this.chunks[c]!;
      for (let i = ch.len - 1; i >= 0; i--) if (!ch.dead[i]) return ch.ctrs[i]!;
    }
    throw new Error('document has no visible elements');
  }

  private setDead(ids: ElementId[], dead: boolean): void {
    const flag = dead ? 1 : 0;
    const changed: Array<{ chunk: Chunk; i: number }> = [];
    let firstOffset = -1;
    for (const id of ids) {
      const ctr = this.ctrOf(id);
      const chunk = this.chunkOf[ctr]!;
      const i = chunk.find(ctr);
      if (chunk.dead[i] === flag) continue;
      // 숨기기: 숨기기 전 첫 원소의 오프셋 = 변경 구간 시작
      if (dead && firstOffset < 0) firstOffset = this.offsetAt(chunk, i);
      chunk.dead[i] = flag;
      chunk.visible += dead ? -1 : 1;
      changed.push({ chunk, i });
    }
    if (changed.length === 0) return;
    const delta = dead ? -changed.length : changed.length;
    this.visible += delta;
    const first = changed[0]!;
    const last = changed[changed.length - 1]!;
    const a = dead ? firstOffset : this.offsetAt(first.chunk, first.i);
    // ids가 연속이 아닐 수 있으므로 마지막 원소 자리까지를 변경 구간으로 본다
    const b = this.offsetAt(last.chunk, last.i) + (dead ? 0 : 1);
    this.updateParagraphs(a, b, delta);
    this._version++;
  }

  // ── 내부: 문단 목록 증분 갱신 ──────────────────────────

  /**
   * 변경 후 [a, b) 구간(새 오프셋)의 원소가 바뀌었고 전체 길이가 delta만큼 변했을 때 문단 목록을 갱신한다.
   * a를 포함하던 문단부터 b 이후 첫 ¶까지만 다시 만든다. b 이후의 ¶는 변경 전에도 있던 원소이므로
   * 그 문단까지 교체하고, 뒤 문단들은 오프셋만 delta만큼 옮긴다.
   */
  private updateParagraphs(a: number, b: number, delta: number): void {
    const old = this.paras;
    const i = findParaByStart(old, a);
    const { paras: rebuilt, lastParaOffset } = this.scanParagraphs(old[i]!.start, b);
    const j = findParaByEnd(old, lastParaOffset - delta);
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
