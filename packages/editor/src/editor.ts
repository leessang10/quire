/**
 * 0단계 에디터: 캔버스 렌더링 + 숨긴 textarea 입력 + 자체 선택 모델
 * 설계: docs/design/03, 04, 08
 */
import {
  OBJ,
  BODY_STYLE,
  Doc,
  Document,
  History,
  invertOp,
  type TableGrid,
  MARK_KEYS,
  MAX_LIST_LEVEL,
  type MarkKey,
  type MarkSet,
  type Op,
  type ParaAttrs,
  type ParaKey,
  type FloatAttrs,
  type ObjAttrs,
  type ObjKey,
  type ParagraphInfo,
  type Position,
  type Selection,
  cellKey,
  cellStoryId,
  fullSection,
  hfStoryId,
  isHFStory,
  newAnnotationId,
  newMessageId,
  newThreadId,
  type AnnotationRange,
  type CommentAuthor,
  type CommentThread,
  isNoteStory,
  noteStoryId,
  type FieldKind,
  type HFKind,
  type HFPart,
  type SectionProps,
  type SectionStart,
  type Style,
  type FindQuery,
} from '@quire/model';
import {
  LayoutCache,
  PagedLayout,
  SectionFrames,
  displayToDoc,
  docToDisplay,
  lineX,
  type Measurer,
  type PageSetup,
  type PlacedLine,
  type PlacedPara,
} from '@quire/layout';
import { EditContextInput, editContextSupported } from './edit-context';
import { MemoryAssets, type AssetStore } from './assets';
import { Formatter, NOTE_INDENT, defaultPageSetup, hasKeys, type TableView } from './formatter';
import { summarizeLayout, type LayoutSummary } from './reference';
import { defaultThemeColors, ensureThemeStyles, readThemeColors, sameColors, type ColorScheme, type PageView, type ThemeColors, type ThemeName } from './theme';
import { dateText, layoutHF, pageHF, type PageHF } from './headers';
import { FRAGMENT_MIME, fragmentOf, fragmentToHtml, fragmentToText, htmlToFragment, pasteFragment, pendingImages, tableBlock, type Fragment } from './clipboard';
import { TextareaInput, type InputBackend, type InputIntent, type InputLogEntry, type InputMode } from './input';
import type { SpellChecker } from './spell';
import { CanvasTarget } from './paint';
import { Messages, type MessageKey, type MessageParams, type MessageTable } from './i18n';
import type { PainterEnv } from './painter';
import { DEFAULT_METRICS, PagePainter, noteLayout as noteLayoutOf, noteSlots as noteSlotsOf, type FontMetrics, type LinePaint, type NoteSlot, type ObjectPaint, type PaintOverlay, type StoryOverlay } from './painter';

import type { Decoration, DecorationPara, DecorationSource, DecorationStyle, MenuItem, PluginContext, PluginEvent, QuirePlugin, Rect, StoryPos } from './plugins';
import { eventKey, normalizeKey } from './plugins';
import { findPlugin, type FindPlugin, type FindStatus } from './find-plugin';
import { spellPlugin, type SpellMenu, type SpellPlugin } from './spell-plugin';
export type { Decoration, DecorationPara, DecorationSource, DecorationStyle } from './plugins';
export type { FindStatus } from './find-plugin';
export type { SpellMenu } from './spell-plugin';

export interface EditorOptions {
  host: HTMLElement;
  text?: string;
  /** 이미 있는 문서 모델을 편집한다 (동기화 브리지가 붙은 Doc 등). 주면 text는 무시 */
  doc?: Doc;
  /** 여러 스토리 문서 (본문 + 표 셀 스토리 + 표 레코드, 11 §2.5). 주면 doc·text는 무시 */
  document?: Document;
  fontFamily?: string;
  fontSize?: number;
  onInputLog?: (entry: InputLogEntry) => void;
  /**
   * 엔진이 불러올 글꼴 (ADR-0002). 앞이 기본 글꼴, 뒤는 대체 글꼴. 주면 불러오는 동안은 fontFamily(시스템 글꼴)로
   * 측정하고, 다 불러오면 HarfBuzz 셰이핑으로 바꿔 다시 조판한다. 그리기도 같은 파일(FontFace)로 한다.
   */
  fonts?: FontSource[];
  /** 화면 테마 (17): classic(기본)·minimal·modern. 문서·레이아웃은 바뀌지 않는다 */
  theme?: ThemeName;
  /** light(기본)·dark·auto(시스템 설정을 따름). 다크에서도 쪽은 흰 종이 */
  colorScheme?: ColorScheme;
  /** print(기본: 쪽마다 종이와 틈)·continuous(쪽 경계 없이 이어서). 레이아웃은 같다 */
  pageView?: PageView;
  /**
   * 편집 기호 표시 (¶, 쪽·단·구역 나눔). 기본 false: 나눔 표시는 캐럿이 그 옆에 있을 때와 연속 보기에서만 보인다.
   * 표시는 화면 위 덧그림이라 레이아웃·문서·내보내기를 바꾸지 않는다
   */
  showMarks?: boolean;
  /** 화면 언어 (18, BCP 47: ko·en·en-GB). 기본 ko. 정확히 없으면 앞부분(en)으로, 빠진 키는 영어 → 한국어 순으로 */
  locale?: string;
  /** 언어별 메시지 덮어쓰기·추가 언어 (키 단위, 18 §5): { en: { 'break.page': 'Page break' } } */
  messages?: Record<string, MessageTable>;
  /** 글꼴을 다 불러와 셰이핑으로 바꿨을 때 (실패하면 error) */
  onFontsReady?: (editor: Editor, error?: unknown) => void;
  /**
   * 입력 층 (03 §2). auto(기본): EditContext를 지원하면 경로 A, 아니면 숨긴 textarea(경로 B).
   * editcontext를 골랐는데 지원하지 않으면 textarea를 쓴다.
   */
  input?: InputMode;
  onChange?: (editor: Editor) => void;
  /** 선택 영역(캐럿)이 바뀌었을 때 (프레즌스 전송용). 그 스토리의 화면 오프셋, story = 셀·머리말·각주 (14 §7), page = 머리말의 쪽 */
  onSelectionChange?: (anchor: number, head: number, story?: string, page?: number) => void;
  /** Ctrl+F(replace = false)·Ctrl+H(true): 앱이 찾기 막대를 연다 (15 §3.1). 없으면 브라우저 기본 동작 */
  onFindRequest?: (replace: boolean) => void;
  /** 맞춤법 검사기 (15 §4). 없으면 검사하지 않는다. 나중에 setSpellChecker로 바꿀 수 있다 */
  spellChecker?: SpellChecker;
  /** 검사 언어 (기본 ko) */
  spellLang?: string;
  /**
   * 오른쪽 클릭: 앱이 메뉴를 연다. spell은 맞춤법 오류 위면 그 메뉴 (그 낱말을 선택해 둔다), items는 플러그인들의 메뉴 항목.
   * false를 돌려주면 브라우저 기본 메뉴. 없으면 늘 브라우저 기본 메뉴
   */
  onContextMenu?: (e: MouseEvent, spell: SpellMenu | null, items: MenuItem[]) => boolean | void;
  /** 플러그인 (15 §7): 만들 때 붙인다. 나중에 use()로도 붙인다 */
  plugins?: QuirePlugin[];
  /** 이미지 원본 저장소 (11 §2.2). 없으면 메모리 */
  assets?: AssetStore;
  /** 댓글 작성자 (14 §3.1: 4단계는 접속할 때의 사용자 정보). 없으면 "나" */
  user?: CommentAuthor;
  /**
   * 문서 복제 (보기 모드 최종본·원본의 파생 문서, 14 §4.3). 편집기는 동기화·정본을 모르므로 바깥에서 준다 (정본 왕복 등).
   * 없으면 보기 모드를 바꿀 수 없다
   */
  cloneDocument?: (document: Document) => Document;
}

/** 보기 모드 (14 §4.3): 제안 포함(편집) / 최종본(모두 수락) / 원본(모두 거부), 뒤 둘은 읽기 전용 */
export type ViewMode = 'suggestions' | 'final' | 'original' | 'preview';

/** 제안 창에 놓을 제안 (14 §4.4): 범위, 화면 y, 요약 */
export interface SuggestionView extends AnnotationRange {
  y: number | null;
  /** "‘…’ 넣음" 같은 요약 */
  summary: string;
}

/** 댓글 창에 놓을 스레드 (14 §3.2): 범위와 그 화면 y (문서 좌표, 고아면 null) */
export interface ThreadView extends CommentThread {
  story: string | null;
  from: number;
  to: number;
  orphan: boolean;
  /** 범위 시작의 문서 y (스크롤 전). 고아·찾지 못하면 null */
  y: number | null;
}

/** 엔진이 불러올 글꼴 파일 (TTF·OTF: HarfBuzz가 woff2를 읽지 못하므로 압축 안 된 sfnt) */
export interface FontSource {
  /** 사람이 읽는 이름 (상태 표시용) */
  name: string;
  /** 글꼴 파일 하나 */
  url?: string;
  data?: ArrayBuffer | Uint8Array;
  /**
   * 조각난 글꼴의 목록 (scripts/build-fonts.mjs의 manifest.json). 문서에 나온 글자가 든 조각만 내려받고, 편집 중 새 글자가
   * 나오면 그 조각을 받아 다시 조판한다 (02 §4 부분 로드).
   */
  manifest?: string;
  /** 같은 가족의 굵은 얼굴 (조각 목록, 같은 조각 이름). 없으면 굵게는 합성 굵게로 그린다 (10 §4) */
  bold?: { manifest: string };
}

/** 선택한 문단들의 문단 서식 (툴바 상태): 스타일 이름과 실제 속성. 문단마다 다른 키는 mixed에 */
export interface ParagraphState {
  style: string;
  attrs: ParaAttrs;
  mixed: Set<string>;
}

/** 선택 영역의 글자 서식: 키마다 값, 섞여 있으면 mixed에 */
export interface SelectionMarks {
  marks: MarkSet;
  mixed: Set<MarkKey>;
}

/** 다른 사용자의 선택 영역 (화면 오프셋). 협업 프레즌스에서 받아 그린다 */
export interface RemoteCaret {
  key: string;
  name: string;
  /** #rrggbb */
  color: string;
  anchor: number;
  head: number;
  /** 스토리 (14 §7: 셀·머리말·각주, 없으면 본문). 오프셋은 그 스토리 기준 */
  story?: string;
  /** 머리말·꼬리말이면 상대가 편집 중인 쪽 */
  page?: number;
}

export interface EditorStats {
  layoutMs: number;
  renderMs: number;
  pages: number;
  paragraphs: number;
  lines: number;
  characters: number;
  cacheHits: number;
  cacheMisses: number;
  /** 마지막 레이아웃에서 줄을 다시 나눈 / 위치만 다시 놓은 / 그대로 쓴 문단 수 */
  reflowed: number;
  repositioned: number;
  reused: number;
  /** 아직 배치되지 않은 문단 수 (백그라운드 쪽 조립 대기) */
  pendingParas: number;
  /** 백그라운드 쪽 조립에 쓴 누적 시간 */
  backgroundMs: number;
}

/** 구역 나눔 표시의 시작 방식 이름 */
const SECTION_LABELS: Record<SectionStart, MessageKey> = {
  nextPage: 'section.nextPage',
  continuous: 'section.continuous',
  evenPage: 'section.evenPage',
  oddPage: 'section.oddPage',
};

/** 입력이 멈춘 뒤 캐럿 문단을 검사하기까지 (15 §4.2) */

/** 내장 장식 겉모양 */
const DECORATION_STYLES: Record<string, DecorationStyle> = {
  find: { fill: 'rgba(255, 214, 0, 0.45)' },
  'find-current': { fill: 'rgba(255, 140, 0, 0.6)' },
  'spell-spelling': { wave: '#e11d48' },
  'spell-spacing': { wave: '#2563eb' },
  'spell-grammar': { wave: '#2563eb' },
};

/** 화면 색 중 테마로 열지 않는 것 (주석 범위, 14 §2.4: 댓글, 그 밖, 고른 것). 나머지는 테마 (theme.ts) */
const COLORS = {
  annComment: 'rgba(255, 196, 0, 0.28)',
  annOther: 'rgba(80, 150, 255, 0.2)',
  annFocus: 'rgba(255, 170, 0, 0.55)',
};

/** 문단 손잡이 영역: 본문 왼쪽 여백 안 [margin - GRIP_LEFT, margin - GRIP_RIGHT) */
const GRIP_LEFT = 32;
const GRIP_RIGHT = 4;
/** 끄는 중 화면 위·아래 끝에서 이 거리 안이면 자동 스크롤 */
const AUTOSCROLL_EDGE = 40;

/** 렌더링 한 번에 쪽 조립에 쓸 최대 시간 (나머지는 다음 프레임) */
const RENDER_LAYOUT_BUDGET_MS = 10;
/** FontFace 이름을 편집기마다 다르게 */
let editorSeq = 0;

class CanvasMeasurer implements Measurer {
  private ctx: CanvasRenderingContext2D;
  private bold: CanvasRenderingContext2D;
  private cache = new Map<string, number>();
  constructor(font: string) {
    const make = (f: string) => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = f;
      // 렌더링과 같은 조건으로 측정 (커닝 없음 → 줄 단위로 그려도 위치가 맞음)
      if ('fontKerning' in ctx) ctx.fontKerning = 'none';
      return ctx;
    };
    this.ctx = make(font);
    this.bold = make(`bold ${font}`);
  }
  width(g: string, face = 0): number {
    const key = face === 0 ? g : `\u0001${g}`;
    let w = this.cache.get(key);
    if (w === undefined) {
      const ctx = face === 0 ? this.ctx : this.bold;
      w = g === '\t' ? ctx.measureText('    ').width : ctx.measureText(g).width;
      this.cache.set(key, w);
    }
    return w;
  }
  /** 글꼴 상자 (em 비율) */
  metrics(size: number): { ascent: number; descent: number } {
    const m = this.ctx.measureText('가');
    const a = m.fontBoundingBoxAscent;
    const d = m.fontBoundingBoxDescent;
    return a > 0 && d >= 0 ? { ascent: a / size, descent: d / size } : { ascent: 0.8, descent: 0.2 };
  }
}

/** 스토리 내용을 다른 스토리로 복사한다 (머리말 연결 끊기). dst는 먼저 비운다 */
function copyStory(src: Doc, dst: Doc): Op[] {
  const ops: Op[] = [];
  if (dst.maxCaret > 0) ops.push(...dst.deleteRange(0, dst.maxCaret));
  const paras = src.paragraphRuns();
  let at = 0;
  paras.forEach((p, i) => {
    if (i > 0) {
      ops.push({ type: 'insert', ids: dst.insertText(at, '\n') });
      at++;
    }
    for (const r of p.runs) {
      if (r.obj) {
        ops.push(...dst.insertObject(at, r.obj, r.marks));
        at++;
      } else if (r.text) {
        ops.push({ type: 'insert', ids: dst.insertText(at, r.text, r.marks) });
        at += Array.from(r.text).length;
      }
    }
  });
  paras.forEach((p, i) => {
    for (const [k, v] of Object.entries(p.attrs)) ops.push(...dst.setParaAttr(i, k as ParaKey, v as never));
  });
  return ops;
}

/** 편집 중인 표 셀 (11 §5.4) */
interface ActiveCell {
  table: string;
  row: string;
  col: string;
  story: string;
}

/** 편집 중인 머리말·꼬리말 (12 §5.4). 같은 스토리가 여러 쪽에 그려지므로 캐럿은 누른 쪽(page)에만 그린다 */
interface ActiveHF {
  story: string;
  part: HFPart;
  page: number;
  /** 들어오기 전 본문 선택 (나오면 되돌린다) */
  bodySel: Selection;
}

/** 편집 중인 각주 (12 §6.3): 누른 쪽(page)의 각주 영역에 그 각주의 레이아웃을 놓는다 */
interface ActiveNote {
  story: string;
  id: string;
  page: number;
  /** 들어오기 전 본문 선택 */
  bodySel: Selection;
}

/** 편집 중인 머리말·꼬리말의 상태 (도구 막대) */
export interface HeaderFooterInfo {
  part: HFPart;
  kind: HFKind;
  /** 그 쪽의 구역 ID와 차례 */
  section: string;
  sectionIndex: number;
  page: number;
  titlePage: boolean;
  oddEven: boolean;
  /** 앞 구역의 스토리를 이어 쓰는가 (이전과 연결) */
  linked: boolean;
}

/** 셀 범위 선택 (격자 인덱스 대신 행·열 ID: 원격 변경에도 따라간다) */
interface CellRange {
  table: string;
  rows: [string, string];
  cols: [string, string];
}

export class Editor {
  /** 여러 스토리 문서. 본문은 document.body */
  document: Document;
  /** 편집 중인 스토리 (본문, 또는 편집 중인 표 셀) */
  doc: Doc;
  history = new History();
  /** 편집 중인 스토리의 레이아웃 (본문이면 bodyLayout) */
  layout!: PagedLayout;
  /** 본문(쪽) 레이아웃 */
  bodyLayout!: PagedLayout;
  stats: EditorStats = {
    layoutMs: 0, renderMs: 0, pages: 0, paragraphs: 0, lines: 0, characters: 0, cacheHits: 0, cacheMisses: 0,
    reflowed: 0, repositioned: 0, reused: 0, pendingParas: 0, backgroundMs: 0,
  };

  private sel: Selection;
  private goalX: number | null = null;
  /** 편집 중인 셀 (null이면 본문) */
  private cell: ActiveCell | null = null;
  /** 편집 중인 머리말·꼬리말 (null이면 아님) */
  private hf: ActiveHF | null = null;
  /** 편집 중인 각주 (null이면 아님) */
  private note: ActiveNote | null = null;
  /** 진하게 칠할 주석 */
  private focusAnn: string | null = null;
  /** 장식 소스 (15 §2): 찾기, 맞춤법, 앱·플러그인이 더한 것 */
  private readonly decoSources: DecorationSource[] = [];
  private readonly decoStyles = new Map<string, DecorationStyle>(Object.entries(DECORATION_STYLES));
  /** 플러그인 (15 §7): 붙인 것, 명령, 단축키, 이벤트 듣는 함수 */
  private readonly plugins: Array<{ plugin: QuirePlugin; ctx: PluginContext; dispose: Array<() => void> }> = [];
  private readonly commands = new Map<string, { plugin: string; fn: (...args: unknown[]) => boolean }>();
  private readonly keys = new Map<string, string>();
  private readonly listeners = new Map<PluginEvent, Set<() => void>>();
  /** 내장 플러그인: 찾기 (늘), 맞춤법 (검사기가 있을 때) */
  private findP!: FindPlugin;
  private spellP: SpellPlugin | null = null;
  /** 다음 붙여넣기는 글자만 (Ctrl+Shift+V) */
  private plainPaste = false;
  /** 다중 커서 (11 §5.2): 첫 캐럿(sel) 말고 다른 캐럿들. 같은 스토리, 겹치지 않음 */
  private extras: Array<{ anchor: Position; head: Position }> = [];
  /** 문서 → 레이아웃 서식 (DOM 없음, formatter.ts) */
  private readonly fmt: Formatter;
  /** 셀 범위 선택 (병합·여러 셀 지우기) */
  private cellSel: CellRange | null = null;
  /** 다음 relayout에서 모든 표를 다시 잰다 (원격 변경) */
  private tablesAllDirty = false;
  private readonly cellCache = new LayoutCache(20000);
  private preedit = '';
  private focused = false;

  private readonly scroller: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly spacer: HTMLDivElement;
  private readonly caretEl: HTMLDivElement;
  private readonly mirror: HTMLDivElement;
  private readonly input: InputBackend;
  private readonly font: string;
  /** 시스템 글꼴 가족 (CSS font-family) */
  private readonly family: string;
  private measurer: Measurer;
  /** 셰이핑 중이면 글꼴 번호별 FontFace 가족 이름 (엔진 글꼴). null이면 시스템 글꼴 측정 */
  private shapedFonts: string[] | null = null;
  /** 글꼴 번호별 굵은 얼굴의 가족 이름 (불러온 것만). 없으면 합성 굵게 */
  private boldFonts: Array<string | null> = [];
  /** 글꼴 자리마다 불러온 파일 (PDF에 넣는다): 보통·굵은 얼굴 */
  private fontFiles: Array<{ name: string; regular: Uint8Array | null; bold: Uint8Array | null }> = [];
  private metrics: FontMetrics = { ...DEFAULT_METRICS };
  private readonly assets: AssetStore;
  /** 자산 ID → 그릴 이미지 (불러오는 중 null) */
  private readonly images = new Map<string, ImageBitmap | null | 'error'>();
  /** 자산마다 마지막으로 그린 프레임 번호 (화면 밖 이미지를 풀어 메모리를 돌려준다, 11 §8) */
  private readonly imageUsed = new Map<string, number>();
  private frame = 0;
  /** 크기 조절 중인 개체: 오프셋과 미리 보기 크기 (px) */
  /** 크기 조절 중인 개체: 새 크기와 왼쪽 위의 이동 (끄는 손잡이 반대쪽 변이 제자리에 남게) */
  private resizing: { offset: number; w: number; h: number; dx: number; dy: number } | null = null;
  /** 옮기는 중인 떠 있는 개체: 오프셋과 끈 거리 (px) */
  private moving: { offset: number; dx: number; dy: number } | null = null;
  /** 캐럿에서 다음 입력이 받을 서식 (Ctrl+B 등을 선택 없이 눌렀을 때). at: 그 캐럿 오프셋 */
  private pending: { at: number; marks: MarkSet } | null = null;
  /** 상태 표시: 측정 방식 */
  textEngine = 'canvas';
  private readonly cache = new LayoutCache();
  private readonly setup: PageSetup;
  private readonly fontSize: number;
  private resizeObserver: ResizeObserver;
  private readonly blink: Animation | null;
  /** 캔버스에서 커닝을 끌 수 있는가 (줄 단위 그리기 가능 여부) */
  /** 쪽 그리기기 (15 §5.1)와 화면 대상 */
  private readonly target: CanvasTarget;
  /** 화면 색 (17): 호스트의 CSS 변수에서 읽은 계산된 값 */
  private colors: ThemeColors = defaultThemeColors();
  private themeName: ThemeName = 'classic';
  private scheme: ColorScheme = 'light';
  private pageViewMode: PageView = 'print';
  private marksShown = false;
  /** 색을 풀어 쓰는 숨긴 요소 */
  private themeProbe: HTMLElement | null = null;
  private readonly painter = new PagePainter(this.painterEnv());
  /** 편집기 덧그리기: 쪽 그리기기가 쪽 내용 사이사이에 부른다 */
  private readonly overlay: PaintOverlay = this.makeOverlay();
  private renderQueued = false;
  private bgTimer: ReturnType<typeof setTimeout> | null = null;
  private disposers: Array<() => void> = [];
  /** 마우스가 올라가 있는 문단 (손잡이를 그릴 문단), 없으면 -1 */
  private hoverPara = -1;
  private hoverGrip = false;
  /** 문단 끌기: 끄는 문단 i..j, 놓을 자리 to (그 문단 앞, -1이면 제자리), 마지막 포인터 위치 */
  private drag: { i: number; j: number; to: number; clientX: number; clientY: number } | null = null;
  private autoScroll = 0;
  private autoScrollRaf = 0;
  /** 다른 사용자의 캐럿·선택 */
  private remotes: RemoteCaret[] = [];
  /** 마지막으로 onSelectionChange로 알린 선택 (같은 객체면 바뀌지 않음) */
  private reportedSel: Selection | null = null;
  /** 화면 언어의 메시지 (18) */
  private readonly i18n: Messages;
  /** 메시지 키 → 지금 화면 언어의 문장 (18 §5). 앱·플러그인이 같은 번역을 쓸 때. 떼어 써도 된다 */
  readonly t = (key: MessageKey, params?: MessageParams): string => this.i18n.t(key, params);

  constructor(private readonly opts: EditorOptions) {
    this.i18n = new Messages(opts.locale, opts.messages);
    this.fontSize = opts.fontSize ?? 16;
    this.assets = opts.assets ?? new MemoryAssets();
    const family = opts.fontFamily ?? `'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`;
    this.font = `${this.fontSize}px ${family}`;
    this.family = family;
    const canvasMeasurer = new CanvasMeasurer(this.font);
    this.measurer = canvasMeasurer;
    const box = canvasMeasurer.metrics(this.fontSize);
    this.metrics = { ...this.metrics, ...box };
    this.setup = { ...defaultPageSetup(this.fontSize), ascent: box.ascent, descent: box.descent };

    this.document = opts.document ?? new Document(opts.doc ?? Doc.fromText(opts.text ?? ''));
    this.fmt = new Formatter(() => this.document, this.setup, this.fontSize);
    this.doc = this.document.body;
    const start = this.doc.positionAt(0);
    this.sel = { anchor: start, head: start };

    // ── DOM ──
    const host = opts.host;
    host.replaceChildren();
    const scroller = document.createElement('div');
    Object.assign(scroller.style, {
      position: 'relative', width: '100%', height: '100%', overflow: 'auto',
      background: this.colors.desk, cursor: 'text', outline: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    host.appendChild(scroller);
    this.scroller = scroller;

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { position: 'sticky', top: '0', left: '0', display: 'block' });
    canvas.setAttribute('aria-hidden', 'true');
    scroller.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.target = new CanvasTarget(this.ctx, (asset) => {
      const img = this.images.get(asset);
      return img && img !== 'error' ? img : null;
    });

    this.spacer = document.createElement('div');
    scroller.appendChild(this.spacer);

    const caret = document.createElement('div');
    caret.className = 'quire-caret';
    Object.assign(caret.style, {
      position: 'absolute', width: '2px', background: this.colors.text, pointerEvents: 'none', display: 'none',
    });
    scroller.appendChild(caret);
    this.caretEl = caret;
    // 깜박임: Web Animations API로 처리해 재시작할 때 강제 리플로가 생기지 않게 한다
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.blink = reduceMotion
      ? null
      : caret.animate(
          [
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.5 },
            { opacity: 0, offset: 0.5001 },
            { opacity: 0, offset: 1 },
          ],
          { duration: 1060, iterations: Infinity },
        );

    // 접근성 미러 (04 §3) — 0단계 최소 구현: 화면에 보이는 문단만
    const mirror = document.createElement('div');
    mirror.setAttribute('role', 'document');
    mirror.setAttribute('aria-label', this.t('a11y.document'));
    Object.assign(mirror.style, {
      position: 'absolute', width: '1px', height: '1px', overflow: 'hidden',
      clipPath: 'inset(50%)', whiteSpace: 'pre-wrap', left: '0', top: '0',
    });
    scroller.appendChild(mirror);
    this.mirror = mirror;

    const mode = opts.input ?? 'auto';
    const onIntent = (i: InputIntent) => this.handleIntent(i);
    this.input =
      mode !== 'textarea' && editContextSupported()
        ? new EditContextInput(scroller, onIntent, opts.onInputLog)
        : new TextareaInput(scroller, onIntent, opts.onInputLog);
    this.input.el.style.font = this.font;

    // ── 이벤트 ──
    this.listen(scroller, 'mousedown', (e) => this.onMouseDown(e as MouseEvent));
    this.listen(scroller, 'mousemove', (e) => this.onHover(e as MouseEvent));
    this.listen(scroller, 'mouseleave', () => this.setHover(-1, false));
    this.listen(scroller, 'scroll', () => this.scheduleRender());
    this.listen(scroller, 'contextmenu', (e) => this.onContextMenu(e as MouseEvent));
    this.findP = findPlugin({ onOpen: opts.onFindRequest });
    this.use(this.findP);
    for (const pl of opts.plugins ?? []) this.use(pl);
    if (opts.spellChecker) this.setSpellChecker(opts.spellChecker, opts.spellLang);
    // 이미지 끌어 놓기 (11 §5.3): 놓은 자리에 넣는다
    this.listen(scroller, 'dragover', (e) => {
      const d = (e as DragEvent).dataTransfer;
      if (d && [...d.items].some((it) => it.kind === 'file' && it.type.startsWith('image/'))) e.preventDefault();
    });
    this.listen(scroller, 'drop', (e) => {
      const ev = e as DragEvent;
      const files = [...(ev.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      ev.preventDefault();
      this.leaveCell();
      const p = this.docPoint(ev);
      const at = this.layout.hitTest(p.x, Math.min(p.y, this.layout.validBottom - 1));
      void (async () => {
        for (const [k, f] of files.entries()) await this.insertImage(f, undefined, k === 0 ? at : undefined);
      })();
    });
    this.listen(this.input.el, 'focus', () => { this.focused = true; this.scheduleRender(); });
    this.listen(this.input.el, 'blur', () => { this.focused = false; this.scheduleRender(); });
    this.resizeObserver = new ResizeObserver(() => this.refresh());
    this.resizeObserver.observe(scroller);

    // 화면 테마 (17): 기본 테마 스타일시트, 호스트 속성, 바뀜 감지
    ensureThemeStyles(host.ownerDocument);
    host.classList.add('quire');
    this.themeName = opts.theme ?? 'classic';
    this.scheme = opts.colorScheme ?? 'light';
    this.pageViewMode = opts.pageView ?? 'print';
    this.marksShown = !!opts.showMarks;
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    Object.assign(probe.style, { position: 'absolute', width: '0', height: '0', overflow: 'hidden', visibility: 'hidden' });
    host.appendChild(probe);
    this.themeProbe = probe;
    this.applyThemeAttrs();
    this.applyLocale();
    this.readTheme();
    const themeObserver = new MutationObserver(() => this.refreshTheme());
    const attrs = ['class', 'style', 'data-theme', 'data-quire-theme', 'data-quire-scheme'];
    themeObserver.observe(host, { attributes: true, attributeFilter: attrs });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: attrs });
    this.disposers.push(() => themeObserver.disconnect());
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (dark) {
      const onScheme = () => {
        if (this.scheme !== 'auto') return;
        this.applyThemeAttrs();
        this.refreshTheme();
      };
      dark.addEventListener('change', onScheme);
      this.disposers.push(() => dark.removeEventListener('change', onScheme));
    }

    this.resetLayouts();
    this.relayout();
    this.render();
    if (opts.fonts?.length) {
      this.loadFonts(opts.fonts).then(
        () => opts.onFontsReady?.(this),
        (e: unknown) => {
          this.textEngine = 'canvas (font loading failed)';
          opts.onFontsReady?.(this, e);
        },
      );
    }
  }

