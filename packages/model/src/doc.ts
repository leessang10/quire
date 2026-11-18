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
/** 개체 원소 (11 §2.1): 인라인 이미지 등. 글자 한 칸 */
export const OBJ = '\uFFFC';
const OBJ_CODE = 0xfffc;
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
  | { type: 'hidden'; segs: SegId[]; value: boolean }
  /**
   * 원소들(카운터)의 글자 서식 키 하나를 after로 바꿨다 (10 §2.5). before = 원소마다 바꾸기 전 서식 묶음 번호.
   * undo면 되돌리는 방향: 지금 값이 after인 원소만 before의 값으로 (그사이 다른 사용자가 바꾼 원소는 두고).
   * 다시 하기는 지금 값이 before의 값인 원소만 after로.
   */
  | { type: 'format'; ctrs: Int32Array; before: Uint16Array; key: MarkKey; after: unknown; undo?: boolean }
  /** ¶(카운터) 하나의 문단 속성 키 하나 */
  | { type: 'para'; ctr: number; key: ParaKey; before: unknown; after: unknown }
  /** 스타일 정의 하나 (undefined = 없음, 10 §2.3) */
  | { type: 'style'; name: string; before: Style | undefined; after: Style | undefined }
  /** 목록 정의 하나 (undefined = 없음, 10 §2.4) */
  | { type: 'list'; id: string; before: ListDef | undefined; after: ListDef | undefined }
  /** 개체 원소(카운터) 하나의 속성 키 하나 (11 §2.1) */
  | { type: 'obj'; ctr: number; key: ObjKey; before: unknown; after: unknown }
  /** 다른 스토리의 연산 (11 §2.5: 여러 스토리 트랜잭션). Document가 그 스토리에 적용한다 */
  | { type: 'story'; story: string; op: Op }
  /** 표 레코드의 맵 항목 하나 (11 §2.4: 지운 표시·열 너비·병합·행/셀/표 속성). Document가 적용한다 */
  | { type: 'tableMap'; table: string; map: import('./tables').TableMapName; key: string; before: unknown; after: unknown };

/** 글자 서식 묶음 (10 §2.1). 값이 없는 키는 서식 없음. 크기는 1/1000pt */
export interface MarkSet {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  font?: string;
  size?: number;
  color?: string;
  highlight?: string;
  link?: string;
  script?: 'sup' | 'sub';
}
export type MarkKey = keyof MarkSet;
export const MARK_KEYS: readonly MarkKey[] = ['bold', 'italic', 'underline', 'strike', 'font', 'size', 'color', 'highlight', 'link', 'script'];
/** 입력할 때 앞 글자에서 이어받는 키 (10 §2.6). 링크는 이어받지 않는다 */
export const INHERITED_MARKS: ReadonlySet<MarkKey> = new Set(MARK_KEYS.filter((k) => k !== 'link'));

/** 문단 속성 (10 §2.2). 길이는 1/1000pt */
export interface ParaAttrs {
  style?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  indent?: { left?: number; right?: number; first?: number };
  space?: { before?: number; after?: number };
  line?: { rule: 'multiple' | 'exact' | 'atLeast'; value: number };
  list?: { id: string; level: number };
  keepWithNext?: true;
  keepTogether?: true;
  pageBreakBefore?: true;
}
export type ParaKey = keyof ParaAttrs;

/** 개체 속성 (11 §2.1). 길이는 1/1000pt */
export interface ObjAttrs {
  /** 개체 ID (동시 이동으로 생긴 중복을 가릴 때) */
  id?: string;
  kind?: 'image' | 'table';
  /** 자산 ID (이미지 원본의 SHA-256 앞 32자) */
  asset?: string;
  w?: number;
  h?: number;
  /** 대체 텍스트 */
  alt?: string;
  /** 표 개체 (kind 'table')가 가리키는 표 레코드 ID (11 §2.4) */
  table?: string;
  /** 떠 있는 개체면 위치·배치 (11 §2.3). 없으면 글자처럼 줄 안에 */
  float?: FloatAttrs;
}

/** 떠 있는 개체의 위치·배치 (11 §2.3). 길이는 1/1000pt */
export interface FloatAttrs {
  relX: 'column' | 'margin' | 'page';
  relY: 'paragraph' | 'margin' | 'page';
  x: number | 'left' | 'center' | 'right';
  y: number;
  wrap: 'square' | 'topBottom' | 'none';
  side?: 'both' | 'left' | 'right' | 'largest';
  gap?: number;
  behind?: boolean;
}
export type ObjKey = keyof ObjAttrs;
export const OBJ_KEYS: readonly ObjKey[] = ['id', 'kind', 'asset', 'w', 'h', 'alt', 'float', 'table'];
/** Loro에서 개체 속성 마크 키의 접두사 */
export const OBJ_MARK_PREFIX = 'o_';
/** Loro에서 문단 속성 마크 키의 접두사 (마크 키에는 ':'를 쓸 수 없다, 10 §3) */
export const PARA_MARK_PREFIX = 'p_';
/** 모델이 아는 문단 속성 키 */
export const PARA_KEYS: readonly ParaKey[] = ['style', 'align', 'indent', 'space', 'line', 'list', 'keepWithNext', 'keepTogether', 'pageBreakBefore'];
const NO_ATTRS: ParaAttrs = Object.freeze({});

/**
 * 원소 열·구획 변경 기록 (CRDT 브리지용, 09). 위치·길이는 UTF-16 단위이고 구획 표식은 U+E000 한 글자로 센다.
 * 순서대로 적용하면 상대 문서가 이 Doc과 같아진다.
 */
