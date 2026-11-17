/**
 * 문서 모델: 단일 스토리, 평평한 원소 열 + 문단 표식(¶) + 구획.
 * 설계: docs/design/01-document-model.md, 09-crdt-integration.md
 *
 * - 원소 1개 = 유니코드 코드포인트 1개 또는 문단 표식 1개 또는 구획 표식 1개
 * - 삭제는 묘비(tombstone) 처리 → ID 기반 위치가 삭제 후에도 해석됨
 * - 스토리는 항상 살아 있는 ¶로 끝난다
 *
 * 저장 구조 (성능)
 * - 원소 열을 청크로 나누고, 청크는 원소별 객체 없이 typed array 세 개(코드포인트, 카운터, 상태)로 저장한다.
 *   원소 수백만 개에서도 GC가 추적할 객체가 거의 없다.
 * - 청크마다 보이는 원소 수와 UTF-16 길이를 유지 → 오프셋 ↔ 원소 변환이 O(청크 수 + 청크 크기)
 * - 원소 ID는 `${peer}:${counter}`. 카운터 → 청크 표로 ID에서 청크를 바로 찾는다
 * - 문단 목록은 변경된 구간만 다시 만든다 (뒤쪽 문단은 오프셋만 이동)
 *
 * 구획 (ADR-0003, 01 §2 구획 표식)
 * - 저장 열은 보이지 않는 구획 표식(BRK) 원소로 구획들로 나뉜다. 구획마다 키(피어 사이에서 공유하는 ID)가 있다.
 *   로컬에서 만든 구획의 키는 그 BRK 원소의 ID, 마지막 구획은 'tail'. 화면 순서는 구획 순서 목록(order)이
 *   정하고, 숨긴 구획은 화면에 나오지 않는다.
 * - 공개 API의 오프셋은 모두 **화면 오프셋**이다: 화면 순서로 이어 붙인 구획들에서 BRK·묘비·숨긴 구획을 뺀 위치.
 *   내부의 "raw 오프셋"은 저장 순서에서 살아 있는 원소(숨긴 구획 포함, BRK 제외)의 위치다.
 * - 문단 이동은 글자를 옮기지 않고 구획 순서만 바꾼다. 문단 삭제(숨김)는 구획을 숨긴다.
 * - 화면에 나오는 비어 있지 않은 구획은 보통 ¶로 끝난다(문단이 구획 경계에 걸치지 않음). 로컬 편집은 이를 지킨다:
 *   구획 끝 ¶를 지우는 삭제는 남은 꼬리 글자를 다음 구획 첫 문단 앞으로 옮긴다(복사 후 원본 삭제).
 *   동시 편집으로 어긋날 수 있으므로(꼬리를 옮기는 동안 다른 피어가 그 꼬리에 입력) 문단 목록은 어긋남을 견딘다.
 * - 동기화 문서에서 ¶ 없이 끝난 구획(동시 편집으로 생김)은 끝에 **가상 ¶**를 화면에만 둔다: 구획 끝은 항상 문단 끝이다
 *   (V4 M4와 같은 규칙). 가상 ¶에도 캐럿을 둘 수 있고(위치는 그 구획의 표식 원소 앞), 지우면 꼬리 옮기기가 된다.
 * - 구획이 하나뿐이면(이동·숨김을 한 적 없는 로컬 문서) 화면 오프셋 = raw 오프셋인 빠른 경로를 쓴다.
 *
 * 동기화 문서 (09, V4 후속 4): CRDT에서 불러온 문서(fromRaw)는 마지막 구획이 화면에 나오지 않는 **보초**(¶ 하나)이고,
 * **자리표시** 구획(미리 만든 빈 문단)을 둔다. 보이는 내용이 없으면 첫 자리표시를 빈 문단으로 보이고,
 * 거기에 입력하면 사용됨으로 표시하고 다음 자리표시를 만든다.
 *
 * 0단계 한계: 구획 수에 비례하는 선형 탐색을 쓴다 (구획은 이동·삭제 횟수만큼만 생기므로 적다. 많아지면 균형 트리로).
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
/** 구획 표식(내부 값). 유니코드 범위 밖 값이라 사용자 글자와 겹치지 않는다 */
const BRK_CODE = 0x110000;
/** 원소 상태(dead 배열): 0 = 살아 있음, TOMB = 묘비, STRUCT = 구획 표식(보이지 않지만 살아 있음) */
const TOMB = 1;
const STRUCT = 2;

/** 구획 표식이 외부(CRDT) 텍스트에서 쓰는 문자 */
export const BRK_CHAR = '';
const BRK_EXT = 0xe000;

export type SegId = string;

/** 원격에서 온 구획 상태 (CRDT의 순서 리스트·맵) */
export interface SegState {
  /** 순서 목록에 있는 구획 키 (중복 가능, 앞의 것이 유효) */
  order: SegId[];
  hidden: SegId[];
  placeholder?: SegId[];
  used?: SegId[];
}

/** 실행 취소 단위 연산 */
export type Op =
  | { type: 'insert'; ids: ElementId[] }
  | { type: 'delete'; ids: ElementId[] }
  /**
   * 구획들을 원소 before가 시작하는 자리 앞으로 옮긴다 (null이면 맨 뒤). back은 옮기기 전 바로 뒤에 있던 내용의 첫 원소
   * (되돌릴 자리). 구획 키 대신 원소로 기록한다: 그 사이 다른 피어가 뒤 구획을 나누면 키는 뒷부분에 남기 때문이다.
   */
  | { type: 'move'; segs: SegId[]; before: ElementId | null; back: ElementId | null }
  | { type: 'hidden'; segs: SegId[]; value: boolean };

/**
 * 원소 열·구획 변경 기록 (CRDT 브리지용, 09). 위치·길이는 UTF-16 단위이고 구획 표식은 U+E000 한 글자로 센다.
 * 순서대로 적용하면 상대 문서가 이 Doc과 같아진다.
 */