  /** 글꼴을 불러와 HarfBuzz 셰이핑으로 바꾼다 (셰이핑 모듈·WASM은 이때 불러온다) */
  private async loadFonts(sources: FontSource[]): Promise<void> {
    const shaping = await import('@quire/shaping');
    const fetchBytes = async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Failed to load font: ${url} (${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    };
    // 글꼴 자리: 파일 하나는 바로 불러온 자리, 조각 목록은 조각마다 아직 안 불러온 자리
    const slots: Array<import('@quire/shaping').FontSlot & { url?: string; bytes?: number }> = [];
    const ready: Array<{ i: number; data: Uint8Array }> = [];
    const readManifest = async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Failed to load font manifest: ${url} (${r.status})`);
      const m = (await r.json()) as import('@quire/shaping').FontManifest;
      return shaping.slotsFromManifest(m, new URL(url, location.href));
    };
    for (const src of sources) {
      if (src.manifest) {
        const regular = await readManifest(src.manifest);
        if (src.bold) shaping.attachBold(regular, await readManifest(src.bold.manifest));
        slots.push(...regular);
      } else {
        const data = src.data ? (src.data instanceof Uint8Array ? src.data : new Uint8Array(src.data)) : await fetchBytes(src.url!);
        ready.push({ i: slots.length, data });
        slots.push(shaping.slotOf(shaping.loadShapingFont(data, src.name)));
      }
    }
    const seq = editorSeq++;
    const families = slots.map((_, i) => `quire-font-${seq}-${i}`);
    const register = async (family: string, data: Uint8Array) => {
      document.fonts.add(await new FontFace(family, data.slice().buffer).load());
    };
    const boldFonts: Array<string | null> = slots.map(() => null);
    const files = slots.map((s) => ({ name: s.name, regular: null as Uint8Array | null, bold: null as Uint8Array | null }));
    for (const { i, data } of ready) files[i]!.regular = data;
    await Promise.all(ready.map(({ i, data }) => register(families[i]!, data)));

    let loadedBytes = 0;
    const describe = () => {
      const lazy = slots.filter((s) => s.url);
      const done = lazy.filter((s) => s.font).length;
      this.textEngine = `HarfBuzz (${sources.map((s) => s.name).join(', ')}${lazy.length ? ` · chunks ${done}/${lazy.length}, ${(loadedBytes / 1e6).toFixed(2)} MB` : ''})`;
    };
    /** 조각 i(face 1이면 그 굵은 얼굴)를 받아 셰이퍼와 캔버스에 등록 */
    const loadChunk = async (key: number) => {
      const i = key % 256;
      const face = key >= 256 ? 1 : 0;
      const slot = face === 1 ? (slots[i]!.bold as (typeof slots)[number] | null | undefined) : slots[i]!;
      if (!slot || slot.font || !slot.url) return;
      const data = await fetchBytes(slot.url);
      const family = face === 1 ? `${families[i]!}-b` : families[i]!;
      await register(family, data);
      loadedBytes += data.length;
      shaper.loaded(i, shaping.loadShapingFont(data, slot.name), face);
      if (face === 1) boldFonts[i] = family;
      if (face === 1) files[i]!.bold = data;
      else files[i]!.regular = data;
    };
    // 편집 중 새 글자가 아직 안 받은 조각에 있으면: 모아서 받고 한 번에 다시 조판 (키 = 얼굴 × 256 + 자리)
    const queue = new Set<number>();
    let flushing = false;
    const flush = async () => {
      if (flushing) return;
      flushing = true;
      while (queue.size > 0) {
        const batch = [...queue];
        queue.clear();
        await Promise.all(batch.map((i) => loadChunk(i).catch((e: unknown) => console.warn(e))));
      }
      flushing = false;
      describe();
      this.relayoutAll();
    };
    const shaper = new shaping.HbShaper(slots, {
      size: this.fontSize,
      fallback: this.measurer,
      onMissing: (i, face) => {
        if (!switched) return; // 처음 조판 전 미리 받기는 아래에서
        queue.add(face * 256 + i);
        if (!flushing) setTimeout(() => void flush(), 0);
      },
    });
    let switched = false;
    // 처음: 문서에 나온 글자가 든 조각을 미리 받는다 (다시 조판을 한 번만)
    if (slots.some((s) => s.url)) {
      const need = new Set<number>();
      const seen = new Set<number>();
      for (const ch of this.doc.text()) {
        const cp = ch.codePointAt(0)!;
        if (seen.has(cp)) continue;
        seen.add(cp);
        const i = slots.findIndex((s) => s.covers(cp));
        if (i >= 0 && !slots[i]!.font) need.add(i);
      }
      // 굵은 글자가 든 굵은 얼굴 조각도
      const seenBold = new Set<number>();
      for (const p of this.doc.paragraphs()) {
        if (!p.fmt) continue;
        let k = 0;
        for (const ch of p.text) {
          if (this.doc.markSet(p.fmt[k++]!).bold) {
            const cp = ch.codePointAt(0)!;
            if (seenBold.has(cp)) continue;
            seenBold.add(cp);
            const i = slots.findIndex((s) => s.covers(cp));
            if (i >= 0 && slots[i]!.bold && !slots[i]!.bold!.font) need.add(256 + i);
          }
        }
      }
      // 공백 폭을 정하는 조각도
      const sp = slots.findIndex((s) => s.covers(0x20));
      if (sp >= 0 && !slots[sp]!.font) need.add(sp);
      await Promise.all([...need].map(loadChunk));
    }
    switched = true;
    this.measurer = shaper;
    this.shapedFonts = families;
    this.boldFonts = boldFonts;
    this.fontFiles = files;
    // 기준선·밑줄은 기본 글꼴(공백을 가진 자리)의 치수로
    const base = slots.find((s) => s.covers(0x20) && s.font)?.font ?? slots.find((s) => s.font)?.font;
    if (base) {
      this.metrics = { ...base.metrics };
      this.setup.ascent = base.metrics.ascent;
      this.setup.descent = base.metrics.descent;
    }
    describe();
    this.relayoutAll();
  }

  /** 측정이 바뀌었다 (글꼴을 받음): 모든 문단을 다시 조판한다 */
  private relayoutAll(): void {
    this.resetLayouts();
    this.refresh();
    this.opts.onChange?.(this);
  }

  // ── 공개 API ──────────────────────────────────────────

  /** 선택한 글 (편집 중인 스토리, 개체 글자는 U+FFFC) */
  selectedText(): string {
    const [a, b] = this.range();
    return this.doc.slice(a, b);
  }

  focus(): void {
    this.input.focus();
  }

  /**
   * 본문 레이아웃의 지문 (기준 문서 골든 비교, 16 §5): 쪽 수·쪽마다 첫 줄·줄 위치 해시. Node 시험과 같은 함수.
   * 백그라운드 쪽 조립이 끝나기 전이면 null
   */
  layoutSummary(today?: string): LayoutSummary | null {
    if (!this.bodyLayout.complete) return null;
    return summarizeLayout(this.document, this.bodyLayout, this.fmt, today);
  }

  /**
   * 지금 스토리의 [from, to)를 글로 바꾼다 (지우기만 하려면 ''). 실행 취소 한 단계이고, 제안 모드면 제안으로 남는다.
   * 앱 명령용 (슬래시 메뉴가 "/찾을 말"을 지우고 명령을 실행하는 것 등)
   */
  replaceRange(from: number, to: number, text = ''): void {
    this.input.commitComposition();
    const n = this.doc.length;
    const a = Math.max(0, Math.min(from, to, n));
    const b = Math.max(0, Math.min(Math.max(from, to), n));
    this.setSelection(a, b);
    this.history.seal();
    this.replaceSelection(text);
    this.history.seal();
  }

  /** 캐럿 자리에 글을 넣는다 (선택이 있으면 바꾼다) */
  insertText(text: string): void {
    const [a, b] = this.range();
    this.replaceRange(a, b, text);
  }

  // ── 화면 테마 (17) ───────────────────────────────────

  /** 테마를 바꾼다 (문서·레이아웃은 그대로, 다시 그리기만) */
  setTheme(theme: ThemeName, colorScheme?: ColorScheme): void {
    this.themeName = theme;
    if (colorScheme) this.scheme = colorScheme;
    this.applyThemeAttrs();
    this.refreshTheme();
    this.opts.onChange?.(this);
  }

  setColorScheme(colorScheme: ColorScheme): void {
    this.setTheme(this.themeName, colorScheme);
  }

  /** 쪽 보기: print(쪽마다 종이), continuous(쪽 경계 없이). 레이아웃은 같다 */
  setPageView(view: PageView): void {
    if (view === this.pageViewMode) return;
    this.pageViewMode = view;
    this.applyThemeAttrs();
    this.paintBackground();
    this.render();
    this.opts.onChange?.(this);
  }

  // ── 화면 언어 (18) ───────────────────────────────────

  /** 지금 화면 언어 (BCP 47) */
  get locale(): string {
    return this.i18n.locale;
  }

  /** 화면 언어를 바꾼다: 캔버스 표시·접근성 이름을 다시 그린다. 문서·레이아웃은 그대로 (18 §2) */
  setLocale(locale: string): void {
    if (!this.i18n.setLocale(locale)) return;
    this.applyLocale();
    delete this.mirror.dataset.key;
    this.render();
    this.opts.onChange?.(this);
  }

  /** 호스트의 lang (스크린 리더 발음, CSS :lang()), 입력 층·미러의 접근성 이름 */
  private applyLocale(): void {
    this.opts.host.lang = this.i18n.locale;
    this.input.setLabel(this.t('a11y.input'));
    this.mirror.setAttribute('aria-label', this.t('a11y.document'));
  }

  /** 편집 기호(¶, 쪽·단·구역 나눔)를 보이는가 */
  get showMarks(): boolean {
    return this.marksShown;
  }

  /** 편집 기호 표시를 켜고 끈다 (다시 그리기만: 레이아웃·문서는 그대로) */
  setShowMarks(show: boolean): void {
    if (show === this.marksShown) return;
    this.marksShown = show;
    this.render();
    this.opts.onChange?.(this);
  }

  /** 지금 테마·색 모드(auto면 auto)·쪽 보기 */
  get appearance(): { theme: ThemeName; colorScheme: ColorScheme; pageView: PageView } {
    return { theme: this.themeName, colorScheme: this.scheme, pageView: this.pageViewMode };
  }

  /** CSS 변수를 다시 읽는다 (앱이 스타일시트를 바꾼 뒤). 값이 같으면 다시 그리지 않는다 */
  refreshTheme(): void {
    if (this.readTheme()) this.render();
  }

  /** 변수를 읽어 색을 바꿨으면 true */
  private readTheme(): boolean {
    if (!this.themeProbe) return false;
    const next = readThemeColors(this.opts.host, this.themeProbe);
    if (sameColors(this.colors, next)) return false;
    this.colors = next;
    this.paintBackground();
    this.caretEl.style.background = next.caret;
    return true;
  }

  /** 스크롤 영역 바탕 (캔버스 밖으로 보이는 부분) */
  private paintBackground(): void {
    this.scroller.style.background = this.pageViewMode === 'continuous' ? this.colors.page : this.colors.desk;
  }

  private applyThemeAttrs(): void {
    const h = this.opts.host;
    const dark = this.scheme === 'dark' || (this.scheme === 'auto' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    h.dataset.quireTheme = this.themeName;
    h.dataset.quireScheme = dark ? 'dark' : 'light';
    h.dataset.quirePageView = this.pageViewMode;
  }

  /** 쓰고 있는 입력 층 */
  get inputKind(): InputBackend['kind'] {
    return this.input.kind;
  }

  /** 본문·셀 레이아웃을 새로 만든다 (측정이나 문서가 바뀜). 편집 중인 셀은 다음 relayout에서 다시 붙는다 */
  private resetLayouts(): void {
    this.cache.clear();
    this.cellCache.clear();
    // 서식기를 먼저: 쪽 조판기는 만들 때 첫 프레임(구역의 머리말·꼬리말 높이)을 재므로 서식기에 측정기가 있어야 한다
    this.fmt.reset(this.measurer, this.cellCache);
    this.bodyLayout = new PagedLayout(this.setup, this.measurer, this.cache, this.fmt.formatOf, new SectionFrames(this.setup, this.fmt.sections));
    this.layout = this.bodyLayout;
  }

  setText(text: string): void {
    this.document = new Document(Doc.fromText(text));
    this.doc = this.document.body;
    this.cell = null;
    this.hf = null;
    this.note = null;
    this.cellSel = null;
    this.extras = [];
    this.resetLayouts();
    this.stats.backgroundMs = 0;
    this.scroller.scrollTop = 0;
    const start = this.doc.positionAt(0);
    this.sel = { anchor: start, head: start };
    this.history = new History();
    this.refresh();
    this.scroller.scrollTop = 0;
  }

  /**
   * 문서 모델을 통째로 바꾼다 (동기화 문서가 새 판으로 바뀐 경우 등). 캐럿은 같은 화면 오프셋에 두고, 실행 취소 기록은 비운다
   * (옛 문서의 원소 ID를 가리키므로).
   */
  setDoc(doc: Doc): void {
    this.setDocument(doc === this.document.body ? this.document : new Document(doc));
  }

  /** 여러 스토리 문서를 통째로 바꾼다 (setDoc과 같다. 편집 중인 셀에서는 나온다) */
  setDocument(document: Document): void {
    const { anchor, head } = this.inBody ? this.selection() : { anchor: 0, head: 0 };
    this.cell = null;
    this.hf = null;
    this.note = null;
    this.cellSel = null;
    this.extras = []; // 다른 캐럿은 옛 문서의 원소를 가리킨다
    this.document = document;
    this.doc = document.body;
    this.pending = null;
    this.resetLayouts();
    this.history = new History();
    this.setSelection(anchor, head);
    this.refresh();
  }

  /** 본문 */
  get body(): Doc {
    return this.document.body;
  }

  /** 편집 중인 스토리 ID (본문이면 null) */
  private get storyId(): string | null {
    return this.cell?.story ?? this.hf?.story ?? this.note?.story ?? null;
  }

  /** 본문을 편집 중인가 (셀·머리말이 아님) */
  private get inBody(): boolean {
    return !this.cell && !this.hf && !this.note;
  }

  /** 날짜 필드 값 */
  private get today(): string {
    return dateText();
  }

  /**
   * 바깥에서 문서 모델이 바뀌었을 때(원격 편집 적용 등) 호출한다. 선택 영역은 원소 ID 기준이라 그대로 유지된다.
   * 실행 취소 기록에는 들어가지 않는다.
   */
  docChanged(): void {
    // 최종본·원본을 보는 중: 살아 있는 문서가 바뀌었으면 파생 문서를 다시 만든다 (잠시 모아서)
    if (this.live && (this.mode === 'final' || this.mode === 'original') && this.viewTimer === null) {
      this.viewTimer = setTimeout(() => {
        this.viewTimer = null;
        if (this.live) this.showDerived();
      }, 300);
    }
    this.tablesAllDirty = true;
    this.relayout();
    this.render();
    this.opts.onChange?.(this);
  }

  /** 다른 사용자의 캐럿·선택을 바꾼다 (프레즌스 갱신·원격 편집 뒤에 호출) */
  setRemoteCarets(list: RemoteCaret[]): void {
    this.remotes = list;
    if (this.following) {
      if (list.some((r) => r.key === this.following)) this.revealRemote(this.following);
      else this.following = null;
    }
    this.scheduleRender();
  }

  getText(): string {
    return this.body.text().slice(0, -1);
  }

  selection(): { anchor: number; head: number } {
    return { anchor: this.doc.resolve(this.sel.anchor), head: this.doc.resolve(this.sel.head) };
  }

  /** 선택 영역을 바꾼다 (화면 오프셋). 조합 중이면 먼저 확정한다 */
  select(anchor: number, head: number = anchor): void {
    this.input.commitComposition();
    this.setSelection(anchor, head);
    this.render();
    this.opts.onChange?.(this);
  }

  destroy(): void {
    if (this.bgTimer !== null) clearTimeout(this.bgTimer);
    for (const p of [...this.plugins].reverse()) this.unuse(p.plugin.name);
    this.spellP = null;
    this.resizeObserver.disconnect();
    for (const d of this.disposers) d();
    this.input.destroy();
    this.scroller.remove();
  }

  // ── 레이아웃·렌더링 ───────────────────────────────────

  private refresh(): void {
    this.relayout();
    this.render();
  }

  private relayout(): void {
    const t0 = performance.now();
    const body = this.body;
    const pre = this.preedit ? { offset: this.headOffset(), text: this.preedit, fmt: this.pendingFmt() } : null;
    this.fmt.cellPreedit = this.cell && pre ? { story: this.cell.story, preedit: pre } : null;
    // 바뀐 표 (레코드, 편집 중인 셀, 원격 변경)의 표 문단을 다시 조판하게 한다
    this.touchTables();
    // 머리말·꼬리말 높이가 바뀌어 쪽 모양이 바뀐 구역은 그 첫 문단부터 다시 놓는다 (12 §5.2). 높이가 그대로면 본문은 그대로
    const sec = this.fmt.syncSections();
    if (sec >= 0) body.touchParagraph(sec === 0 ? 0 : body.sectionBreaks()[sec - 1]! + 1);
    // 각주 높이·번호 자릿수가 바뀐 참조 문단을 다시 조판한다 (12 §6.2)
    for (const i of this.fmt.syncNotes()) body.touchParagraph(i);
    // 화면 아래 한 화면 분량까지만 즉시 배치하고 나머지는 백그라운드로
    const syncUntil = this.scroller.scrollTop + this.scroller.clientHeight * 2;
    this.bodyLayout.update(body.paragraphs(), this.inBody ? pre : null, syncUntil, body.takeParagraphChanges());
    if (this.cell) this.attachActive();
    else if (this.hf) this.attachHF(pre);
    else if (this.note) this.attachNote(pre);
    this.stats.layoutMs = performance.now() - t0;
    this.stats.reflowed = this.bodyLayout.counts.reflowed;
    this.stats.repositioned = this.bodyLayout.counts.repositioned;
    this.stats.reused = this.bodyLayout.counts.reused;
    this.updateDerived();
    this.scheduleBackground();
  }

  /** 쪽 수, 스크롤 높이 등 레이아웃에서 파생되는 값 */
  private updateDerived(): void {
    const s = this.stats;
    const body = this.body;
    const layout = this.bodyLayout;
    const paras = body.paragraphs();
    s.pages = layout.pageCount;
    s.paragraphs = paras.length;
    s.characters = body.length - paras.length;
    s.cacheHits = this.cache.hits;
    s.cacheMisses = this.cache.misses;
    s.pendingParas = paras.length - layout.validCount;
    if (layout.complete) {
      let lines = 0;
      for (const p of layout.paras) lines += p!.lines.length;
      s.lines = lines;
    }
    const viewH = this.scroller.clientHeight;
    this.spacer.style.height = `${Math.max(0, layout.totalHeight - viewH)}px`;
    this.spacer.style.width = `${this.fmt.maxPageWidth() + this.setup.gap * 2}px`;
  }

  /** 남은 쪽 조립을 짧은 조각으로 나눠 유휴 시간에 진행 (02 §7) */
  private scheduleBackground(): void {
    if (this.bgTimer !== null || this.bodyLayout.complete) return;
    this.bgTimer = setTimeout(() => {
      this.bgTimer = null;
      const t0 = performance.now();
      const more = this.bodyLayout.step(8);
      this.stats.backgroundMs += performance.now() - t0;
      this.updateDerived();
      if (more) this.scheduleBackground();
      this.opts.onChange?.(this);
    }, 0);
  }

  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private pageLeft(): number {
    // 쪽들은 기본 용지 폭의 가운데 축에 맞춘다 (구역마다 폭이 다르면 넓은 쪽이 왼쪽으로 나온다)
    const over = (this.fmt.maxPageWidth() - this.setup.width) / 2;
    return Math.max(this.setup.gap + over, (this.scroller.clientWidth - this.setup.width) / 2);
  }

  private render(): void {
    const t0 = performance.now();
    this.emit('beforeRender');
    const { scroller, canvas, ctx } = this;
    const layout = this.bodyLayout;
    const dpr = window.devicePixelRatio || 1;
    const w = scroller.clientWidth;
    const h = scroller.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const top = scroller.scrollTop;
    const left = scroller.scrollLeft;
    const px = this.pageLeft() - left;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = this.colors;
    // 연속 보기 (17 §3.2): 책상도 종이 색, 쪽 그림자·테두리 없이 (레이아웃은 그대로, 그리기만)
    const continuous = this.pageViewMode === 'continuous';
    ctx.fillStyle = continuous ? C.page : C.desk;
    ctx.fillRect(0, 0, w, h);

    // 쪽
    // 쪽 상자는 레이아웃이 낸다 (12 §2: 구역마다 쪽 크기가 다를 수 있다)
    if (!continuous)
      for (let p = layout.pageAt(top); p < layout.pageCount; p++) {
        const pb = layout.pageBox(p);
        const y = pb.top - top;
        if (y > h) break;
        if (C.pageShadow) {
          ctx.shadowColor = C.pageShadow.color;
          ctx.shadowBlur = C.pageShadow.blur;
          ctx.shadowOffsetY = C.pageShadow.offsetY;
        }
        ctx.fillStyle = C.page;
        ctx.fillRect(px + pb.x, y, pb.width, pb.height);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        if (C.pageBorder) {
          ctx.strokeStyle = C.pageBorder;
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(px + pb.x) + 0.5, Math.round(y) + 0.5, Math.round(pb.width) - 1, Math.round(pb.height) - 1);
        }
      }

    // 쪽 내용 (15 §5.1): 단 구분선, 머리말·꼬리말, 떠 있는 개체, 줄, 각주. 편집기 것은 덧그리기 갈고리로
    const visibleParas = new Set<number>();
    this.target.begin();
    const ready = this.painter.paint(this.target, { px, top, h, overlay: this.overlay, budgetMs: RENDER_LAYOUT_BUDGET_MS, visible: visibleParas });
    ctx.textBaseline = 'middle';
    this.drawParagraphDrag(px, top);
    this.drawExtraCarets(px, top, h);
    this.drawRemoteCarets(px, top, w, visibleParas);

    if (!ready) {
      this.drawPendingPlaceholder(px, top, w, h);
      this.scheduleRender();
    }

    this.releaseImages();
    this.updateCaret();
    this.updateMirror(visibleParas);
    this.emit('afterRender');
    this.reportSelection();
    this.stats.renderMs = performance.now() - t0;
  }

  /**
   * PDF로 내보낼 것 (15 §5.2, @quire/pdf의 exportPdf): 그리기 환경(이미지는 자산을 따로 받는다), 글꼴 자리별 파일, 자산 바이트.
   * 엔진 글꼴(셰이핑)을 불러오지 않았으면 글꼴이 없다 (글자를 그리지 못한다)
   */
  printSource(): {
    env: PainterEnv;
    fonts: { count: number; face(slot: number, bold: boolean): { bytes: Uint8Array; name: string } | null };
    asset(id: string): Promise<Uint8Array | null>;
    title: string;
  } {
    const files = this.shapedFonts ? this.fontFiles : [];
    return {
      env: this.painterEnv(false),
      fonts: {
        count: files.length,
        face: (slot, bold) => {
          const f = files[slot];
          const bytes = f ? (bold ? f.bold : f.regular) : null;
          return f && bytes ? { bytes, name: bold ? `${f.name} Bold` : f.name } : null;
        },
      },
      asset: async (id) => {
        const blob = await this.assets.get(id);
        return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
      },
      // 문서 제목은 본문 첫 문단 (캐럿이 셀·머리말에 있어도)
      title: this.document.body.paragraphs()[0]?.text.replaceAll(OBJ, '').trim() ?? '',
    };
  }

  /** 자산을 넣는다 (가져온 문서의 이미지, 15 §6). 자산 ID를 돌려준다 */
  putAsset(blob: Blob): Promise<string> {
    return this.assets.put(blob);
  }

  /**
   * 쪽 그리기기가 읽는 것들 (게터: 글꼴을 불러오면 셰이핑 글꼴이 바뀐다). screen이면 화면 테마 색(17)을 싣고,
   * 인쇄·PDF(printSource)는 싣지 않아 늘 문서 그대로의 기본 색으로 그린다 — 어두운 화면의 밝은 글자색이 흰 종이에 가지 않게
   */
  private painterEnv(screen = true): PainterEnv {
    const self = this;
    const env: PainterEnv = {
      get fmt() {
        return self.fmt;
      },
      get document() {
        return self.document;
      },
      get t() {
        return self.t;
      },
      get colors() {
        if (!screen) return undefined;
        const c = self.colors;
        return { text: c.text, columnRule: c.mark, tableBorder: c.tableBorder, field: c.field, placeholder: c.placeholder, placeholderBorder: c.mark, placeholderText: c.placeholderText };
      },
      get layout() {
        return self.bodyLayout;
      },
      get setup() {
        return self.setup;
      },
      get fontSize() {
        return self.fontSize;
      },
      get family() {
        return self.family;
      },
      get metrics() {
        return self.metrics;
      },
      get shapedFonts() {
        return self.shapedFonts;
      },
      get boldFonts() {
        return self.boldFonts;
      },
      get today() {
        return self.today;
      },
      images: {
        state: (asset) => {
          const img = this.image(asset);
          return img === 'error' ? 'error' : img ? 'ready' : 'loading';
        },
      },
    };
    return env;
  }

  /** 편집기 덧그리기 (15 §5.1): 선택, 주석·제안·장식, 조합 밑줄, 나눔 표시, 편집 중 표시, 개체 손잡이, 셀 범위 선택 */
  private makeOverlay(): PaintOverlay {
    const self = this;
    return {
      get bodyAlpha() {
        // 머리말·꼬리말을 편집 중이면 본문을 흐리게 (12 §5.4)
        return self.hf ? 0.4 : 1;
      },
      get hfAlpha() {
        return self.hf ? 1 : 0.55;
      },
      get fieldShading() {
        return !!self.hf;
      },
      story: (layout, doc) => this.storyOverlay(layout, doc),
      hf: (p, part, info, px, top) => this.hfOverlay(p, part, info, px, top),
      note: (p, s) => (this.note !== null && this.note.id === s.id && this.note.page === p ? this.layout : null),
      objectBox: (offset, float, w, h) => {
        const r = this.resizing && this.resizing.offset === offset ? this.resizing : null;
        const m = float && this.moving && this.moving.offset === offset ? this.moving : null;
        if (!r && !m) return null;
        return { w: r ? r.w : w, h: r ? r.h : h, dx: (m ? m.dx : 0) + (r ? r.dx : 0), dy: (m ? m.dy : 0) + (r ? r.dy : 0) };
      },
      object: (o) => this.objectOverlay(o),
      cell: (v, start, x, y, cx, cy, cw, ch) => {
        // 본문 선택이 표 원소를 덮으면 표 전체를 선택 색으로
        let bodySel = false;
        if (this.inBody) {
          const [a, b] = this.range();
          bodySel = a <= start && b > start;
        }
        const box = this.cellSelBox(v);
        if (bodySel || (box && y >= box.y0 && y <= box.y1 && x >= box.x0 && x <= box.x1)) {
          this.ctx.fillStyle = this.focused ? this.colors.selection : this.colors.selectionInactive;
          this.ctx.fillRect(cx, cy, cw, ch);
        }
      },
    };
  }

  /** 한 스토리의 줄 덧그리기: 끄는 문단, 주석 범위, 장식, 선택 영역, 원격 선택 / 제안 표시, 장식 물결, 조합 밑줄, 나눔 표시 */
  private storyOverlay(layout: PagedLayout, doc: Doc): StoryOverlay {
    const { ctx } = this;
    const isBody = doc === this.body;
    const active = layout === this.layout;
    // 선택 범위들 (다중 커서면 여럿)
    const ranges = active ? this.caretList().filter((c) => c.anchor !== c.head).map((c) => [Math.min(c.anchor, c.head), Math.max(c.anchor, c.head)] as const) : [];
    // 주석 범위 (14 §2.4): 이 스토리의 주석. 해결한 댓글 스레드의 범위는 칠하지 않는다 (14 §3.2)
    const storyId = this.document.storyIdOf(doc);
    const anns = storyId === undefined ? [] : this.document.annotationRanges().filter((a) => (a.story ?? null) === storyId && !a.orphan && a.to > a.from && !this.hiddenAnn(a));
    const sugg = anns.filter((a) => a.type === 'suggestion');
    // 장식 (15 §2): 문단마다 한 번 구한다
    const decoCache = new Map<number, readonly Decoration[]>();
    const decosOf = (l: LinePaint): readonly Decoration[] => {
      let d = decoCache.get(l.index);
      if (!d) decoCache.set(l.index, (d = storyId === undefined ? [] : this.decorationsFor(storyId, l.para.info)));
      return d;
    };
    return {
      back: (l) => {
        // 끌고 있는 문단
        if (isBody && this.drag && l.index >= this.drag.i && l.index <= this.drag.j) {
          ctx.fillStyle = this.colors.dragSource;
          ctx.fillRect(l.px + l.para.frameLeft - 6, l.y, l.para.width + 12, l.ln.height);
        }
      },
      under: (l) => {
        const { para, ln, X, y } = l;
        const pStart = para.info.start;
        // 주석 범위 칠 (겹치면 진해진다)
        if (anns.length) this.drawAnnotations(anns, para, ln, X, y);
        const decos = decosOf(l);
        if (decos.length) this.paintDecorations(decos, para, ln, X, y, false);
        // 선택 영역
        for (const [selFrom, selTo] of ranges) {
          const lineDocStart = pStart + ln.start;
          const isLast = ln.index === para.lines.length - 1;
          const lineDocEnd = pStart + ln.end + (isLast ? 1 : 0); // 마지막 줄은 ¶ 포함
          const a = Math.max(selFrom, lineDocStart);
          const b = Math.min(selTo, lineDocEnd);
          if (a < b) {
            const da = a - pStart;
            const db = Math.min(b - pStart, ln.end);
            const sx = X(da);
            let ex = X(db);
            if (isLast && b > pStart + ln.end) ex += this.fontSize * 0.5; // ¶ 표시 폭
            ctx.fillStyle = this.focused ? this.colors.selection : this.colors.selectionInactive;
            ctx.fillRect(sx, y, Math.max(1, ex - sx), ln.height);
          }
        }
        // 다른 사용자의 선택 영역
        for (const rc of isBody ? this.remotes : []) {
          if (rc.anchor === rc.head) continue;
          const pEnd = doc.paragraphs()[l.index]!.end; // 이 문단 ¶의 오프셋
          const a = Math.max(Math.min(rc.anchor, rc.head), pStart);
          const b = Math.min(Math.max(rc.anchor, rc.head), pEnd + 1);
          if (a >= b) continue;
          const withMark = b > pEnd && ln.index === para.lines.length - 1; // 이 줄에 ¶까지 포함
          const sd = Math.max(docToDisplay(para, a), ln.start);
          const ed = b > pEnd ? ln.end : Math.min(docToDisplay(para, b), ln.end);
          if (sd > ed || (sd === ed && !withMark)) continue;
          const sx = X(sd);
          const ex = X(ed) + (withMark ? this.fontSize * 0.5 : 0);
          ctx.fillStyle = withAlpha(rc.color, 0.22);
          ctx.fillRect(sx, y, Math.max(1, ex - sx), ln.height);
        }
      },
      over: (l) => {
        const { para, ln, X, y } = l;
        // 제안 밑줄·취소선 (글자 위)
        if (sugg.length) this.drawSuggestionLines(sugg, para, ln, X, y, l.px + para.frameLeft);
        const decos = decosOf(l);
        if (decos.length) this.paintDecorations(decos, para, ln, X, y, true);
        // 조합 중 밑줄
        const { preedit } = para.layout;
        if (preedit) {
          const a = Math.max(preedit[0], ln.start);
          const b = Math.min(preedit[1], ln.end);
          if (a < b) {
            ctx.fillStyle = this.colors.preedit;
            ctx.fillRect(X(a), y + ln.height - 5, X(b) - X(a), 1.5);
          }
        }
        // 편집 기호 (12 §3.1): 문단 끝 ¶, 문단 뒤의 쪽·단·구역 나눔. 글 위에 반투명하게 덧그릴 뿐 자리를 차지하지 않는다
        if (isBody && ln.index === para.lines.length - 1) {
          if (this.marksShown) this.drawPilcrow(X(ln.end), y, ln.height);
          const brk = this.breakAfter(l.index);
          if (brk && this.breakVisible(l.index)) {
            const x0 = l.px + para.frameLeft;
            this.drawBreakMark(brk, x0, x0 + para.width, y + ln.height + 2);
          }
        }
      },
    };
  }

  /** 머리말·꼬리말을 편집 중인 쪽: 경계 점선과 이름. 편집 중인 것은 편집 레이아웃(this.layout)으로 그려 선택 영역이 보인다 */
  private hfOverlay(p: number, part: 'header' | 'footer', info: PageHF, px: number, top: number): PagedLayout | null {
    const editing = this.hf !== null && this.hf.page === p && this.hf.part === part;
    if (!editing) return null;
    const { ctx } = this;
    const y = (part === 'header' ? info.bodyTop : info.bodyBottom) - top;
    const kind = info.kind === 'first' ? 'First' : info.kind === 'even' ? 'Even' : '';
    const name = this.t(`hf.${part}${kind}` as MessageKey);
    const label = this.headerFooterInfo()?.linked ? this.t('hf.linked', { label: name }) : name;
    ctx.save();
    ctx.strokeStyle = this.colors.gripActive;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px + info.box.x, y + 0.5);
    ctx.lineTo(px + info.box.x + info.box.width, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `${Math.min(12, this.fontSize)}px ${this.family}`;
    const w = ctx.measureText(label).width + 10;
    const ly = part === 'header' ? y : y - 18;
    ctx.fillStyle = this.colors.gripActive;
    ctx.fillRect(px + info.box.x, ly, w, 18);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px + info.box.x + 5, ly + 9);
    ctx.restore();
    return this.layout;
  }

  /** 선택한 개체: 테두리와 손잡이. 떠 있는 개체는 앵커 표시도 (개체가 붙은 문단의 첫 줄 왼쪽) */
  private objectOverlay(o: ObjectPaint): void {
    const active = o.float ? this.inBody : o.layout === this.layout;
    const [from, to] = active ? this.range() : [0, 0];
    if (to - from !== 1 || from !== o.offset) return;
    const { ctx } = this;
    const { x, y, w, h } = o;
    ctx.strokeStyle = this.colors.gripActive;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ffffff';
    for (const [hx, hy] of handlePoints(x, y, w, h)) {
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
      ctx.strokeRect(hx - 4 + 0.5, hy - 4 + 0.5, 7, 7);
    }
    const ln = o.float ? o.para.lines[0] : undefined;
    if (ln) {
      ctx.save();
      ctx.fillStyle = this.colors.gripActive;
      ctx.font = `12px ${this.family}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('⚓', o.px + o.para.frameLeft - 18, ln.baseline - o.top);
      ctx.restore();
    }
  }