export type RawChange =
  /** segs: text 안의 구획 표식(U+E000)마다 그 구획 키 (순서대로). marks: 넣은 글자의 서식 (없으면 서식 없음) */
  | { kind: 'insert'; at: number; text: string; segs?: SegId[]; marks?: MarkSet }
  /** [at, at+len)의 글자 서식 키 하나 (value undefined = 해제) */
  | { kind: 'mark'; at: number; len: number; key: MarkKey; value: unknown }
  /** at에 있는 ¶의 문단 속성 키 하나 (value undefined = 해제) */
  | { kind: 'para'; at: number; key: ParaKey; value: unknown }
  | { kind: 'delete'; at: number; len: number }
  /** 구획을 순서대로 before 앞으로 옮긴다 (null이면 맨 뒤). 목록에 없던 구획이면 그 자리에 넣는다 */
  | { kind: 'order'; moves: Array<{ seg: SegId; before: SegId | null }> }
  /** 새 구획을 순서 목록에서 before 바로 앞에 넣는다 */
  | { kind: 'list'; seg: SegId; before: SegId }
  | { kind: 'hidden'; segs: SegId[]; value: boolean }
  | { kind: 'flag'; seg: SegId; flag: 'placeholder' | 'used' }
  /** 스타일 정의 하나 (null = 없음, 10 §3: Loro 맵 styles) */
  | { kind: 'style'; name: string; def: Style | null }
  /** 목록 정의 하나 (null = 없음, Loro 맵 lists) */
  | { kind: 'listDef'; id: string; def: ListDef | null }
  /** 개체 속성 키 하나 (at = 개체 글자의 UTF-16 위치, Loro 마크 o_<키>) */
  | { kind: 'obj'; at: number; key: ObjKey; value: unknown }
  /**
   * 가벼운 스토리(11 §2.5)의 끝 ¶ 속성 하나: 끝 ¶는 Loro 텍스트에 없으므로(유령 ¶) 맵에 둔다.
   * key는 글자 서식 키(¶의 서식) 또는 p_<문단 속성 키>
   */
  | { kind: 'tail'; key: string; value: unknown };

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
  /** 문단 속성 (없으면 공유하는 빈 객체) */
  attrs: ParaAttrs;
  /** 글자마다 서식 묶음 번호 (text의 코드포인트 순, Doc.markSet으로 푼다). 모두 0이면 null */
  fmt: Uint16Array | null;
  /** 문단 ¶의 서식 묶음 번호 (빈 줄의 높이, 10 §2.1). 가상 ¶는 0 */
  mark: number;
  /** 문단 안 개체: 코드포인트 위치 → 속성 (11 §2.1). 없으면 null */
  objs: ReadonlyMap<number, ObjAttrs> | null;
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
  /** 원소마다 서식 묶음 번호와 카운터 (되살릴 때 서식·문단 속성을 함께 보낸다) */
  fmts: number[];
  ctrs: number[];
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
  /** 글자 서식 묶음 번호 (0 = 서식 없음) */
  readonly fmt = new Uint16Array(CAP);

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
  /**
   * 가벼운 스토리의 유령 ¶ (11 §2.5): 끝 ¶가 Loro 텍스트에 없는 스토리. 그 원소 카운터, 아니면 -1.
   * 표 셀처럼 두 피어가 동시에 처음 만들 수 있는 스토리는 보초·자리표시를 넣으면 둘이 되므로, 빈 텍스트 = 빈 문단 하나로 본다.
   */
  private ghost = -1;
  private listener: ((c: RawChange) => void) | null = null;
  /** 원격 변경 적용 중 (변경 기록을 보내지 않음) */
  private muted = false;
  /** false면 구획 연산(문단 이동·숨김)을 거부한다 */
  segmentsEnabled = true;
  /** 서식 묶음 표 (10 §2.1): 번호 → 묶음. 0번은 빈 묶음 */
  private markSets: MarkSet[] = [Object.freeze({})];
  private markIds = new Map<string, number>([[markKey({}), 0]]);
  /** (묶음 번호, 키, 값) → 그 키를 바꾼 묶음 번호 */
  private withMarkCache = new Map<string, number>();
  /** ¶ 원소 카운터 → 문단 속성 (속성 없는 문단은 없음) */
  private paraAttrsMap = new Map<number, ParaAttrs>();
  /** 개체 원소 카운터 → 속성 (지운 개체도 기억한다) */
  private objAttrsMap = new Map<number, ObjAttrs>();
  /** 문단 스타일 (10 §2.3). 기본 스타일로 시작한다 */
  private styleMap = new Map<string, Style>(DEFAULT_STYLES.map((st) => [st.name, st]));
  private resolvedStyles = new Map<string, ResolvedStyle>();
  private _stylesVersion = 0;
  /** 목록 정의 (10 §2.4) */
  private listMap = new Map<string, ListDef>();
  /** 목록 구조(목록 문단의 화면 순서·수준·정의)가 바뀔 때마다 오른다. 번호 캐시 키 */
  private _listEpoch = 0;
  private labels: { epoch: number; map: Map<ElementId, ListLabel> } | null = null;
  private listSeq = 0;

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
      attrs: NO_ATTRS,
      fmt: null,
      mark: 0,
      objs: null,
    }));
    doc._version++;
    return doc;
  }

  /**
   * CRDT 텍스트에서 동기화 문서를 만든다. raw는 구획 표식을 U+E000으로 담은 전체 텍스트(보초 ¶로 끝남),
   * keys는 표식마다 구획 키(순서대로), state는 순서·숨김·자리표시 상태.
   */
  static fromRaw(raw: string, keys: SegId[], state: SegState, peer?: string, story = false): Doc {
    const doc = new Doc(peer);
    doc.sentinel = !story;
    if (story) raw += PARA; // 유령 ¶ (Loro 텍스트에는 없음)
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
    if (story) doc.ghost = doc.counter - 1;
    else if (len !== 1) throw new Error('fromRaw: the last segment must be a single paragraph mark (sentinel)');
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
    this.refreshListLabels();
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
  insertText(offset: number, text: string, marks?: MarkSet): ElementId[] {
    const codes = toCodes(normalizeNewlines(text));
    if (codes.length === 0) return [];
    offset = clamp(offset, 0, this.maxCaret);
    // 서식: 주어지면 그것 (편집기의 보류 서식), 아니면 앞 글자에서 이어받는다 (10 §2.6)
    const fmt = this.internMarks(marks ?? this.inheritedMarks(offset));
    // 새 ¶는 지금 문단의 속성을 복사한다 (Enter, 10 §2.2)
    const paraAttrs = codes.includes(PARA_CODE) ? (this.paras[this.paragraphIndexAt(offset)]?.attrs ?? NO_ATTRS) : NO_ATTRS;
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
    const first = this.insertIntoChunk(chunk, index, codes, 0, fmt);
    const newParas: Array<{ ctr: number; at: number }> = [];
    if (paraAttrs !== NO_ATTRS) {
      let u = at;
      for (let k = 0; k < codes.length; k++) {
        if (codes[k] === PARA_CODE) {
          this.paraAttrsMap.set(first + k, paraAttrs);
          newParas.push({ ctr: first + k, at: u });
        }
        u += width16(codes[k]!);
      }
    }
    this.visible += codes.length;
    seg.len += codes.length;
    seg.openCache = null;
    if (this.isOpen(seg) !== wasOpen) this.rebuildParagraphs();
    else this.updateParagraphs(offset, offset + codes.length, codes.length);
    this._version++;
    this.emit(fmt ? { kind: 'insert', at, text: fromCodes(codes), marks: this.markSets[fmt]! } : { kind: 'insert', at, text: fromCodes(codes) });
    for (const p of newParas)
      for (const key of Object.keys(paraAttrs) as ParaKey[]) this.emit({ kind: 'para', at: p.at, key, value: paraAttrs[key] });
    if (claimed) this.addSpare();
    return this.idRange(first, codes.length);
  }

  // ── 서식 (10) ────────────────────────────────────────

  /** 서식 묶음 번호 → 묶음 (ParagraphInfo.fmt를 풀 때) */
  markSet(id: number): MarkSet {
    return this.markSets[id] ?? this.markSets[0]!;
  }

  /** 서식 묶음의 번호 (같은 내용이면 같은 번호) */
  internMarks(m: MarkSet): number {
    const key = markKey(m);
    let id = this.markIds.get(key);
    if (id === undefined) {
      id = this.markSets.length;
      if (id > 0xffff) throw new Error('internMarks: too many distinct mark sets');
      const norm: MarkSet = {};
      for (const k of MARK_KEYS) if (m[k] !== undefined) (norm as Record<string, unknown>)[k] = m[k];
      this.markSets.push(Object.freeze(norm));
      this.markIds.set(key, id);
    }
    return id;
  }

  /** 화면 오프셋 offset에 있는 원소(그 자리 글자)의 서식. 문서 끝이면 빈 묶음 */
  marksAt(offset: number): MarkSet {
    if (offset < 0 || offset >= this.length) return this.markSets[0]!;
    let f = 0;
    this.forEachFrom(offset, (_code, _ctr, chunk, i) => {
      f = chunk.fmt[i]!;
      return true;
    });
    return this.markSets[f]!;
  }

  /**
   * offset에 입력하면 받을 서식 (10 §2.6): 문단 안이면 앞 글자, 문단 첫머리면 그 자리 글자(빈 문단이면 ¶)의 서식에서
   * 이어받는 키만.
   */
  inheritedMarks(offset: number): MarkSet {
    if (this.length === 0) return this.markSets[0]!;
    const p = this.paras[this.paragraphIndexAt(offset)];
    const src = p && offset > p.start ? offset - 1 : offset;
    const m = this.marksAt(src);
    let all = true;
    for (const k of Object.keys(m) as MarkKey[]) if (!INHERITED_MARKS.has(k)) all = false;
    if (all) return m;
    const out: MarkSet = {};
    for (const k of Object.keys(m) as MarkKey[]) if (INHERITED_MARKS.has(k)) (out as Record<string, unknown>)[k] = m[k];
    return out;
  }

  /** [from, to)의 서식 런 (같은 묶음이 이어진 구간) */
  markRuns(from: number, to: number): Array<{ from: number; to: number; marks: MarkSet }> {
    const out: Array<{ from: number; to: number; marks: MarkSet }> = [];
    if (from >= to) return out;
    let n = to - from;
    let off = from;
    this.forEachFrom(from, (_code, _ctr, chunk, i) => {
      const f = chunk.dead[i] === STRUCT ? 0 : chunk.fmt[i]!;
      const m = this.markSets[f]!;
      const last = out[out.length - 1];
      if (last && last.marks === m) last.to = off + 1;
      else out.push({ from: off, to: off + 1, marks: m });
      off++;
      return --n <= 0;
    });
    return out;
  }

  /**
   * [from, to) 글자들의 서식 키 하나를 value로 (undefined = 해제). ¶도 서식을 받는다 (빈 줄의 높이·다음 입력).
   * @returns 실행 취소용 연산 (바뀐 원소가 없으면 빈 목록)
   */
  format(from: number, to: number, key: MarkKey, value: unknown): Op[] {
    from = clamp(from, 0, this.length);
    to = clamp(to, from, this.length);
    if (from === to) return [];
    const ctrs: number[] = [];
    const before: number[] = [];
    const changed: Array<{ chunk: Chunk; i: number }> = [];
    let n = to - from;
    this.forEachFrom(from, (_code, ctr, chunk, i) => {
      if (chunk.dead[i] !== STRUCT) {
        const prev = chunk.fmt[i]!;
        const next = this.withMark(prev, key, value);
        if (next !== prev) {
          chunk.fmt[i] = next;
          ctrs.push(ctr);
          before.push(prev);
          changed.push({ chunk, i });
        }
      }
      return --n <= 0;
    });
    if (ctrs.length === 0) return [];
    this.emitMarks(changed, key, value);
    this.updateParagraphs(from, to, 0);
    this._version++;
    return [{ type: 'format', ctrs: Int32Array.from(ctrs), before: Uint16Array.from(before), key, after: value }];
  }

  /** 문단 i의 속성 */
  paraAttrs(i: number): ParaAttrs {
    return this.paras[i]?.attrs ?? NO_ATTRS;
  }

  /**
   * 문단 i의 속성 키 하나를 value로 (undefined = 해제).
   * 가상 ¶로 끝나는 문단(동시 편집, 09 §6)은 속성을 걸 ¶가 없어 빈 목록을 돌려준다 (2-6에서 실제 ¶를 먼저 넣는다).
   */
  setParaAttr(i: number, key: ParaKey, value: unknown): Op[] {
    const p = this.paras[i];
    if (!p) return [];
    const ctr = this.ctrOf(p.id);
    const chunk = this.chunkOfCtr(ctr);
    if (chunk.dead[chunk.find(ctr)] === STRUCT) return [];
    const cur = this.paraAttrsMap.get(ctr) ?? NO_ATTRS;
    if (sameValue(cur[key], value)) return [];
    this.writeParaAttr(ctr, i, key, value);
    return [{ type: 'para', ctr, key, before: cur[key], after: value }];
  }

  // ── 스타일 (10 §2.3) ─────────────────────────────

  /**
   * 서식이 전혀 없는 문서인가 (글자 서식 묶음이 빈 것뿐, 문단 속성 없음, 스타일 기본, 목록 없음). 보수적이다: 쓰지 않는
   * 묶음이 남아 있으면 false. 저장·재기반의 빠른 길에 쓴다.
   */
  get plain(): boolean {
    if (this.markSets.length > 1 || this.paraAttrsMap.size > 0 || this.listMap.size > 0 || this.objAttrsMap.size > 0) return false;
    if (this.styleMap.size !== DEFAULT_STYLES.length) return false;
    return DEFAULT_STYLES.every((st) => this.styleMap.get(st.name) === st);
  }

  /** 스타일 정의가 바뀔 때마다 오른다 (풀이 캐시 키) */
  get stylesVersion(): number {
    return this._stylesVersion;
  }

  /** 스타일 정의 (없으면 undefined) */
  style(name: string): Style | undefined {
    return this.styleMap.get(name);
  }

  /** 모든 스타일 (정의한 순서) */
  styles(): Style[] {
    return [...this.styleMap.values()];
  }

  /** 스타일 사슬을 풀어 쓴 값 (없는 이름은 본문) */
  resolvedStyle(name: string = BODY_STYLE): ResolvedStyle {
    let r = this.resolvedStyles.get(name);
    if (!r) {
      r = resolveStyle(name, (n) => this.styleMap.get(n));
      this.resolvedStyles.set(name, r);
    }
    return r;
  }

  /** 문단 i의 스타일을 풀어 쓴 값 */
  paraStyle(i: number): ResolvedStyle {
    return this.resolvedStyle(this.paras[i]?.attrs.style ?? BODY_STYLE);
  }

  /** 문단 i의 실제 문단 속성: 스타일 사슬 → 직접 속성 */
  effectiveParaAttrs(i: number): ParaAttrs {
    const attrs = this.paras[i]?.attrs ?? NO_ATTRS;
    const base = this.resolvedStyle(attrs.style ?? BODY_STYLE).para;
    return mergeParaAttrs(base, attrs);
  }

  /**
   * 스타일 정의를 바꾼다 (undefined = 지움). 그 스타일을 (사슬로) 쓰는 문단만 바뀐 문단이 되어 다시 조판된다.
   * @returns 실행 취소용 연산
   */
  setStyle(name: string, def: Style | undefined): Op[] {
    const before = this.styleMap.get(name);
    if (def && def.name !== name) throw new Error(`setStyle: name mismatch (${def.name} != ${name})`);
    if (sameValue(before, def)) return [];
    this.writeStyle(name, def);
    return [{ type: 'style', name, before, after: def }];
  }

  private writeStyle(name: string, def: Style | undefined): void {
    if (def) this.styleMap.set(name, Object.freeze(structuredClone(def)));
    else this.styleMap.delete(name);
    this.emit({ kind: 'style', name, def: def ? structuredClone(def) : null });
    this.resolvedStyles.clear();
    this._stylesVersion++;
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < this.paras.length; i++) {
      const p = this.paras[i]!;
      if (this.resolvedStyle(p.attrs.style ?? BODY_STYLE).chain.includes(name) || (p.attrs.style === name)) {
        this.paras[i] = { ...p };
        if (lo < 0) lo = i;
        hi = i;
      }
    }
    if (lo >= 0) {
      this.changeFrom = Math.min(this.changeFrom, lo);
      this.changeSuffix = Math.min(this.changeSuffix, this.paras.length - 1 - hi);
    }
    this._version++;
  }

  // ── 개체 (11 §2.1) ───────────────────────────────

  /**
   * offset에 개체 하나를 넣는다 (서식은 보통 입력처럼 이어받는다). 실행 취소 연산: 삽입 + 속성.
   * 속성은 지워도 기억하므로 되살리면 그대로다.
   */
  insertObject(offset: number, attrs: ObjAttrs, marks?: MarkSet): Op[] {
    const ids = this.insertText(offset, OBJ, marks);
    const ctr = this.ctrOf(ids[0]!);
    const ops: Op[] = [{ type: 'insert', ids }];
    for (const k of OBJ_KEYS) if (attrs[k] !== undefined) ops.push(...this.setObjAttrCtr(ctr, k, attrs[k]));
    return ops;
  }

  /** 화면 오프셋 offset의 원소가 개체면 그 속성 */
  objAt(offset: number): ObjAttrs | null {
    if (offset < 0 || offset >= this.length) return null;
    let out: ObjAttrs | null = null;
    this.forEachFrom(offset, (code, ctr) => {
      if (code === OBJ_CODE) out = this.objAttrsMap.get(ctr) ?? NO_OBJ;
      return true;
    });
    return out;
  }

  /** 화면 오프셋 offset의 개체 속성 키 하나 (개체가 아니면 빈 목록) */
  setObjAttr(offset: number, key: ObjKey, value: unknown): Op[] {
    let ctr = -1;
    this.forEachFrom(offset, (code, c) => {
      if (code === OBJ_CODE) ctr = c;
      return true;
    });
    return ctr < 0 ? [] : this.setObjAttrCtr(ctr, key, value);
  }

  private setObjAttrCtr(ctr: number, key: ObjKey, value: unknown): Op[] {
    const cur = this.objAttrsMap.get(ctr) ?? NO_OBJ;
    if (sameValue(cur[key], value)) return [];
    this.writeObjAttr(ctr, key, value);
    return [{ type: 'obj', ctr, key, before: cur[key], after: value }];
  }

  private writeObjAttr(ctr: number, key: ObjKey, value: unknown): void {
    const cur = this.objAttrsMap.get(ctr) ?? NO_OBJ;
    const next: Record<string, unknown> = { ...cur };
    if (value === undefined || value === null) delete next[key];
    else next[key] = value;
    this.objAttrsMap.set(ctr, Object.freeze(next) as ObjAttrs);
    this._version++;
    const chunk = this.chunkOfCtr(ctr);
    const i = chunk.find(ctr);
    if (chunk.dead[i] === TOMB) return; // 지운 개체: 속성만 기억
    // 그 개체가 든 문단을 새로 만든다 (레이아웃이 알아채게)
    const { off, hidden } = this.elementDisplay(chunk, i);
    if (!hidden) this.updateParagraphs(off, off + 1, 0);
    if (this.listener && !this.muted) this.emit({ kind: 'obj', at: this.u16At(chunk, i), key, value: value ?? undefined });
  }

  // ── 목록 (10 §2.4) ───────────────────────────────

  /** 목록 정의 */
  listDef(id: string): ListDef | undefined {
    return this.listMap.get(id);
  }

  lists(): ListDef[] {
    return [...this.listMap.values()];
  }

  /** 목록 구조 판 (번호가 바뀔 수 있는 변경마다 오름) */
  get listEpoch(): number {
    return this._listEpoch;
  }

  /**
   * 새 목록 정의 (기본 모양). id는 이 문서 안에서 겹치지 않게 피어 이름과 차례로 만든다.
   * @returns [id, 실행 취소용 연산]
   */
  createList(kind: 'bullet' | 'number'): [string, Op[]] {
    let id: string;
    do id = `${this.peer}-l${++this.listSeq}`;
    while (this.listMap.has(id));
    return [id, this.setList(id, defaultListDef(id, kind))];
  }

  /** 목록 정의를 바꾼다 (undefined = 지움). 그 목록 문단이 다시 조판된다 */
  setList(id: string, def: ListDef | undefined): Op[] {
    const before = this.listMap.get(id);
    if (def && def.id !== id) throw new Error(`setList: id mismatch (${def.id} != ${id})`);
    if (sameValue(before, def)) return [];
    this.writeList(id, def);
    return [{ type: 'list', id, before, after: def }];
  }

  private writeList(id: string, def: ListDef | undefined): void {
    if (def) this.listMap.set(id, Object.freeze(structuredClone(def)));
    else this.listMap.delete(id);
    this.emit({ kind: 'listDef', id, def: def ? structuredClone(def) : null });
    this._listEpoch++;
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < this.paras.length; i++) {
      const pi = this.paras[i]!;
      if (pi.attrs.list?.id === id) {
        this.paras[i] = { ...pi };
        if (lo < 0) lo = i;
        hi = i;
      }
    }
    if (lo >= 0) {
      this.changeFrom = Math.min(this.changeFrom, lo);
      this.changeSuffix = Math.min(this.changeSuffix, this.paras.length - 1 - hi);
    }
    this._version++;
  }

  /** 문단의 목록 번호 (목록 문단이 아니면 null). 화면 순서로 센 값을 목록 구조 판마다 캐시한다 */
  listLabel(p: ParagraphInfo): ListLabel | null {
    if (!p.attrs.list) return null;
    this.refreshListLabels();
    return this.labels!.map.get(p.id) ?? null;
  }

  /**
   * 목록 구조가 바뀌었으면 번호를 다시 센다. 번호가 바뀐 문단은 새 객체로 바꾸고 바뀐 구간에 넣는다 (레이아웃이 다시 그린다:
   * 위에 항목을 넣으면 아래 항목들의 번호가 바뀐다)
   */
  private refreshListLabels(): void {
    if (this.labels && this.labels.epoch === this._listEpoch) return;
    const old = this.labels?.map ?? null;
    const map = this.listMap.size ? numberLists(this.paras, this.listMap) : new Map<ElementId, ListLabel>();
    this.labels = { epoch: this._listEpoch, map };
    if (!old || (old.size === 0 && map.size === 0)) return;
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < this.paras.length; i++) {
      const pi = this.paras[i]!;
      if (!pi.attrs.list) continue;
      const a = old.get(pi.id);
      const b = map.get(pi.id);
      if (a?.text === b?.text && a?.level === b?.level && a?.def === b?.def) continue;
      this.paras[i] = { ...pi };
      if (lo < 0) lo = i;
      hi = i;
    }
    if (lo >= 0) {
      this.changeFrom = Math.min(this.changeFrom, lo);
      this.changeSuffix = Math.min(this.changeSuffix, this.paras.length - 1 - hi);
    }
  }

  /**
   * 정본 JSON(07 §4)용: 문단마다 속성과 서식 런. 런은 같은 서식이 이어진 글자들이고 ¶는 넣지 않는다.
   */
  paragraphRuns(): Array<{ attrs: ParaAttrs; runs: Array<{ text: string; marks: MarkSet; obj?: ObjAttrs }> }> {
    return this.paras.map((p) => {
      const runs: Array<{ text: string; marks: MarkSet; obj?: ObjAttrs }> = [];
      const cps = Array.from(p.text);
      let k = 0;
      while (k < cps.length) {
        const f = p.fmt ? p.fmt[k]! : 0;
        // 개체는 혼자 한 런
        const o = p.objs?.get(k);
        if (o) {
          runs.push({ text: OBJ, marks: this.markSets[f]!, obj: o });
          k++;
          continue;
        }
        let j = k + 1;
        while (j < cps.length && (p.fmt ? p.fmt[j]! : 0) === f && !p.objs?.has(j)) j++;
        runs.push({ text: cps.slice(k, j).join(''), marks: this.markSets[f]! });
        k = j;
      }
      return { attrs: p.attrs, runs };
    });
  }

  /** paragraphRuns의 반대: 서식·속성이 있는 문서를 만든다 (실행 취소 기록 없음) */
  static fromParagraphRuns(
    paras: Array<{ attrs?: ParaAttrs; runs: Array<{ text: string; marks?: MarkSet; obj?: ObjAttrs }> }>,
    peer?: string,
    /** 가벼운 스토리로 (끝 ¶는 유령 ¶, 11 §2.5) */
    story = false,
  ): Doc {
    const text = paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
    const doc = story ? Doc.fromRaw(text, [], { order: [], hidden: [], placeholder: [], used: [] }, peer, true) : Doc.fromText(text, peer);
    let off = 0;
    paras.forEach((p, i) => {
      for (const r of p.runs) {
        const len = Array.from(r.text).length;
        if (r.marks) for (const k of Object.keys(r.marks) as MarkKey[]) if (r.marks[k] !== undefined) doc.format(off, off + len, k, r.marks[k]);
        if (r.obj) for (const k of OBJ_KEYS) if (r.obj[k] !== undefined) doc.setObjAttr(off, k, r.obj[k]);
        off += len;
      }
      if (p.attrs) for (const k of Object.keys(p.attrs) as ParaKey[]) if (p.attrs[k] !== undefined) doc.setParaAttr(i, k, p.attrs[k]);
      off++; // ¶
    });
    return doc;
  }

  /** 묶음 id에서 key만 value로 바꾼 묶음의 번호 */
  private withMark(id: number, key: MarkKey, value: unknown): number {
    const ck = `${id}|${key}|${typeof value === 'object' ? JSON.stringify(value) : String(value)}`;
    let r = this.withMarkCache.get(ck);
    if (r === undefined) {
      const m: Record<string, unknown> = { ...this.markSets[id] };
      if (value === undefined || value === null) delete m[key];
      else m[key] = value;
      r = this.internMarks(m as MarkSet);
      if (this.withMarkCache.size > 50_000) this.withMarkCache.clear();
      this.withMarkCache.set(ck, r);
    }
    return r;
  }

  /** 바뀐 원소들(문서 순서)을 저장 위치가 이어진 구간마다 mark 변경 기록으로 */
  private emitMarks(changed: Array<{ chunk: Chunk; i: number }>, key: MarkKey, value: unknown): void {
    if (!this.listener || this.muted || changed.length === 0) return;
    if (this.ghost >= 0) {
      // 유령 ¶의 서식은 맵으로 (Loro 텍스트에 없는 글자)
      const g = changed.findIndex((e) => e.chunk.ctrs[e.i] === this.ghost);
      if (g >= 0) {
        this.emit({ kind: 'tail', key, value: value ?? undefined });
        changed = changed.filter((_, k) => k !== g);
        if (changed.length === 0) return;
      }
    }
    let start = this.u16At(changed[0]!.chunk, changed[0]!.i);
    let len = 0;
    let prev: { chunk: Chunk; i: number } | null = null;
    for (const e of changed) {
      if (prev && !this.isNextInStorage(prev, e)) {
        this.emit({ kind: 'mark', at: start, len, key, value: value ?? undefined });
        start = this.u16At(e.chunk, e.i);
        len = 0;
      }
      len += width16(e.chunk.codes[e.i]!);
      prev = e;
    }
    this.emit({ kind: 'mark', at: start, len, key, value: value ?? undefined });
  }

  /** b가 저장 순서에서 a 바로 다음의 묘비 아닌 원소인가 (UTF-16 위치가 이어지는가) */
  private isNextInStorage(a: { chunk: Chunk; i: number }, b: { chunk: Chunk; i: number }): boolean {
    let c = a.chunk;
    let i = a.i + 1;
    for (;;) {
      while (i < c.len && c.dead[i] === TOMB) i++;
      if (i < c.len) return c === b.chunk && i === b.i;
      const next = this.chunks[c.index + 1];
      if (!next) return false;
      c = next;
      i = 0;
    }
  }

  /** 문단 i를 바뀐 것으로 표시한다 (내용은 그대로, 새 객체): 표 셀처럼 문단 밖의 것이 바뀌어 다시 조판해야 할 때 */
  touchParagraph(i: number): void {
    if (!this.paras[i]) return;
    this.paras[i] = { ...this.paras[i]! };
    this.changeFrom = Math.min(this.changeFrom, i);
    this.changeSuffix = Math.min(this.changeSuffix, this.paras.length - 1 - i);
  }

  private writeParaAttr(ctr: number, i: number, key: ParaKey, value: unknown): void {
    if (key === 'list') this._listEpoch++;
    const cur = this.paraAttrsMap.get(ctr) ?? NO_ATTRS;
    const next: Record<string, unknown> = { ...cur };
    if (value === undefined || value === null) delete next[key];
    else next[key] = value;
    const frozen = Object.freeze(next) as ParaAttrs;
    if (Object.keys(frozen).length === 0) this.paraAttrsMap.delete(ctr);
    else this.paraAttrsMap.set(ctr, frozen);
    if (i >= 0 && this.paras[i]) {
      this.paras[i] = { ...this.paras[i]!, attrs: Object.keys(frozen).length ? frozen : NO_ATTRS };
      this.changeFrom = Math.min(this.changeFrom, i);
      this.changeSuffix = Math.min(this.changeSuffix, this.paras.length - 1 - i);
    }
    this._version++;
    if (this.listener && !this.muted) {
      if (ctr === this.ghost) this.emit({ kind: 'tail', key: PARA_MARK_PREFIX + key, value: value ?? undefined });
      else {
        const chunk = this.chunkOfCtr(ctr);
        this.emit({ kind: 'para', at: this.u16At(chunk, chunk.find(ctr)), key, value: value ?? undefined });
      }
    }
  }

  /** 원격: 유령 ¶의 속성을 맵 전체(tail)와 같게 한다 (맵에 없는 키는 지운다) */
  applyTailAll(tail: Record<string, unknown>): void {
    if (this.ghost < 0) return;
    const chunk = this.chunkOfCtr(this.ghost);
    const keys = new Set(Object.keys(tail));
    for (const k of Object.keys(this.paraAttrsMap.get(this.ghost) ?? NO_ATTRS)) keys.add(PARA_MARK_PREFIX + k);
    for (const k of Object.keys(this.markSets[chunk.fmt[chunk.find(this.ghost)]!]!)) keys.add(k);
    for (const k of keys) this.applyTail(k, tail[k]);
  }

  /** 가벼운 스토리인가 (끝 ¶가 Loro에 없음) */
  get isStory(): boolean {
    return this.ghost >= 0;
  }

  /**
   * 원격: 유령 ¶의 속성 하나 (맵 tp:<스토리>의 항목). 글자 서식 키면 ¶의 서식, p_<키>면 문단 속성. 기록하지 않는다
   */
  applyTail(key: string, value: unknown): void {
    if (this.ghost < 0) return;
    this.muted = true;
    try {
      const chunk = this.chunkOfCtr(this.ghost);
      const i = chunk.find(this.ghost);
      if (key.startsWith(PARA_MARK_PREFIX)) {
        const k = key.slice(PARA_MARK_PREFIX.length) as ParaKey;
        const cur = this.paraAttrsMap.get(this.ghost) ?? NO_ATTRS;
        if (!sameValue(cur[k], value ?? undefined)) this.writeParaAttr(this.ghost, -1, k, value ?? undefined);
      } else if ((MARK_KEYS as readonly string[]).includes(key)) {
        const next = this.withMark(chunk.fmt[i]!, key as MarkKey, value ?? undefined);
        if (next === chunk.fmt[i]) return;
        chunk.fmt[i] = next;
      } else return;
      this.rebuildParagraphs();
    } finally {
      this.muted = false;
    }
  }

  /** 실행 취소·다시 하기의 서식 연산 */
  private applyFormat(op: Extract<Op, { type: 'format' }>): void {
    const changed: Array<{ chunk: Chunk; i: number }> = [];
    const values = new Map<string, Array<{ chunk: Chunk; i: number }>>();
    let hint: { chunk: Chunk; i: number } | null = null;
    for (let k = 0; k < op.ctrs.length; k++) {
      const ctr = op.ctrs[k]!;
      let chunk: Chunk;
      let i: number;
      if (hint && hint.chunk.ctrs[hint.i + 1] === ctr && hint.i + 1 < hint.chunk.len) {
        chunk = hint.chunk;
        i = hint.i + 1;
      } else {
        chunk = this.chunkOfCtr(ctr);
        i = chunk.find(ctr);
      }
      hint = { chunk, i };
      const cur = chunk.fmt[i]!;
      const curVal = this.markSets[cur]![op.key];
      const beforeVal = this.markSets[op.before[k]!]![op.key];
      let target: unknown;
      if (op.undo) {
        if (!sameValue(curVal, op.after)) continue;
        target = beforeVal;
      } else {
        if (!sameValue(curVal, beforeVal)) continue;
        target = op.after;
      }
      const next = this.withMark(cur, op.key, target);
      if (next === cur) continue;
      chunk.fmt[i] = next;
      if (chunk.dead[i] === TOMB) continue; // 지워진 글자: 서식만 기억해 두고 기록·화면에는 없다
      changed.push({ chunk, i });
      const vk = JSON.stringify(target ?? null);
      let list = values.get(vk);
      if (!list) values.set(vk, (list = []));
      list.push({ chunk, i });
    }
    if (changed.length === 0) return;
    for (const [vk, list] of values) this.emitMarks(list, op.key, JSON.parse(vk) ?? undefined);
    // 바뀐 원소가 흩어져 있을 수 있어 문단 목록을 다시 만든다 (되돌리기·다시 하기에서만)
    this.rebuildParagraphs();
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
        // 서식도 함께 옮긴다 (런마다 그 서식으로 다시 넣음)
        const tail = this.markRuns(tStart, segEnd).map((r) => ({ text: this.slice(r.from, r.to), marks: r.marks }));
        ops.push(...this.deleteRange(tStart, segEnd));
        // 꼬리를 지우면 첫 구획은 tStart에서 끝나므로, 같은 화면 위치는 다음 구획의 첫 글자를 가리킨다
        const ids: ElementId[] = [];
        let at = tStart;
        for (const r of tail) {
          ids.push(...this.insertText(at, r.text, r.marks));
          at += Array.from(r.text).length;
        }
        ops.push({ type: 'insert', ids });
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
    // 가벼운 스토리: 유령 ¶를 가진 끝 문단은 옮기지 않고, 끝 뒤로도 옮기지 않는다
    if (this.ghost >= 0 && (j === n - 1 || to === n)) return [];
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
    if (this.ghost >= 0 && j === n - 1) return [];
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
    else if (op.type === 'hidden') this.setHidden(op.segs, op.value);
    else if (op.type === 'format') this.applyFormat(op);
    else if (op.type === 'style') this.writeStyle(op.name, op.after);
    else if (op.type === 'list') this.writeList(op.id, op.after);
    else if (op.type === 'obj') this.writeObjAttr(op.ctr, op.key, op.after);
    else if (op.type === 'story' || op.type === 'tableMap') throw new Error(`Doc.apply: ${op.type} op needs a Document`);
    else {
      // 문단 속성: 그사이 다른 사용자가 같은 키를 바꿨으면 두지 않고 덮는다 (¶ 속성은 키 하나의 LWW)
      const i = this.paras.findIndex((p) => p.id === this.idOf(op.ctr));
      this.writeParaAttr(op.ctr, i, op.key, op.after);
    }
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
          // 속성만 바꾸는 retain = 원격 서식 변경 (10 §3)
          if (op.attributes && op.retain > 0) this.remoteFormat(pos, op.retain, op.attributes);
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
            this.remoteInsert(pos, codes, op.attributes);
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

  /**
   * 원격 스타일·목록 정의 (Loro 맵 styles·lists의 내용, 10 §3). null 값은 그 이름을 지운 것이고, 맵에 없는 기본 스타일은
   * 기본 정의다. 변경 기록·실행 취소 기록은 남기지 않는다.
   */
  applyRemoteDefs(styles: Record<string, Style | null> | null, lists: Record<string, ListDef | null> | null): void {
    this.muted = true;
    try {
      if (styles) {
        const want = new Map<string, Style | undefined>(DEFAULT_STYLES.map((st) => [st.name, st]));
        for (const [name, def] of Object.entries(styles)) want.set(name, def ? { ...def, name } : undefined);
        for (const name of this.styleMap.keys()) if (!want.has(name)) want.set(name, undefined);
        for (const [name, def] of want) if (!sameValue(this.styleMap.get(name), def)) this.writeStyle(name, def);
      }
      if (lists) for (const [id, def] of Object.entries(lists)) {
        const d = def ? { ...def, id } : undefined;
        if (!sameValue(this.listMap.get(id), d)) this.writeList(id, d);
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
      // 로컬 문서: ¶ 없이 끝난 구획은 문단 이동 뒤의 실행 취소에서만 생기고, 가상 ¶로 보인다 (isOpen과 일치).
      // 저장 마지막 구획(tail)은 가상 ¶가 없으므로 ¶로 끝나야 한다
      const shown = this.shownPredicate();
      for (const s of this.order) {
        if (!shown(s) || s.len === 0 || lastCode.get(s) === PARA_CODE) continue;
        if (s.brk < 0 || !this.isOpen(s)) throw new Error(`segment ${s.id} does not end with a paragraph mark`);
      }
      if (this.slice(this.length - 1, this.length) !== PARA) throw new Error('the document does not end with a paragraph mark');
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
    fmt: ArrayLike<number> | null = null,
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
        c.fmt[i] = fmt ? fmt[k]! : 0;
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

  /** 원소들을 넣고 첫 카운터를 돌려준다. flag가 STRUCT면 보이지 않는 구획 표식. fmt: 넣은 원소의 서식 묶음 번호 */
  private insertIntoChunk(chunk: Chunk, index: number, codes: number[], flag: number, fmt = 0): number {
    const n = codes.length;
    const first = this.counter;
    if (chunk.len + n <= CAP) {
      chunk.codes.copyWithin(index + n, index, chunk.len);
      chunk.ctrs.copyWithin(index + n, index, chunk.len);
      chunk.dead.copyWithin(index + n, index, chunk.len);
      chunk.fmt.copyWithin(index + n, index, chunk.len);
      for (let k = 0; k < n; k++) {
        const ctr = this.nextCtr();
        chunk.codes[index + k] = codes[k]!;
        chunk.ctrs[index + k] = ctr;
        chunk.dead[index + k] = flag;
        chunk.fmt[index + k] = fmt;
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
    const allFmt = new Uint16Array(total);
    allCodes.set(chunk.codes.subarray(0, index), 0);
    allCtrs.set(chunk.ctrs.subarray(0, index), 0);
    allDead.set(chunk.dead.subarray(0, index), 0);
    allFmt.set(chunk.fmt.subarray(0, index), 0);
    for (let k = 0; k < n; k++) {
      allCodes[index + k] = codes[k]!;
      allCtrs[index + k] = this.nextCtr();
      allDead[index + k] = flag;
      allFmt[index + k] = fmt;
    }
    allCodes.set(chunk.codes.subarray(index, chunk.len), index + n);
    allCtrs.set(chunk.ctrs.subarray(index, chunk.len), index + n);
    allDead.set(chunk.dead.subarray(index, chunk.len), index + n);
    allFmt.set(chunk.fmt.subarray(index, chunk.len), index + n);
    const pieces = this.buildChunks(allCodes, allCtrs, allDead, chunk.index, allFmt);
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

  /** 화면 마지막 ¶ 원소의 카운터 (가상 ¶면 -1) */
  private lastDisplayedPara(): number {
    const p = this.paras[this.paras.length - 1];
    if (!p) return -1;
    const ctr = this.ctrOf(p.id);
    const ch = this.chunkOfCtr(ctr);
    return ch.dead[ch.find(ctr)] === STRUCT ? -1 : ctr;
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
    // 문단을 옮긴 뒤의 실행 취소는 화면 마지막 ¶를 지우려 할 수 있다 (앞으로 하는 삭제는 마지막 ¶를 지우지 않는다).
    // 로컬 문서에는 보초가 없으므로 그 ¶는 남긴다: 빈 문단이 하나 남을 수 있지만 문서는 늘 ¶로 끝난다
    const lastPara = dead && !this.sentinel ? this.lastDisplayedPara() : -1;
    for (const id of ids) {
      const ctr = this.ctrOf(id);
      const chunk = this.chunkOfCtr(ctr);
      const i = chunk.find(ctr);
      if (ctr === lastPara) continue;
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
    // 바뀐 구간: ID 순서는 문단을 옮긴 뒤 화면 순서와 다를 수 있으므로 화면 위치의 최소·최대를 쓴다.
    // 원소가 많으면 위치 계산보다 처음부터 다시 만드는 편이 싸다
    const many = shownItems.length > 2000;
    let a = Infinity;
    if (dead && !many) for (const it of shownItems) a = Math.min(a, this.elementDisplay(it.chunk, it.i).off);
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
    if (many || this.fallback() !== fb || touched.some((sg, k) => this.isOpen(sg) !== wasOpen[k])) {
      this.rebuildParagraphs();
    } else if (shownItems.length > 0) {
      // 바뀐 뒤의 좌표: 되살리면 원소 자리, 지우면 원소가 있던 틈
      let b = -Infinity;
      for (const it of shownItems) {
        const off = this.elementDisplay(it.chunk, it.i).off;
        if (!dead) a = Math.min(a, off);
        b = Math.max(b, off + (dead ? 0 : 1));
      }
      this.updateParagraphs(a, Math.max(a, b), dead ? -shownItems.length : shownItems.length);
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
            cur = { chunk: ch, i: e, at: dead ? this.u16At(ch, e) : 0, len: 0, codes: [], fmts: [], ctrs: [] };
            runs.push(cur);
          }
          cur.len += width16(ch.codes[e]!);
          cur.codes.push(ch.codes[e]!);
          cur.fmts.push(ch.fmt[e]!);
          cur.ctrs.push(ch.ctrs[e]!);
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
      // 되살린 글자는 지우기 전 서식을 갖고 있다: 같은 서식끼리 넣고, ¶의 문단 속성도 다시 보낸다 (10 §3)
      for (const run of runs) {
        let at = this.u16At(run.chunk, run.i);
        let k = 0;
        const paras: Array<{ at: number; attrs: ParaAttrs }> = [];
        const objs: Array<{ at: number; attrs: ObjAttrs }> = [];
        while (k < run.codes.length) {
          let j = k + 1;
          while (j < run.codes.length && run.fmts[j] === run.fmts[k]) j++;
          const codes = run.codes.slice(k, j);
          const f = run.fmts[k]!;
          this.emit(f ? { kind: 'insert', at, text: fromCodes(codes), marks: this.markSets[f]! } : { kind: 'insert', at, text: fromCodes(codes) });
          for (let q = k; q < j; q++) {
            if (run.codes[q] === PARA_CODE) {
              const attrs = this.paraAttrsMap.get(run.ctrs[q]!);
              if (attrs) paras.push({ at, attrs });
            }
            if (run.codes[q] === OBJ_CODE) {
              const oa = this.objAttrsMap.get(run.ctrs[q]!);
              if (oa) objs.push({ at, attrs: oa });
            }
            at += width16(run.codes[q]!);
          }
          k = j;
        }
        for (const p of paras) for (const key of Object.keys(p.attrs) as ParaKey[]) this.emit({ kind: 'para', at: p.at, key, value: p.attrs[key] });
        for (const o of objs) for (const key of Object.keys(o.attrs) as ObjKey[]) this.emit({ kind: 'obj', at: o.at, key, value: o.attrs[key] });
      }
    }
  }

  /** 원소(묘비 아님, 구획 표식 포함) 앞 틈이 속한 구획. 구획 표식 앞이면 그 표식이 끝내는 구획 */
  private segAtElement(chunk: Chunk, index: number, raw: number): Seg {
    if (index >= chunk.len) return this.segs[this.segs.length - 1]!;
    if (chunk.dead[index] === STRUCT) return this.segByBrk.get(chunk.ctrs[index]!)!;
    return this.segAtRaw(raw);
  }

  /** 원격 글자 삽입 */
  /** attributes: 원격 글자의 서식 (서식 키만 쓴다. 구획·문단 속성 키는 무시) */
  private remoteInsert(pos: number, codes: number[], attributes?: Record<string, unknown>): void {
    let fmt = 0;
    if (attributes) {
      const m: Record<string, unknown> = {};
      for (const k of MARK_KEYS) if (attributes[k] !== undefined && attributes[k] !== null) m[k] = attributes[k];
      fmt = this.internMarks(m as MarkSet);
    }
    const { chunk, index, raw } = this.locateU16(pos);
    const seg = this.segAtElement(chunk, index, raw);
    const shown = this.shownPredicate()(seg);
    const snap = this.displaySnapshot();
    const fb = this.fallback();
    const d = shown ? this.dispStartOf(seg) + raw - this.rawStartOf(seg) : 0;
    const wasOpen = this.isOpen(seg);
    const first = this.insertIntoChunk(chunk, index, codes, 0, fmt);
    // 넣은 ¶의 문단 속성 (p_* 마크, ¶에 붙은 것만), 넣은 개체의 속성 (o_* 마크, 개체 글자에 붙은 것만)
    if (attributes) {
      const ok = Object.keys(attributes).filter((k) => k.startsWith(OBJ_MARK_PREFIX) && attributes[k] !== null && attributes[k] !== undefined);
      if (ok.length)
        for (let k = 0; k < codes.length; k++)
          if (codes[k] === OBJ_CODE) {
            const a: Record<string, unknown> = {};
            for (const key of ok) a[key.slice(OBJ_MARK_PREFIX.length)] = attributes[key];
            this.objAttrsMap.set(first + k, Object.freeze(a) as ObjAttrs);
          }
      const paraKeys = Object.keys(attributes).filter((k) => k.startsWith(PARA_MARK_PREFIX) && attributes[k] !== null && attributes[k] !== undefined);
      if (paraKeys.length)
        for (let k = 0; k < codes.length; k++)
          if (codes[k] === PARA_CODE) for (const pk of paraKeys) this.writeParaAttr(first + k, -1, pk.slice(PARA_MARK_PREFIX.length) as ParaKey, attributes[pk]);
    }
    this.visible += codes.length;
    seg.len += codes.length;
    seg.openCache = null;
    void snap;
    if (this.fallback() !== fb || this.isOpen(seg) !== wasOpen) this.rebuildParagraphs();
    else if (shown) this.updateParagraphs(d, d + codes.length, codes.length);
    this._version++;
  }

  /**
   * 원격 서식 변경 [pos, pos+len16) (UTF-16, 구획 표식 포함 위치). 글자 서식 키는 그 글자들에, 문단 속성 키(p_*)는
   * 그 안의 ¶에만 건다 (¶ 옆으로 번진 마크는 읽지 않는다, 2-1 발견 3). 값 null = 해제.
   */
  private remoteFormat(pos: number, len16: number, attributes: Record<string, unknown>): void {
    const marks: Array<[MarkKey, unknown]> = [];
    const paraKeys: Array<[ParaKey, unknown]> = [];
    const objKeys: Array<[ObjKey, unknown]> = [];
    for (const [k, v] of Object.entries(attributes)) {
      if ((MARK_KEYS as readonly string[]).includes(k)) marks.push([k as MarkKey, v ?? undefined]);
      else if (k.startsWith(PARA_MARK_PREFIX)) paraKeys.push([k.slice(PARA_MARK_PREFIX.length) as ParaKey, v ?? undefined]);
      else if (k.startsWith(OBJ_MARK_PREFIX)) objKeys.push([k.slice(OBJ_MARK_PREFIX.length) as ObjKey, v ?? undefined]);
    }
    if (marks.length === 0 && paraKeys.length === 0 && objKeys.length === 0) return;
    const { chunk, index } = this.locateU16(pos);
    let left = len16;
    let lo = Infinity;
    let hi = -1;
    let n = 0;
    outer: for (let c = chunk.index; c < this.chunks.length; c++) {
      const ch = this.chunks[c]!;
      for (let i = c === chunk.index ? index : 0; i < ch.len; i++) {
        const st = ch.dead[i];
        if (st === TOMB) continue;
        let changed = false;
        if (st !== STRUCT) {
          let f = ch.fmt[i]!;
          for (const [k, v] of marks) f = this.withMark(f, k, v);
          if (f !== ch.fmt[i]) {
            ch.fmt[i] = f;
            changed = true;
          }
          if (objKeys.length && ch.codes[i] === OBJ_CODE) {
            const ctr = ch.ctrs[i]!;
            const cur = this.objAttrsMap.get(ctr) ?? NO_OBJ;
            const next: Record<string, unknown> = { ...cur };
            let diff = false;
            for (const [k, v] of objKeys) {
              if (sameValue(cur[k], v)) continue;
              if (v === undefined) delete next[k];
              else next[k] = v;
              diff = true;
            }
            if (diff) {
              this.objAttrsMap.set(ctr, Object.freeze(next) as ObjAttrs);
              changed = true;
            }
          }
          if (paraKeys.length && ch.codes[i] === PARA_CODE) {
            const ctr = ch.ctrs[i]!;
            const cur = this.paraAttrsMap.get(ctr) ?? NO_ATTRS;
            for (const [k, v] of paraKeys) {
              if (sameValue(cur[k], v)) continue;
              this.writeParaAttr(ctr, -1, k, v);
              changed = true;
            }
          }
        }
        if (changed) {
          n++;
          const { off, hidden } = this.elementDisplay(ch, i);
          if (!hidden) {
            lo = Math.min(lo, off);
            hi = Math.max(hi, off);
          }
        }
        left -= width16(ch.codes[i]!);
        if (left <= 0) break outer;
      }
    }
    if (n === 0) return;
    if (n > 2000) this.rebuildParagraphs();
    else if (hi >= 0) this.updateParagraphs(lo, hi + 1, 0);
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
    if (s.len === 0 || s.brk < 0) return false;
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
    this._listEpoch++; // 문단 순서가 바뀌었다 (구획 이동·숨김): 목록 번호를 다시 센다
    this._version++;
  }

  /** 문단 목록을 처음부터 다시 만든다 (드문 경우: 동시 편집으로 구획·문단 경계가 어긋났거나 대체 자리표시가 바뀜) */
  private rebuildParagraphs(): void {
    this._listEpoch++;
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
    const acc = new ParaAccumulator();
    let lastCode = -1;
    this.rawForEach(this.rawStartOf(seg), (code, ctr, chunk, i) => {
      lastCode = code;
      if (code === PARA_CODE) {
        paras.push(this.paraInfo(ctr, pStart, off, acc, chunk.fmt[i]!));
        pStart = off + 1;
      } else {
        acc.push(code, chunk.fmt[i]!, code === OBJ_CODE ? (this.objAttrsMap.get(ctr) ?? NO_OBJ) : null);
      }
      off++;
      return --n <= 0;
    });
    if (lastCode === PARA_CODE) return paras;
    if (!this.isOpen(seg)) return null;
    // 가상 ¶로 끝나는 마지막 문단
    paras.push(this.paraInfo(seg.brk, pStart, off, acc, 0));
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
    // 목록 번호: 바뀐 문단들 가운데 목록 문단의 (ID, 목록, 수준) 열이 그대로면 번호도 그대로다 (글자 입력, 목록 아닌 문단의
    // Enter·합치기). 번호는 ¶ ID로 찾으므로 보통 문단이 늘거나 줄어도 다시 셀 필요가 없다
    if (this.listMap.size > 0 && !sameListSeq(old, i, j + 1, rebuilt)) this._listEpoch++;
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
    const acc = new ParaAccumulator();
    let lastParaOffset = start;
    this.forEachFrom(start, (code, ctr, chunk, i) => {
      if (code === PARA_CODE) {
        paras.push(this.paraInfo(ctr, pStart, off, acc, chunk.fmt[i]!));
        lastParaOffset = off;
        if (off >= stopAfter) return true;
        pStart = off + 1;
      } else {
        acc.push(code, chunk.fmt[i]!, code === OBJ_CODE ? (this.objAttrsMap.get(ctr) ?? NO_OBJ) : null);
      }
      off++;
      return false;
    });
    return { paras, lastParaOffset };
  }

  /** 문단 정보 하나 (acc를 비운다). ctr = ¶ 원소(가상 ¶면 구획 표식) */
  private paraInfo(ctr: number, start: number, end: number, acc: ParaAccumulator, mark: number): ParagraphInfo {
    const { text, fmt, objs } = acc.take();
    return { id: this.idOf(ctr), start, end, text, attrs: this.paraAttrsMap.get(ctr) ?? NO_ATTRS, fmt, mark, objs };
  }
}

/** 문단 하나의 글자와 서식 번호를 모은다 (서식이 없으면 번호 배열을 만들지 않음) */
class ParaAccumulator {
  private codes: number[] = [];
  private fmt: number[] | null = null;
  private objs: Map<number, ObjAttrs> | null = null;

  push(code: number, f: number, obj: ObjAttrs | null): void {
    if (f !== 0 && !this.fmt) this.fmt = new Array<number>(this.codes.length).fill(0);
    if (obj) (this.objs ??= new Map()).set(this.codes.length, obj);
    this.codes.push(code);
    this.fmt?.push(f);
  }

  take(): { text: string; fmt: Uint16Array | null; objs: Map<number, ObjAttrs> | null } {
    const r = { text: fromCodes(this.codes), fmt: this.fmt ? Uint16Array.from(this.fmt) : null, objs: this.objs };
    this.codes = [];
    this.fmt = null;
    this.objs = null;
    return r;
  }
}

const NO_OBJ: ObjAttrs = Object.freeze({});

/** 서식 묶음의 정규형 키 (값 있는 키를 이름순으로) */
function markKey(m: MarkSet): string {
  const keys = (Object.keys(m) as MarkKey[]).filter((k) => m[k] !== undefined).sort();
  return JSON.stringify(keys.map((k) => [k, m[k]]));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  return typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
}

/** old[a, b)와 rebuilt의 목록 문단 열이 같은가 (ID·목록·수준) */
function sameListSeq(old: ParagraphInfo[], a: number, b: number, rebuilt: ParagraphInfo[]): boolean {
  let k = a;
  let m = 0;
  for (;;) {
    while (k < b && !old[k]!.attrs.list) k++;
    while (m < rebuilt.length && !rebuilt[m]!.attrs.list) m++;
    if (k >= b || m >= rebuilt.length) return k >= b && m >= rebuilt.length;
    const x = old[k]!;
    const y = rebuilt[m]!;
    if (x.id !== y.id || x.attrs.list!.id !== y.attrs.list!.id || x.attrs.list!.level !== y.attrs.list!.level) return false;
    k++;
    m++;
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
}import { defaultListDef, numberLists, type ListDef, type ListLabel } from './lists';
import { BODY_STYLE, DEFAULT_STYLES, mergeParaAttrs, resolveStyle, type ResolvedStyle, type Style } from './styles';