export type RawChange =
  /** segs: text 안의 구획 표식(U+E000)마다 그 구획 키 (순서대로) */
  | { kind: 'insert'; at: number; text: string; segs?: SegId[] }
  | { kind: 'delete'; at: number; len: number }
  /** 구획을 순서대로 before 앞으로 옮긴다 (null이면 맨 뒤). 목록에 없던 구획이면 그 자리에 넣는다 */
  | { kind: 'order'; moves: Array<{ seg: SegId; before: SegId | null }> }
  /** 새 구획을 순서 목록에서 before 바로 앞에 넣는다 */
  | { kind: 'list'; seg: SegId; before: SegId }
  | { kind: 'hidden'; segs: SegId[]; value: boolean }
  | { kind: 'flag'; seg: SegId; flag: 'placeholder' | 'used' };

/** 원격 텍스트 델타 (UTF-16 단위). 구획 표식은 attributes.seg에 키를 가진다 */
export type TextDelta = Array<{ retain?: number; insert?: string; delete?: number; attributes?: Record<string, unknown> }>;

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
  /** 구획 키 */
  id: SegId;
  /** 구획을 끝내는 BRK 원소의 카운터 (마지막 구획은 -1) */
  brk: number;
  /** raw 길이: 살아 있는 원소 수 (BRK 제외) */
  len: number;
  hidden: boolean;
  placeholder: boolean;
  used: boolean;
  /** isOpen() 캐시 (내용이 바뀌면 null) */
  openCache: boolean | null;
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