  /** 쪽 p의 각주 영역에 놓인 각주들 (문서 좌표) */
  private noteSlots(p: number): NoteSlot[] {
    return noteSlotsOf(this.fmt, this.bodyLayout, this.setup, p);
  }

  /** 각주 조각의 레이아웃 */
  private noteLayout(s: NoteSlot, pre: { offset: number; text: string; fmt?: number } | null = null): PagedLayout {
    return noteLayoutOf(this.fmt, this.document, s, pre);
  }

  /** 줄에 걸친 주석 범위를 칠한다 (14 §2.4) */
  private drawAnnotations(anns: readonly AnnotationRange[], para: PlacedPara, ln: PlacedLine, X: (d: number) => number, y: number): void {
    const { ctx } = this;
    const isLast = ln.index === para.lines.length - 1;
    const lineFrom = displayToDoc(para, ln.start);
    const lineEnd = displayToDoc(para, ln.end);
    const lineTo = lineEnd + (isLast ? 1 : 0);
    // 시작 오프셋 순이므로 줄 끝을 넘으면 그만 본다
    for (const a of anns) {
      if (a.from >= lineTo) break;
      if (a.to <= lineFrom) continue;
      const sd = Math.max(ln.start, docToDisplay(para, Math.max(a.from, lineFrom)));
      const ed = Math.min(ln.end, docToDisplay(para, Math.min(a.to, lineEnd)));
      const sx = X(sd);
      // 마지막 줄의 ¶까지 덮으면 ¶ 표시 폭만큼
      const ex = X(ed) + (isLast && a.to > lineEnd ? this.fontSize * 0.5 : 0);
      if (ex <= sx) continue;
      if (a.type === 'suggestion') {
        // 제안: 삽입은 작성자 색 옅은 바탕 (밑줄·취소선은 글자 뒤에 drawSuggestionLines)
        if (a.data.kind !== 'insert' && a.id !== this.focusAnn) continue;
        ctx.fillStyle = a.id === this.focusAnn ? COLORS.annFocus : withAlpha(suggestionColor(a), 0.1);
      } else ctx.fillStyle = a.id === this.focusAnn ? COLORS.annFocus : a.type === 'comment' ? COLORS.annComment : COLORS.annOther;
      ctx.fillRect(sx, y, ex - sx, ln.height);
    }
  }