function newSeg(id: SegId, brk: number, len: number): Seg {
  return { id, brk, len, hidden: false, placeholder: false, used: false, openCache: null };
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
  private segs: Seg[] = [newSeg('tail', -1, 0)];
  /** 화면 순서의 구획 (숨긴 구획 포함) */
  private order: Seg[] = [this.segs[0]!];
  private segMap = new Map<SegId, Seg>([['tail', this.segs[0]!]]);
  /** BRK 원소 카운터 → 구획 */
  private segByBrk = new Map<number, Seg>();
  /** 동기화 문서: 마지막 구획(tail)은 보이지 않는 보초 */
  private sentinel = false;
  private listener: ((c: RawChange) => void) | null = null;
  /** 원격 변경 적용 중 (변경 기록을 보내지 않음) */
  private muted = false;
  /** false면 구획 연산(문단 이동·숨김)을 거부한다 */
  segmentsEnabled = true;

  constructor(readonly peer = 'local') {}

  // ── 만들기 ────────────────────────────────────────────

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
    forEachCodePoint(norm, push);
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

  /**
   * CRDT 텍스트에서 동기화 문서를 만든다. raw는 구획 표식을 U+E000으로 담은 전체 텍스트(보초 ¶로 끝남),
   * keys는 표식마다 구획 키(순서대로), state는 순서·숨김·자리표시 상태.
   */
  static fromRaw(raw: string, keys: SegId[], state: SegState, peer?: string): Doc {
    const doc = new Doc(peer);
    doc.sentinel = true;
    doc.chunkIdOf = new Int32Array(raw.length + 1024);
    const chunks: Chunk[] = [doc.newChunk()];
    let chunk = chunks[0]!;
    const segs: Seg[] = [];
    let len = 0;
    let k = 0;
    forEachCodePoint(raw, (cp) => {
      if (chunk.len === LOAD_FILL) {
        chunk = doc.newChunk();
        chunk.index = chunks.length;
        chunks.push(chunk);
      }
      const ctr = doc.nextCtr();
      const i = chunk.len++;
      chunk.ctrs[i] = ctr;
      doc.chunkIdOf[ctr] = chunk.id;
      chunk.u16 += cp === BRK_EXT ? 1 : width16(cp);
      if (cp === BRK_EXT) {
        chunk.codes[i] = BRK_CODE;
        chunk.dead[i] = STRUCT;
        const key = keys[k++];
        if (key === undefined) throw new Error('fromRaw: missing segment key');
        segs.push(newSeg(key, ctr, len));
        len = 0;
      } else {
        chunk.codes[i] = cp;
        chunk.visible++;
        doc.visible++;
        len++;
      }
    });
    segs.push(newSeg('tail', -1, len));
    if (len !== 1) throw new Error('fromRaw: the last segment must be a single paragraph mark (sentinel)');
    doc.chunks = chunks;
    doc.segs = segs;
    doc.segMap = new Map(segs.map((s) => [s.id, s]));
    doc.segByBrk = new Map(segs.filter((s) => s.brk >= 0).map((s) => [s.brk, s]));
    doc.order = [...segs];
    doc.setSegState(state);
    doc.paras = doc.scanParagraphs(0, Infinity).paras;
    doc._version++;
    return doc;
  }

  // ── 상태 ──────────────────────────────────────────────

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

  /** 화면 순서의 구획 키 (숨긴 구획 포함). 브리지가 순서 목록에 없는 구획의 자리를 정할 때 쓴다 */
  segmentOrder(): SegId[] {
    return this.order.map((s) => s.id);
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

  /** 살아 있는 원소 열 전체 (구획 표식은 U+E000, 숨긴 구획 포함, 저장 순서). CRDT 텍스트와 같아야 한다 */
  rawText(): string {
    const out: number[] = [];
    for (const c of this.chunks)
      for (let i = 0; i < c.len; i++) {
        if (c.dead[i] === TOMB) continue;
        out.push(c.dead[i] === STRUCT ? BRK_EXT : c.codes[i]!);
      }
    return fromCodes(out);
  }

  /** 저장 순서의 구획 키 (테스트용: CRDT 텍스트의 표식 키와 같아야 한다) */
  segmentKeys(): SegId[] {
    return this.segs.filter((s) => s.brk >= 0).map((s) => s.id);
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

  /** 원소 열 변경 기록을 받는다 (하나만). null이면 해제 */
  observe(fn: ((c: RawChange) => void) | null): void {
    this.listener = fn;
  }

  private emit(c: RawChange): void {
    if (this.listener && !this.muted) this.listener(c);
  }

  // ── 편집 ──────────────────────────────────────────────

  /**
   * offset 위치(틈)에 텍스트를 삽입한다. '\n'은 문단 표식이 된다.
   * @returns 새로 만든 원소 ID 목록 (실행 취소용)
   */
  insertText(offset: number, text: string): ElementId[] {
    const codes = toCodes(normalizeNewlines(text));
    if (codes.length === 0) return [];
    offset = clamp(offset, 0, this.maxCaret);
    const { seg, raw } = this.toRaw(offset);
    // 자리표시로 보이던 빈 문단에 입력: 사용됨으로 표시 (화면은 그대로)
    const claimed = seg.placeholder && !seg.used;
    if (claimed) {
      seg.used = true;
      this.emit({ kind: 'flag', seg: seg.id, flag: 'used' });
    }
    const { chunk, index } = this.insertPoint(seg, raw);
    const at = this.listener ? this.u16At(chunk, index) : 0;
    const wasOpen = this.isOpen(seg);
    const first = this.insertIntoChunk(chunk, index, codes, 0);
    this.visible += codes.length;
    seg.len += codes.length;
    seg.openCache = null;
    if (this.isOpen(seg) !== wasOpen) this.rebuildParagraphs();
    else this.updateParagraphs(offset, offset + codes.length, codes.length);
    this._version++;
    this.emit({ kind: 'insert', at, text: fromCodes(codes) });
    if (claimed) this.addSpare();
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
    const shown = this.shownPredicate();
    const pieces: Array<{ seg: Seg; raw: number; n: number; endsSeg: boolean; ids: ElementId[]; wasOpen: boolean }> = [];
    let ds = 0;
    for (const s of this.order) {
      if (!shown(s) || s.len === 0) continue;
      // 가상 ¶가 있으면 화면 길이는 1 더 길다. 가상 ¶ 자체는 지울 원소가 없다 (아래 꼬리 옮기기로 처리)
      const L = s.len + this.virt(s);
      const a = Math.max(from, ds);
      const b = Math.min(to, ds + L);
      if (a < b) {
        const n = Math.max(0, Math.min(b, ds + s.len) - a);
        pieces.push({ seg: s, raw: this.rawStartOf(s) + a - ds, n, endsSeg: b === ds + L, ids: [], wasOpen: this.isOpen(s) });
      }
      ds += L;
      if (ds >= to) break;
    }
    // 저장 순서상 뒤에서부터 지워야 앞서 계산한 raw 위치가 그대로 맞다
    for (const p of [...pieces].sort((x, y) => y.raw - x.raw)) {
      if (p.n === 0) continue;
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
      p.seg.openCache = null;
      this.emit({ kind: 'delete', at, len: len16 });
    }
    const ids = pieces.flatMap((p) => p.ids);
    this.visible -= ids.length;
    // 가상 ¶는 실제 원소가 아니라 지운 범위 뒤에 다시 나타난다 → 범위가 가상 ¶를 덮었거나 열림 상태가 바뀌면 다시 만든다
    if (pieces.some((p) => this.isOpen(p.seg) !== p.wasOpen || (p.wasOpen && p.endsSeg))) this.rebuildParagraphs();
    else if (ids.length > 0) this.updateParagraphs(from, from, -ids.length);
    this._version++;
    const ops: Op[] = ids.length > 0 ? [{ type: 'delete', ids }] : [];

    // 첫 구획이 끝 ¶(또는 가상 ¶)를 잃었으면 남은 꼬리를 다음 구획으로 옮긴다
    const first = pieces[0]!;
    if (first.endsSeg && first.seg.len > 0 && this.shownPredicate()(first.seg)) {
      const segStart = this.dispStartOf(first.seg);
      const segEnd = segStart + first.seg.len;
      if (segEnd < this.length && this.slice(segEnd - 1, segEnd) !== PARA) {
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
    const targetOffset = to < n ? this.paras[to]!.start : -1;
    const run = this.isolateRun(i, j);
    let target: Seg | null = null;
    if (targetOffset >= 0) {
      this.splitAt(targetOffset);
      target = this.toRaw(targetOffset).seg;
    }
    const k = this.order.indexOf(run[run.length - 1]!);
    const back = this.order.slice(k + 1).find((s) => s.len > 0) ?? null;
    const ids = run.map((s) => s.id);
    const before = target ? this.firstElementOf(target) : null;
    const backEl = back ? this.firstElementOf(back) : null;
    this.moveSegs(ids, target ? target.id : null);
    return [{ type: 'move', segs: ids, before, back: backEl }];
  }

  /** 구획의 첫 살아 있는 원소 ID */
  private firstElementOf(seg: Seg): ElementId {
    const { chunk, index } = this.locateRaw(this.rawStartOf(seg));
    return this.idOf(chunk.ctrs[index]!);
  }

  /** 실행 취소·다시 실행: 구획들을 원소 el이 있는 자리 앞으로 (그 원소가 구획 중간이면 거기서 나눈다) */
  private moveSegsBefore(ids: SegId[], el: ElementId | null): void {
    if (el === null) {
      this.moveSegs(ids, null);
      return;
    }
    const ctr = this.ctrOf(el);
    const chunk = this.chunkOfCtr(ctr);
    const i = chunk.find(ctr);
    let { seg } = this.segOfElement(chunk, i);
    if (this.shownPredicate()(seg) && !chunk.dead[i]) {
      const { off } = this.elementDisplay(chunk, i);
      this.splitAt(off);
      seg = this.segOfElement(chunk, i).seg;
    }
    if (ids.includes(seg.id)) return; // 되돌릴 자리가 옮길 구획 안: 제자리
    this.moveSegs(ids, seg.id);
  }

  /**
   * 문단 i..j를 숨긴다(문단 삭제). 로컬 문서는 보이는 문단을 모두 숨기는 요청을 무시한다.
   * 동기화 문서는 모두 숨겨도 자리표시가 빈 문단으로 보이므로 허용한다 (자리표시로 보이는 빈 문단 자체는 숨기지 않음).
   */
  hideParagraphs(i: number, j: number): Op[] {
    const n = this.paras.length;
    if (!this.segmentsEnabled) return [];
    if (i < 0 || j < i || j >= n) return [];
    if (i === 0 && j === n - 1 && !this.sentinel) return [];
    if (this.sentinel && this.fallback() !== null) return [];
    const run = this.isolateRun(i, j).filter((s) => !s.hidden);
    if (this.sentinel && i === 0 && j === n - 1 && !this.segs.some((s) => s.placeholder && !s.used && !s.hidden && !run.includes(s)))
      return [];
    const ids = run.map((s) => s.id);
    this.setHidden(ids, true);
    return [{ type: 'hidden', segs: ids, value: true }];
  }

  /** 연산 적용 (실행 취소·다시 실행) */
  apply(op: Op): void {
    if (op.type === 'insert') this.setDead(op.ids, false);
    else if (op.type === 'delete') this.setDead(op.ids, true);
    else if (op.type === 'move') this.moveSegsBefore(op.segs, op.before);
    else this.setHidden(op.segs, op.value);
  }

  /** 묘비가 된 원소들을 되살린다 (실행 취소·다시 실행). ids는 문서 순서여야 한다 */
  revive(ids: ElementId[]): void {
    this.setDead(ids, false);
  }

  /** 원소들을 묘비로 만든다 (실행 취소·다시 실행). ids는 문서 순서여야 한다 */
  hide(ids: ElementId[]): void {
    this.setDead(ids, true);
  }

  // ── 원격 변경 (09) ────────────────────────────────────

  /**
   * 원격 텍스트 델타를 적용한다 (UTF-16 단위, 구획 표식 포함 위치). 구획 표식 삽입은 attributes.seg에 키가 있어야 한다.
   * 변경 기록은 보내지 않는다. 구획 순서·숨김은 따로 applySegState로 맞춘다.
   */
  applyDelta(delta: TextDelta): void {
    this.muted = true;
    try {
      let pos = 0;
      for (const op of delta) {
        if (op.retain !== undefined) {
          pos += op.retain;
        } else if (op.insert !== undefined) {
          if (op.insert.length === 0) continue;
          const key = op.attributes?.['seg'];
          if (typeof key === 'string') {
            if (op.insert !== BRK_CHAR) throw new Error('applyDelta: a segment mark insert must be a single mark');
            this.remoteSplit(pos, key);
          } else {
            const codes = toCodes(op.insert);
            if (codes.includes(BRK_EXT)) throw new Error('applyDelta: segment mark without a key');
            this.remoteInsert(pos, codes);
          }
          pos += op.insert.length;
        } else if (op.delete !== undefined && op.delete > 0) {
          this.remoteDelete(pos, op.delete);
        }
      }
    } finally {
      this.muted = false;
    }
  }

  /** 원격 구획 상태(순서·숨김·자리표시)를 적용한다. 변경 기록은 보내지 않는다 */
  applySegState(state: SegState): void {
    const snap = this.displaySnapshot();
    const fb = this.fallback();
    this.setSegState(state);
    this.relist(snap, fb);
  }

  // ── 위치 ──────────────────────────────────────────────

  /** 오프셋 → 안정적 위치 */
  positionAt(offset: number): Position {
    const total = this.length;
    offset = clamp(offset, 0, total);
    const at = offset < total ? offset : total - 1;
    const { seg, raw } = this.toRaw(at);
    const { chunk, index } = this.insertPoint(seg, raw);
    return { anchor: this.idOf(chunk.ctrs[index]!), side: offset < total ? 'before' : 'after' };
  }

  /** 안정적 위치 → 현재 오프셋. 기준 원소가 삭제되었거나 숨긴 구획에 있으면 그 자리의 오프셋 */
  resolve(pos: Position): number {
    const ctr = this.ctrOf(pos.anchor);
    const chunk = this.chunkOfCtr(ctr);
    const i = chunk.find(ctr);
    const { off, hidden } = this.elementDisplay(chunk, i);
    return Math.min(this.length, !chunk.dead[i] && !hidden && pos.side === 'after' ? off + 1 : off);
  }

  /**
   * 화면 오프셋 → 그 자리 원소의 UTF-16 위치 (살아 있는 원소 열 = Loro 텍스트 기준).
   * 공유 위치(원격 커서·주석 범위)를 Loro 커서로 만들 때 쓴다 (09 §7). 가상 ¶ 자리는 그 구획의 표식 원소.
   */
  u16OfOffset(offset: number): number {
    const total = this.length;
    offset = clamp(offset, 0, total);
    const at = offset < total ? offset : total - 1;
    const { seg, raw } = this.toRaw(at);
    const { chunk, index } = this.insertPoint(seg, raw);
    const u = this.u16At(chunk, index);
    return offset < total || index >= chunk.len ? u : u + width16(chunk.codes[index]!);
  }

  /**
   * UTF-16 위치(Loro 텍스트 기준) → 화면 오프셋. 그 자리 원소가 화면에 나오지 않는 구획에 있으면
   * 그 구획이 놓였을 자리. 결과는 커서가 놓일 수 있는 범위(0..maxCaret)로 자른다.
   */
  offsetOfU16(u16: number): number {
    let { chunk, index } = this.locateU16(Math.max(0, u16));
    if (index >= chunk.len) {
      // 텍스트 끝: 마지막 원소(묘비 제외)의 자리
      let c = this.chunks.length - 1;
      let i = -1;
      for (; c >= 0 && i < 0; c--) {
        const ch = this.chunks[c]!;
        for (let k = ch.len - 1; k >= 0; k--) {
          if (ch.dead[k] !== TOMB) {
            i = k;
            chunk = ch;
            break;
          }
        }
      }
      if (i < 0) return 0;
      index = i;
    }
    return clamp(this.elementDisplay(chunk, index).off, 0, this.maxCaret);
  }

  // ── 검사 ──────────────────────────────────────────────

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
    const close = (seg: Seg | undefined, brk: number) => {
      if (!seg || seg.brk !== brk) throw new Error(`segment list out of sync at BRK ${brk}`);
      if (seg.len !== len) throw new Error(`segment ${seg.id} len ${seg.len} != ${len}`);
      if (brk >= 0 && this.segByBrk.get(brk) !== seg) throw new Error(`segment ${seg.id} not indexed by BRK`);
      if (this.segMap.get(seg.id) !== seg) throw new Error(`segment ${seg.id} not indexed by key`);
      lastCode.set(seg, last);
    };
    for (const c of this.chunks) {
      for (let i = 0; i < c.len; i++) {
        if (c.dead[i] === STRUCT) {
          close(this.segs[k++], c.ctrs[i]!);
          len = 0;
          last = -1;
        } else if (!c.dead[i]) {
          len++;
          last = c.codes[i]!;
        }
      }
    }
    close(this.segs[k++], -1);
    if (k !== this.segs.length) throw new Error('segment list length out of sync');
    if (this.order.length !== this.segs.length || new Set(this.order).size !== this.segs.length)
      throw new Error('segment order is not a permutation');
    for (const s of this.order) if (!this.segs.includes(s)) throw new Error(`unknown segment ${s.id} in order`);
    if (this.sentinel && (this.segs[this.segs.length - 1]!.len !== 1 || lastCode.get(this.segs[this.segs.length - 1]!) !== PARA_CODE))
      throw new Error('sentinel segment must be a single paragraph mark');
    // 로컬 문서는 화면에 나오는 구획이 ¶로 끝난다 (동기화 문서는 동시 편집으로 어긋날 수 있음)
    if (!this.sentinel) {
      const shown = this.shownPredicate();
      for (const s of this.order)
        if (shown(s) && s.len > 0 && lastCode.get(s) !== PARA_CODE)
          throw new Error(`segment ${s.id} does not end with a paragraph mark`);
    }
    if (this.length === 0) throw new Error('nothing is displayed');
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
    const shown = this.shownPredicate();
    let ds = 0;
    for (const s of this.order) {
      if (!shown(s) || s.len === 0) continue;
      const open = this.isOpen(s);
      const L = s.len + (open ? 1 : 0);
      if (offset >= ds + L) {
        ds += L;
        continue;
      }
      const within = Math.max(0, offset - ds);
      let n = s.len - within;
      let stop = false;
      if (n > 0) {
        this.rawForEach(this.rawStartOf(s) + within, (code, ctr, ch, i) => {
          if (fn(code, ctr, ch, i)) {
            stop = true;
            return true;
          }
          return --n <= 0;
        });
      }
      if (stop) return;
      if (open) {
        // 가상 ¶: 그 구획의 표식 원소로 대신한다 (문단 ID = 표식 원소 ID)
        const ch = this.chunkOfCtr(s.brk);
        if (fn(PARA_CODE, s.brk, ch, ch.find(s.brk))) return;
      }
      ds += L;
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
          seg = this.segs[this.segs.indexOf(this.segByBrk.get(ch.ctrs[e]!)!) + 1]!;
          continue;
        }
        while (k < sorted.length && sorted[k]!.chunk === ch && sorted[k]!.i === e) sorted[k++]!.seg = seg;
        if (k >= sorted.length) break sweep;
      }
    }
    const snap = this.displaySnapshot();
    const fb = this.fallback();
    const shownBefore = this.shownPredicate();
    const shownItems = items.filter((it) => shownBefore(it.seg!));
    const touched = [...new Set(items.map((it) => it.seg!))];
    const wasOpen = touched.map((sg) => this.isOpen(sg));
    let a = 0;
    if (dead && shownItems.length > 0) a = this.elementDisplay(shownItems[0]!.chunk, shownItems[0]!.i).off;
    const runs = track ? this.runsOf(items, dead) : null;
    for (const it of items) {
      it.chunk.dead[it.i] = flag;
      it.chunk.visible += dead ? -1 : 1;
      it.chunk.u16 += dead ? -width16(it.chunk.codes[it.i]!) : width16(it.chunk.codes[it.i]!);
      it.seg!.len += dead ? -1 : 1;
      it.seg!.openCache = null;
    }
    if (runs) this.emitRuns(runs, dead);
    this.visible += dead ? -items.length : items.length;
    void snap;
    if (this.fallback() !== fb || touched.some((sg, k) => this.isOpen(sg) !== wasOpen[k])) {
      this.rebuildParagraphs();
    } else if (shownItems.length > 0) {
      const last = shownItems[shownItems.length - 1]!;
      if (!dead) a = this.elementDisplay(shownItems[0]!.chunk, shownItems[0]!.i).off;
      const b = this.elementDisplay(last.chunk, last.i).off + (dead ? 0 : 1);
      this.updateParagraphs(a, b, dead ? -shownItems.length : shownItems.length);
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

  /** UTF-16 위치 pos에 있는 원소(묘비 제외, 구획 표식 포함)와 그 앞의 raw 오프셋. 끝이면 마지막 청크 끝 */
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

  /** 원소(묘비 아님, 구획 표식 포함) 앞 틈이 속한 구획. 구획 표식 앞이면 그 표식이 끝내는 구획 */
  private segAtElement(chunk: Chunk, index: number, raw: number): Seg {
    if (index >= chunk.len) return this.segs[this.segs.length - 1]!;
    if (chunk.dead[index] === STRUCT) return this.segByBrk.get(chunk.ctrs[index]!)!;
    return this.segAtRaw(raw);
  }

  /** 원격 글자 삽입 */
  private remoteInsert(pos: number, codes: number[]): void {
    const { chunk, index, raw } = this.locateU16(pos);
    const seg = this.segAtElement(chunk, index, raw);
    const shown = this.shownPredicate()(seg);
    const snap = this.displaySnapshot();
    const fb = this.fallback();
    const d = shown ? this.dispStartOf(seg) + raw - this.rawStartOf(seg) : 0;
    const wasOpen = this.isOpen(seg);
    this.insertIntoChunk(chunk, index, codes, 0);
    this.visible += codes.length;
    seg.len += codes.length;
    seg.openCache = null;
    void snap;
    if (this.fallback() !== fb || this.isOpen(seg) !== wasOpen) this.rebuildParagraphs();
    else if (shown) this.updateParagraphs(d, d + codes.length, codes.length);
    this._version++;
  }

  /** 원격 글자 삭제 (구획 표식은 지우지 않는다) */
  private remoteDelete(pos: number, len16: number): void {
    const { chunk, index, raw } = this.locateU16(pos);
    const seg = this.segAtElement(chunk, index, raw);
    const shown = this.shownPredicate()(seg);
    const snap = this.displaySnapshot();
    const fb = this.fallback();
    const d = shown ? this.dispStartOf(seg) + raw - this.rawStartOf(seg) : 0;
    const wasOpen = this.isOpen(seg);
    const totalBefore = shown ? this.dispTotal() : 0;
    let left = len16;
    let n = 0;
    outer: for (let c = chunk.index; c < this.chunks.length; c++) {
      const ch = this.chunks[c]!;
      for (let i = c === chunk.index ? index : 0; i < ch.len; i++) {
        const st = ch.dead[i];
        if (st === TOMB) continue;
        if (st === STRUCT) throw new Error('applyDelta: segment marks are never deleted');
        ch.dead[i] = TOMB;
        ch.visible--;
        const w = width16(ch.codes[i]!);
        ch.u16 -= w;
        left -= w;
        n++;
        if (left <= 0) break outer;
      }
    }
    this.visible -= n;
    seg.len -= n;
    seg.openCache = null;
    void snap;
    // 원격 피어에게는 마지막이 아니던 구획이 여기서는 화면 마지막일 수 있다: 구획이 통째로 비면 다시 만든다
    // 화면 끝(마지막 ¶)까지 지웠으면 증분 갱신의 기준 ¶가 없다
    if (this.fallback() !== fb || this.isOpen(seg) !== wasOpen || (shown && (seg.len === 0 || d + n >= totalBefore)))
      this.rebuildParagraphs();
    else if (shown) this.updateParagraphs(d, d, -n);
    this._version++;
  }

  /** 원격 구획 표식 삽입: 그 자리 앞부분이 새 구획(key)이 되고 뒷부분은 원래 구획 (화면은 바뀌지 않음) */
  private remoteSplit(pos: number, key: SegId): void {
    if (this.segMap.has(key)) throw new Error(`applyDelta: segment ${key} already exists`);
    const { chunk, index, raw } = this.locateU16(pos);
    const seg = this.segAtElement(chunk, index, raw);
    const rs = this.rawStartOf(seg);
    const ctr = this.insertIntoChunk(chunk, index, [BRK_CODE], STRUCT);
    const left = newSeg(key, ctr, raw - rs);
    // 새 구획은 숨김·이동 표시가 없다. 원래 구획이 숨겨져 있었다면 앞부분이 다시 보일 수 있으므로 문단 목록을 다시 엮는다
    const fb = this.fallback();
    const wasOpen = this.isOpen(seg);
    const wasShown = this.shownPredicate()(seg);
    seg.len -= left.len;
    seg.openCache = null;
    this.segs.splice(this.segs.indexOf(seg), 0, left);
    this.order.splice(this.order.indexOf(seg), 0, left);
    this.segMap.set(key, left);
    this.segByBrk.set(ctr, left);
    // 화면이 그대로인 경우: 같은 보임 상태로 나뉘고, 나눈 자리가 문단 경계(앞부분이 ¶로 끝남)일 때.
    // 그 밖(숨긴 구획·보초·자리표시를 나눔, 문단 중간을 나눔)은 문단 목록을 다시 만든다
    const shown = this.shownPredicate();
    const same =
      this.fallback() === fb &&
      shown(left) === wasShown &&
      shown(seg) === wasShown &&
      !this.isOpen(left) &&
      this.isOpen(seg) === wasOpen;
    if (same) this._version++;
    else this.rebuildParagraphs();
  }

  // ── 내부: 구획 ────────────────────────────────────────

  private get simple(): boolean {
    return this.segs.length === 1;
  }

  /** 보초·자리표시 규칙을 빼고 화면에 나오는가 */
  private baseShown(s: Seg): boolean {
    if (s.hidden) return false;
    if (this.sentinel && s.brk < 0) return false;
    return !(s.placeholder && !s.used);
  }

  /** 동기화 문서에서 내용이 ¶로 끝나지 않는 구획인가 (화면에 가상 ¶를 둔다) */
  private isOpen(s: Seg): boolean {
    if (!this.sentinel || s.len === 0 || s.brk < 0) return false;
    if (s.openCache !== null) return s.openCache;
    // 표식 원소에서 뒤로 가며 첫 살아 있는 원소를 찾는다
    let ch = this.chunkOfCtr(s.brk);
    let i = ch.find(s.brk) - 1;
    let code = -1;
    for (;;) {
      if (i < 0) {
        if (ch.index === 0) break;
        ch = this.chunks[ch.index - 1]!;
        i = ch.len - 1;
        continue;
      }
      const d = ch.dead[i];
      if (d === 0) {
        code = ch.codes[i]!;
        break;
      }
      if (d === STRUCT) break;
      i--;
    }
    s.openCache = code !== PARA_CODE;
    return s.openCache;
  }

  /** 가상 ¶ 개수 (0 또는 1) */
  private virt(s: Seg): number {
    return this.isOpen(s) ? 1 : 0;
  }

  /** 구획 seg 안 raw 위치에 넣을 때의 저장 위치. 구획 끝이면 그 구획의 표식 원소 앞 (다음 구획으로 넘어가지 않게) */
  private insertPoint(seg: Seg, raw: number): { chunk: Chunk; index: number } {
    if (seg.brk >= 0 && raw === this.rawStartOf(seg) + seg.len) {
      const chunk = this.chunkOfCtr(seg.brk);
      return { chunk, index: chunk.find(seg.brk) };
    }
    return this.locateRaw(raw);
  }

  /** 보이는 내용이 하나도 없을 때 빈 문단으로 보일 자리표시 (없으면 null) */
  private fallback(): Seg | null {
    if (!this.sentinel) return null;
    for (const s of this.segs) if (s.len > 0 && this.baseShown(s)) return null;
    for (const s of this.segs) if (s.placeholder && !s.used && !s.hidden && s.len > 0) return s;
    return null;
  }

  /** 화면에 나오는가 (반복문용으로 대체 자리표시를 한 번만 계산) */
  private shownPredicate(): (s: Seg) => boolean {
    if (this.simple) return () => true;
    const fb = this.fallback();
    return (s) => s === fb || this.baseShown(s);
  }

  private dispTotal(): number {
    if (this.simple) return this.visible;
    const shown = this.shownPredicate();
    let n = 0;
    for (const s of this.order) if (shown(s)) n += s.len + this.virt(s);
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
    const shown = this.shownPredicate();
    let d = 0;
    for (const s of this.order) {
      if (s === seg) return d;
      if (shown(s)) d += s.len + this.virt(s);
    }
    throw new Error(`unknown segment ${seg.id}`);
  }

  /** 화면 오프셋 → 그 자리 원소가 있는 구획과 raw 오프셋. 끝(= 길이)이면 마지막으로 보이는 구획의 끝 */
  private toRaw(d: number): { seg: Seg; raw: number } {
    if (this.simple) return { seg: this.segs[0]!, raw: d };
    const shown = this.shownPredicate();
    let ds = 0;
    let last: Seg | null = null;
    for (const s of this.order) {
      if (!shown(s) || s.len === 0) continue;
      const L = s.len + this.virt(s);
      // 가상 ¶ 자리(d === ds + len)는 그 구획의 끝 (표식 원소 앞)
      if (d < ds + L) return { seg: s, raw: this.rawStartOf(s) + Math.min(d - ds, s.len) };
      ds += L;
      last = s;
    }
    if (!last) throw new Error('nothing is displayed');
    return { seg: last, raw: this.rawStartOf(last) + last.len };
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
        if (d === STRUCT) return { seg: this.segByBrk.get(ch.ctrs[k]!)!, raw };
      }
    }
    return { seg: this.segs[this.segs.length - 1]!, raw };
  }

  /** 원소의 화면 오프셋. 화면에 나오지 않는 구획이면 그 구획이 놓였을 자리 */
  private elementDisplay(chunk: Chunk, i: number): { off: number; hidden: boolean } {
    const { seg, raw } = this.segOfElement(chunk, i);
    if (this.simple) return { off: raw, hidden: false };
    const ds = this.dispStartOf(seg);
    return this.shownPredicate()(seg)
      ? { off: ds + raw - this.rawStartOf(seg), hidden: false }
      : { off: ds, hidden: true };
  }

  /**
   * 화면 오프셋 d의 원소 앞에서 구획을 나눈다 (이미 구획 시작이면 아무것도 안 함).
   * 앞부분이 새 BRK를 키로 받고 뒷부분은 원래 키를 유지한다 (끝 표식 구획). 화면은 바뀌지 않는다.
   */
  private splitAt(d: number): void {
    if (d <= 0 || d >= this.length) return;
    const { seg, raw } = this.toRaw(d);
    const rs = this.rawStartOf(seg);
    if (raw === rs) return;
    const { chunk, index } = this.locateRaw(raw);
    const at = this.listener ? this.u16At(chunk, index) : 0;
    const ctr = this.insertIntoChunk(chunk, index, [BRK_CODE], STRUCT);
    const left = newSeg(this.idOf(ctr), ctr, raw - rs);
    left.hidden = seg.hidden;
    seg.len -= left.len;
    seg.openCache = null;
    this.segs.splice(this.segs.indexOf(seg), 0, left);
    this.order.splice(this.order.indexOf(seg), 0, left);
    this.segMap.set(left.id, left);
    this.segByBrk.set(ctr, left);
    this.emit({ kind: 'insert', at, text: BRK_CHAR, segs: [left.id] });
    this.emit({ kind: 'list', seg: left.id, before: seg.id });
    this._version++;
  }

  /** 보초 바로 앞에 새 자리표시 구획 [¶ BRK]를 만든다 (화면에는 나오지 않음) */
  private addSpare(): void {
    const tail = this.segs[this.segs.length - 1]!;
    const { chunk, index } = this.locateRaw(this.rawStartOf(tail));
    const at = this.listener ? this.u16At(chunk, index) : 0;
    // 표식을 먼저 넣고 같은 자리에 ¶를 넣으면 [¶ BRK] 순서가 된다
    const ctr = this.insertIntoChunk(chunk, index, [BRK_CODE], STRUCT);
    const brkChunk = this.chunkOfCtr(ctr);
    this.insertIntoChunk(brkChunk, brkChunk.find(ctr), [PARA_CODE], 0);
    this.visible++;
    const spare = newSeg(this.idOf(ctr), ctr, 1);
    spare.placeholder = true;
    this.segs.splice(this.segs.length - 1, 0, spare);
    this.order.splice(this.order.indexOf(tail), 0, spare);
    this.segMap.set(spare.id, spare);
    this.segByBrk.set(ctr, spare);
    this.emit({ kind: 'insert', at, text: PARA + BRK_CHAR, segs: [spare.id] });
    this.emit({ kind: 'flag', seg: spare.id, flag: 'placeholder' });
    this._version++;
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

  /** 구획들을 순서대로 before 앞으로 옮긴다 (null이면 맨 뒤). 없는 키는 건너뛴다 */
  private moveSegs(ids: SegId[], before: SegId | null): void {
    const run = ids.map((id) => this.segMap.get(id)).filter((s): s is Seg => !!s);
    if (run.length === 0) return;
    const snap = this.displaySnapshot();
    const fb = this.fallback();
    const target = before !== null ? (this.segMap.get(before) ?? null) : null;
    const rest = this.order.filter((s) => !run.includes(s));
    const at = target && !run.includes(target) ? rest.indexOf(target) : rest.length;
    rest.splice(at, 0, ...run);
    this.order = rest;
    this.emit({ kind: 'order', moves: run.map((s) => ({ seg: s.id, before: target && !run.includes(target) ? target.id : null })) });
    this.relist(snap, fb);
  }

  /** 구획들의 숨김을 바꾼다 */
  private setHidden(ids: SegId[], value: boolean): void {
    const segs = ids.map((id) => this.segMap.get(id)).filter((s): s is Seg => !!s && s.hidden !== value);
    if (segs.length === 0) return;
    const snap = this.displaySnapshot();
    const fb = this.fallback();
    for (const s of segs) s.hidden = value;
    this.emit({ kind: 'hidden', segs: segs.map((s) => s.id), value });
    this.relist(snap, fb);
  }

  /** 구획 상태를 그대로 맞춘다 (순서 목록에 없는 구획은 저장 순서상 다음 구획 바로 앞) */
  private setSegState(state: SegState): void {
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
    const ph = new Set(state.placeholder ?? []);
    const used = new Set(state.used ?? []);
    for (const s of this.segs) {
      s.hidden = hidden.has(s.id);
      if (state.placeholder) s.placeholder = ph.has(s.id);
      if (state.used) s.used = used.has(s.id);
    }
    this.order = order;
  }

  /** 화면에 나오는 구획의 화면 시작 오프셋 */
  private displaySnapshot(): Map<Seg, number> {
    const m = new Map<Seg, number>();
    if (this.simple) {
      m.set(this.segs[0]!, 0);
      return m;
    }
    const shown = this.shownPredicate();
    let ds = 0;
    for (const s of this.order) {
      if (!shown(s) || s.len === 0) continue;
      m.set(s, ds);
      ds += s.len + this.virt(s);
    }
    return m;
  }

  /**
   * 구획 순서·숨김이 바뀐 뒤 문단 목록을 다시 엮는다. 전에도 보이던 구획의 문단은 같은 객체를 오프셋만 옮겨 쓰고,
   * 새로 보이는 구획만 글자를 읽어 만든다. 구획 경계가 문단 경계와 어긋나 있으면(동시 편집) 처음부터 다시 만든다.
   */
  private relist(snap: Map<Seg, number>, _fb: Seg | null): void {
    const old = this.paras;
    const next: ParagraphInfo[] = [];
    const shift: number[] = [];
    const shown = this.shownPredicate();
    let ds = 0;
    let aligned = true;
    for (const s of this.order) {
      if (!shown(s) || s.len === 0) continue;
      const o = snap.get(s);
      if (o !== undefined) {
        let k = findParaByStart(old, o);
        if (old[k]?.start !== o) {
          aligned = false;
          break;
        }
        const L = s.len + this.virt(s);
        let lastEnd = -1;
        for (; k < old.length && old[k]!.start < o + L; k++) {
          next.push(old[k]!);
          shift.push(ds - o);
          lastEnd = old[k]!.end;
        }
        if (lastEnd !== o + L - 1) {
          aligned = false;
          break;
        }
      } else {
        const ps = this.scanSegment(s, ds);
        if (ps === null) {
          aligned = false;
          break;
        }
        for (const p of ps) {
          next.push(p);
          shift.push(0);
        }
      }
      ds += s.len + this.virt(s);
    }
    if (!aligned) {
      this.rebuildParagraphs();
      return;
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

  /** 문단 목록을 처음부터 다시 만든다 (드문 경우: 동시 편집으로 구획·문단 경계가 어긋났거나 대체 자리표시가 바뀜) */
  private rebuildParagraphs(): void {
    this.paras = this.scanParagraphs(0, Infinity).paras;
    this.changeFrom = 0;
    this.changeSuffix = 0;
    this._version++;
  }

  /** 구획 하나의 문단들을 화면 시작 오프셋 ds 기준으로 만든다. 구획이 ¶로 끝나지 않으면 null */
  private scanSegment(seg: Seg, ds: number): ParagraphInfo[] | null {
    const paras: ParagraphInfo[] = [];
    let n = seg.len;
    let off = ds;
    let pStart = ds;
    let buf: number[] = [];
    let lastCode = -1;
    this.rawForEach(this.rawStartOf(seg), (code, ctr) => {
      lastCode = code;
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
    if (lastCode === PARA_CODE) return paras;
    if (!this.isOpen(seg)) return null;
    // 가상 ¶로 끝나는 마지막 문단
    paras.push({ id: this.idOf(seg.brk), start: pStart, end: off, text: fromCodes(buf) });
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
    if (old.length === 0) {
      this.paras = this.scanParagraphs(0, Infinity).paras;
      this.changeFrom = 0;
      this.changeSuffix = 0;
      return;
    }
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

function forEachCodePoint(s: string, fn: (cp: number) => void): void {
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    fn(c);
  }
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