  /**
   * 줄에 걸친 장식을 그린다 (15 §2). over = false: 바탕(글자 아래), true: 물결·밑줄(글자 위).
   * 장식은 시작 순이므로 줄 끝을 넘으면 그만 본다
   */
  private paintDecorations(decos: readonly Decoration[], para: PlacedPara, ln: PlacedLine, X: (d: number) => number, y: number, over: boolean): void {
    const { ctx } = this;
    const lineFrom = displayToDoc(para, ln.start);
    const lineEnd = displayToDoc(para, ln.end);
    for (const m of decos) {
      if (m.from >= lineEnd) break;
      if (m.to <= lineFrom) continue;
      const st = this.decoStyles.get(m.kind);
      if (!st || (over ? !st.wave && !st.underline : !st.fill)) continue;
      const sd = Math.max(ln.start, docToDisplay(para, Math.max(m.from, lineFrom)));
      const ed = Math.min(ln.end, docToDisplay(para, Math.min(m.to, lineEnd)));
      const sx = X(sd);
      const ex = X(ed);
      if (ex <= sx) continue;
      if (!over) {
        ctx.fillStyle = st.fill!;
        ctx.fillRect(sx, y, ex - sx, ln.height);
        continue;
      }
      const by = y + ln.height - 3;
      if (st.underline) {
        ctx.fillStyle = st.underline;
        ctx.fillRect(sx, by, ex - sx, 1);
      }
      if (st.wave) {
        // 물결: 높이 2px, 주기 4px
        ctx.save();
        ctx.strokeStyle = st.wave;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, by);
        for (let x = sx, k = 1; x < ex; x += 2, k++) ctx.lineTo(Math.min(x + 2, ex), k % 2 ? by + 2 : by);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /**
   * 제안 표시 (14 §4.3, 글자 위에): 삽입은 작성자 색 밑줄, 삭제는 취소선, 서식 제안은 점선 밑줄, 문단 제안은 왼쪽 여백 막대
   */
  private drawSuggestionLines(anns: readonly AnnotationRange[], para: PlacedPara, ln: PlacedLine, X: (d: number) => number, y: number, left: number): void {
    const { ctx } = this;
    const isLast = ln.index === para.lines.length - 1;
    const lineFrom = displayToDoc(para, ln.start);
    const lineEnd = displayToDoc(para, ln.end);
    const lineTo = lineEnd + (isLast ? 1 : 0);
    for (const a of anns) {
      if (a.from >= lineTo) break;
      if (a.to <= lineFrom || a.type !== 'suggestion') continue;
      const color = suggestionColor(a);
      ctx.fillStyle = color;
      if (a.data.kind === 'para' || a.data.kind === 'table') {
        // ¶·표 개체 하나 범위: 왼쪽 여백에 막대
        ctx.fillRect(left - 10, y + 2, 3, ln.height - 4);
        continue;
      }
      if (a.data.kind === 'move') {
        // 옮긴 블록: 줄마다 왼쪽 여백에 겹 막대 (14 §4.5)
        ctx.fillRect(left - 12, y + 1, 2, ln.height - 2);
        ctx.fillRect(left - 8, y + 1, 2, ln.height - 2);
        continue;
      }
      if (a.data.kind === 'moveFrom') {
        // 원래 자리: 그 글자가 있는 줄 위에 점선 ("옮겨 간 자리")
        if (a.from >= lineFrom && a.from <= lineEnd) for (let x = left; x < left + para.width; x += 6) ctx.fillRect(x, y, 3, 1.5);
        continue;
      }
      const sd = Math.max(ln.start, docToDisplay(para, Math.max(a.from, lineFrom)));
      const ed = Math.min(ln.end, docToDisplay(para, Math.min(a.to, lineEnd)));
      const sx = X(sd);
      const ex = X(ed) + (isLast && a.to > lineEnd ? this.fontSize * 0.5 : 0);
      if (ex <= sx) continue;
      if (a.data.kind === 'insert') ctx.fillRect(sx, y + ln.height - 4, ex - sx, 1.5);
      else if (a.data.kind === 'delete') ctx.fillRect(sx, y + ln.height * 0.55, ex - sx, 1.5);
      else for (let x = sx; x < ex; x += 4) ctx.fillRect(x, y + ln.height - 3, Math.min(2, ex - x), 1.5);
    }
  }

  // ── 주석 (14 §2) ─────────────────────────────────────

  /**
   * 선택 범위에 주석을 건다 (편집 중인 스토리). 범위가 없으면 아무것도 하지 않는다. 실행 취소 한 단계. 만든 주석 ID (없으면 null)
   */
  annotate(type: string, data: Record<string, unknown> = {}): string | null {
    this.input.commitComposition();
    const [from, to] = this.range();
    if (from === to) return null;
    const story = this.storyId;
    const id = newAnnotationId();
    const before: Selection = { ...this.sel };
    this.history.seal();
    this.commit(this.document.annotate({ id, type, story, from, to, data }), before);
    this.history.seal();
    return id;
  }

  /** 주석 지우기 (실행 취소 한 단계) */
  unannotate(id: string): void {
    const before: Selection = { ...this.sel };
    const ops = this.document.unannotate(id);
    if (!ops.length) return;
    this.history.seal();
    this.commitRaw(ops, before);
    this.history.seal();
  }

  /** 캐럿(또는 선택)이 걸친 주석들 (편집 중인 스토리) */
  annotationsAtCaret(): AnnotationRange[] {
    const [from, to] = this.range();
    const story = this.storyId;
    return this.document.annotationRanges().filter((a) => (a.story ?? null) === story && !a.orphan && a.from <= to && a.to >= from && (a.from < to || a.to > from || from === to));
  }

  /** 모든 주석 (문서 순서, 고아 포함) */
  annotations(): readonly AnnotationRange[] {
    return this.document.annotationRanges();
  }

  /** 진하게 칠할 주석 (댓글 창에서 고른 것) */
  focusAnnotation(id: string | null): void {
    if (this.focusAnn === id) return;
    this.focusAnn = id;
    this.scheduleRender();
  }

  // ── 수락·거부, 보기 모드 (14 §4.2–4.4) ────────────────

  /** 읽기 전용 (최종본·원본 보기) */
  private readOnly = false;
  /** 권한 (14 §6): view는 읽기 전용, comment는 댓글 명령만 */
  private role: 'edit' | 'comment' | 'view' = 'edit';
  /** 댓글 명령의 커밋 중 (comment 역할에서 허용) */
  private commentCommit = false;

  /** 권한 (서버가 알린 역할). edit가 아니면 제안 모드를 끈다 (제안도 본문 변경이다) */
  setAccess(role: 'edit' | 'comment' | 'view'): void {
    if (role !== 'edit' && this.role === 'edit') this.history = new History(); // 앞의 본문 편집을 되돌리면 서버가 거부한다
    this.role = role;
    if (role !== 'edit' && this.document.suggesting) this.document.setSuggesting(null);
    this.render();
    this.opts.onChange?.(this);
  }

  get access(): 'edit' | 'comment' | 'view' {
    return this.role;
  }

  /** 댓글을 쓸 수 있는가 (보기 모드가 아니고 view 역할이 아님) */
  private get canComment(): boolean {
    return this.role !== 'view' && !this.readOnly;
  }

  private commentCommitRaw(ops: Op[], before: Selection): void {
    this.commentCommit = true;
    try {
      this.commitRaw(ops, before);
    } finally {
      this.commentCommit = false;
    }
  }
  /** 최종본·원본을 보는 동안 살아 있는 문서와 실행 취소 기록 */
  private live: { document: Document; history: History } | null = null;
  private mode: ViewMode = 'suggestions';
  private viewTimer: ReturnType<typeof setTimeout> | null = null;

  get viewMode(): ViewMode {
    return this.mode;
  }

  /**
   * 다른 문서를 읽기 전용으로 본다 (버전 보기, 14 §5.2: 최종본 보기와 같은 길). null이면 살아 있는 문서로 돌아간다.
   * 보는 동안 살아 있는 문서는 그대로 편집·동기화된다 (보이지 않을 뿐)
   */
  previewDocument(document: Document | null): void {
    if (document === null) {
      this.setViewMode('suggestions');
      return;
    }
    if (this.mode === 'suggestions') this.live = { document: this.document, history: this.history };
    this.mode = 'preview';
    if (this.viewTimer !== null) clearTimeout(this.viewTimer);
    this.viewTimer = null;
    this.readOnly = true;
    this.setDocument(document);
    this.opts.onChange?.(this);
  }

  /** 보기 모드 바꾸기. 최종본·원본은 지금 문서를 복제해 모두 수락·거부한 파생 문서를 따로 조판한다 (읽기 전용) */
  setViewMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    if (mode === 'preview') throw new Error('setViewMode: use previewDocument');
    if (mode !== 'suggestions' && !this.opts.cloneDocument) throw new Error('setViewMode: cloneDocument option is required');
    if (this.mode === 'suggestions') this.live = { document: this.document, history: this.history };
    this.mode = mode;
    if (mode === 'suggestions') {
      const live = this.live!;
      this.live = null;
      this.readOnly = false;
      if (this.viewTimer !== null) clearTimeout(this.viewTimer);
      this.viewTimer = null;
      this.setDocument(live.document);
      this.history = live.history;
      this.opts.onChange?.(this);
      return;
    }
    this.showDerived();
  }

  private showDerived(): void {
    const live = this.live!;
    const d = this.opts.cloneDocument!(live.document);
    d.resolveAll(this.mode === 'final');
    this.readOnly = true;
    this.setDocument(d);
    this.opts.onChange?.(this);
  }

  /** 제안 하나 수락·거부 (보통 편집: 실행 취소 한 단계, 제안 모드에서도 새 제안이 되지 않는다) */
  acceptSuggestion(id: string): void {
    this.resolve(this.document.resolveSuggestion(id, true));
  }

  rejectSuggestion(id: string): void {
    this.resolve(this.document.resolveSuggestion(id, false));
  }

  /** 모두 수락·거부 (authorId를 주면 그 작성자의 것만) */
  acceptAll(authorId?: string): void {
    this.resolve(this.document.resolveAll(true, authorId));
  }

  rejectAll(authorId?: string): void {
    this.resolve(this.document.resolveAll(false, authorId));
  }

  private resolve(ops: Op[]): void {
    if (!ops.length) return;
    const before: Selection = { ...this.sel };
    this.history.seal();
    if (this.focusAnn && !this.document.annotation(this.focusAnn)) this.focusAnn = null;
    this.commitRaw(ops, before);
    this.history.seal();
  }

  /** 제안 목록 (14 §4.4): 범위가 있는 것은 y 순, 요약 포함 */
  suggestionViews(): SuggestionView[] {
    const out: SuggestionView[] = [];
    const t = this.t;
    const attrName = (k: string) => (this.i18n.has(`attr.${k}`) ? t(`attr.${k}` as MessageKey) : k);
    for (const a of this.suggestions()) {
      if (a.orphan || a.to <= a.from || a.data.kind === 'moveFrom') continue;
      const text = Array.from(this.document.docOf(a.story).text()).slice(a.from, a.to).join('').replace(/\n/g, '¶').replace(/\uFFFC/g, '▣');
      const short = text.length > 24 ? `${text.slice(0, 24)}…` : text;
      const keys = Object.keys((a.data.before as Record<string, unknown> | undefined) ?? {}).map(attrName).join(t('list.separator'));
      const summary =
        a.data.kind === 'insert'
          ? t('suggestion.insert', { text: short })
          : a.data.kind === 'delete'
            ? t('suggestion.delete', { text: short })
            : a.data.kind === 'format'
              ? t('suggestion.format', { attrs: keys, text: short })
              : a.data.kind === 'move'
                ? t('suggestion.move', { text: short })
                : a.data.kind === 'table'
                  ? t(a.data.axis === 'row' ? (a.data.op === 'insert' ? 'suggestion.rowInsert' : 'suggestion.rowDelete') : a.data.op === 'insert' ? 'suggestion.columnInsert' : 'suggestion.columnDelete')
                  : t('suggestion.paragraph', { attrs: keys });
      out.push({ ...a, y: this.storyY(a.story ?? null, a.from), summary });
    }
    out.sort((x, y) => (x.y ?? Infinity) - (y.y ?? Infinity) || x.from - y.from);
    return out;
  }

  /** 제안 하나를 고르고 그 범위로 간다 */
  revealSuggestion(id: string): void {
    const s = this.suggestions().find((a) => a.id === id);
    this.focusAnnotation(id);
    if (!s || s.orphan || (s.story ?? null) !== null || this.storyId !== null) return;
    this.setSelection(s.from, s.to);
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  // ── 찾기·바꾸기 (15 §3) ───────────────────────────────

  /**
   * 모두 찾고 캐럿 뒤 첫 결과를 지금 결과로 고른다 (선택하지는 않는다: 찾기 막대에서 Enter로 간다).
   * 조건이 틀리면(빈 글자, 틀린 정규식) 결과 없이 error. 내장 찾기 플러그인(find-plugin)이 한다
   */
  find(query: FindQuery): FindStatus {
    return this.findP.find(query);
  }

  /** 찾기 상태 (찾는 중이 아니면 null) */
  findStatus(): FindStatus | null {
    return this.findP.status();
  }

  /** 다음(dir = 1)·앞(-1) 결과로 가서 선택한다 (끝에서 처음으로 돈다) */
  findNext(dir: 1 | -1 = 1): FindStatus | null {
    return this.findP.next(dir);
  }

  /** 찾기를 끝낸다 (칠한 것을 지운다) */
  clearFind(): void {
    this.findP.clear();
  }

  /** 지금 결과를 바꾸고 다음 결과로 간다. 지금 결과가 선택돼 있지 않으면 거기로 가기만 한다 (Word와 같다). 바꿨으면 true */
  replace(text: string): boolean {
    return this.findP.replace(text);
  }

  /** 모든 결과를 바꾼다: 한 트랜잭션 (실행 취소 한 번). 바꾼 수 */
  replaceAll(text: string): number {
    this.input.commitComposition();
    return this.findP.replaceAll(text);
  }

  /** 본문 글자를 바꿀 수 있는가 (읽기 전용 보기·보기·댓글 역할이면 아니다) */
  private get canEditText(): boolean {
    return this.role === 'edit' && !this.readOnly;
  }

  /** 범위로 간다: 그 스토리로 들어가(셀·각주·머리말) 범위를 고르고 보이게 스크롤 (화면 위 1/3쯤). 못 들어가면 false */
  private revealRange(story: string | null, from: number, to: number): boolean {
    this.input.commitComposition();
    if (story !== this.storyId) {
      if (this.hf) this.leaveHF(true);
      if (this.note) this.leaveNote(true);
      if (this.cell) this.leaveCellKeep();
      if (story !== null) {
        if (isNoteStory(story)) this.enterNote(story.slice(3), null);
        else if (isHFStory(story)) {
          const page = this.pageOfHF(story);
          if (page === null) return false;
          this.enterHF(page, story.startsWith('hdr|') ? 'header' : 'footer');
        } else {
          const [table, row, col] = story.split('|') as [string, string, string];
          if (!this.enterCell(table, row, col)) return false;
        }
      }
      this.relayout();
    }
    this.setSelection(from, to);
    // 가장자리에 붙으면 찾기 막대에 가린다
    const r = this.layout.caretRect(this.headOffset());
    const sc = this.scroller;
    if (r.y < sc.scrollTop + sc.clientHeight / 4 || r.y + r.height > sc.scrollTop + (sc.clientHeight * 3) / 4) sc.scrollTop = Math.max(0, r.y - sc.clientHeight / 3);
    this.render();
    this.opts.onChange?.(this);
    return true;
  }

  /** 머리말·꼬리말 스토리를 쓰는 첫 쪽 (없으면 null) */
  private pageOfHF(story: string): number | null {
    const L = this.bodyLayout;
    for (let p = 0; p < L.pageCount; p++) {
      const info = pageHF(this.fmt, L, p, this.today);
      if (info.header.story === story || info.footer.story === story) return p;
    }
    return null;
  }

  // ── 제안 모드 (14 §4) ─────────────────────────────────

  /** 제안 모드 켜기·끄기 (이 편집기의 상태: 켜면 편집이 작성자의 제안으로 기록된다) */
  setSuggesting(on: boolean): void {
    if (on && this.role !== 'edit') return;
    this.document.setSuggesting(on ? { author: this.author } : null);
    this.render();
    this.opts.onChange?.(this);
  }

  get suggesting(): boolean {
    return this.document.suggesting !== null;
  }

  /** 제안 목록 (문서 순서, 고아 포함): 종류·작성자·시각·범위 */
  suggestions(): AnnotationRange[] {
    return this.document.annotationRanges().filter((a) => a.type === 'suggestion');
  }

  // ── 댓글 (14 §3) ─────────────────────────────────────

  /** 칠하지 않을 주석: 해결했거나 지운 스레드의 댓글 */
  private hiddenAnn(a: AnnotationRange): boolean {
    if (a.type !== 'comment' || typeof a.data.thread !== 'string') return false;
    const t = this.document.thread(a.data.thread);
    return !!t && (t.resolved || t.deleted);
  }

  private get author(): CommentAuthor {
    return this.opts.user ?? { id: 'local', name: this.t('author.me'), color: '#2563eb' };
  }

  /** 선택 범위에 댓글 스레드를 만든다 (주석 + 첫 메시지, 실행 취소 한 단계). 범위가 없거나 글이 비면 null */
  addComment(text: string): string | null {
    this.input.commitComposition();
    const [from, to] = this.range();
    if (from === to || !text.trim() || !this.canComment) return null;
    const thread = newThreadId();
    const before: Selection = { ...this.sel };
    this.history.seal();
    const ops = this.document.addThread({
      thread, annotation: newAnnotationId(), story: this.storyId, from, to, message: newMessageId(), author: this.author, text, time: Date.now(),
    });
    this.focusAnn = this.document.thread(thread)?.anchor ?? null;
    this.commentCommitRaw(ops, before);
    this.history.seal();
    return thread;
  }

  /** 답글 (실행 취소 기록 없음: 댓글 대화는 문서 편집이 아니다) */
  replyComment(thread: string, text: string): string | null {
    if (!text.trim() || !this.document.thread(thread) || !this.canComment) return null;
    const id = newMessageId();
    this.document.addMessage(thread, { id, author: this.author, time: Date.now(), text });
    this.commentChanged();
    return id;
  }

  /** 메시지 고치기 (기록 없음) */
  editComment(thread: string, message: string, text: string): void {
    if (!text.trim() || !this.canComment) return;
    this.document.editMessage(thread, message, text, Date.now());
    this.commentChanged();
  }

  /** 메시지 지우기 (지운 표시, 기록 없음). 첫 메시지를 지우면 스레드를 지운다 */
  deleteComment(thread: string, message: string): void {
    if (!this.canComment) return;
    const t = this.document.thread(thread);
    if (t && t.messages[0]?.id === message) return this.deleteThread(thread);
    this.document.deleteMessage(thread, message);
    this.commentChanged();
  }

  /** 해결 / 다시 열기 (기록 없음) */
  resolveThread(thread: string, on: boolean): void {
    if (!this.canComment) return;
    this.document.resolveThread(thread, on);
    if (on && this.focusAnn === this.document.thread(thread)?.anchor) this.focusAnn = null;
    this.commentChanged();
  }

  /** 스레드 지우기: 주석을 지우고 스레드는 지운 표시 (실행 취소 한 단계: 글을 지운 것처럼 되돌릴 수 있다) */
  deleteThread(thread: string): void {
    if (!this.canComment) return;
    const ops = this.document.deleteThread(thread);
    if (!ops.length) return;
    const before: Selection = { ...this.sel };
    this.history.seal();
    this.commentCommitRaw(ops, before);
    this.history.seal();
  }

  private commentChanged(): void {
    this.render();
    this.opts.onChange?.(this);
  }

  /** 선택 범위 시작의 문서 y (새 댓글 쓰는 자리). 찾지 못하면 null */
  selectionY(): number | null {
    return this.storyY(this.storyId, this.range()[0]);
  }

  /** 스크롤하는 요소 (댓글 창이 스레드를 범위의 y - scrollTop에 맞추어 놓는다) */
  get scrollElement(): HTMLElement {
    return this.scroller;
  }

  /** 스레드를 고르고 그 범위로 간다 (본문이면 범위를 선택하고 보이게 스크롤) */
  revealThread(thread: string): void {
    const t = this.threads().find((v) => v.id === thread);
    this.focusThread(thread);
    if (!t || t.orphan || t.story !== null || this.storyId !== null) return;
    this.setSelection(t.from, t.to);
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  /** 고른 스레드의 범위를 진하게 칠한다 (null이면 없음) */
  focusThread(thread: string | null): void {
    this.focusAnnotation(thread ? (this.document.thread(thread)?.anchor ?? null) : null);
  }

  /** 지금 고른 스레드 */
  focusedThread(): string | null {
    if (!this.focusAnn) return null;
    const a = this.document.annotation(this.focusAnn);
    return a && typeof a.data.thread === 'string' ? a.data.thread : null;
  }

  /** 캐럿이 걸친 댓글 스레드 (편집 중인 스토리, 열린 것) */
  threadsAtCaret(): string[] {
    const out: string[] = [];
    for (const a of this.annotationsAtCaret()) {
      if (a.type !== 'comment' || typeof a.data.thread !== 'string') continue;
      const t = this.document.thread(a.data.thread);
      if (t && !t.deleted && !t.resolved) out.push(t.id);
    }
    return out;
  }

  /**
   * 스레드 목록 (14 §3.2, 지운 것 빼고): 범위가 있는 것은 문서 순서(스토리 위치의 y 순), 그다음 고아. 각 항목에 범위 시작의
   * 문서 y가 있다 (댓글 창이 맞추어 놓는다). 본문 밖 스토리는 그 스토리가 걸린 자리: 표·각주 참조 문단, 머리말은 첫 쪽 위, 꼬리말은 첫 쪽 아래
   */
  threads(): ThreadView[] {
    const ranges = new Map<string, AnnotationRange>();
    for (const r of this.document.annotationRanges()) if (r.type === 'comment') ranges.set(r.id, r);
    const out: ThreadView[] = [];
    for (const t of this.document.threads()) {
      if (t.deleted || !t.messages.length) continue;
      const r = t.anchor ? ranges.get(t.anchor) : undefined;
      const orphan = !r || r.orphan;
      const story = r?.story ?? null;
      out.push({ ...t, story, from: r?.from ?? 0, to: r?.to ?? 0, orphan, y: orphan ? null : this.storyY(story, r!.from) });
    }
    out.sort((a, b) => (a.y === null ? 1 : 0) - (b.y === null ? 1 : 0) || (a.y ?? 0) - (b.y ?? 0) || a.from - b.from || (a.id < b.id ? -1 : 1));
    return out;
  }

  /** 스토리 위치의 문서 y (본문 레이아웃 좌표). 찾지 못하면 null */
  private storyY(story: string | null, offset: number): number | null {
    try {
      if (story === null) return this.bodyLayout.caretRect(offset).y;
      if (isHFStory(story)) return story.startsWith('ftr') ? this.setup.height * 0.9 : 0;
      // 표 셀·각주: 그 개체가 있는 본문 문단
      const noteId = story.startsWith('fn|') ? story.slice(3) : null;
      const tableId = noteId === null ? story.split('|')[0]! : null;
      const paras = this.body.paragraphs();
      for (let i = 0; i < paras.length; i++) {
        const objs = paras[i]!.objs;
        if (!objs) continue;
        for (const [k, o] of objs) {
          if (noteId !== null ? o.kind === 'note' && o.id === noteId : o.kind === 'table' && o.table === tableId) {
            return noteId !== null ? this.bodyLayout.caretRect(paras[i]!.start + k).y : this.bodyLayout.para(i).lines[0]!.y;
          }
        }
      }
    } catch {
      // 아직 조립하지 않은 곳
    }
    return null;
  }

  /** 본문 문단 i 뒤의 나눔: 구역 나눔, 다음 문단의 앞에서 쪽·단 나눔 (없으면 null) */
  private breakAfter(i: number): { kind: 'page' | 'column' | 'section'; label: string } | null {
    const b = this.body;
    if (b.paraAttrs(i).section !== undefined) {
      const start = fullSection(b.sectionDef(b.sectionOf(i + 1).id)).start;
      return { kind: 'section', label: this.t('break.section', { start: this.t(SECTION_LABELS[start]) }) };
    }
    const next = this.bodyLayout.paras[i + 1];
    if (next?.layout.box?.keep?.breakBefore) return { kind: 'page', label: this.t('break.page') };
    if (next?.layout.box?.keep?.column) return { kind: 'column', label: this.t('break.column') };
    return null;
  }

  /** 문단 i 뒤의 나눔을 보일까: 편집 기호를 켰거나, 연속 보기(쪽 경계가 없어 달리 알 길이 없다)이거나, 캐럿이 바로 앞뒤 문단에 있을 때 */
  private breakVisible(i: number): boolean {
    if (this.marksShown || this.pageViewMode === 'continuous') return true;
    if (!this.inBody) return false;
    const p = this.body.paragraphIndexAt(this.headOffset());
    return p === i || p === i + 1;
  }

  /** 문단 끝 ¶ (편집 기호): 마지막 글자 뒤에 반투명하게 */
  private drawPilcrow(x: number, y: number, h: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = this.colors.mark;
    ctx.font = `${Math.round(this.fontSize * 0.85)}px ${this.family}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('¶', x + 1, y + h / 2);
    ctx.restore();
  }

  /**
   * 나눔 표시: 문단 아래 경계(y)에 본문 폭 x0..x1의 반투명 점선(구역은 두 줄, 단은 잘게)과 오른쪽 끝의 작은 배지.
   * 글자 줄 위가 아니라 문단 사이에 덧그리므로 글을 가리지 않고, 줄이 꽉 차도 넘치지 않는다
   */
  private drawBreakMark(brk: { kind: 'page' | 'column' | 'section'; label: string }, x0: number, x1: number, y: number): void {
    const { ctx } = this;
    const c = this.colors;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = c.mark;
    ctx.lineWidth = 1;
    ctx.setLineDash(brk.kind === 'column' ? [2, 3] : [5, 3]);
    ctx.beginPath();
    for (const dy of brk.kind === 'section' ? [-1.5, 1.5] : [0]) {
      ctx.moveTo(x0, Math.round(y + dy) + 0.5);
      ctx.lineTo(x1, Math.round(y + dy) + 0.5);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `10px ${this.family}`;
    const tw = ctx.measureText(brk.label).width;
    const h = 15;
    const bw = tw + 12;
    const bx = Math.max(x0, x1 - bw);
    const by = Math.round(y - h / 2);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = c.page;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, h, h / 2);
    else ctx.rect(bx, by, bw, h);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.fillStyle = c.placeholderText;
    ctx.textBaseline = 'middle';
    ctx.fillText(brk.label, bx + 6, by + h / 2 + 0.5);
    ctx.restore();
  }

  /** 셀 범위 선택의 격자 인덱스 (이 표가 아니거나 범위의 행·열이 사라졌으면 null) */
  private cellSelBox(v: TableView): { y0: number; y1: number; x0: number; x1: number } | null {
    const c = this.cellSel;
    if (!c || c.table !== v.id) return null;
    const ys = c.rows.map((r) => v.grid.rows.indexOf(r));
    const xs = c.cols.map((r) => v.grid.cols.indexOf(r));
    if (ys.includes(-1) || xs.includes(-1)) return null;
    return { y0: Math.min(...ys), y1: Math.max(...ys), x0: Math.min(...xs), x1: Math.max(...xs) };
  }

  // ── 개체 (11 §2.1, §4.1, §5) ─────────────────────────

  /** 자산의 그릴 이미지. 없으면 불러오기를 시작하고 null (다 되면 다시 그린다) */
  private image(asset: string): ImageBitmap | null | 'error' {
    this.imageUsed.set(asset, this.frame);
    if (this.images.has(asset)) return this.images.get(asset)!;
    this.images.set(asset, null);
    void this.assets
      .get(asset)
      .then((blob) => (blob ? createImageBitmap(blob) : Promise.reject(new Error('missing'))))
      .then(
        (bmp) => this.images.set(asset, bmp),
        () => this.images.set(asset, 'error'),
      )
      .then(() => this.scheduleRender());
    return null;
  }

  /** 그린 이미지가 많으면 이번 프레임에 그리지 않은 것을 푼다 (다시 보이면 저장소에서 다시 디코드) */
  private releaseImages(): void {
    this.frame++;
    if (this.images.size <= 64) return;
    for (const [id, img] of this.images) {
      if ((this.imageUsed.get(id) ?? -1) >= this.frame - 1 || img === null) continue;
      if (img !== 'error') img.close();
      this.images.delete(id);
      this.imageUsed.delete(id);
    }
  }

  /** 문서 좌표 (x, y)에 있는 개체: 오프셋, 화면 상자 (쪽 왼쪽 기준 x, 문서 y). 떠 있는 개체(앞에 그린 것부터)를 먼저 본다 */
  private objectAt(x: number, y: number): { offset: number; x: number; y: number; w: number; h: number; float?: boolean } | null {
    const fl = this.layout.floatsIn(y - 1, y + 1);
    for (let i = fl.length - 1; i >= 0; i--) {
      const { para, float: f } = fl[i]!;
      if (x >= f.x - 5 && x <= f.x + f.w + 5 && y >= f.y - 5 && y <= f.y + f.h + 5) {
        const pl = para.layout;
        const k = pl.preedit && f.k >= pl.preedit[0] ? f.k - (pl.preedit[1] - pl.preedit[0]) : f.k;
        return { offset: (para.info as ParagraphInfo).start + k, x: f.x, y: f.y, w: f.w, h: f.h, float: true };
      }
    }
    const ref = this.layout.firstLineBelow(y, false);
    if (!ref) return null;
    for (const r of [ref, this.layout.stepLine(ref, -1)]) {
      if (!r) continue;
      const para = this.layout.para(r.para);
      const pl = para.layout;
      if (!pl.objs) continue;
      const ln = para.lines[r.line]!;
      for (const [k, box] of pl.objs) {
        if (k < ln.start || k >= ln.end) continue;
        const bx = lineX(pl, ln, k);
        const by = ln.baseline - box.h;
        if (x >= bx - 5 && x <= bx + box.w + 5 && y >= by - 5 && y <= ln.baseline + 5)
          return { offset: (para.info as ParagraphInfo).start + k, x: bx, y: by, w: box.w, h: box.h };
      }
    }
    return null;
  }

  /** 선택한 개체 하나 (선택이 개체 글자 하나일 때)의 오프셋과 속성 */
  selectedObject(): { offset: number; attrs: ObjAttrs } | null {
    const [from, to] = this.range();
    if (to - from !== 1) return null;
    const attrs = this.doc.objAt(from);
    return attrs ? { offset: from, attrs } : null;
  }

  /** 선택한 개체의 속성 하나 (대체 텍스트 등). 실행 취소 한 단계 */
  setObjectAttr(key: ObjKey, value: unknown): void {
    const o = this.selectedObject();
    if (!o) return;
    const before: Selection = { ...this.sel };
    const ops = this.doc.setObjAttr(o.offset, key, value);
    if (ops.length === 0) return;
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
  }

  /**
   * 이미지 넣기 (붙여넣기·끌어 놓기·메뉴): 원본을 자산 저장소에 넣고 캐럿 자리에 개체를 넣는다. 크기는 원래 크기(px)이고,
   * 본문 폭보다 넓으면 본문 폭으로 줄인다. 자산 올리기를 기다리지 않는다.
   */
  async insertImage(blob: Blob, alt?: string, at?: number): Promise<void> {
    const bmp = await createImageBitmap(blob);
    const asset = await this.assets.put(blob);
    this.images.set(asset, bmp);
    const maxW = this.contentWidthAt(at ?? this.headOffset());
    const scale = Math.min(1, maxW / bmp.width);
    const toPt = (v: number) => Math.round(v * 0.75 * 1000); // px(96dpi) → 1/1000pt
    const attrs: ObjAttrs = { id: crypto.randomUUID().slice(0, 8), kind: 'image', asset, w: toPt(bmp.width * scale), h: toPt(bmp.height * scale), ...(alt ? { alt } : {}) };
    this.input.commitComposition();
    if (at !== undefined) this.setSelection(at);
    const before: Selection = { ...this.sel };
    const [from, to] = this.range();
    const ops: Op[] = [];
    if (from !== to) ops.push(...this.doc.deleteRange(from, to));
    ops.push(...this.doc.insertObject(from, attrs));
    this.setSelection(from + 1); // 캐럿은 넣은 이미지 뒤 (Google Docs처럼: 이어 쓰거나 Enter를 눌러도 이미지가 남는다. 누르면 개체 선택)
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
  }

  /**
   * 떠 있는 개체 배치 바꾸기 (11 §5.3): inline(글자처럼) / square(어울림) / topBottom(자리 차지) / front(글 앞) / behind(글 뒤).
   * 처음 띄울 때는 앵커 문단 위쪽 왼쪽에 둔다.
   */
  setPlacement(mode: 'inline' | 'square' | 'topBottom' | 'front' | 'behind'): void {
    const o = this.selectedObject();
    if (!o) return;
    const cur = o.attrs.float;
    const base: FloatAttrs = cur ?? { relX: 'column', relY: 'paragraph', x: 0, y: 0, wrap: 'square', side: 'largest', gap: 9000 };
    const next: FloatAttrs | undefined =
      mode === 'inline'
        ? undefined
        : { ...base, wrap: mode === 'front' || mode === 'behind' ? 'none' : mode, behind: mode === 'behind' ? true : undefined };
    if (next && next.behind === undefined) delete next.behind;
    this.setObjectAttr('float', next);
  }

  /** 떠 있는 개체 끌어 옮기기: 같은 문단 안이면 위치만, 다른 문단 위에 놓으면 그 문단으로 앵커를 옮긴다 (지우고 넣기, 속성 복사) */
  private startMove(obj: { offset: number; x: number; y: number; w: number; h: number }, e: MouseEvent): void {
    const start = this.docPoint(e);
    const onMove = (ev: MouseEvent) => {
      const q = this.docPoint(ev);
      this.moving = { offset: obj.offset, dx: q.x - start.x, dy: q.y - start.y };
      this.scheduleRender();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const mv = this.moving;
      this.moving = null;
      if (!mv || (Math.abs(mv.dx) < 2 && Math.abs(mv.dy) < 2)) {
        this.render();
        return;
      }
      const attrs = this.doc.objAt(obj.offset);
      if (!attrs?.float) return;
      const toPt = (v: number) => Math.round(v * 0.75 * 1000);
      const newX = obj.x + mv.dx;
      const newY = obj.y + mv.dy;
      // 놓은 자리의 문단 (개체 위쪽이 걸친 줄)
      const ref = this.layout.firstLineBelow(newY, false) ?? this.layout.lineAt(obj.offset);
      const target = this.layout.para(ref.para);
      const tTop = target.lines[0]!.y;
      const anchorPara = this.doc.paragraphIndexAt(obj.offset);
      const float: FloatAttrs = { ...attrs.float, relX: 'column', x: toPt(newX - target.frameLeft), y: toPt(newY - tTop), relY: 'paragraph' };
      const before: Selection = { ...this.sel };
      const ops: Op[] = [];
      let at = obj.offset;
      if (ref.para === anchorPara) ops.push(...this.doc.setObjAttr(obj.offset, 'float', float));
      else {
        const tStart = (target.info as ParagraphInfo).start;
        ops.push(...this.doc.deleteRange(obj.offset, obj.offset + 1));
        at = tStart > obj.offset ? tStart - 1 : tStart;
        ops.push(...this.doc.insertObject(at, { ...attrs, float }));
      }
      this.setSelection(at, at + 1);
      this.history.seal();
      this.commit(ops, before);
      this.history.seal();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /** 개체 손잡이를 끌어 크기 조절: 모서리는 비율 유지, 변은 한 방향 (11 §5.1) */
  private startResize(obj: { offset: number; x: number; y: number; w: number; h: number }, handle: number, e: MouseEvent): void {
    const start = this.docPoint(e);
    const ratio = obj.h / obj.w;
    const corner = handle % 2 === 0;
    const onMove = (ev: MouseEvent) => {
      const q = this.docPoint(ev);
      const dx = q.x - start.x;
      const dy = q.y - start.y;
      // 손잡이 번호: 0 왼쪽 위, 1 위, 2 오른쪽 위, 3 오른쪽, 4 오른쪽 아래, 5 아래, 6 왼쪽 아래, 7 왼쪽
      const sx = handle === 0 || handle === 6 || handle === 7 ? -1 : handle === 1 || handle === 5 ? 0 : 1;
      const sy = handle <= 2 ? -1 : handle === 3 || handle === 7 ? 0 : 1;
      let w = Math.max(16, obj.w + sx * dx);
      let h = Math.max(16, obj.h + sy * dy);
      if (corner) {
        // 비율 유지: 가로·세로 중 더 크게 바뀐 쪽을 따른다 (세로로만 끌어도 커진다)
        const scale = Math.max(16 / obj.w, 16 / obj.h, Math.abs(w / obj.w - 1) >= Math.abs(h / obj.h - 1) ? w / obj.w : h / obj.h);
        w = obj.w * scale;
        h = obj.w * scale * ratio;
      }
      if (sx === 0) w = obj.w;
      if (sy === 0) h = obj.h;
      // 왼쪽·위 손잡이면 오른쪽·아래 변을 고정한다: 손잡이가 커서를 따라간다
      this.resizing = { offset: obj.offset, w, h, dx: sx < 0 ? obj.w - w : 0, dy: sy < 0 ? obj.h - h : 0 };
      this.scheduleRender();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const r = this.resizing;
      this.resizing = null;
      if (!r) return;
      const toPt = (v: number) => Math.round(v * 0.75 * 1000);
      const before: Selection = { ...this.sel };
      const ops = [...this.doc.setObjAttr(r.offset, 'w', toPt(r.w)), ...this.doc.setObjAttr(r.offset, 'h', toPt(r.h))];
      // 떠 있는 개체는 왼쪽·위 손잡이로 바꾼 만큼 자리도 옮긴다 (오른쪽·아래 변이 제자리). 정렬 자리(left·center·right)는 그대로
      const fl = this.doc.objAt(r.offset)?.float;
      if (fl && (r.dx || r.dy)) {
        const next: FloatAttrs = { ...fl, y: fl.y + toPt(r.dy), ...(typeof fl.x === 'number' ? { x: fl.x + toPt(r.dx) } : {}) };
        ops.push(...this.doc.setObjAttr(r.offset, 'float', next));
      }
      this.history.seal();
      if (ops.length) this.commit(ops, before);
      else this.render();
      this.history.seal();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── 목록 (10 §2.4) ──────────────────────────────────

  /** 선택한 문단들이 모두 이 종류의 목록인가 */
  private allInList(kind: 'bullet' | 'number'): boolean {
    const [i, j] = this.selectedParagraphs();
    for (let k = i; k <= j; k++) {
      const li = this.doc.paraAttrs(k).list;
      if (!li || this.doc.listDef(li.id)?.kind !== kind) return false;
    }
    return true;
  }

  /**
   * 글머리·번호 목록 켜고 끄기 (Ctrl+Shift+8 / 7). 모두 그 목록이면 목록을 푼다. 아니면 바로 앞 문단이 같은 종류의 목록이면
   * 그 목록을 이어 가고(번호가 이어짐), 아니면 새 목록을 만든다. 수준은 지금 수준(없으면 0)을 둔다.
   */
  toggleList(kind: 'bullet' | 'number'): void {
    this.input.commitComposition();
    const [i, j] = this.selectedParagraphs();
    const before: Selection = { ...this.sel };
    const ops: Op[] = [];
    if (this.allInList(kind)) {
      for (let k = i; k <= j; k++) ops.push(...this.doc.setParaAttr(k, 'list', undefined));
    } else {
      const prev = i > 0 ? this.doc.paraAttrs(i - 1).list : undefined;
      let id = prev && this.doc.listDef(prev.id)?.kind === kind ? prev.id : null;
      if (!id) {
        const [nid, created] = this.doc.createList(kind);
        id = nid;
        ops.push(...created);
      }
      for (let k = i; k <= j; k++) {
        const level = this.doc.paraAttrs(k).list?.level ?? 0;
        ops.push(...this.doc.setParaAttr(k, 'list', { id, level }));
      }
    }
    if (ops.length === 0) return;
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
  }

  /** 선택한 목록 문단들의 수준 ±1 (Tab / Shift+Tab). 목록 문단이 없으면 false */
  listLevel(dir: 1 | -1): boolean {
    const [i, j] = this.selectedParagraphs();
    const before: Selection = { ...this.sel };
    const ops: Op[] = [];
    let any = false;
    for (let k = i; k <= j; k++) {
      const li = this.doc.paraAttrs(k).list;
      if (!li) continue;
      any = true;
      const level = Math.max(0, Math.min(MAX_LIST_LEVEL, li.level + dir));
      if (level !== li.level) ops.push(...this.doc.setParaAttr(k, 'list', { id: li.id, level }));
    }
    if (ops.length > 0) {
      this.history.seal();
      this.commit(ops, before);
      this.history.seal();
    }
    return any;
  }

  /** 캐럿이 목록 문단의 첫머리에 있는가 (선택 없음) */
  private caretAtListStart(): { i: number; empty: boolean } | null {
    const [from, to] = this.range();
    if (from !== to) return null;
    const i = this.doc.paragraphIndexAt(from);
    const p = this.doc.paragraphs()[i]!;
    if (!p.attrs.list || from !== p.start) return null;
    return { i, empty: p.start === p.end };
  }

  /** 목록 문단 하나의 수준을 한 단계 올리거나(수준 0이면 목록 해제) — 빈 항목 Enter, 첫머리 Backspace */
  private outdentListItem(i: number, unlist: boolean): void {
    const li = this.doc.paraAttrs(i).list!;
    const before: Selection = { ...this.sel };
    const ops = unlist || li.level === 0 ? this.doc.setParaAttr(i, 'list', undefined) : this.doc.setParaAttr(i, 'list', { id: li.id, level: li.level - 1 });
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
  }

  // ── 문단 서식 (10 §2.2–2.3) ──────────────────────────

  /** 선택한 문단들의 문단 서식 (툴바 상태). 많으면 앞 1,000문단만 본다 */
  paragraphState(): ParagraphState {
    const [i, j] = this.selectedParagraphs();
    const last = Math.min(j, i + 999);
    const styleOf = (k: number) => this.doc.paraAttrs(k).style ?? BODY_STYLE;
    const first = this.doc.effectiveParaAttrs(i);
    const mixed = new Set<string>();
    for (let k = i + 1; k <= last; k++) {
      if (styleOf(k) !== styleOf(i)) mixed.add('style');
      const a = this.doc.effectiveParaAttrs(k);
      for (const key of ['align', 'indent', 'space', 'line', 'pageBreakBefore', 'keepWithNext', 'keepTogether', 'koreanBreak', 'hangPunct', 'squeeze'] as const)
        if (JSON.stringify(a[key]) !== JSON.stringify(first[key])) mixed.add(key);
    }
    return { style: styleOf(i), attrs: first, mixed };
  }

  /** 선택한 문단들의 문단 속성 키 하나를 value로 (undefined = 해제). 실행 취소 한 단계 */
  setParagraphAttr(key: ParaKey, value: unknown): void {
    this.input.commitComposition();
    const before = this.fullSel();
    const ops: Op[] = [];
    for (const k of this.caretParagraphs()) ops.push(...this.doc.setParaAttr(k, key, value));
    if (ops.length === 0) return;
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
  }

  /** 선택한 문단들에 문단 스타일 (본문이면 style 키를 지운다) */
  setParagraphStyle(name: string): void {
    this.setParagraphAttr('style', name === BODY_STYLE ? undefined : name);
  }

  // ── 쪽 나눔 (12 §4) ───────────────────────────────

  /**
   * 쪽 나누기 (Ctrl+Enter): 캐럿에서 문단을 나누고 뒤쪽 문단을 앞에서 쪽 나눔으로. 캐럿이 문단 처음이면 그 문단을 (나누지 않음).
   * 쪽 나눔은 글자가 아니라 다음 문단의 속성이다. 본문에서만. 실행 취소 한 단계
   */
  insertPageBreak(): void {
    this.input.commitComposition();
    if (!this.inBody || this.extras.length) return;
    const [from, to] = this.range();
    const pi = this.doc.paragraphIndexAt(from);
    const p = this.doc.paragraphs()[pi]!;
    if (p.objs?.get(0)?.kind === 'table') return;
    this.history.seal();
    if (from === to && from === p.start && pi > 0) {
      const before: Selection = { ...this.sel };
      const ops = this.doc.setParaAttr(pi, 'pageBreakBefore', true);
      if (ops.length) this.commit(ops, before);
    } else this.replaceSelection('\n', undefined, () => this.doc.setParaAttr(pi + 1, 'pageBreakBefore', true));
    this.history.seal();
  }

  /** 단 나누기 (Ctrl+Shift+Enter, 12 §7.1): 캐럿에서 문단을 나누고 뒤쪽 문단을 앞에서 단 나눔으로 (문단 처음이면 그 문단에) */
  insertColumnBreak(): void {
    this.input.commitComposition();
    if (!this.inBody || this.extras.length) return;
    const [from, to] = this.range();
    const pi = this.doc.paragraphIndexAt(from);
    const p = this.doc.paragraphs()[pi]!;
    if (p.objs?.get(0)?.kind === 'table') return;
    this.history.seal();
    if (from === to && from === p.start && pi > 0) {
      const before: Selection = { ...this.sel };
      const ops = this.doc.setParaAttr(pi, 'columnBreakBefore', true);
      if (ops.length) this.commit(ops, before);
    } else this.replaceSelection('\n', undefined, () => this.doc.setParaAttr(pi + 1, 'columnBreakBefore', true));
    this.history.seal();
  }

  /** 선택한 문단들의 쪽 나눔 제어 키를 켜거나 끈다 (모두 켜져 있으면 끈다). 스타일 값(제목의 다음 문단과 함께)도 본다 */
  toggleParagraphKeep(key: 'pageBreakBefore' | 'keepWithNext' | 'keepTogether'): void {
    const on = this.paragraphState().attrs[key] === true && !this.paragraphState().mixed.has(key);
    const styled = this.styleHas(key);
    // 스타일이 켜는 키는 직접 속성 false로 끄고, 다시 켜면 직접 속성을 지워 스타일을 따른다
    this.setParagraphAttr(key, on ? (styled ? false : undefined) : styled ? undefined : true);
  }

  /** 캐럿 문단의 스타일이 이 키를 켜는가 (끄려면 직접 속성 false) */
  private styleHas(key: 'pageBreakBefore' | 'keepWithNext' | 'keepTogether'): boolean {
    const [i] = this.selectedParagraphs();
    return this.doc.paraStyle(i).para[key] === true;
  }

  // ── 구역 (12 §3) ───────────────────────────────

  /**
   * 구역 나누기 (Ctrl+Alt+Enter: 다음 쪽): 캐럿에서 문단을 나누고 앞쪽 문단을 새 구역의 끝으로 한다. 새 구역(앞)은 지금 구역의
   * 설정을 그대로 받고, 지금 구역(뒤)은 start 방식으로 시작한다 (Word처럼 나눔의 종류는 뒤 구역의 시작). 본문에서만. 실행 취소 한 단계
   */
  insertSectionBreak(start: SectionStart = 'nextPage'): void {
    this.input.commitComposition();
    if (!this.inBody || this.extras.length) return;
    const [from] = this.range();
    const pi = this.doc.paragraphIndexAt(from);
    if (this.doc.paragraphs()[pi]?.objs?.get(0)?.kind === 'table') return;
    this.history.seal();
    this.replaceSelection('\n', undefined, () => {
      const d = this.doc;
      const cur = d.sectionOf(pi + 1).id;
      const props = fullSection(d.sectionDef(cur));
      const id = d.newSectionId();
      return [...d.setSection(id, props), ...d.setParaAttr(pi, 'section', id), ...d.setSection(cur, { ...props, start })];
    });
    this.history.seal();
  }

  /** 캐럿이 든 구역: ID, 설정(빠진 키는 기본값), 차례, 구역 수 */
  sectionInfo(): { id: string; props: SectionProps; index: number; count: number } {
    const b = this.body;
    if (this.hf) {
      // 머리말·꼬리말: 그 쪽의 구역
      const info = pageHF(this.fmt, this.bodyLayout, this.hf.page, this.today);
      return { id: info.sectionId, props: fullSection(b.sectionDef(info.sectionId)), index: info.section, count: b.sectionBreaks().length + 1 };
    }
    const pi = this.cell ? this.tableIndex(this.cell.table) : b.paragraphIndexAt(this.range()[0]);
    const s = b.sectionOf(Math.max(0, pi));
    return { id: s.id, props: fullSection(b.sectionDef(s.id)), index: s.index, count: b.sectionBreaks().length + 1 };
  }

  /** 캐럿이 든 구역의 설정을 바꾼다 (쪽 설정 대화상자). 그 구역부터 다시 조립. 실행 취소 한 단계 */
  setSectionProps(props: SectionProps): void {
    this.input.commitComposition();
    const before: Selection = { ...this.sel };
    const { id } = this.sectionInfo();
    const ops = this.body.setSection(id, props);
    if (!ops.length) return;
    this.history.seal();
    this.commitRaw(ops, before);
    this.history.seal();
  }

  /** 캐럿이 든 구역의 끝 구역 나눔을 지운다: 이 구역이 다음 구역에 합쳐지고 다음 구역의 설정이 남는다 (12 §3.1) */
  removeSectionBreak(): void {
    this.input.commitComposition();
    const b = this.body;
    const { index } = this.sectionInfo();
    const at = b.sectionBreaks()[index];
    if (at === undefined) return;
    const before: Selection = { ...this.sel };
    const ops = b.setParaAttr(at, 'section', undefined);
    if (!ops.length) return;
    this.history.seal();
    this.commitRaw(ops, before);
    this.history.seal();
  }

  /** 문단 스타일 정의를 바꾼다 (그 스타일을 쓰는 문단만 다시 조판). 실행 취소 한 단계 */
  setStyleDef(name: string, def: Style | undefined): void {
    this.input.commitComposition();
    const before: Selection = { ...this.sel };
    const ops = this.body.setStyle(name, def);
    if (ops.length === 0) return;
    this.history.seal();
    this.commitRaw(ops, before);
    this.history.seal();
  }

  /** 들여쓰기 한 단계 (±24pt, 왼쪽 들여쓰기만) */
  indent(dir: 1 | -1): void {
    const cur = this.doc.paraAttrs(this.selectedParagraphs()[0]).indent;
    const left = Math.max(0, (cur?.left ?? 0) + dir * 24000);
    const next = { ...cur, left };
    if (left === 0) delete (next as { left?: number }).left;
    this.setParagraphAttr('indent', hasKeys(next) ? next : undefined);
  }

  /**
   * 문단을 지우는 삭제 [from, to)의 뒤처리 (10 §2.2): 합친 문단은 남은 뒤 ¶의 속성을 갖는데, 사용자는 앞 문단 서식을 기대한다.
   * 앞 문단이 일부라도 남으면(from이 문단 첫머리가 아니면) 그 문단의 속성을 합친 문단에 복사하는 연산을 돌려준다.
   */
  private mergeKeepAttrs(from: number, to: number): (() => Op[]) | null {
    if (from === to || this.document.suggesting) return null; // 제안 모드는 ¶를 지우지 않는다
    const pi = this.doc.paragraphIndexAt(from);
    const p = this.doc.paragraphs()[pi]!;
    if (to <= p.end || from === p.start) return null;
    const keep = p.attrs;
    return () => {
      const cur = this.doc.paraAttrs(pi);
      const ops: Op[] = [];
      for (const k of new Set([...Object.keys(keep), ...Object.keys(cur)]) as Set<ParaKey>)
        ops.push(...this.doc.setParaAttr(pi, k, keep[k]));
      return ops;
    };
  }

  /** Enter (10 §2.2): 문단 끝에서 Enter면 다음 문단은 스타일의 next (제목 → 본문) */
  private insertParagraph(): void {
    if (this.extras.length) return this.insertAll('\n');
    // 빈 목록 항목에서 Enter: 수준을 올리고, 수준 0이면 목록을 끝낸다 (10 §2.4)
    const at = this.caretAtListStart();
    if (at?.empty) {
      this.outdentListItem(at.i, false);
      return;
    }
    const [from, to] = this.range();
    const pi = this.doc.paragraphIndexAt(from);
    const p = this.doc.paragraphs()[pi]!;
    const name = p.attrs.style;
    const next = from === to && from === p.end && name ? this.doc.style(name)?.next : undefined;
    const restyle = next !== undefined && next !== name;
    // 앞에서 쪽 나눔은 나뉜 앞쪽 문단에만 (뒤쪽이 또 새 쪽에서 시작하지 않게, 12 §4)
    const pbb = p.attrs.pageBreakBefore === true;
    const cbb = p.attrs.columnBreakBefore === true;
    this.replaceSelection('\n', undefined, restyle || pbb || cbb ? () => [
      ...(restyle ? this.doc.setParaAttr(pi + 1, 'style', next === BODY_STYLE ? undefined : next) : []),
      ...(pbb ? this.doc.setParaAttr(pi + 1, 'pageBreakBefore', undefined) : []),
      ...(cbb ? this.doc.setParaAttr(pi + 1, 'columnBreakBefore', undefined) : []),
    ] : undefined);
  }

  /** 보류 서식(캐럿에서 다음 입력이 받을 서식)의 번호. 지금 캐럿에 해당하지 않으면 undefined */
  private pendingFmt(): number | undefined {
    const pend = this.pending;
    if (!pend) return undefined;
    const { anchor, head } = this.selection();
    if (anchor !== head || head !== pend.at) return undefined;
    return this.doc.internMarks(pend.marks);
  }

  /** 선택 영역(없으면 캐럿에서 다음 입력)의 글자 서식. 툴바 상태용 (08 §2) */
  selectionMarks(): SelectionMarks {
    const [from, to] = this.range();
    if (from === to) {
      const marks = this.pending && this.pending.at === from ? this.pending.marks : this.doc.inheritedMarks(from);
      return { marks, mixed: new Set() };
    }
    const text = Array.from(this.doc.slice(from, to));
    const sets: MarkSet[] = [];
    for (const r of this.doc.markRuns(from, to)) {
      // ¶는 세지 않는다 (글자가 하나도 없으면 ¶라도)
      let hasChar = false;
      for (let o = r.from; o < r.to && !hasChar; o++) if (text[o - from] !== '\n') hasChar = true;
      if (hasChar) sets.push(r.marks);
    }
    if (sets.length === 0) sets.push(this.doc.marksAt(from));
    const marks: MarkSet = {};
    const mixed = new Set<MarkKey>();
    for (const k of MARK_KEYS) {
      const v = sets[0]![k];
      if (sets.every((m) => m[k] === v)) {
        if (v !== undefined) (marks as Record<string, unknown>)[k] = v;
      } else mixed.add(k);
    }
    return { marks, mixed };
  }

  /**
   * 글자 서식 키 하나를 value로 (undefined = 해제). 선택이 없으면 캐럿에서 다음 입력의 서식(보류 서식)을 바꾼다.
   * 실행 취소 한 단계 (연속 서식 변경은 묶지 않음, 10 §5).
   */
  setMark(key: MarkKey, value: unknown): void {
    this.input.commitComposition();
    if (this.extras.length) return this.formatAll((f, t) => this.doc.format(f, t, key, value));
    const [from, to] = this.range();
    if (from === to) {
      const base = this.selectionMarks().marks;
      const marks = { ...base } as Record<string, unknown>;
      if (value === undefined) delete marks[key];
      else marks[key] = value;
      this.pending = { at: from, marks: marks as MarkSet };
      this.render();
      this.opts.onChange?.(this);
      return;
    }
    const before: Selection = { ...this.sel };
    const ops = this.doc.format(from, to, key, value);
    if (ops.length === 0) return;
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
  }

  /** 다중 커서: 비지 않은 선택마다 서식 (캐럿은 그대로), 실행 취소 한 단계 */
  private formatAll(fn: (from: number, to: number) => Op[]): void {
    const before = this.fullSel();
    const ops: Op[] = [];
    for (const c of this.caretList()) if (c.anchor !== c.head) ops.push(...fn(Math.min(c.anchor, c.head), Math.max(c.anchor, c.head)));
    if (ops.length === 0) return;
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
  }

  /** 켜고 끄는 서식 (굵게·기울임·밑줄·취소선): 선택이 모두 켜져 있으면 끄고, 아니면 켠다 */
  toggleMark(key: 'bold' | 'italic' | 'underline' | 'strike'): void {
    const { marks, mixed } = this.selectionMarks();
    this.setMark(key, marks[key] && !mixed.has(key) ? undefined : true);
  }

  /** 위·아래 첨자 켜고 끄기 */
  toggleScript(script: 'sup' | 'sub'): void {
    const { marks, mixed } = this.selectionMarks();
    this.setMark('script', marks.script === script && !mixed.has('script') ? undefined : script);
  }

  /** 서식 지우기 (Ctrl+\): 선택의 글자 서식을 모두 해제 */
  clearMarks(): void {
    this.input.commitComposition();
    if (this.extras.length) return this.formatAll((f, t) => MARK_KEYS.flatMap((k) => this.doc.format(f, t, k, undefined)));
    const [from, to] = this.range();
    if (from === to) {
      this.pending = { at: from, marks: {} };
      this.render();
      this.opts.onChange?.(this);
      return;
    }
    const before: Selection = { ...this.sel };
    const ops: Op[] = [];
    for (const k of MARK_KEYS) ops.push(...this.doc.format(from, to, k, undefined));
    if (ops.length === 0) return;
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
  }

  /** 문단 손잡이(⋮⋮)와 끌어서 놓을 자리 표시 */
  private drawParagraphDrag(px: number, top: number): void {
    const { ctx, setup } = this;
    const layout = this.bodyLayout;
    const g = this.drag ? this.drag.i : this.hoverPara;
    if (g >= 0 && g < layout.validCount) {
      const ln = layout.paras[g]!.lines[0]!;
      const cx = px + layout.paras[g]!.frameLeft - (GRIP_LEFT + GRIP_RIGHT) / 2;
      const cy = ln.y - top + ln.height / 2;
      ctx.fillStyle = this.drag || this.hoverGrip ? this.colors.gripActive : this.colors.grip;
      for (let r = -1; r <= 1; r++) {
        for (const c of [-2.5, 2.5]) {
          ctx.beginPath();
          ctx.arc(cx + c, cy + r * 5, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (!this.drag || this.drag.to < 0) return;
    const n = this.body.paragraphs().length;
    const to = this.drag.to;
    let yLine: number;
    if (to < n) {
      if (to >= layout.validCount) return;
      yLine = layout.paras[to]!.lines[0]!.y - setup.paraSpacing / 2;
    } else {
      if (n - 1 >= layout.validCount) return;
      yLine = layout.paras[n - 1]!.bottom + setup.paraSpacing / 2;
    }
    const at = layout.paras[Math.min(to, n - 1)]!;
    const x = px + at.frameLeft - 8;
    const y = yLine - top;
    ctx.fillStyle = this.colors.dropLine;
    ctx.fillRect(x, y - 1, at.width + 16, 2);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 다른 사용자의 캐럿과 이름표. 화면에 보이는 문단에 있는 것만 */
  /**
   * 스토리의 레이아웃 (원격 캐럿·따라가기, 14 §7): 표 셀은 셀 레이아웃, 각주는 그 쪽의 각주 자리, 머리말·꼬리말은 page 쪽(없으면 그 스토리를
   * 그리는 첫 쪽). 지금 그려지지 않으면 null
   */
  private storyLayoutFor(story: string, page?: number): { caretRect(o: number): { x: number; y: number; height: number } } | null {
    try {
      if (story.startsWith('fn|')) {
        const id = story.slice(3);
        if (!this.fmt.noteNumber(id)) return null;
        const s = this.noteSlots(this.notePageOf(id)).find((x) => x.id === id);
        return s ? this.noteLayout(s) : null;
      }
      if (isHFStory(story)) {
        const part = story.startsWith('hdr') ? 'header' : 'footer';
        const L = this.bodyLayout;
        let p = page !== undefined && page < L.pageCount ? page : this.hfPageOf(story, part);
        if (p < 0) return null;
        let info = pageHF(this.fmt, L, p, this.today);
        if ((part === 'header' ? info.header.story : info.footer.story) !== story) {
          p = this.hfPageOf(story, part);
          if (p < 0) return null;
          info = pageHF(this.fmt, L, p, this.today);
        }
        return layoutHF(this.fmt, (id) => this.document.story(id), info, part, null) ?? null;
      }
      return this.fmt.tables.cells.get(story)?.view ?? null;
    } catch {
      return null;
    }
  }

  /** 원격 캐럿의 자리 (문서 좌표) */
  private remoteRect(rc: RemoteCaret): { x: number; y: number; height: number } | null {
    if (rc.story) {
      const L = this.storyLayoutFor(rc.story, rc.page);
      if (!L) return null;
      return L.caretRect(Math.min(rc.head, this.document.story(rc.story).maxCaret));
    }
    return this.bodyLayout.caretRect(Math.min(rc.head, this.body.maxCaret));
  }

  /** 따라가는 원격 피어 (그 캐럿이 움직일 때마다 스크롤) */
  private following: string | null = null;

  /** 원격 피어의 캐럿으로 스크롤한다 (접속자 목록에서 누름, 14 §7) */
  revealRemote(key: string): boolean {
    const rc = this.remotes.find((r) => r.key === key);
    const r = rc ? this.remoteRect(rc) : null;
    if (!r) return false;
    const sc = this.scroller;
    if (r.y < sc.scrollTop + 40 || r.y + r.height > sc.scrollTop + sc.clientHeight - 40) sc.scrollTop = Math.max(0, r.y - sc.clientHeight / 3);
    this.scheduleRender();
    return true;
  }

  /** 따라가기 (null이면 그만) */
  follow(key: string | null): void {
    this.following = key;
    if (key) this.revealRemote(key);
  }

  get followingKey(): string | null {
    return this.following;
  }

  private drawRemoteCarets(px: number, top: number, w: number, visible: Set<number>): void {
    if (this.remotes.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.font = `600 11px ${this.font.replace(/^\d+px /, '')}`;
    ctx.textBaseline = 'middle';
    for (const rc of this.remotes) {
      let r: { x: number; y: number; height: number } | null;
      if (rc.story) {
        // 다른 스토리 (셀·머리말·각주): 그 스토리 레이아웃 자리, 화면 안일 때만
        r = this.remoteRect(rc);
        if (!r || r.y + r.height < top || r.y > top + this.scroller.clientHeight) continue;
      } else {
        const head = Math.min(rc.head, this.body.maxCaret);
        if (!visible.has(this.body.paragraphIndexAt(head))) continue;
        r = this.bodyLayout.caretRect(head);
      }
      const x = Math.round(px + r.x);
      const y = r.y - top;
      ctx.fillStyle = rc.color;
      ctx.fillRect(x - 1, y + 2, 2, r.height - 4);
      // 이름표: 캐럿 위 (위에 자리가 없으면 아래)
      const tw = ctx.measureText(rc.name).width + 8;
      const th = 16;
      const ly = y - th + 2 >= 0 ? y - th + 2 : y + r.height - 2;
      const lx = Math.min(x - 1, w - tw - 2);
      ctx.fillRect(lx, ly, tw, th);
      ctx.fillStyle = readableOn(rc.color);
      ctx.fillText(rc.name, lx + 4, ly + th / 2 + 0.5);
    }
    ctx.restore();
  }

  /** 선택 영역이 바뀌었으면 알린다 (원격 편집으로 오프셋만 바뀐 것은 알리지 않음: 공유 위치가 따라간다) */
  private reportSelection(): void {
    if (this.sel === this.reportedSel) return;
    if (this.listeners.get('selection')?.size) {
      this.reportedSel = this.sel;
      this.emit('selection');
    }
    if (!this.opts.onSelectionChange) return;
    this.reportedSel = this.sel;
    // 셀·머리말·각주는 그 스토리의 오프셋과 스토리 (14 §7)
    const { anchor, head } = this.selection();
    const story = this.storyId;
    if (story === null) this.opts.onSelectionChange(anchor, head);
    else this.opts.onSelectionChange(anchor, head, story, this.hf?.page);
  }

  /** 아직 배치되지 않은 영역: 쪽 위에 옅은 막과 진행률을 그린다 */
  private drawPendingPlaceholder(px: number, top: number, w: number, h: number): void {
    const { ctx, setup } = this;
    const layout = this.bodyLayout;
    const from = Math.max(0, layout.validBottom - top);
    if (from >= h) return;
    ctx.fillStyle = this.colors.placeholder;
    ctx.fillRect(px, from, setup.width, h - from);
    const total = this.body.paragraphs().length;
    const pct = total ? Math.floor((layout.validCount / total) * 100) : 100;
    ctx.fillStyle = this.colors.placeholderText;
    ctx.font = this.font;
    ctx.textAlign = 'center';
    ctx.fillText(this.t('layout.progress', { percent: pct }), Math.min(px + setup.width / 2, w / 2), Math.max(from, 0) + (h - from) / 2);
    ctx.textAlign = 'start';
  }

  private updateCaret(): void {
    const head = this.headOffset();
    const r = this.layout.caretRect(head);
    const x = this.pageLeft() + r.x;
    const { anchor } = this.selection();
    const collapsed = anchor === head;
    const show = this.focused && (collapsed || this.preedit !== '');
    Object.assign(this.caretEl.style, {
      display: show ? 'block' : 'none',
      left: `${x}px`,
      top: `${r.y + 3}px`,
      height: `${r.height - 6}px`,
    });
    // 깜박임 재시작
    if (this.blink) this.blink.currentTime = 0;
    this.input.place(x, r.y, r.height);
    if (this.input.sync && !this.input.composing) {
      // 캐럿이 있는 문단을 입력 층에 (IME 재변환·문맥용, 03 §2)
      const paras = this.doc.paragraphs();
      const p = paras[this.doc.paragraphIndexAt(head)];
      if (p) {
        const clamp = (o: number) => Math.max(p.start, Math.min(p.end, o)) - p.start;
        this.input.sync(p.text, p.start, clamp(anchor), clamp(head));
      }
    }
  }

  private updateMirror(paras: Set<number>): void {
    const body = this.body;
    const infos = [...paras].sort((a, b) => a - b).map((p) => body.paragraphs()[p]).filter((p) => p !== undefined);
    const key = infos
      .map((p) => {
        const t = p.objs?.get(0)?.table;
        if (t) return `table\u0004${this.mirrorTableKey(t)}`;
        return `${p.attrs.style ?? ''}\u0002${body.listLabel(p)?.text ?? ''}\u0003${p.fmt ? `${p.text}\u0001${p.fmt.join(',')}` : p.text}`;
      })
      .join('\n') + (this.spellP ? `\u0005${this.spellP.session.version}` : '');
    if (this.mirror.dataset.key === key) return;
    this.mirror.dataset.key = key;
    // 목록 문단은 같은 목록이 이어지는 동안 ul/ol 하나에 li로. 번호는 글자로 앞에 붙인다 (화면과 같은 번호를 읽게)
    const out: HTMLElement[] = [];
    let group: { id: string; el: HTMLElement } | null = null;
    for (const info of infos) {
      const t = info.objs?.get(0)?.table;
      if (t) {
        group = null;
        out.push(this.mirrorTable(t));
        continue;
      }
      const label = body.listLabel(info);
      if (!label) {
        group = null;
        out.push(this.mirrorPara(info));
        continue;
      }
      if (!group || group.id !== label.def.id) {
        group = { id: label.def.id, el: document.createElement(label.def.kind === 'bullet' ? 'ul' : 'ol') };
        out.push(group.el);
      }
      const li = this.mirrorPara(info, 'li');
      li.setAttribute('aria-level', String(label.level + 1));
      if (label.def.kind === 'number') li.prepend(`${label.text} `);
      group.el.append(li);
    }
    this.mirror.replaceChildren(...out);
  }

  /** 표의 미러 키 (셀 글이 바뀌면 다시 만든다) */
  private mirrorTableKey(id: string): string {
    const v = this.fmt.tableViews.get(id);
    if (!v) return id;
    return v.grid.cells.map((row) => row.map((c) => (c ? `${c.span}:${this.document.story(c.story).version}` : '-')).join(',')).join(';');
  }

  /** 표의 미러 (04 §3, 11 §7): table/tr/td, 병합은 rowspan·colspan */
  private mirrorTable(id: string): HTMLElement {
    const v = this.fmt.tableViews.get(id);
    const table = document.createElement('table');
    if (!v) return table;
    for (const row of v.grid.cells) {
      const tr = document.createElement('tr');
      for (const c of row) {
        if (!c) continue;
        const td = document.createElement('td');
        if (c.span[0] > 1) td.rowSpan = c.span[0];
        if (c.span[1] > 1) td.colSpan = c.span[1];
        for (const sid of [c.story, ...c.covered]) {
          const d = this.document.story(sid);
          if (sid !== c.story && isEmptyDoc(d)) continue;
          for (const info of d.paragraphs()) td.append(this.mirrorPara(info as ParagraphInfo, undefined, d));
        }
        tr.append(td);
      }
      table.append(tr);
    }
    return table;
  }

  /** 문단 하나의 미러 요소 */
  private mirrorPara(info: ParagraphInfo, forceTag?: string, doc: Doc = this.body): HTMLElement {
    // 제목·인용은 h1–h3·blockquote로 (04 §3): 스크린리더가 구조를 읽는다
    const tag = forceTag ?? ({ h1: 'h1', h2: 'h2', h3: 'h3', quote: 'blockquote' } as Record<string, string>)[info.attrs.style ?? ''] ?? 'p';
    const p = document.createElement(tag);
    // 맞춤법 오류 (15 §4.3): aria-invalid를 붙인 span (서식 없는 문단만)
    const issues = this.spellP?.session.issuesFor(info.text);
    if (!info.fmt && !info.objs && issues?.length) {
      const cps = Array.from(info.text);
      let k = 0;
      for (const i of issues) {
        if (i.from < k) continue;
        if (i.from > k) p.append(cps.slice(k, i.from).join(''));
        const span = document.createElement('span');
        span.setAttribute('aria-invalid', i.kind === 'spelling' ? 'spelling' : 'grammar');
        span.textContent = cps.slice(i.from, i.to).join('');
        p.append(span);
        k = i.to;
      }
      if (k < cps.length) p.append(cps.slice(k).join(''));
      return p;
    }
    if (!info.fmt && !info.objs) {
      p.textContent = info.text;
      return p;
    }
    // 굵게·기울임은 strong·em으로 (04 §3, 10 §4)
    const cps = Array.from(info.text);
    const fmt = info.fmt ?? new Uint16Array(cps.length);
    let k = 0;
    while (k < cps.length) {
      // 이미지: 대체 텍스트를 읽는 img (11 §7)
      const o = info.objs?.get(k);
      if (o) {
        const img = document.createElement('span');
        img.setAttribute('role', 'img');
        img.setAttribute('aria-label', o.alt || this.t('a11y.image'));
        p.append(img);
        k++;
        continue;
      }
      let j = k + 1;
      while (j < cps.length && fmt[j] === fmt[k] && !info.objs?.has(j)) j++;
      const m = doc.markSet(fmt[k]!);
      let node: Node = document.createTextNode(cps.slice(k, j).join(''));
      if (m.italic) {
        const em = document.createElement('em');
        em.append(node);
        node = em;
      }
      if (m.bold) {
        const strong = document.createElement('strong');
        strong.append(node);
        node = strong;
      }
      p.append(node);
      k = j;
    }
    return p;
  }

  private scrollCaretIntoView(): void {
    const r = this.layout.caretRect(this.headOffset());
    const s = this.scroller;
    const pad = r.height;
    if (r.y - pad < s.scrollTop) s.scrollTop = Math.max(0, r.y - pad);
    else if (r.y + r.height + pad > s.scrollTop + s.clientHeight) {
      s.scrollTop = r.y + r.height + pad - s.clientHeight;
    }
  }

  // ── 선택 도우미 ───────────────────────────────────────

  private headOffset(): number {
    return this.doc.resolve(this.sel.head);
  }

  private range(): [number, number] {
    const { anchor, head } = this.selection();
    return [Math.min(anchor, head), Math.max(anchor, head)];
  }

  private setSelection(anchor: number, head: number = anchor, keepGoal = false): void {
    const max = this.doc.maxCaret;
    anchor = Math.max(0, Math.min(max, anchor));
    head = Math.max(0, Math.min(max, head));
    const story = this.storyId;
    this.sel = { anchor: this.doc.positionAt(anchor), head: this.doc.positionAt(head), ...(story ? { story } : {}) };
    if (!keepGoal) this.goalX = null;
    this.cellSel = null;
    this.extras = [];
    if (this.pending && (anchor !== head || head !== this.pending.at)) this.pending = null;
  }

  // ── 편집 ──────────────────────────────────────────────

  /** 선택 영역을 지우고 텍스트를 넣는다. 결과를 트랜잭션 하나로 기록 */
  private replaceSelection(text: string, mergeKey?: string, extra?: () => Op[]): void {
    if (this.extras.length) return this.insertAll(text, mergeKey);
    const before: Selection = { ...this.sel };
    const [from, to] = this.range();
    const ops: Op[] = [];
    const merge = this.mergeKeepAttrs(from, to);
    if (from !== to) {
      ops.push(...this.doc.deleteRange(from, to));
      mergeKey = undefined;
    }
    if (merge) ops.push(...merge());
    const marks = this.pending && this.pending.at === from ? this.pending.marks : undefined;
    if (text) ops.push({ type: 'insert', ids: this.doc.insertText(from, text, marks) });
    if (text) this.pending = null;
    const caret = from + Array.from(text.replace(/\r\n?/g, '\n')).length;
    if (extra) {
      ops.push(...extra());
      mergeKey = undefined;
    }
    this.setSelection(caret);
    this.commit(ops, before, mergeKey);
  }

  private deleteRange(from: number, to: number, mergeKey?: string, forward = false): void {
    if (from === to) return;
    const before: Selection = { ...this.sel };
    const merge = this.mergeKeepAttrs(from, to);
    const ops = this.doc.deleteRange(from, to);
    if (merge) {
      ops.push(...merge());
      mergeKey = undefined;
    }
    // 제안 모드: 지운 글자가 남으므로 앞으로 지우기는 그 뒤로 (다음 Delete가 다음 글자를 지우게)
    this.setSelection(forward && this.document.suggesting ? this.document.suggestDeleteEnd : from);
    this.commit(ops, before, mergeKey);
  }

  /** 선택 영역이 걸친 문단들. [첫 문단, 끝 문단] (화면 인덱스) */
  private selectedParagraphs(): [number, number] {
    const [from, to] = this.range();
    return [this.doc.paragraphIndexAt(from), this.doc.paragraphIndexAt(to)];
  }

  /** 모든 캐럿이 걸친 문단 번호 (다중 커서의 문단 속성) */
  private caretParagraphs(): number[] {
    const set = new Set<number>();
    for (const c of this.caretList()) {
      const a = this.doc.paragraphIndexAt(Math.min(c.anchor, c.head));
      const b = this.doc.paragraphIndexAt(Math.max(c.anchor, c.head));
      for (let k = a; k <= b; k++) set.add(k);
    }
    return [...set].sort((x, y) => x - y);
  }

  /** 선택한 문단들을 한 칸 위(-1)/아래(+1)로 옮긴다. 글자는 그대로, 구획 순서만 바뀐다 */
  private moveParagraphs(dir: -1 | 1): void {
    const [i, j] = this.selectedParagraphs();
    const n = this.doc.paragraphs().length;
    if (dir < 0 ? i === 0 : j === n - 1) return;
    const before: Selection = { ...this.sel };
    const ops = this.doc.moveParagraphs(i, j, dir < 0 ? i - 1 : j + 2);
    // 선택 영역은 원소 ID 기준이므로 옮겨진 문단을 그대로 따라간다
    this.history.seal();
    this.commit(ops, before);
  }

  /** 선택한 문단들을 삭제(숨김)한다 */
  private deleteParagraphs(): void {
    const [i, j] = this.selectedParagraphs();
    const before: Selection = { ...this.sel };
    const ops = this.doc.hideParagraphs(i, j);
    if (ops.length === 0) return;
    // 캐럿은 다음 문단(없으면 앞 문단) 시작으로
    const paras = this.doc.paragraphs();
    const k = Math.min(i, paras.length - 1);
    this.setSelection(paras[k]!.start);
    this.history.seal();
    this.commit(ops, before);
  }

  // ── 다중 커서 (11 §5.2) ───────────────────────────────

  /** 모든 캐럿 (첫 캐럿 먼저), 오프셋 */
  private caretList(): Array<{ anchor: number; head: number; primary: boolean }> {
    const d = this.doc;
    const out = [{ ...this.selection(), primary: true }];
    for (const e of this.extras) out.push({ anchor: d.resolve(e.anchor), head: d.resolve(e.head), primary: false });
    return out;
  }

  /** 캐럿 수 (상태 표시) */
  get caretCount(): number {
    return 1 + this.extras.length;
  }

  /** 기록용 선택: 첫 캐럿 + 다른 캐럿 */
  private fullSel(): Selection {
    return this.extras.length ? { ...this.sel, more: this.extras.map((e) => ({ ...e })) } : { ...this.sel };
  }

  /**
   * 캐럿들을 정한다 (오프셋). 겹치거나 같은 자리의 캐럿은 합친다 (첫 캐럿이 남는다). 상한 MAX_CARETS개.
   * primary: list 안 첫 캐럿의 번호
   */
  private setCarets(list: Array<{ anchor: number; head: number }>, primary = 0, keepGoal = false): void {
    const max = this.doc.maxCaret;
    const items = list.map((c, k) => ({
      anchor: Math.max(0, Math.min(max, c.anchor)),
      head: Math.max(0, Math.min(max, c.head)),
      primary: k === primary,
    }));
    items.sort((a, b) => Math.min(a.anchor, a.head) - Math.min(b.anchor, b.head));
    const merged: typeof items = [];
    for (const it of items) {
      const last = merged[merged.length - 1];
      const from = Math.min(it.anchor, it.head);
      if (last && from <= Math.max(last.anchor, last.head) && (from < Math.max(last.anchor, last.head) || it.anchor === it.head || last.anchor === last.head)) {
        // 겹침: 하나로 (방향은 앞 것)
        const lo = Math.min(last.anchor, last.head, from);
        const hi = Math.max(last.anchor, last.head, it.anchor, it.head);
        const fwd = last.head >= last.anchor;
        last.anchor = fwd ? lo : hi;
        last.head = fwd ? hi : lo;
        last.primary = last.primary || it.primary;
      } else merged.push(it);
    }
    const p = merged.find((m) => m.primary) ?? merged[0]!;
    this.setSelection(p.anchor, p.head, keepGoal);
    this.extras = merged
      .filter((m) => m !== p)
      .slice(0, MAX_CARETS - 1)
      .map((m) => ({ anchor: this.doc.positionAt(m.anchor), head: this.doc.positionAt(m.head) }));
  }

  /** 캐럿 하나 더하기 (Alt+누르기, Ctrl+Alt+↑/↓) */
  addCaret(offset: number): void {
    const list = this.caretList();
    if (list.length >= MAX_CARETS) return;
    const k = list.findIndex((c) => c.primary);
    this.setCarets([...list, { anchor: offset, head: offset }], k);
    this.history.seal();
    this.render();
    this.opts.onChange?.(this);
  }

  /** Ctrl+Alt+↑/↓: 가장 위(아래) 캐럿의 위(아래) 줄 같은 x에 캐럿 */
  private addCaretVertical(dir: -1 | 1): void {
    const list = this.caretList();
    const edge = list.reduce((a, b) => ((dir < 0 ? b.head < a.head : b.head > a.head) ? b : a));
    const r = this.layout.caretRect(edge.head);
    const t = this.layout.stepLine(r.ref, dir);
    if (!t) return;
    const x = this.goalX ?? this.layout.caretRect(this.headOffset()).x;
    this.addCaret(this.layout.offsetInLine(t, x));
    this.goalX = x;
  }

  /**
   * 모든 캐럿에서 편집 (뒤 캐럿부터: 앞 캐럿 오프셋이 그대로 맞는다). fn이 null이면 그 캐럿은 그대로.
   * 트랜잭션 하나로 기록한다
   */
  private editAll(fn: (from: number, to: number) => { ops: Op[]; caret: number } | null, mergeKey?: string): void {
    const before = this.fullSel();
    const list = this.caretList();
    const order = list.map((c, k) => ({ ...c, k })).sort((a, b) => Math.min(b.anchor, b.head) - Math.min(a.anchor, a.head));
    const ops: Op[] = [];
    const out: Array<{ a: Position; h: Position }> = [];
    // 문단 시작 옮기기는 끝에 한 번 (Doc.batch)
    this.doc.batch(() => {
      for (const c of order) {
        const from = Math.min(c.anchor, c.head);
        const to = Math.max(c.anchor, c.head);
        const r = fn(from, to);
        if (r) {
          ops.push(...r.ops);
          const pos = this.doc.positionAt(r.caret);
          out[c.k] = { a: pos, h: pos };
        } else out[c.k] = { a: this.doc.positionAt(c.anchor), h: this.doc.positionAt(c.head) };
      }
    });
    this.pending = null;
    if (ops.length === 0) return;
    // 위치는 원소 기준이라 다른 캐럿 편집 뒤에도 맞다. 오프셋으로 풀어 합치기·정렬
    const d = this.doc;
    this.setCarets(out.map((o) => ({ anchor: d.resolve(o.a), head: d.resolve(o.h) })), 0);
    this.commit(ops, before, mergeKey);
  }

  /** 모든 캐럿에 글 넣기 (선택은 바꾼다) */
  private insertAll(text: string, mergeKey?: string): void {
    const n = Array.from(text.replace(/\r\n?/g, '\n')).length;
    this.editAll((from, to) => {
      const ops: Op[] = from !== to ? this.doc.deleteRange(from, to) : [];
      ops.push({ type: 'insert', ids: this.doc.insertText(from, text) });
      return { ops, caret: from + n };
    }, mergeKey);
  }

  /** 모든 캐럿에서 지우기: 선택이면 선택, 아니면 앞(dir < 0)·뒤 글자 (word면 단어) */
  private deleteAll(dir: -1 | 1, word: boolean): void {
    this.editAll((from, to) => {
      const d = this.doc;
      if (from === to) {
        if (dir < 0 && from === 0) return null;
        if (dir > 0 && from >= d.maxCaret) return null;
        const o = word ? this.wordBoundary(from, dir) : this.graphemeStep(from, dir);
        [from, to] = dir < 0 ? [o, from] : [from, o];
        if (from === to) return null;
      }
      return { ops: d.deleteRange(from, to), caret: from };
    }, from0Key(dir, word));
  }

  /** 모든 캐럿을 옮긴다 (extend면 선택을 늘린다) */
  private moveAll(step: (head: number) => number, extend: boolean): void {
    const list = this.caretList();
    const k = list.findIndex((c) => c.primary);
    this.setCarets(
      list.map((c) => {
        const h = step(c.head);
        return { anchor: extend ? c.anchor : h, head: h };
      }),
      k,
    );
    this.history.seal();
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  /** 다음·이전 grapheme 경계 (레이아웃 없이: 여러 캐럿을 편집하는 동안 레이아웃은 낡았다) */
  private graphemeStep(offset: number, dir: -1 | 1): number {
    const d = this.doc;
    const p = d.paragraphs()[d.paragraphIndexAt(offset)]!;
    const k = offset - p.start;
    const n = Array.from(p.text).length;
    if (dir < 0 && k === 0) return offset - 1; // 앞 문단 ¶
    if (dir > 0 && k >= n) return offset + 1; // 이 문단 ¶
    let cp = 0;
    for (const seg of graphemes.segment(p.text)) {
      const end = cp + Array.from(seg.segment).length;
      if (dir < 0 && end >= k) return p.start + cp;
      if (dir > 0 && end > k) return p.start + end;
      cp = end;
    }
    return p.start + (dir < 0 ? 0 : n);
  }

  /** 다른 캐럿을 그린다 (첫 캐럿은 DOM 캐럿). 조합 중이면 조합 문자열을 흐리게 미리 보인다 */
  private drawExtraCarets(px: number, top: number, h: number): void {
    if (!this.extras.length) return;
    const { ctx } = this;
    const d = this.doc;
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    for (const e of this.extras) {
      const head = d.resolve(e.head);
      const r = this.layout.caretRect(head);
      const y = r.y - top;
      if (y > h || y + r.height < 0) continue;
      if (this.preedit) {
        ctx.globalAlpha = 0.45;
        ctx.font = this.font;
        ctx.fillStyle = this.colors.text;
        const ln = this.layout.line(r.ref);
        ctx.fillText(this.preedit, px + r.x, ln.baseline - top);
        const w = ctx.measureText(this.preedit).width;
        ctx.fillRect(px + r.x, y + r.height - 5, w, 1.5);
        ctx.globalAlpha = 1;
      }
      if (this.focused) {
        ctx.fillStyle = this.colors.text;
        ctx.fillRect(Math.round(px + r.x), y + 3, 2, r.height - 6);
      }
    }
    ctx.restore();
  }

  /** 편집 중인 스토리의 연산을 기록한다 (셀이면 스토리로 감싼다, 11 §2.5) */
  private commit(ops: Op[], before: Selection, mergeKey?: string): void {
    // 편집으로 같은 종류 목록이 붙었으면 한 목록으로 (같은 실행 취소 단계)
    const join = ops.length ? this.joinTouchingLists() : [];
    if (join.length) {
      ops = [...ops, ...join];
      mergeKey = undefined;
    }
    const story = this.storyId;
    // 제안 모드 (14 §4): 넣은 글자·서식·문단 속성을 제안으로 표시한다 (지우기는 Doc의 삭제 갈고리가 이미 표시했다)
    if (this.document.suggesting) ops = [...ops, ...this.document.recordSuggestions(story, this.doc, ops)];
    this.commitRaw(story ? Document.tag(story, ops) : ops, before, mergeKey);
  }

  /**
   * 캐럿 둘레(캐럿들이 걸친 문단 ± 1)에서 붙은 목록을 하나로 합친다 (Word·Google Docs처럼 "붙으면 한 목록"):
   * 목록 문단이 끊기지 않고 이어지는 곳에서, 같은 종류(번호·글머리)인데 다른 목록이면 뒤 목록의 이어진 문단들을 앞 목록 id로 바꾼다.
   * 그래서 나중에 사이에 보통 문단이 끼거나 한 항목의 번호를 풀어도 번호가 이어진다. 화면 번호는 numberLists가 붙은 목록을 이미
   * 잇는다 (원격 편집·문단 이동도). 이것은 그 이음을 문서에 남긴다
   */
  private joinTouchingLists(): Op[] {
    const d = this.doc;
    const ps = this.caretParagraphs();
    if (!ps.length) return [];
    const n = d.paragraphs().length;
    const lo = Math.max(1, ps[0]! - 1);
    const hi = Math.min(n, ps[ps.length - 1]! + 2);
    const kind = (k: number) => {
      const li = d.paraAttrs(k).list;
      return li ? (d.listDef(li.id)?.kind ?? null) : null;
    };
    const ops: Op[] = [];
    for (let k = lo; k < hi; k++) {
      const b = d.paraAttrs(k).list;
      const bk = kind(k);
      if (!b || !bk) continue;
      // 이어진 목록 문단들에서 가장 가까운 같은 종류 문단
      let a: { id: string } | undefined;
      for (let m = k - 1; m >= 0 && kind(m); m--)
        if (kind(m) === bk) {
          a = d.paraAttrs(m).list;
          break;
        }
      if (!a || a.id === b.id) continue;
      for (let m = k; m < n && kind(m); m++) {
        const li = d.paraAttrs(m).list!;
        if (li.id === b.id) ops.push(...d.setParaAttr(m, 'list', { id: a.id, level: li.level }));
      }
    }
    return ops;
  }

  /** 문서 연산 그대로 기록 (본문 연산, 표 레코드 연산, 이미 감싼 스토리 연산) */
  private commitRaw(ops: Op[], before: Selection, mergeKey?: string): void {
    if (this.readOnly || (this.role !== 'edit' && !this.commentCommit)) {
      // 읽기 전용 (보기 모드 최종본·원본): 명령이 바꾼 것을 바로 되돌린다 (모든 편집 경로가 여기를 지난다)
      for (const op of [...ops].reverse()) this.document.apply(invertOp(op));
      this.sel = before;
      this.afterChange();
      return;
    }
    this.history.record({ ops, before, after: this.fullSel(), mergeKey, time: Date.now() });
    this.afterChange();
  }

  private afterChange(): void {
    this.relayout();
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
    this.emit('change');
  }

  private moveTo(offset: number, extend: boolean, keepGoal = false): void {
    if (this.inBody && !extend) {
      const t = this.tableAtOffset(offset);
      if (t && this.enterTableEdge(t, offset < this.headOffset() ? 'last' : 'first', null)) {
        this.history.seal();
        this.scrollCaretIntoView();
        this.render();
        this.opts.onChange?.(this);
        return;
      }
    }
    const { anchor } = this.selection();
    this.setSelection(extend ? anchor : offset, offset, keepGoal);
    this.history.seal();
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  /** 실행 취소 */
  undo(): void {
    this.input.commitComposition();
    const sel = this.history.undo(this.document);
    if (sel) this.restoreSelection(sel);
  }

  /** 다시 실행 */
  redo(): void {
    this.input.commitComposition();
    const sel = this.history.redo(this.document);
    if (sel) this.restoreSelection(sel);
  }

  /** 실행 취소가 돌려준 선택: 그 스토리(셀)로 옮겨 간다. 셀이 사라졌으면 relayout이 표 뒤 본문으로 내보낸다 */
  private restoreSelection(sel: Selection): void {
    this.cellSel = null;
    this.pending = null;
    if (sel.story && isNoteStory(sel.story)) {
      // 각주: 그 각주가 놓인 쪽으로
      this.cell = null;
      this.hf = null;
      if (this.note?.story !== sel.story) {
        const id = sel.story.slice(3);
        this.note = { story: sel.story, id, page: this.notePageOf(id), bodySel: this.note?.bodySel ?? this.bodyStart() };
      }
      this.doc = this.document.story(sel.story);
    } else if (sel.story && isHFStory(sel.story)) {
      // 머리말·꼬리말: 그 스토리를 그리는 쪽으로 (지금 편집 중인 쪽이면 그대로)
      this.cell = null;
      this.note = null;
      if (this.hf?.story !== sel.story) {
        const part: HFPart = sel.story.startsWith('hdr|') ? 'header' : 'footer';
        this.hf = { story: sel.story, part, page: Math.max(0, this.hfPageOf(sel.story, part)), bodySel: this.hf?.bodySel ?? this.bodyStart() };
      }
      this.doc = this.document.story(sel.story);
    } else if (sel.story) {
      const [table, row, col] = sel.story.split('|') as [string, string, string];
      this.hf = null;
      this.note = null;
      this.cell = { table, row, col, story: sel.story };
      this.doc = this.document.story(sel.story);
    } else if (!this.inBody) {
      this.cell = null;
      this.hf = null;
      this.note = null;
      this.doc = this.body;
      this.layout = this.bodyLayout;
    }
    this.sel = { anchor: sel.anchor, head: sel.head, ...(sel.story ? { story: sel.story } : {}) };
    this.extras = sel.more ? sel.more.map((e) => ({ ...e })) : [];
    this.afterChange();
  }

  // ── 표 (11 §2.4, §4.3, §5.4) ──────────────────────────

  /** 본문에서 표 문단 번호 (없으면 -1) */
  private tableIndex(id: string): number {
    const body = this.body;
    const v = this.fmt.tableViews.get(id);
    if (v) {
      const i = body.paragraphIndexAt(body.resolve(v.at));
      if (body.paragraphs()[i]?.objs?.get(0)?.table === id) return i;
    }
    return body.paragraphs().findIndex((q) => q.objs?.get(0)?.table === id);
  }

  /** 바뀐 표 (레코드가 바뀐 표, 편집 중인 셀의 표, 원격 변경이면 모든 표)의 표 문단을 다시 조판하게 한다 */
  private touchTables(): void {
    const ids = new Set(this.document.takeDirtyTables());
    if (this.cell) ids.add(this.cell.table);
    if (this.tablesAllDirty) {
      for (const id of this.fmt.tableViews.keys()) ids.add(id);
      this.tablesAllDirty = false;
    }
    for (const id of ids) {
      const i = this.tableIndex(id);
      if (i >= 0) this.body.touchParagraph(i);
    }
  }

  /** 표 문단 (본문 레이아웃에 놓은 것). 표 레코드가 없거나 비었으면 null */
  private locateTable(id: string): { index: number; para: PlacedPara; view: TableView } | null {
    const index = this.tableIndex(id);
    if (index < 0) return null;
    const para = this.bodyLayout.para(index);
    const view = this.fmt.tableViews.get(id);
    return para.layout.table && view ? { index, para, view } : null;
  }

  /** 표 원소의 본문 오프셋 (프레즌스·캐럿 내보내기) */
  private tableOffset(id: string): number | null {
    const i = this.tableIndex(id);
    return i < 0 ? null : this.body.paragraphs()[i]!.start;
  }

  /** 격자 (y, x)를 덮는 셀과 그 왼쪽 위 자리 */
  private ownerAt(v: TableView, y: number, x: number): { cell: NonNullable<TableGrid['cells'][0][0]>; y: number; x: number } | null {
    for (let yy = y; yy >= 0; yy--)
      for (let xx = x; xx >= 0; xx--) {
        const c = v.grid.cells[yy]?.[xx];
        if (c && yy + c.span[0] > y && xx + c.span[1] > x) return { cell: c, y: yy, x: xx };
      }
    return null;
  }

  /** 스토리가 주인인 셀의 격자 자리 */
  private cellPos(v: TableView, story: string): { cell: NonNullable<TableGrid['cells'][0][0]>; y: number; x: number } | null {
    for (let y = 0; y < v.grid.cells.length; y++) {
      const row = v.grid.cells[y]!;
      for (let x = 0; x < row.length; x++) if (row[x]?.story === story) return { cell: row[x]!, y, x };
    }
    return null;
  }

  /** 편집 중인 셀의 레이아웃을 붙인다 (셀 원점을 맞춘다). 셀이 사라졌으면 표 뒤 본문으로 나온다 */
  private attachActive(): void {
    const a = this.cell!;
    const loc = this.locateTable(a.table);
    if (!loc || !this.cellPos(loc.view, a.story)) {
      this.leaveTable(loc ? loc.index : this.tableIndex(a.table), 1);
      return;
    }
    this.fmt.tables.place(loc.view.input, loc.view.measure, loc.para.lines);
    this.layout = this.fmt.tables.cells.get(a.story)!.view;
  }

  /** 셀 편집을 끝내고 본문으로 (선택은 본문 처음: 부르는 쪽이 정한다) */
  private leaveCell(): void {
    if (!this.cell) return;
    this.input.commitComposition();
    this.cell = null;
    this.extras = [];
    this.doc = this.body;
    this.layout = this.bodyLayout;
    this.pending = null;
    this.setSelection(0);
  }

  /** 표 밖 본문으로: dir < 0이면 표 앞 문단 끝, 아니면 표 뒤 문단 처음 (그 문단도 표면 그 표로) */
  private leaveTable(index: number, dir: number, goalX: number | null = null): void {
    this.leaveCell();
    const paras = this.body.paragraphs();
    if (index < 0) return;
    const j = dir < 0 ? index - 1 : index + 1;
    const q = paras[j];
    if (!q) {
      this.setSelection(dir < 0 ? paras[index]!.start : paras[index]!.end);
      return;
    }
    const t = q.objs?.get(0)?.table;
    if (t && this.enterTableEdge(t, dir < 0 ? 'last' : 'first', goalX)) return;
    if (goalX !== null) {
      const pp = this.bodyLayout.para(j);
      this.setSelection(this.bodyLayout.offsetInLine({ para: j, line: dir < 0 ? pp.lines.length - 1 : 0 }, goalX), undefined, true);
    } else this.setSelection(dir < 0 ? q.end : q.start);
  }

  /** 셀로 들어간다 (캐럿은 부르는 쪽이 정한다). 셀이 없으면 false */
  private enterCell(table: string, row: string, col: string): boolean {
    const story = cellStoryId(table, row, col);
    if (this.cell?.story === story) return true;
    this.input.commitComposition();
    this.history.seal();
    this.cell = { table, row, col, story };
    this.extras = []; // 다른 캐럿은 같은 스토리 안에만 있다
    this.doc = this.document.story(story);
    this.pending = null;
    this.attachActive();
    return this.cell !== null;
  }

  /** 표의 첫 행(first) 또는 끝 행(last) 셀로 들어간다. x(문서 좌표)가 있으면 그 열, 캐럿도 그 x에 */
  private enterTableEdge(id: string, edge: 'first' | 'last', x: number | null, caret: 'start' | 'end' = edge === 'first' ? 'start' : 'end'): boolean {
    const loc = this.locateTable(id);
    if (!loc) return false;
    const v = loc.view;
    const y = edge === 'first' ? 0 : v.grid.cells.length - 1;
    let col = edge === 'first' ? 0 : v.grid.cols.length - 1;
    if (x !== null) {
      const rx = x - loc.para.lines[0]!.x;
      col = 0;
      while (col + 1 < v.grid.cols.length && v.measure.colX[col + 1]! <= rx) col++;
    }
    const o = this.ownerAt(v, y, col);
    if (!o || !this.enterCell(id, o.cell.row, o.cell.col)) return false;
    this.caretInCell(x, edge === 'first' ? 1 : -1, caret);
    return true;
  }

  /** 막 들어간 셀 안의 캐럿: x가 있으면 첫 줄(dir > 0)이나 끝 줄의 그 x, 없으면 처음·끝 */
  private caretInCell(x: number | null, dir: number, caret: 'start' | 'end'): void {
    if (x !== null) {
      const L = this.layout;
      const last = L.paras.length - 1;
      const ref = dir > 0 ? { para: 0, line: 0 } : { para: last, line: L.para(last).lines.length - 1 };
      this.setSelection(L.offsetInLine(ref, x), undefined, true);
    } else this.setSelection(caret === 'start' ? 0 : this.doc.maxCaret);
  }

  /** 문서 좌표의 셀 (표 문단의 행 안, 표 폭 안) */
  private cellAt(x: number, y: number): { view: TableView; cell: NonNullable<TableGrid['cells'][0][0]>; y: number; x: number } | null {
    const L = this.bodyLayout;
    if (y >= L.validBottom) return null;
    const ref = L.firstLineBelow(y, false);
    if (!ref) return null;
    const para = L.paras[ref.para]!;
    if (!para.layout.table) return null;
    const ln = para.lines[ref.line]!;
    if (y < ln.y || y >= ln.y + ln.height) return null;
    const id = (para.info as ParagraphInfo).objs?.get(0)?.table;
    const v = id ? this.fmt.tableViews.get(id) : undefined;
    if (!v) return null;
    const rx = x - ln.x;
    if (rx < 0 || rx >= v.measure.width) return null;
    let col = 0;
    while (col + 1 < v.grid.cols.length && v.measure.colX[col + 1]! <= rx) col++;
    const o = this.ownerAt(v, ln.row ?? ref.line, col);
    return o ? { view: v, ...o } : null;
  }

  /** 셀 안을 눌렀다: 셀로 들어가 캐럿, Shift는 셀 범위 선택, 끌어서 다른 셀로 가면 셀 범위 선택 */
  private mouseInCell(hit: NonNullable<ReturnType<Editor['cellAt']>>, p: { x: number; y: number }, e: MouseEvent): void {
    const id = hit.view.id;
    const a = this.cell;
    if (e.shiftKey && a && a.table === id && a.story !== hit.cell.story) {
      this.cellSel = { table: id, rows: [a.row, hit.cell.row], cols: [a.col, hit.cell.col] };
      this.render();
      this.opts.onChange?.(this);
      return;
    }
    if (!this.enterCell(id, hit.cell.row, hit.cell.col)) return;
    const start = this.cell!;
    const offset = this.layout.hitTest(p.x, p.y);
    if (e.detail === 2) {
      const [x0, x1] = this.wordAt(offset);
      this.setSelection(x0, x1);
    } else if (e.detail >= 3) {
      const para = this.doc.paragraphs()[this.layout.paraIndexAt(offset)]!;
      this.setSelection(para.start, para.end);
    } else if (e.shiftKey && a?.story === start.story) this.setSelection(this.selection().anchor, offset);
    else this.setSelection(offset);
    this.history.seal();
    this.render();
    this.opts.onChange?.(this);
    if (e.detail !== 1) return;
    const anchor = this.selection().anchor;
    const onMove = (ev: MouseEvent) => {
      const q = this.docPoint(ev);
      const h2 = this.cellAt(q.x, q.y);
      if (h2 && h2.view.id === id && h2.cell.story !== start.story) {
        this.cellSel = { table: id, rows: [start.row, h2.cell.row], cols: [start.col, h2.cell.col] };
      } else if (this.cell?.story === start.story) {
        this.setSelection(anchor, this.layout.hitTest(q.x, q.y));
      }
      this.scheduleRender();
      this.opts.onChange?.(this);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /** 행 우선 순서로 이웃 셀 (dir ±1). 표 끝을 넘으면 표 밖 본문으로 */
  private stepCell(dir: -1 | 1, caret: 'start' | 'end' | 'all'): void {
    const a = this.cell;
    const loc = a && this.locateTable(a.table);
    if (!a || !loc) return;
    const list = loc.view.grid.cells.flat().filter((c) => c !== null);
    const k = list.findIndex((c) => c!.story === a.story);
    const next = list[k + dir];
    if (!next) {
      this.leaveTable(loc.index, dir);
    } else {
      this.enterCell(a.table, next.row, next.col);
      if (caret === 'all') this.setSelection(0, this.doc.maxCaret);
      else this.setSelection(caret === 'start' ? 0 : this.doc.maxCaret);
    }
    this.history.seal();
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  /** Tab: 다음 셀 (내용 선택). 마지막 셀에서는 행을 더한다 */
  private tabCell(dir: -1 | 1): void {
    const a = this.cell;
    const loc = a && this.locateTable(a.table);
    if (!a || !loc) return;
    const list = loc.view.grid.cells.flat().filter((c) => c !== null);
    if (dir > 0 && list[list.length - 1]!.story === a.story) {
      this.tableAddRow(true);
      const loc2 = this.locateTable(a.table);
      const y = loc2 ? loc2.view.grid.cells.length - 1 : -1;
      const first = loc2?.view.grid.cells[y]?.find((c) => c !== null);
      if (first) {
        this.enterCell(a.table, first.row, first.col);
        this.setSelection(0);
        this.render();
      }
      return;
    }
    this.stepCell(dir, 'all');
  }

  /** 셀의 첫 줄 위·끝 줄 아래로: 위·아래 셀, 표 끝이면 표 밖 본문 */
  private leaveCellVertical(dir: number): void {
    const a = this.cell!;
    const loc = this.locateTable(a.table);
    if (!loc) return;
    const pos = this.cellPos(loc.view, a.story);
    if (!pos) return;
    const ny = dir < 0 ? pos.y - 1 : pos.y + pos.cell.span[0];
    const goal = this.goalX;
    if (ny < 0 || ny >= loc.view.grid.cells.length) {
      this.leaveTable(loc.index, dir, goal);
    } else {
      const o = this.ownerAt(loc.view, ny, pos.x);
      if (o) {
        this.enterCell(a.table, o.cell.row, o.cell.col);
        this.caretInCell(goal, dir, dir > 0 ? 'start' : 'end');
      }
    }
    this.goalX = goal;
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  /** 본문 오프셋이 표 문단 안이면 그 표 ID */
  private tableAtOffset(offset: number): string | null {
    const q = this.body.paragraphs()[this.body.paragraphIndexAt(offset)];
    const t = q?.objs?.get(0)?.table;
    return t && this.document.table(t) ? t : null;
  }

  /** 표 레코드 연산 기록 (셀 선택 그대로) */
  private commitTable(ops: Op[], before: Selection): void {
    if (ops.length === 0) return;
    this.history.seal();
    this.commitRaw(ops, before);
    this.history.seal();
  }

  /** 편집 중인 표·셀 (도구 막대 상태) */
  tableState(): { inTable: boolean; merged: boolean; range: boolean; header: boolean; cantSplit: boolean } {
    const a = this.cell;
    const v = a && this.fmt.tableViews.get(a.table);
    const pos = v && this.cellPos(v, a.story);
    const ra = a ? this.document.table(a.table)?.rowAttrs[a.row] : undefined;
    return {
      inTable: !!a,
      merged: !!pos && (pos.cell.span[0] > 1 || pos.cell.span[1] > 1),
      range: !!this.cellSel && !!v && !!this.cellSelBox(v),
      header: !!ra?.header,
      cantSplit: !!ra?.cantSplit,
    };
  }

  /**
   * 편집 중인 셀(셀 범위면 그 행들)의 행 속성 (12 §8): header = 제목 행 (표 맨 위에서 이어진 제목 행들을 표가 이어지는 쪽마다 다시
   * 그린다), cantSplit = 행 나누지 않음. 실행 취소 한 단계
   */
  tableSetRowFlag(flag: 'header' | 'cantSplit', on: boolean): void {
    const a = this.cell;
    const v = a && this.fmt.tableViews.get(a.table);
    if (!a || !v) return;
    const box = this.cellSelBox(v);
    const rows = box ? v.grid.rows.slice(box.y0, box.y1 + 1) : [a.row];
    const rec = this.document.table(a.table)!;
    const ops: Op[] = [];
    for (const r of rows) {
      const next: Record<string, unknown> = { ...(rec.rowAttrs[r] ?? {}) };
      if (on) next[flag] = true;
      else delete next[flag];
      ops.push(...this.document.setRowAttrs(a.table, r, Object.keys(next).length ? next : undefined));
    }
    this.commitTable(ops, { ...this.sel });
  }

  /** 캐럿 문단 앞에 표를 넣는다 (행 × 열, 본문 폭을 열마다 똑같이) 그리고 첫 셀로 */
  insertTable(rows: number, cols: number): void {
    this.input.commitComposition();
    this.leaveCellKeep();
    const before: Selection = { ...this.sel };
    const width = Math.round(this.contentWidthAt(this.headOffset()) * (72 / 96) * 1000);
    const { id, ops } = this.document.insertTable(this.headOffset(), rows, cols, width);
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
    const t = this.document.table(id)!;
    if (this.enterCell(id, t.rows[0]!, t.cols[0]!)) this.setSelection(0);
    this.render();
    this.opts.onChange?.(this);
  }

  /** 셀에서 나오되 캐럿을 표 앞에 (표 명령) */
  private leaveCellKeep(): void {
    const a = this.cell;
    if (!a) return;
    const at = this.tableOffset(a.table);
    this.leaveCell();
    if (at !== null) this.setSelection(at);
  }

  /** 편집 중인 셀의 행 아래(below)·위에 행 */
  tableAddRow(below = true): void {
    const a = this.cell;
    const loc = a && this.locateTable(a.table);
    const pos = loc && this.cellPos(loc.view, a.story);
    if (!a || !loc || !pos) return;
    const rows = loc.view.grid.rows;
    const after = below ? rows[pos.y + pos.cell.span[0] - 1]! : pos.y > 0 ? rows[pos.y - 1]! : null;
    const before: Selection = { ...this.sel };
    this.commitTable(this.document.addRow(a.table, after).ops, before);
  }

  /**
   * 편집 중인 셀의 열 오른쪽(right)·왼쪽에 열 (너비는 그 열과 같게). 그러면 본문 폭을 넘는 표는 모든 열을 같은 비율로 줄여
   * 본문 폭에 맞춘다 (Word·Google Docs처럼 표가 용지 밖으로 나가지 않게). 원래 본문보다 넓던 표는 그 폭을 지킨다. 실행 취소 한 단계
   */
  tableAddCol(right = true): void {
    const a = this.cell;
    const loc = a && this.locateTable(a.table);
    const pos = loc && this.cellPos(loc.view, a.story);
    if (!a || !loc || !pos) return;
    const cols = loc.view.grid.cols;
    const after = right ? cols[pos.x + pos.cell.span[1] - 1]! : pos.x > 0 ? cols[pos.x - 1]! : null;
    const before: Selection = { ...this.sel };
    const widths = this.document.table(a.table)!.widths;
    const w = widths[cols[pos.x]!];
    const added = this.document.addCol(a.table, after, w);
    const ops = [...added.ops];
    const newW = this.document.table(a.table)!.widths[added.id] ?? 0;
    const old = cols.reduce((s, c) => s + (widths[c] ?? 0), 0);
    // 본문 폭 (px → 1/1000 pt): 표가 놓인 본문 문단의 폭 (구역·다단 반영)
    const limit = Math.round((loc.para.width || this.setup.width - this.setup.margin * 2) * (72 / 96) * 1000);
    if (old + newW > limit) {
      const k = Math.max(old, limit) / (old + newW);
      for (const c of [...cols, added.id]) {
        const cw = c === added.id ? newW : (widths[c] ?? 0);
        ops.push(...this.document.setColWidth(a.table, c, cw * k));
      }
    }
    this.commitTable(ops, before);
  }

  /** 편집 중인 셀(또는 셀 범위)의 행·열을 지운다. 다 지우면 표를 지운다 */
  tableDelete(what: 'row' | 'col'): void {
    const a = this.cell;
    const loc = a && this.locateTable(a.table);
    const pos = loc && this.cellPos(loc.view, a.story);
    if (!a || !loc || !pos) return;
    const v = loc.view;
    const box = this.cellSelBox(v) ?? { y0: pos.y, y1: pos.y + pos.cell.span[0] - 1, x0: pos.x, x1: pos.x + pos.cell.span[1] - 1 };
    const ids = what === 'row' ? v.grid.rows.slice(box.y0, box.y1 + 1) : v.grid.cols.slice(box.x0, box.x1 + 1);
    const all = what === 'row' ? v.grid.rows : v.grid.cols;
    if (ids.length >= all.length) return this.deleteTable();
    const before: Selection = { ...this.sel };
    const ops: Op[] = [];
    for (const id of ids) ops.push(...this.document.deleteRowOrCol(a.table, id));
    // 캐럿은 지운 범위 다음(없으면 앞) 행·열의 셀로
    const ny = what === 'row' ? (box.y1 + 1 < v.grid.rows.length ? box.y1 + 1 : box.y0 - 1) : pos.y;
    const nx = what === 'col' ? (box.x1 + 1 < v.grid.cols.length ? box.x1 + 1 : box.x0 - 1) : pos.x;
    const o = this.ownerAt(v, ny, nx);
    this.cellSel = null;
    this.history.seal();
    this.history.record({ ops, before, after: { ...this.sel }, time: Date.now() });
    if (o) this.enterCell(a.table, o.cell.row, o.cell.col);
    if (this.cell) this.setSelection(0);
    this.history.seal();
    this.afterChange();
  }

  /** 셀 범위를 병합 (왼쪽 위 셀이 주인, 덮인 셀의 글은 그대로 주인 셀 아래에 이어 보인다) */
  tableMerge(): void {
    const a = this.cell;
    const v = a && this.fmt.tableViews.get(a.table);
    const box = v && this.cellSelBox(v);
    if (!a || !v || !box) return;
    const owner = v.grid.cells[box.y0]?.[box.x0];
    if (!owner) return;
    const before: Selection = { ...this.sel };
    const ops = this.document.mergeCells(a.table, owner.row, owner.col, v.grid.rows.slice(box.y0 + 1, box.y1 + 1), v.grid.cols.slice(box.x0 + 1, box.x1 + 1));
    this.cellSel = null;
    this.history.seal();
    this.history.record({ ops, before, after: { ...this.sel }, time: Date.now() });
    if (this.enterCell(a.table, owner.row, owner.col)) this.setSelection(this.doc.maxCaret);
    this.history.seal();
    this.afterChange();
  }

  /** 편집 중인 병합 셀을 나눈다 */
  tableUnmerge(): void {
    const a = this.cell;
    if (!a) return;
    this.commitTable(this.document.unmergeCell(a.table, a.row, a.col), { ...this.sel });
  }

  /** 편집 중인 셀(범위)의 배경색 */
  tableCellFill(fill: string | undefined): void {
    const a = this.cell;
    const v = a && this.fmt.tableViews.get(a.table);
    if (!a || !v) return;
    const box = this.cellSelBox(v);
    const cells = box
      ? v.grid.cells.slice(box.y0, box.y1 + 1).flatMap((r) => r.slice(box.x0, box.x1 + 1)).filter((c) => c !== null)
      : [{ row: a.row, col: a.col }];
    const ops: Op[] = [];
    const rec = this.document.table(a.table)!;
    for (const c of cells) ops.push(...this.document.setCellAttrs(a.table, c!.row, c!.col, fill ? { ...rec.cellAttrs[cellKey(c!.row, c!.col)], fill } : undefined));
    this.commitTable(ops, { ...this.sel });
  }

  /** 편집 중인 셀의 열 너비 (px) */
  tableSetColWidth(px: number): void {
    const a = this.cell;
    if (!a) return;
    this.commitTable(this.document.setColWidth(a.table, a.col, px * (72 / 96) * 1000), { ...this.sel });
  }

  /** 편집 중인 표를 지운다 (표 문단 [표][¶]) */
  deleteTable(): void {
    const a = this.cell;
    if (!a) return;
    const i = this.tableIndex(a.table);
    this.leaveCell();
    if (i < 0) return;
    const q = this.body.paragraphs()[i]!;
    this.setSelection(q.start);
    const before: Selection = { ...this.sel };
    const ops = this.body.deleteRange(q.start, q.end + 1);
    this.history.seal();
    this.commitRaw(ops, before);
    this.history.seal();
  }

  /** 셀 범위의 내용을 지운다 (Delete·Backspace) */
  private clearCellRange(): void {
    const a = this.cell;
    const v = a && this.fmt.tableViews.get(a.table);
    const box = v && this.cellSelBox(v);
    if (!a || !v || !box) return;
    const before: Selection = { ...this.sel };
    const ops: Op[] = [];
    for (const c of v.grid.cells.slice(box.y0, box.y1 + 1).flatMap((r) => r.slice(box.x0, box.x1 + 1))) {
      if (!c) continue;
      const d = this.document.story(c.story);
      if (d.maxCaret > 0) ops.push(...Document.tag(c.story, d.deleteRange(0, d.maxCaret)));
    }
    const keep = this.cellSel;
    this.setSelection(0);
    this.cellSel = keep;
    if (ops.length) this.commitTable(ops, before);
  }

  // ── 입력 의도 처리 ────────────────────────────────────

  private handleIntent(i: InputIntent): void {
    switch (i.kind) {
      case 'insertText':
        this.replaceSelection(i.text, 'type');
        break;
      case 'insertParagraph':
        this.insertParagraph();
        break;
      case 'compositionStart': {
        // 조합이 가져가는 기존 글자: 선택 영역, 또는 입력 층이 알려 준 범위(한자 재변환 등)
        if (this.extras.length && !i.replace) {
          // 다중 커서: 모든 선택을 지우고 조합은 첫 캐럿에서 (확정하면 모두에 넣는다)
          if (this.caretList().some((c) => c.anchor !== c.head)) this.editAll((f, t) => (f === t ? null : { ops: this.doc.deleteRange(f, t), caret: f }));
          this.preedit = '';
          break;
        }
        const [from, to] = i.replace ?? this.range();
        if (i.replace) this.setSelection(from, to);
        if (from !== to) this.deleteRange(from, to);
        this.preedit = '';
        break;
      }
      case 'replaceText': {
        // 다중 커서에서 캐럿에 입력: 모든 캐럿에
        if (this.extras.length && i.from === i.to && i.from === this.headOffset()) {
          this.insertAll(i.text, 'type');
          break;
        }
        // IME가 주변 텍스트를 고침 (보통은 캐럿에 입력: from = to = 캐럿)
        this.setSelection(i.from, i.to);
        this.replaceSelection(i.text, i.from === i.to ? 'type' : undefined);
        break;
      }
      case 'compositionUpdate':
        this.preedit = i.text;
        this.relayout();
        this.render();
        break;
      case 'compositionEnd': {
        const text = i.text || this.preedit;
        this.preedit = '';
        if (text) this.replaceSelection(text, 'type');
        else this.refresh();
        break;
      }
      case 'key':
        this.onKey(i.event);
        break;
      case 'copy':
      case 'cut': {
        const [from, to] = this.range();
        i.event.preventDefault();
        if (this.extras.length) {
          // 다중 커서: 선택들을 줄로 이어 복사
          const parts = this.caretList()
            .filter((c) => c.anchor !== c.head)
            .sort((a, b) => Math.min(a.anchor, a.head) - Math.min(b.anchor, b.head))
            .map((c) => this.doc.slice(Math.min(c.anchor, c.head), Math.max(c.anchor, c.head)));
          if (!parts.length) return;
          i.event.clipboardData?.setData('text/plain', parts.join('\n'));
          if (i.kind === 'cut') this.editAll((f, t) => (f === t ? null : { ops: this.doc.deleteRange(f, t), caret: f }));
          break;
        }
        // 셀 범위: 그 셀들로 된 표
        if (this.cellSel && this.cell) {
          const v = this.fmt.tableViews.get(this.cell.table);
          const box = v && this.cellSelBox(v);
          if (v && box) {
            const frag: Fragment = { quire: 1, blocks: [], closed: true, stories: {}, lists: {} };
            const tb = tableBlock(this.document, v.id, frag, box);
            if (tb) frag.blocks.push(tb);
            this.writeClipboard(i.event, frag);
            if (i.kind === 'cut') this.clearCellRange();
            break;
          }
        }
        if (from === to) return;
        this.writeClipboard(i.event, fragmentOf(this.document, this.doc, from, to));
        if (i.kind === 'cut') this.deleteRange(from, to);
        break;
      }
      case 'paste': {
        this.history.seal();
        const plain = this.plainPaste;
        this.plainPaste = false;
        // 서식 있는 붙여넣기: Quire 조각 → HTML. 다중 커서는 글자만 (캐럿마다)
        if (!plain && !this.extras.length) {
          let frag: Fragment | null = null;
          if (i.quire)
            try {
              const f = JSON.parse(i.quire) as Fragment;
              if (f && f.quire === 1 && Array.isArray(f.blocks)) frag = f;
            } catch {
              frag = null;
            }
          // 이미지 파일과 함께 온 HTML이 그림 하나뿐이면 파일을 쓴다 (Excel·이미지 복사)
          const htmlUseful = !!i.html && /<(p|div|li|h[1-6]|td|span|b|strong|i|em|br|table|ul|ol)\b/i.test(i.html);
          if (!frag && htmlUseful && !(i.files?.length && !/<(p|li|td|h[1-6])\b/i.test(i.html!))) frag = htmlToFragment(i.html!);
          if (frag) {
            void this.pasteRich(frag);
            break;
          }
        }
        if (i.files?.length && !plain) {
          for (const f of i.files) void this.insertImage(f);
          break;
        }
        if (i.text) this.replaceSelection(i.text);
        break;
      }
    }
  }

  /** 복사: 조각(Quire끼리), HTML(다른 프로그램), 글자 */
  private writeClipboard(e: ClipboardEvent, frag: Fragment): void {
    const dt = e.clipboardData;
    if (!dt) return;
    dt.setData('text/plain', fragmentToText(frag));
    dt.setData('text/html', fragmentToHtml(frag));
    try {
      dt.setData(FRAGMENT_MIME, JSON.stringify(frag));
    } catch {
      // 사용자 형식을 못 쓰는 브라우저: HTML로 붙는다
    }
  }

  /** 서식 있는 붙여넣기 (선택을 바꾼다). HTML의 그림(data: URL)은 먼저 자산으로 */
  private async pasteRich(frag: Fragment): Promise<void> {
    for (const r of pendingImages(frag)) {
      try {
        const blob = await (await fetch(r.src!)).blob();
        const asset = await this.assets.put(blob);
        const bmp = await createImageBitmap(blob);
        this.images.set(asset, bmp);
        const img = r.img!;
        img.asset = asset;
        if (!img.w || !img.h) {
          const maxW = this.contentWidthAt(this.headOffset());
          const sc = Math.min(1, maxW / bmp.width);
          img.w = Math.round(bmp.width * sc * 750);
          img.h = Math.round(bmp.height * sc * 750);
        }
      } catch {
        // 못 읽은 그림은 넣지 않는다
      }
    }
    this.input.commitComposition();
    // 셀에서 표(셀 범위)를 붙이면 지금 셀부터 칸마다 덮어쓴다 (Word·Excel)
    if (this.cell && frag.blocks.length === 1 && 'table' in frag.blocks[0]!) return this.pasteCells(frag);
    const before = this.fullSel();
    const [from, to] = this.range();
    const ops: Op[] = [];
    const merge = this.mergeKeepAttrs(from, to);
    if (from !== to) ops.push(...this.doc.deleteRange(from, to));
    if (merge) ops.push(...merge());
    const r = pasteFragment({ document: this.document, doc: this.doc, inCell: !this.inBody, newId: () => crypto.randomUUID().slice(0, 8) }, from, frag);
    ops.push(...r.ops);
    this.setSelection(r.caret);
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
  }

  /** 표 조각을 편집 중인 셀부터 칸마다 덮어쓴다 (표 밖으로 넘치는 칸은 버린다). 실행 취소 한 단계 */
  private pasteCells(frag: Fragment): void {
    const a = this.cell!;
    const loc = this.locateTable(a.table);
    const pos = loc && this.cellPos(loc.view, a.story);
    const block = frag.blocks[0] as Extract<Fragment['blocks'][0], { table: unknown }>;
    if (!loc || !pos) return;
    const before = this.fullSel();
    const ops: Op[] = [];
    const done = new Set<string>();
    const taken = new Set<string>();
    block.table.rows.forEach((row, y) => {
      let x = 0;
      for (const c of row.cells) {
        while (taken.has(`${y},${x}`)) x++;
        const [h, w] = c.span ?? [1, 1];
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) taken.add(`${yy},${xx}`);
        const o = this.ownerAt(loc.view, pos.y + y, pos.x + x);
        x += w;
        if (!o || pos.y + y >= loc.view.grid.rows.length || pos.x + x - w >= loc.view.grid.cols.length || done.has(o.cell.story)) continue;
        done.add(o.cell.story);
        const d = this.document.story(o.cell.story);
        const cellOps: Op[] = [];
        if (d.maxCaret > 0) cellOps.push(...d.deleteRange(0, d.maxCaret));
        for (let k = 0; k < d.paragraphs().length; k++)
          for (const key of Object.keys(d.paraAttrs(k)) as ParaKey[]) cellOps.push(...d.setParaAttr(k, key, undefined));
        const paras = frag.stories[c.story] ?? [];
        const sub: Fragment = { quire: 1, blocks: paras, closed: false, stories: {}, lists: frag.lists };
        cellOps.push(...pasteFragment({ document: this.document, doc: d, inCell: true, newId: () => crypto.randomUUID().slice(0, 8) }, 0, sub).ops);
        ops.push(...Document.tag(o.cell.story, cellOps));
      }
    });
    this.cellSel = null;
    if (!ops.length) return;
    this.history.seal();
    this.commitRaw(ops, before);
    this.history.seal();
  }

  private onKey(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    // Ctrl+Shift+V: 다음 붙여넣기는 글자만 (paste 이벤트는 브라우저가 이어서 보낸다)
    if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
      this.plainPaste = true;
      return;
    }
    const shift = e.shiftKey;
    const head = this.headOffset();
    const [from, to] = this.range();
    let handled = true;

    // 셀 범위 선택 (11 §5.4): 지우기는 셀 내용, Esc는 해제
    if (this.cellSel && !mod && (e.key === 'Backspace' || e.key === 'Delete')) {
      this.clearCellRange();
      e.preventDefault();
      return;
    }
    // 각주에서 나오기 (12 §6.3)
    if (this.note && e.key === 'Escape') {
      this.closeNote();
      e.preventDefault();
      return;
    }
    // 각주 넣기 (12 §6.3): Ctrl+Alt+F
    if (mod && e.altKey && !shift && (e.key === 'f' || e.key === 'F' || e.code === 'KeyF')) {
      this.insertFootnote();
      e.preventDefault();
      return;
    }
    // 머리말·꼬리말에서 나오기 (12 §5.4)
    if (this.hf && e.key === 'Escape' && !this.cellSel) {
      this.closeHeaderFooter();
      e.preventDefault();
      return;
    }
    if (this.cellSel && e.key === 'Escape') {
      this.cellSel = null;
      this.render();
      e.preventDefault();
      return;
    }
    // 단 나누기 (12 §7.1): Ctrl+Shift+Enter
    if (mod && !e.altKey && shift && e.key === 'Enter') {
      this.insertColumnBreak();
      e.preventDefault();
      return;
    }
    // 쪽 나누기 (12 §4): Ctrl+Enter
    if (mod && !e.altKey && !shift && e.key === 'Enter') {
      this.insertPageBreak();
      e.preventDefault();
      return;
    }
    // 구역 나누기 (12 §3.1): Ctrl+Alt+Enter
    if (mod && e.altKey && !shift && e.key === 'Enter') {
      this.insertSectionBreak('nextPage');
      e.preventDefault();
      return;
    }
    // 다중 커서 (11 §5.2): Ctrl+Alt+↑/↓ 캐럿 더하기
    if (mod && e.altKey && !shift && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      this.addCaretVertical(e.key === 'ArrowUp' ? -1 : 1);
      e.preventDefault();
      return;
    }
    if (this.extras.length && this.multiKey(e, mod, shift)) {
      e.preventDefault();
      return;
    }

    if (e.altKey && shift && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      this.moveParagraphs(e.key === 'ArrowUp' ? -1 : 1);
      e.preventDefault();
      return;
    }
    // 플러그인 단축키 (15 §7): 명령이 처리하면 기본 동작을 막는다 (찾기 Ctrl+F·Ctrl+H·F3도 여기)
    const cmd = this.keys.get(eventKey(e));
    if (cmd) {
      this.input.commitComposition();
      if (this.run(cmd)) {
        e.preventDefault();
        return;
      }
    }
    if (mod && shift && !e.altKey && e.key.toLowerCase() === 'k') {
      this.deleteParagraphs();
      e.preventDefault();
      return;
    }

    // 목록 (10 §5): Ctrl+Shift+8 글머리, Ctrl+Shift+7 번호
    if (mod && shift && !e.altKey && (e.code === 'Digit8' || e.code === 'Digit7')) {
      this.toggleList(e.code === 'Digit8' ? 'bullet' : 'number');
      e.preventDefault();
      return;
    }
    // 문단 스타일 (10 §5): Ctrl+Alt+1–3 제목, Ctrl+Alt+0 본문
    if (mod && e.altKey && !shift && /^Digit[0-3]$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      this.setParagraphStyle(n === 0 ? BODY_STYLE : `h${n}`);
      e.preventDefault();
      return;
    }
    // 글자 서식 (10 §5)
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      const align = !shift ? ({ l: 'left', e: 'center', r: 'right', j: 'justify' } as const)[k as 'l'] : undefined;
      if (align) {
        this.setParagraphAttr('align', align === 'left' ? undefined : align);
        e.preventDefault();
        return;
      }
      const fmtKey =
        !shift && k === 'b' ? 'bold' : !shift && k === 'i' ? 'italic' : !shift && k === 'u' ? 'underline' : shift && k === 'x' ? 'strike' : null;
      if (fmtKey) {
        this.toggleMark(fmtKey);
        e.preventDefault();
        return;
      }
      if (!shift && (e.key === '.' || e.key === ',')) {
        this.toggleScript(e.key === '.' ? 'sup' : 'sub');
        e.preventDefault();
        return;
      }
      if (!shift && e.key === '\\') {
        this.clearMarks();
        e.preventDefault();
        return;
      }
    }

    if (mod && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'z':
          if (shift) this.redo();
          else this.undo();
          break;
        case 'y':
          this.redo();
          break;
        case 'a':
          this.setSelection(0, this.doc.maxCaret);
          this.render();
          break;
        case 'home':
          this.moveTo(0, shift);
          break;
        case 'end':
          this.moveTo(this.doc.maxCaret, shift);
          break;
        case 'backspace':
          if (from !== to) this.deleteRange(from, to);
          else this.deleteRange(this.wordBoundary(head, -1), head);
          break;
        case 'delete':
          if (from !== to) this.deleteRange(from, to);
          else this.deleteRange(head, this.wordBoundary(head, 1), undefined, true);
          break;
        case 'arrowleft':
          this.moveTo(this.wordBoundary(head, -1), shift);
          break;
        case 'arrowright':
          this.moveTo(this.wordBoundary(head, 1), shift);
          break;
        default:
          handled = false;
      }
    } else {
      switch (e.key) {
        case 'Backspace':
          if (this.caretAtListStart()) this.outdentListItem(this.caretAtListStart()!.i, true); // 목록 첫머리: 번호부터 지운다
          else if (from !== to) this.deleteRange(from, to);
          else if (this.inBody && head > 0 && this.tableAtOffset(head - 1)) this.moveTo(head - 1, false); // 표 뒤 문단 처음: 표와 합치지 않고 표로
          else if (this.inBody && this.pageBreakAtCaret(head))
            this.setParagraphAttr(this.doc.paraAttrs(this.doc.paragraphIndexAt(head)).pageBreakBefore === true ? 'pageBreakBefore' : 'columnBreakBefore', undefined); // 쪽·단 나눔부터 지운다
          else if (head > 0) this.deleteRange(this.layout.prevStop(head), head, 'delete');
          break;
        case 'Delete':
          if (from !== to) this.deleteRange(from, to);
          else if (this.inBody && head < this.doc.maxCaret && this.tableAtOffset(head + 1)) this.moveTo(head + 1, false); // 표 앞 문단 끝
          else if (head < this.doc.maxCaret) this.deleteRange(head, this.layout.nextStop(head), 'delete', true);
          break;
        case 'ArrowLeft':
          if (from !== to && !shift) this.moveTo(from, false);
          else if (this.cell && head === 0 && !shift) this.stepCell(-1, 'end');
          else this.moveTo(this.layout.prevStop(head), shift);
          break;
        case 'ArrowRight':
          if (from !== to && !shift) this.moveTo(to, false);
          else if (this.cell && head >= this.doc.maxCaret && !shift) this.stepCell(1, 'start');
          else this.moveTo(Math.min(this.doc.maxCaret, this.layout.nextStop(head)), shift);
          break;
        case 'ArrowUp':
          this.moveVertical(-1, shift);
          break;
        case 'ArrowDown':
          this.moveVertical(1, shift);
          break;
        case 'PageUp':
          this.moveVertical(-Math.max(1, Math.floor(this.scroller.clientHeight / this.setup.lineHeight) - 1), shift);
          break;
        case 'PageDown':
          this.moveVertical(Math.max(1, Math.floor(this.scroller.clientHeight / this.setup.lineHeight) - 1), shift);
          break;
        case 'Home': {
          const ref = this.layout.lineAt(head);
          this.moveTo(this.layout.offsetInLine(ref, -Number.MAX_SAFE_INTEGER), shift);
          break;
        }
        case 'End': {
          const ref = this.layout.lineAt(head);
          this.moveTo(this.layout.offsetInLine(ref, Number.MAX_SAFE_INTEGER), shift);
          break;
        }
        case 'Tab':
          // 표 셀이면 다음·앞 셀 (11 §5.4). 목록 문단이면 수준 ±1 (10 §2.4), 아니면 탭 문자 (Shift+Tab은 목록에서만)
          if (this.cell) this.tabCell(shift ? -1 : 1);
          else if (!this.listLevel(shift ? -1 : 1) && !shift) this.replaceSelection('\t', 'type');
          break;
        default:
          handled = false;
      }
    }
    if (handled) e.preventDefault();
  }

  /** 다중 커서일 때의 키: 지우기·이동·Esc. 처리했으면 true (나머지는 보통 경로: 입력·서식은 모든 캐럿에) */
  private multiKey(e: KeyboardEvent, mod: boolean, shift: boolean): boolean {
    const L = this.layout;
    const max = this.doc.maxCaret;
    const vert = (dir: number) => (h: number) => {
      const r = L.caretRect(h);
      const t = L.stepLine(r.ref, dir);
      return t ? L.offsetInLine(t, r.x) : dir < 0 ? 0 : max;
    };
    switch (e.key) {
      case 'Escape':
        this.setSelection(this.selection().anchor, this.headOffset());
        this.render();
        this.opts.onChange?.(this);
        return true;
      case 'Backspace':
      case 'Delete':
        if (e.altKey) return false;
        this.deleteAll(e.key === 'Backspace' ? -1 : 1, mod);
        return true;
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (e.altKey) return false;
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        this.moveAll((h) => Math.max(0, Math.min(max, mod ? this.wordBoundary(h, dir) : dir < 0 ? L.prevStop(h) : L.nextStop(h))), shift);
        return true;
      }
      case 'ArrowUp':
      case 'ArrowDown':
        if (e.altKey || mod) return false;
        this.moveAll(vert(e.key === 'ArrowUp' ? -1 : 1), shift);
        return true;
      case 'Home':
      case 'End': {
        if (mod) return false;
        const x = e.key === 'Home' ? -Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        this.moveAll((h) => L.offsetInLine(L.lineAt(h), x), shift);
        return true;
      }
      case 'Tab':
        if (this.cell) return false;
        this.insertAll('\t', 'type');
        return true;
    }
    return false;
  }

  private moveVertical(dir: number, extend: boolean): void {
    const head = this.headOffset();
    const r = this.layout.caretRect(head);
    if (this.goalX === null) this.goalX = r.x;
    const target = this.layout.stepLine(r.ref, dir);
    if (!extend && this.cell && !target) return this.leaveCellVertical(dir);
    if (!extend && this.inBody && target && this.bodyLayout.para(target.para).layout.table) {
      // 위·아래 표로: 첫 행(내려갈 때)이나 끝 행의 goalX 열
      const id = (this.bodyLayout.para(target.para).info as ParagraphInfo).objs?.get(0)?.table;
      const goal = this.goalX;
      if (id && this.enterTableEdge(id, dir > 0 ? 'first' : 'last', goal)) {
        this.goalX = goal;
        this.history.seal();
        this.scrollCaretIntoView();
        this.render();
        this.opts.onChange?.(this);
        return;
      }
    }
    let offset: number;
    if (target) offset = this.layout.offsetInLine(target, this.goalX);
    else offset = dir < 0 ? 0 : this.doc.maxCaret;
    this.moveTo(offset, extend, true);
  }

  /** 단어(어절) 경계. dir=-1이면 이전, 1이면 다음 */
  private wordBoundary(offset: number, dir: -1 | 1): number {
    const para = this.doc.paragraphs()[this.doc.paragraphIndexAt(offset)]!;
    const d = offset - para.start;
    if (dir < 0 && d === 0) return Math.max(0, offset - 1);
    if (dir > 0 && d >= Array.from(para.text).length) return Math.min(this.doc.maxCaret, offset + 1);
    const bounds = wordBounds(para.text);
    if (dir < 0) {
      let best = 0;
      for (const b of bounds) if (b.start < d && b.isWord) best = b.start;
      return para.start + best;
    }
    for (const b of bounds) if (b.end > d && b.isWord) return para.start + b.end;
    return para.start + Array.from(para.text).length;
  }

  // ── 장식·맞춤법 (15 §2, §4) ─────────────────────────

  /** 장식 소스를 더한다 (앱·플러그인). 떼는 함수를 돌려준다 */
  addDecorationSource(source: DecorationSource): () => void {
    this.decoSources.push(source);
    this.scheduleRender();
    return () => {
      const i = this.decoSources.indexOf(source);
      if (i >= 0) this.decoSources.splice(i, 1);
      this.scheduleRender();
    };
  }

  /** 장식 종류의 겉모양을 정한다 (내장 종류도 바꿀 수 있다) */
  setDecorationStyle(kind: string, style: DecorationStyle): void {
    this.decoStyles.set(kind, style);
    this.scheduleRender();
  }

  /** 다시 그린다 (장식 소스의 결과가 바뀌었을 때) */
  redraw(): void {
    this.scheduleRender();
  }

  /** 맞춤법 검사기를 바꾼다 (null이면 끈다). 내장 맞춤법 플러그인(spell-plugin)을 새로 붙인다: 결과 캐시와 무시 목록은 새로 시작한다 */
  setSpellChecker(checker: SpellChecker | null, lang?: string): void {
    if (this.spellP) this.unuse(this.spellP.name);
    this.spellP = checker ? spellPlugin(checker, { lang }) : null;
    if (this.spellP) this.use(this.spellP);
    if (this.mirror) delete this.mirror.dataset.key;
    this.scheduleRender();
  }

  /** 맞춤법 세션 (검사 통계, 무시 목록). 검사하지 않으면 null */
  get spellSession() {
    return this.spellP?.session ?? null;
  }

  /** 문단의 장식들 (소스마다 시작 순, 여럿이면 합쳐 정렬) */
  private decorationsFor(story: string | null, para: DecorationPara): readonly Decoration[] {
    let out: Decoration[] | null = null;
    let only: readonly Decoration[] = [];
    for (const src of this.decoSources) {
      const d = src.decorationsIn(story, para);
      if (!d || !d.length) continue;
      if (!only.length) only = d;
      else {
        out ??= [...only];
        out.push(...d);
      }
    }
    return out ? out.sort((a, b) => a.from - b.from) : only;
  }

  /** 화면 점의 맞춤법 오류 (편집 중인 스토리에서). 없으면 null */
  spellAt(clientX: number, clientY: number): SpellMenu | null {
    return this.spellP?.menuAt(clientX, clientY) ?? null;
  }

  private onContextMenu(e: MouseEvent): void {
    if (!this.opts.onContextMenu) return;
    this.input.commitComposition();
    // 맞춤법 오류 위면 그 낱말을 선택해 둔다 (Word와 같다)
    const spell = this.spellP?.menuAt(e.clientX, e.clientY, true) ?? null;
    if (spell) {
      this.history.seal();
      this.render();
    }
    const at = this.hitTestClient(e.clientX, e.clientY);
    const items: MenuItem[] = [];
    if (at)
      for (const p of this.plugins)
        if (p.plugin.contextMenu && p.plugin !== this.spellP) for (const it of p.plugin.contextMenu(p.ctx, at, e)) items.push({ ...it, plugin: p.plugin.name });
    if (this.opts.onContextMenu(e, spell, items) !== false) e.preventDefault();
  }

  // ── 플러그인 (15 §7) ─────────────────────────────────

  /** 플러그인을 붙인다. 같은 이름이 있으면 먼저 뗀다. 떼는 함수를 돌려준다 */
  use(plugin: QuirePlugin): () => void {
    this.unuse(plugin.name);
    const ctx = this.pluginContext(plugin);
    const entry = { plugin, ctx, dispose: [] as Array<() => void> };
    this.plugins.push(entry);
    for (const [name, fn] of Object.entries(plugin.commands ?? {})) {
      const key = `${plugin.name}.${name}`;
      this.commands.set(key, { plugin: plugin.name, fn: (...args) => fn(ctx, ...args) });
      entry.dispose.push(() => {
        if (this.commands.get(key)?.plugin === plugin.name) this.commands.delete(key);
      });
    }
    for (const [k, cmd] of Object.entries(plugin.keymap ?? {})) {
      const key = normalizeKey(k);
      this.keys.set(key, cmd);
      entry.dispose.push(() => {
        if (this.keys.get(key) === cmd) this.keys.delete(key);
      });
    }
    for (const [kind, st] of Object.entries(plugin.decorationStyles ?? {})) this.setDecorationStyle(kind, st);
    if (plugin.decorations) entry.dispose.push(this.addDecorationSource(plugin.decorations(ctx)));
    // 문서 데이터: 옛 판이면 옮긴다
    if (plugin.data) {
      const cur = this.document.ext.get(plugin.name) as { v: number; data: unknown } | undefined;
      if (cur && cur.v < plugin.data.schemaVersion && plugin.data.migrate)
        this.document.ext.set(plugin.name, { v: plugin.data.schemaVersion, data: plugin.data.migrate(cur.data, cur.v) });
    }
    const cleanup = plugin.init?.(ctx);
    if (typeof cleanup === 'function') entry.dispose.push(cleanup);
    this.scheduleRender();
    return () => this.unuse(plugin.name);
  }

  /** 플러그인을 뗀다 */
  unuse(name: string): void {
    const i = this.plugins.findIndex((p) => p.plugin.name === name);
    if (i < 0) return;
    const [entry] = this.plugins.splice(i, 1);
    for (const d of entry!.dispose.reverse()) d();
    this.scheduleRender();
  }

  /** 붙인 플러그인 이름 */
  pluginNames(): string[] {
    return this.plugins.map((p) => p.plugin.name);
  }

  /** 명령 실행 ('플러그인.명령'). 처리했으면 true */
  run(command: string, ...args: unknown[]): boolean {
    const c = this.commands.get(command);
    return c ? c.fn(...args) : false;
  }

  /** 명령 이름들 */
  commandNames(): string[] {
    return [...this.commands.keys()];
  }

  /** 플러그인이 더한 내보내기 형식 ('플러그인.형식' → 정보) */
  exporters(): Array<{ id: string; label: string; extension: string; mime: string }> {
    const out: Array<{ id: string; label: string; extension: string; mime: string }> = [];
    for (const p of this.plugins) for (const [k, ex] of Object.entries(p.plugin.exporters ?? {})) out.push({ id: `${p.plugin.name}.${k}`, label: typeof ex.label === 'function' ? ex.label(this.t) : ex.label, extension: ex.extension, mime: ex.mime });
    return out;
  }

  /** 플러그인 내보내기 실행 */
  async exportWith(id: string): Promise<Uint8Array | string | null> {
    for (const p of this.plugins)
      for (const [k, ex] of Object.entries(p.plugin.exporters ?? {})) if (`${p.plugin.name}.${k}` === id) return ex.export(p.ctx);
    return null;
  }

  private emit(event: PluginEvent): void {
    const set = this.listeners.get(event);
    if (set) for (const fn of [...set]) fn();
  }

  /** 화면 점의 스토리 자리 (편집 중인 스토리 안이 아니면 null) */
  private hitTestClient(clientX: number, clientY: number): StoryPos | null {
    const p = this.docPoint({ clientX, clientY });
    // 본문을 편집 중이면 표 칸 위는 아니다 (칸은 들어가서)
    if (!this.cell && !this.hf && !this.note && this.cellAt(p.x, p.y)) return null;
    const offset = this.layout.hitTest(p.x, Math.min(p.y, this.layout.validBottom - 1));
    return { story: this.storyId, offset };
  }

  /** 편집 중인 스토리의 캐럿 사각형 (뷰포트 좌표) */
  private clientRectAt(offset: number): Rect {
    const r = this.layout.caretRect(offset);
    const sr = this.scroller.getBoundingClientRect();
    return { x: sr.left + r.x + this.pageLeft() - this.scroller.scrollLeft, y: sr.top + r.y - this.scroller.scrollTop, width: 1, height: r.height };
  }

  /** 플러그인이 받는 좁은 면 */
  private pluginContext(plugin: QuirePlugin): PluginContext {
    const self = this;
    const finish = (select?: [number, number]) => {
      if (select) self.setSelection(select[0], select[1]);
      self.render();
      self.opts.onChange?.(self);
    };
    return {
      name: plugin.name,
      t: (key, params) => self.t(key, params),
      document: () => self.document,
      story: () => self.storyId,
      doc: () => self.doc,
      selection() {
        const { anchor, head } = self.selection();
        return { anchor, head, from: Math.min(anchor, head), to: Math.max(anchor, head), story: self.storyId };
      },
      select(anchor, head = anchor) {
        self.setSelection(anchor, head);
        self.render();
        self.opts.onChange?.(self);
      },
      reveal: (story, from, to) => self.revealRange(story, from, to),
      canEdit: () => self.canEditText,
      edit(fn, opts) {
        if (!self.canEditText) return false;
        self.input.commitComposition();
        const before: Selection = { ...self.sel };
        const ops = fn(self.doc);
        if (!ops.length) return false;
        self.history.seal();
        self.commit(ops, before);
        self.history.seal();
        finish(opts?.select);
        return true;
      },
      editDocument(fn, opts) {
        if (!self.canEditText) return false;
        self.input.commitComposition();
        const before: Selection = { ...self.sel };
        const ops = fn(self.document);
        if (!ops.length) return false;
        self.history.seal();
        self.commitRaw(ops, before);
        self.history.seal();
        finish(opts?.select);
        return true;
      },
      caretRect: () => self.clientRectAt(self.headOffset()),
      rangeRects(from, to) {
        // 줄마다: 줄이 바뀌는 곳에서 끊는다 (긴 범위는 앞 2,000자)
        const out: Rect[] = [];
        const end = Math.min(to, from + 2000);
        let cur: Rect | null = null;
        for (let o = from; o <= end; o++) {
          const r = self.clientRectAt(o);
          if (cur && Math.abs(r.y - cur.y) < 1 && r.x >= cur.x) cur.width = r.x - cur.x;
          else {
            if (cur && cur.width > 0) out.push(cur);
            cur = { ...r, width: 0 };
          }
        }
        if (cur && cur.width > 0) out.push(cur);
        return out;
      },
      hitTest: (x, y) => self.hitTestClient(x, y),
      redraw: () => self.scheduleRender(),
      on(event, fn) {
        let set = self.listeners.get(event);
        if (!set) self.listeners.set(event, (set = new Set()));
        set.add(fn);
        return () => set!.delete(fn);
      },
      run: (command, ...args) => self.run(command, ...args),
      getData<T>() {
        return (self.document.ext.get(plugin.name) as { data: T } | undefined)?.data;
      },
      setData(value) {
        self.document.ext.set(plugin.name, { v: plugin.data?.schemaVersion ?? 1, data: value });
      },
    };
  }

  // ── 마우스 ────────────────────────────────────────────

  private docPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.scroller.getBoundingClientRect();
    return {
      x: e.clientX - rect.left + this.scroller.scrollLeft - this.pageLeft(),
      y: e.clientY - rect.top + this.scroller.scrollTop,
    };
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    // 스크롤바 클릭은 무시
    const rect = this.scroller.getBoundingClientRect();
    if (e.clientX - rect.left > this.scroller.clientWidth || e.clientY - rect.top > this.scroller.clientHeight) return;
    e.preventDefault();
    this.input.commitComposition();
    this.focus();

    const p = this.docPoint(e);
    // 아직 쪽 조립이 안 된 영역의 클릭은 무시 (자리표시가 보이는 상태)
    if (p.y >= this.bodyLayout.validBottom) return;
    // 머리말·꼬리말 (12 §5.4): 두 번 눌러 들어간다. 편집 중에는 다른 쪽·다른 영역을 누르면 그리로, 본문은 두 번 눌러 나온다
    const zone = this.hfZoneAt(p.x, p.y);
    if (this.hf) {
      if (!zone && e.detail < 2) return;
      if (!zone) {
        this.leaveHF(false);
        this.setSelection(this.bodyLayout.hitTest(p.x, p.y));
        this.history.seal();
        this.relayout();
        this.render();
        this.opts.onChange?.(this);
        return;
      }
      if (zone.page !== this.hf.page || zone.part !== this.hf.part) {
        this.enterHF(zone.page, zone.part);
        if (!this.hf) return;
        this.setSelection(this.layout.hitTest(p.x, p.y));
        this.render();
        this.opts.onChange?.(this);
        return;
      }
      return this.selectAt(p, e);
    }
    if (zone && e.detail === 2) {
      this.enterHF(zone.page, zone.part);
      if (this.hf) this.setSelection(this.layout.hitTest(p.x, p.y));
      this.render();
      this.opts.onChange?.(this);
      return;
    }
    // 각주 (12 §6.3): 쪽 아래 각주를 누르면 그 각주를 편집한다. 각주 밖을 누르면 나온다
    const nz = this.noteAt(p.x, p.y);
    if (this.note) {
      if (nz && nz.id === this.note.id && nz.page === this.note.page) return this.selectAt(p, e);
      this.leaveNote(false);
      this.relayout();
    }
    if (nz) {
      this.enterNote(nz.id, nz.page);
      if (this.note) this.setSelection(this.layout.hitTest(p.x, p.y));
      this.history.seal();
      this.render();
      this.opts.onChange?.(this);
      return;
    }
    if (e.detail === 1 && this.inGrip(p.x, p.y)) {
      const ref = this.bodyLayout.firstLineBelow(p.y, false);
      if (ref) {
        this.leaveCellKeep();
        this.startParagraphDrag(ref.para, e);
        return;
      }
    }
    // Alt+누르기: 캐럿 더하기 (11 §5.2, 편집 중인 스토리 안에서)
    if (e.altKey && !e.shiftKey && e.detail === 1) {
      const hit0 = this.cellAt(p.x, p.y);
      if ((hit0 ? hit0.cell.story : null) === (this.cell ? this.cell.story : null)) {
        this.addCaret(this.layout.hitTest(p.x, p.y));
        return;
      }
    }
    // 표 셀 (11 §5.4)
    const hit = this.cellAt(p.x, p.y);
    if (hit) return this.mouseInCell(hit, p, e);
    this.leaveCell();
    // 개체: 선택한 개체의 손잡이면 크기 조절, 개체를 누르면 개체 선택 (11 §5.1)
    const obj = this.objectAt(p.x, p.y);
    const sel = this.selectedObject();
    if (obj && sel && sel.offset === obj.offset) {
      const h = handlePoints(obj.x, obj.y, obj.w, obj.h).findIndex(([hx, hy]) => Math.abs(hx - p.x) <= 6 && Math.abs(hy - p.y) <= 6);
      if (h >= 0) {
        this.startResize(obj, h, e);
        return;
      }
    }
    if (obj && obj.float && sel && sel.offset === obj.offset && !e.shiftKey && e.detail === 1) {
      this.startMove(obj, e);
      return;
    }
    if (obj && !e.shiftKey && e.detail === 1) {
      this.setSelection(obj.offset, obj.offset + 1);
      this.history.seal();
      this.render();
      this.opts.onChange?.(this);
      return;
    }
    this.selectAt(p, e);
  }

  /** 편집 중인 스토리 안에서 누르기(두 번: 낱말, 세 번: 문단)와 끌어 선택하기 */
  private selectAt(p: { x: number; y: number }, e: MouseEvent): void {
    const offset = this.layout.hitTest(p.x, p.y);

    if (e.detail === 2) {
      const [a, b] = this.wordAt(offset);
      this.setSelection(a, b);
    } else if (e.detail >= 3) {
      const para = this.doc.paragraphs()[this.layout.paraIndexAt(offset)]!;
      this.setSelection(para.start, para.end);
    } else if (e.shiftKey) {
      this.setSelection(this.selection().anchor, offset);
    } else {
      this.setSelection(offset);
    }
    this.history.seal();
    this.render();
    this.opts.onChange?.(this);

    const anchor = this.selection().anchor;
    const onMove = (ev: MouseEvent) => {
      const q = this.docPoint(ev);
      const head = this.layout.hitTest(q.x, Math.min(q.y, this.layout.validBottom - 1));
      this.setSelection(anchor, head);
      this.scheduleRender();
      this.opts.onChange?.(this);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    if (e.detail === 1) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  }

  // ── 각주 (12 §6) ─────────────────────────────────────

  /** 문서 좌표의 각주 (쪽 아래 각주 영역) */
  private noteAt(x: number, y: number): { id: string; page: number } | null {
    const L = this.bodyLayout;
    const page = L.pageAt(y);
    if (page >= L.pageCount) return null;
    for (const s of this.noteSlots(page)) if (y >= s.y && y < s.y + s.h && x >= s.x - 4 && x <= s.x + NOTE_INDENT + s.width + 4) return { id: s.id, page };
    return null;
  }

  /** 각주가 (처음) 놓인 쪽: 참조 줄의 쪽부터 찾는다. 없으면 참조 줄의 쪽 */
  private notePageOf(id: string): number {
    const L = this.bodyLayout;
    const ref = this.fmt.noteList().find((n) => n.id === id);
    if (!ref) return 0;
    const pp = L.para(ref.para);
    const ln = pp.lines.find((l, k) => ref.k < l.end || k === pp.lines.length - 1)!;
    for (let p = ln.page; p < Math.min(L.pageCount, ln.page + 8); p++) if (L.notesOnPage(p).some((n) => n.id === id)) return p;
    return ln.page;
  }

  /** 각주 편집을 시작한다 (page: 그 각주가 놓인 쪽, 없으면 처음 놓인 쪽) */
  private enterNote(id: string, page: number | null): void {
    this.input.commitComposition();
    if (this.hf) this.leaveHF(true);
    if (this.cell) this.leaveCellKeep();
    const bodySel = this.note ? this.note.bodySel : { anchor: this.sel.anchor, head: this.sel.head };
    if (this.note) this.leaveNote(true);
    this.history.seal();
    const story = noteStoryId(id);
    this.note = { story, id, page: page ?? this.notePageOf(id), bodySel };
    this.extras = [];
    this.pending = null;
    this.cellSel = null;
    this.doc = this.document.story(story);
    const end = this.doc.positionAt(this.doc.maxCaret);
    this.sel = { anchor: end, head: end, story };
    this.relayout();
  }

  /** 편집 중인 각주의 레이아웃: 그 쪽에 놓인 조각 자리. 참조가 지워졌으면 나온다 */
  private attachNote(pre: { offset: number; text: string; fmt?: number } | null): void {
    const a = this.note!;
    if (!this.fmt.noteNumber(a.id)) return this.leaveNote(true);
    let s = this.noteSlots(a.page).find((x) => x.id === a.id);
    if (!s) {
      a.page = this.notePageOf(a.id);
      s = this.noteSlots(a.page).find((x) => x.id === a.id);
    }
    if (!s) return this.leaveNote(true);
    this.layout = this.noteLayout(s, pre);
  }

  /** 각주 편집을 끝낸다. restore면 들어오기 전 본문 선택으로 */
  private leaveNote(restore: boolean): void {
    const a = this.note;
    if (!a) return;
    this.input.commitComposition();
    this.history.seal();
    this.note = null;
    this.extras = [];
    this.pending = null;
    this.doc = this.body;
    this.layout = this.bodyLayout;
    if (restore) this.sel = { anchor: a.bodySel.anchor, head: a.bodySel.head };
    else this.setSelection(0);
  }

  /**
   * 각주 넣기 (Ctrl+Alt+F, 12 §6.3): 캐럿에 참조를 넣고 그 각주를 편집한다. 본문에서만 (셀·머리말 안 각주는 3단계 밖).
   * 참조 넣기는 실행 취소 한 단계
   */
  insertFootnote(): void {
    this.input.commitComposition();
    if (!this.inBody || this.extras.length) return;
    const before: Selection = { ...this.sel };
    const [from, to] = this.range();
    const ops: Op[] = [];
    if (from !== to) ops.push(...this.doc.deleteRange(from, to));
    const marks = this.pending && this.pending.at === from ? this.pending.marks : undefined;
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    ops.push(...this.doc.insertObject(from, { id, kind: 'note' }, marks));
    this.setSelection(from + 1);
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
    this.enterNote(id, null);
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  /** 각주 편집에서 본문으로 (Esc): 들어오기 전 본문 선택으로 */
  closeNote(): void {
    if (!this.note) return;
    this.leaveNote(true);
    this.relayout();
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  /** 편집 중인 각주 (번호, 없으면 null) */
  noteInfo(): { id: string; number: number; page: number } | null {
    const a = this.note;
    return a ? { id: a.id, number: this.fmt.noteNumber(a.id), page: a.page } : null;
  }

  // ── 머리말·꼬리말 (12 §5) ─────────────────────────────

  /** 문서 좌표가 쪽의 머리말(본문 위)·꼬리말(본문 아래) 영역이면 그 쪽과 영역 */
  private hfZoneAt(x: number, y: number): { page: number; part: HFPart } | null {
    const L = this.bodyLayout;
    const page = L.pageAt(y);
    if (page >= L.pageCount) return null;
    const pb = L.pageBox(page);
    if (x < pb.x || x > pb.x + pb.width || y < pb.top || y > pb.top + pb.height) return null;
    const info = pageHF(this.fmt, L, page, this.today);
    if (y < info.bodyTop) return { page, part: 'header' };
    if (y > info.bodyBottom) return { page, part: 'footer' };
    return null;
  }

  /** 본문 처음 (머리말에서 나올 때 돌아갈 선택이 없으면) */
  private bodyStart(): Selection {
    const p = this.body.positionAt(0);
    return { anchor: p, head: p };
  }

  /** 스토리를 머리말·꼬리말로 그리는 첫 쪽 (없으면 -1) */
  private hfPageOf(story: string, part: HFPart): number {
    const L = this.bodyLayout;
    for (let p = 0; p < L.pageCount; p++) {
      const info = pageHF(this.fmt, L, p, this.today);
      if ((part === 'header' ? info.header.story : info.footer.story) === story) return p;
    }
    return -1;
  }

  /** 캐럿이 있는 본문 쪽 */
  private caretPage(): number {
    const L = this.bodyLayout;
    if (this.cell) {
      const at = this.tableOffset(this.cell.table);
      return at === null ? 0 : L.pageAt(L.caretRect(at).y);
    }
    return L.pageAt(L.caretRect(this.body.resolve(this.sel.head)).y);
  }

  /**
   * 쪽 page의 머리말·꼬리말을 편집한다. 그 쪽에 스토리가 없으면 그 쪽 구역·종류의 스토리를 만들어 구역 설정에 건다 (실행 취소 한 단계).
   * 셀에서 들어오면 셀에서 나온다
   */
  private enterHF(page: number, part: HFPart): void {
    this.input.commitComposition();
    if (this.cell) this.leaveCellKeep();
    if (this.note) this.leaveNote(true);
    const bodySel = this.hf ? this.hf.bodySel : { anchor: this.sel.anchor, head: this.sel.head };
    if (this.hf) this.leaveHF(true);
    const body = this.body;
    const info = pageHF(this.fmt, this.bodyLayout, page, this.today);
    let story = part === 'header' ? info.header.story : info.footer.story;
    if (!story) {
      story = hfStoryId(part, info.sectionId, info.kind);
      const f = fullSection(body.sectionDef(info.sectionId));
      const before: Selection = { ...this.sel };
      this.history.seal();
      this.commitRaw(body.setSection(info.sectionId, { ...f, [part]: { ...(f[part] ?? {}), [info.kind]: story } }), before);
    }
    this.history.seal();
    this.hf = { story, part, page, bodySel };
    this.extras = [];
    this.pending = null;
    this.cellSel = null;
    this.doc = this.document.story(story);
    const start = this.doc.positionAt(0);
    this.sel = { anchor: start, head: start, story };
    this.relayout();
  }

  /** 편집 중인 머리말·꼬리말의 레이아웃 (그 쪽의 필드 값, 자리). 쪽의 스토리가 바뀌었으면 같은 스토리를 그리는 쪽으로, 없으면 나온다 */
  private attachHF(pre: { offset: number; text: string; fmt?: number } | null): void {
    const a = this.hf!;
    const L = this.bodyLayout;
    if (a.page >= L.pageCount) a.page = Math.max(0, L.pageCount - 1);
    let info = pageHF(this.fmt, L, a.page, this.today);
    if ((a.part === 'header' ? info.header.story : info.footer.story) !== a.story) {
      const p = this.hfPageOf(a.story, a.part);
      if (p < 0) return this.leaveHF(true);
      a.page = p;
      info = pageHF(this.fmt, L, p, this.today);
    }
    this.layout = layoutHF(this.fmt, (id) => this.document.story(id), info, a.part, pre)!;
  }

  /** 머리말·꼬리말 편집을 끝낸다. restore면 들어오기 전 본문 선택으로 */
  private leaveHF(restore: boolean): void {
    const a = this.hf;
    if (!a) return;
    this.input.commitComposition();
    this.history.seal();
    this.hf = null;
    this.extras = [];
    this.pending = null;
    this.doc = this.body;
    this.layout = this.bodyLayout;
    if (restore) this.sel = { anchor: a.bodySel.anchor, head: a.bodySel.head };
    else this.setSelection(0);
  }

  /** 캐럿이 있는 쪽의 머리말(또는 꼬리말) 편집을 시작한다 (12 §5.4). 머리말 편집 중이면 같은 쪽의 다른 쪽으로 */
  editHeaderFooter(part: HFPart = 'header'): void {
    this.enterHF(this.hf ? this.hf.page : this.caretPage(), part);
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  /** 머리말·꼬리말 편집을 끝내고 본문으로 (Esc) */
  closeHeaderFooter(): void {
    if (!this.hf) return;
    this.leaveHF(true);
    this.relayout();
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  /** 편집 중인 머리말·꼬리말 (없으면 null) */
  headerFooterInfo(): HeaderFooterInfo | null {
    const a = this.hf;
    if (!a) return null;
    const info = pageHF(this.fmt, this.bodyLayout, a.page, this.today);
    const f = fullSection(this.body.sectionDef(info.sectionId));
    return {
      part: a.part,
      kind: info.kind,
      section: info.sectionId,
      sectionIndex: info.section,
      page: a.page,
      titlePage: !!f.titlePage,
      oddEven: !!f.oddEven,
      linked: f[a.part]?.[info.kind] !== a.story,
    };
  }

  /** 필드 넣기 (12 §5.1): 머리말·꼬리말 안에서만 (본문의 쪽 번호 필드는 쪽 나눔과 순환을 만든다, O-29) */
  insertField(kind: FieldKind): void {
    if (!this.hf) return;
    this.input.commitComposition();
    const before: Selection = { ...this.sel };
    const [from, to] = this.range();
    const ops: Op[] = [];
    if (from !== to) ops.push(...this.doc.deleteRange(from, to));
    const marks = this.pending && this.pending.at === from ? this.pending.marks : undefined;
    ops.push(...this.doc.insertObject(from, { kind: 'field', field: kind }, marks));
    this.setSelection(from + 1);
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
  }

  /** 편집 중인 머리말·꼬리말 구역의 첫 쪽 다르게(titlePage)·짝홀 다르게(oddEven). 그 쪽의 새 종류 스토리로 옮겨 간다 */
  setHeaderFooterOption(key: 'titlePage' | 'oddEven', on: boolean): void {
    const a = this.hf;
    if (!a) return;
    const info = pageHF(this.fmt, this.bodyLayout, a.page, this.today);
    const f = fullSection(this.body.sectionDef(info.sectionId));
    if (!!f[key] === on) return;
    const { page, part } = a;
    const keep = { story: a.story, ...this.selection() };
    this.leaveHF(true);
    const next: SectionProps = { ...f };
    if (on) next[key] = true;
    else delete next[key];
    const before: Selection = { ...this.sel };
    this.history.seal();
    this.commitRaw(this.body.setSection(info.sectionId, next), before);
    this.enterHF(page, part);
    if (this.hf?.story === keep.story) this.setSelection(keep.anchor, keep.head);
    this.render();
    this.opts.onChange?.(this);
  }

  /**
   * 이전과 연결 (Word): linked = false면 앞 구역에서 이어 쓰던 스토리를 이 구역 스토리로 복사해 끊는다. true면 이 구역 스토리를
   * 떼어 앞 구역의 것을 이어 쓴다 (스토리 내용은 남아 되돌릴 수 있다). 실행 취소 한 단계
   */
  setHeaderFooterLinked(linked: boolean): void {
    const a = this.hf;
    const cur = this.headerFooterInfo();
    if (!a || !cur || cur.linked === linked) return;
    if (linked && cur.sectionIndex === 0) return;
    const { page, part } = a;
    const sec = cur.section;
    const kind = cur.kind;
    const src = a.story;
    const caret = this.selection();
    this.leaveHF(true);
    const before: Selection = { ...this.sel };
    const body = this.body;
    const f = fullSection(body.sectionDef(sec));
    const map = { ...(f[part] ?? {}) };
    const ops: Op[] = [];
    if (linked) delete map[kind];
    else {
      const id = hfStoryId(part, sec, kind);
      ops.push(...Document.tag(id, copyStory(this.document.story(src), this.document.story(id))));
      map[kind] = id;
    }
    const next: SectionProps = { ...f };
    if (Object.keys(map).length) next[part] = map;
    else delete next[part];
    ops.push(...body.setSection(sec, next));
    this.history.seal();
    this.commitRaw(ops, before);
    this.enterHF(page, part);
    // 복사한 스토리는 글이 같으므로 캐럿을 같은 자리에
    if (this.hf && !linked) this.setSelection(caret.anchor, caret.head);
    this.render();
    this.opts.onChange?.(this);
  }

  // ── 문단 끌기 ─────────────────────────────────────────

  /** 쪽 왼쪽 기준 x가 문단 손잡이 영역인가 */
  private inGrip(x: number, y: number): boolean {
    const ref = this.bodyLayout.firstLineBelow(y, false);
    const m = ref ? this.bodyLayout.paras[ref.para]!.frameLeft : this.setup.margin;
    return x >= m - GRIP_LEFT && x < m - GRIP_RIGHT;
  }

  /** 캐럿이 앞에서 쪽 나눔(직접 속성) 문단의 처음인가 (첫 문단 제외) */
  private pageBreakAtCaret(head: number): boolean {
    const i = this.doc.paragraphIndexAt(head);
    const a = this.doc.paraAttrs(i);
    return i > 0 && this.doc.paragraphs()[i]!.start === head && (a.pageBreakBefore === true || a.columnBreakBefore === true);
  }

  /** 오프셋 자리의 본문 폭 (px): 구역 여백, 셀이면 셀 폭 */
  private contentWidthAt(offset: number): number {
    const L = this.layout;
    const pp = L.para(L.paraIndexAt(offset));
    return pp.width || this.setup.width - this.setup.margin * 2;
  }

  private setHover(para: number, grip: boolean): void {
    const cursor = this.drag ? 'grabbing' : grip ? 'grab' : 'text';
    if (this.scroller.style.cursor !== cursor) this.scroller.style.cursor = cursor;
    if (para === this.hoverPara && grip === this.hoverGrip) return;
    this.hoverPara = para;
    this.hoverGrip = grip;
    this.scheduleRender();
  }

  /** 문단 위에 마우스가 있으면 그 문단의 손잡이를 보인다 */
  private onHover(e: MouseEvent): void {
    if (this.drag || e.buttons) return;
    const p = this.docPoint(e);
    let para = -1;
    const L = this.bodyLayout;
    if (p.y < L.validBottom) {
      const ref = L.firstLineBelow(p.y, false);
      const pp = ref ? L.paras[ref.para]! : null;
      if (pp && p.x >= pp.frameLeft - GRIP_LEFT && p.x <= pp.frameLeft + pp.width && p.y >= pp.lines[0]!.y - this.setup.paraSpacing) para = ref!.para;
    }
    this.setHover(para, para >= 0 && this.inGrip(p.x, p.y));
  }

  /**
   * 문단 k의 손잡이를 잡았다. 선택 영역이 걸친 문단들 안이면 그 문단들을 함께, 아니면 문단 k만 끈다.
   * 놓으면 moveParagraphs로 구획 순서만 바꾼다 (글자는 옮기지 않음).
   */
  private startParagraphDrag(k: number, e: MouseEvent): void {
    const [from, to] = this.range();
    const [si, sj] = this.selectedParagraphs();
    const withSelection = from !== to && k >= si && k <= sj;
    const [i, j] = withSelection ? [si, sj] : [k, k];
    this.drag = { i, j, to: -1, clientX: e.clientX, clientY: e.clientY };
    this.setHover(k, true);
    this.scheduleRender();

    const onMove = (ev: MouseEvent) => this.updateDrop(ev.clientX, ev.clientY);
    const finish = (commit: boolean) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey, true);
      this.endParagraphDrag(commit, withSelection);
    };
    const onUp = () => finish(true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey, true);
  }

  /** 포인터 위치로 놓을 자리를 정하고, 화면 끝 근처면 자동 스크롤한다 */
  private updateDrop(clientX: number, clientY: number): void {
    const d = this.drag;
    if (!d) return;
    d.clientX = clientX;
    d.clientY = clientY;
    const to = this.dropIndexAt(this.docPoint({ clientX, clientY }).y);
    d.to = to >= d.i && to <= d.j + 1 ? -1 : to; // 제자리면 표시 안 함
    const rect = this.scroller.getBoundingClientRect();
    const edge = (dist: number) => Math.ceil(((AUTOSCROLL_EDGE - dist) / AUTOSCROLL_EDGE) * 20);
    this.autoScroll =
      clientY < rect.top + AUTOSCROLL_EDGE
        ? -edge(clientY - rect.top)
        : clientY > rect.bottom - AUTOSCROLL_EDGE
          ? edge(rect.bottom - clientY)
          : 0;
    if (this.autoScroll && !this.autoScrollRaf) this.autoScrollRaf = requestAnimationFrame(this.autoScrollTick);
    this.scheduleRender();
  }

  private readonly autoScrollTick = (): void => {
    this.autoScrollRaf = 0;
    if (!this.drag || !this.autoScroll) return;
    this.scroller.scrollTop += this.autoScroll;
    this.updateDrop(this.drag.clientX, this.drag.clientY);
  };

  /** 문서 y에 놓으면 들어갈 자리: 그 문단 앞이면 문단 번호, 뒤면 다음 번호 */
  private dropIndexAt(y: number): number {
    const layout = this.bodyLayout;
    const ref = layout.firstLineBelow(Math.max(0, y));
    const para = layout.para(ref.para);
    const lines = para.lines;
    if (y >= para.bottom) return ref.para + 1;
    if (y < lines[0]!.y) return ref.para;
    if (lines.length === 1) return y < lines[0]!.y + lines[0]!.height / 2 ? ref.para : ref.para + 1;
    return ref.line < lines.length / 2 ? ref.para : ref.para + 1;
  }

  private endParagraphDrag(commit: boolean, withSelection: boolean): void {
    const d = this.drag;
    this.drag = null;
    this.autoScroll = 0;
    if (this.autoScrollRaf) cancelAnimationFrame(this.autoScrollRaf);
    this.autoScrollRaf = 0;
    this.setHover(this.hoverPara, this.hoverGrip);
    if (!d || !commit || d.to < 0) {
      this.scheduleRender();
      return;
    }
    const before: Selection = { ...this.sel };
    const ops = this.doc.moveParagraphs(d.i, d.j, d.to);
    if (ops.length === 0) {
      this.scheduleRender();
      return;
    }
    if (!withSelection) {
      // 선택과 무관한 문단을 옮겼으면 캐럿을 옮긴 문단 앞으로
      const at = d.to > d.j ? d.to - (d.j - d.i + 1) : d.to;
      this.setSelection(this.doc.paragraphs()[at]!.start);
    }
    this.hoverPara = -1;
    this.history.seal();
    this.commit(ops, before);
  }

  private wordAt(offset: number): [number, number] {
    const para = this.doc.paragraphs()[this.layout.paraIndexAt(offset)]!;
    const d = offset - para.start;
    for (const b of wordBounds(para.text)) {
      if (d >= b.start && d < b.end) return [para.start + b.start, para.start + b.end];
    }
    return [offset, offset];
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.disposers.push(() => target.removeEventListener(type, fn));
  }
}

// ── 유틸 ─────────────────────────────────────────────────

/** #rrggbb → rgba(…, a) */
/** 제안 작성자 색 (없으면 기본 파랑) */
function suggestionColor(a: AnnotationRange): string {
  const c = (a.data.author as { color?: unknown } | undefined)?.color;
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#2563eb';
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** 배경색 위에서 읽히는 글자색 (흰색 또는 검정) */
function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // 흰 글자와의 대비가 4.5 이상이면 흰색
  return 1.05 / (L + 0.05) >= 4.5 ? '#ffffff' : '#1d1d1f';
}

const wordSegmenter = new Intl.Segmenter('ko', { granularity: 'word' });
const graphemes = new Intl.Segmenter('ko', { granularity: 'grapheme' });

/** 다중 커서 상한 (11 §5.2) */
const MAX_CARETS = 1000;

/** 연속 지우기를 실행 취소 한 단계로 합치는 키 (단어 지우기는 합치지 않는다) */
function from0Key(_dir: number, word: boolean): string | undefined {
  return word ? undefined : 'delete';
}

/** 단어 구간 (코드포인트 인덱스) */
function wordBounds(text: string): Array<{ start: number; end: number; isWord: boolean }> {
  const out: Array<{ start: number; end: number; isWord: boolean }> = [];
  let cp = 0;
  for (const seg of wordSegmenter.segment(text)) {
    const len = Array.from(seg.segment).length;
    out.push({ start: cp, end: cp + len, isWord: !!seg.isWordLike });
    cp += len;
  }
  return out;
}


export type { Position };

/** 빈 스토리 (빈 문단 하나) */
function isEmptyDoc(d: Doc): boolean {
  return d.length === 1;
}

/** 크기 조절 손잡이 8곳 (왼쪽 위부터 시계 방향) */
function handlePoints(x: number, y: number, w: number, h: number): Array<[number, number]> {
  return [
    [x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2],
    [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2],
  ];
}
