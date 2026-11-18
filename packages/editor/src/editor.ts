/**
 * 0단계 에디터: 캔버스 렌더링 + 숨긴 textarea 입력 + 자체 선택 모델
 * 설계: docs/design/03, 04, 08
 */
import {
  BODY_STYLE,
  Doc,
  History,
  MARK_KEYS,
  MAX_LIST_LEVEL,
  OBJ,
  mergeParaAttrs,
  type MarkKey,
  type MarkSet,
  type Op,
  type ParaAttrs,
  type ParaKey,
  type FloatAttrs,
  type ListLabel,
  type ObjAttrs,
  type ObjKey,
  type ParagraphInfo,
  type Position,
  type ResolvedStyle,
  type Selection,
  type Style,
} from '@quire/model';
import {
  LayoutCache,
  PagedLayout,
  PLAIN_STYLE,
  cpSlice,
  docToDisplay,
  lineX,
  pageTop,
  type FloatSpec,
  type FormatSource,
  type Measurer,
  type PageSetup,
  type ParaBox,
  type ParaLayout,
  type PlacedFloat,
  type PlacedLine,
  type PlacedPara,
  type RunStyle,
} from '@quire/layout';
import { EditContextInput, editContextSupported } from './edit-context';
import { MemoryAssets, type AssetStore } from './assets';
import { TextareaInput, type InputBackend, type InputIntent, type InputLogEntry, type InputMode } from './input';

export interface EditorOptions {
  host: HTMLElement;
  text?: string;
  /** 이미 있는 문서 모델을 편집한다 (동기화 브리지가 붙은 Doc 등). 주면 text는 무시 */
  doc?: Doc;
  fontFamily?: string;
  fontSize?: number;
  onInputLog?: (entry: InputLogEntry) => void;
  /**
   * 엔진이 불러올 글꼴 (ADR-0002). 앞이 기본 글꼴, 뒤는 대체 글꼴. 주면 불러오는 동안은 fontFamily(시스템 글꼴)로
   * 측정하고, 다 불러오면 HarfBuzz 셰이핑으로 바꿔 다시 조판한다. 그리기도 같은 파일(FontFace)로 한다.
   */
  fonts?: FontSource[];
  /** 글꼴을 다 불러와 셰이핑으로 바꿨을 때 (실패하면 error) */
  onFontsReady?: (editor: Editor, error?: unknown) => void;
  /**
   * 입력 층 (03 §2). auto(기본): EditContext를 지원하면 경로 A, 아니면 숨긴 textarea(경로 B).
   * editcontext를 골랐는데 지원하지 않으면 textarea를 쓴다.
   */
  input?: InputMode;
  onChange?: (editor: Editor) => void;
  /** 선택 영역(캐럿)이 바뀌었을 때 (프레즌스 전송용). 화면 오프셋 */
  onSelectionChange?: (anchor: number, head: number) => void;
  /** 이미지 원본 저장소 (11 §2.2). 없으면 메모리 */
  assets?: AssetStore;
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

/** 글꼴 치수 (em 비율): 기준선·밑줄·취소선 */
interface Metrics {
  ascent: number;
  descent: number;
  underlinePosition: number;
  underlineThickness: number;
  strikePosition: number;
  strikeThickness: number;
}

/** 서식 번호 하나의 그리기 정보 (10 §4) */
interface DrawStyle {
  run: RunStyle;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string | null;
  highlight: string | null;
  /** 기준선 이동 (px, 위가 음수): 위·아래 첨자 */
  shift: number;
}

const PLAIN_DRAW: DrawStyle = {
  run: PLAIN_STYLE, bold: false, italic: false, underline: false, strike: false, color: null, highlight: null, shift: 0,
};
/** 기울인 그리기의 기울기 (tan 약 12°) */
const ITALIC_SKEW = 0.21;
/** 위·아래 첨자: 크기 배율, 기준선 이동 (em) */
const SCRIPT_SCALE = 0.65;
const SUP_SHIFT = -0.33;
const SUB_SHIFT = 0.2;
const LINK_COLOR = '#1a5fb4';

/** 다른 사용자의 선택 영역 (화면 오프셋). 협업 프레즌스에서 받아 그린다 */
export interface RemoteCaret {
  key: string;
  name: string;
  /** #rrggbb */
  color: string;
  anchor: number;
  head: number;
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

const COLORS = {
  desk: '#e9e9ec',
  page: '#ffffff',
  pageShadow: 'rgba(0,0,0,0.12)',
  text: '#1d1d1f',
  selection: 'rgba(56, 132, 255, 0.28)',
  selectionBlur: 'rgba(0, 0, 0, 0.12)',
  preedit: '#1d1d1f',
  placeholder: 'rgba(233, 233, 236, 0.85)',
  placeholderText: '#6e6e73',
  grip: '#a1a1a6',
  gripActive: '#3884ff',
  dragSource: 'rgba(56, 132, 255, 0.10)',
  dropLine: '#3884ff',
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

export class Editor {
  doc: Doc;
  history = new History();
  layout!: PagedLayout;
  stats: EditorStats = {
    layoutMs: 0, renderMs: 0, pages: 0, paragraphs: 0, lines: 0, characters: 0, cacheHits: 0, cacheMisses: 0,
    reflowed: 0, repositioned: 0, reused: 0, pendingParas: 0, backgroundMs: 0,
  };

  private sel: Selection;
  private goalX: number | null = null;
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
  private metrics: Metrics = {
    ascent: 0.8, descent: 0.2, underlinePosition: -0.1, underlineThickness: 0.06, strikePosition: 0.3, strikeThickness: 0.06,
  };
  /** (문단 스타일, 서식 번호)별 그리기 정보. 문서·스타일 판이 바뀌면 비운다 */
  private drawStyles = new Map<string, Array<DrawStyle | undefined>>();
  private drawStylesKey: { doc: Doc; version: number } | null = null;
  private styleFns = new Map<string, (id: number) => RunStyle>();
  /** 문단 → 레이아웃 서식 (10 §4): 글자 서식, 스타일의 기본 글자 서식, 문단 상자 */
  private readonly formatOf: FormatSource = (info, force) => {
    const p = info as ParagraphInfo;
    const attrs = p.attrs ?? {};
    const rs = this.doc.resolvedStyle(attrs.style ?? BODY_STYLE);
    const styled = hasKeys(rs.marks);
    const label = attrs.list ? this.doc.listLabel(p) : null;
    const box = this.paraBox(attrs, rs, label);
    if (!p.fmt && !p.mark && !force && !box && !styled && !p.objs) return null;
    const marker = label ? { text: label.text, id: p.mark ?? 0, hanging: pt(label.def.levels[label.level]!.hanging) } : null;
    const objs = p.objs ? objSizes(p.objs) : null;
    const floats = p.objs ? floatSpecs(p.objs) : null;
    const sty = styled ? (attrs.style ?? BODY_STYLE) : '';
    // 스타일 글자 서식은 서식 번호 0에도 걸리므로 fmt가 없으면 0으로 채운 열을 준다
    const fmt = p.fmt ?? (styled ? new Uint16Array(cpCount(p.text)) : null);
    return { fmt, mark: p.mark ?? 0, style: this.styleFn(sty), box, marker, objs, floats, key: styled ? `${sty}@${this.doc.stylesVersion}` : undefined };
  };
  private readonly assets: AssetStore;
  /** 자산 ID → 그릴 이미지 (불러오는 중 null) */
  private readonly images = new Map<string, ImageBitmap | null | 'error'>();
  /** 자산마다 마지막으로 그린 프레임 번호 (화면 밖 이미지를 풀어 메모리를 돌려준다, 11 §8) */
  private readonly imageUsed = new Map<string, number>();
  private frame = 0;
  /** 크기 조절 중인 개체: 오프셋과 미리 보기 크기 (px) */
  private resizing: { offset: number; w: number; h: number } | null = null;
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
  private readonly kerningOff: boolean;
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

  constructor(private readonly opts: EditorOptions) {
    this.fontSize = opts.fontSize ?? 16;
    this.assets = opts.assets ?? new MemoryAssets();
    const family = opts.fontFamily ?? `'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`;
    this.font = `${this.fontSize}px ${family}`;
    this.family = family;
    const canvasMeasurer = new CanvasMeasurer(this.font);
    this.measurer = canvasMeasurer;
    const box = canvasMeasurer.metrics(this.fontSize);
    this.metrics = { ...this.metrics, ...box };
    // A4 @96dpi
    this.setup = {
      width: 794,
      height: 1123,
      margin: 96,
      gap: 24,
      lineHeight: Math.round(this.fontSize * 1.7),
      paraSpacing: Math.round(this.fontSize * 0.5),
      fontSize: this.fontSize,
      ascent: box.ascent,
      descent: box.descent,
    };

    this.doc = opts.doc ?? Doc.fromText(opts.text ?? '');
    const start = this.doc.positionAt(0);
    this.sel = { anchor: start, head: start };

    // ── DOM ──
    const host = opts.host;
    host.replaceChildren();
    const scroller = document.createElement('div');
    Object.assign(scroller.style, {
      position: 'relative', width: '100%', height: '100%', overflow: 'auto',
      background: COLORS.desk, cursor: 'text', outline: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    host.appendChild(scroller);
    this.scroller = scroller;

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { position: 'sticky', top: '0', left: '0', display: 'block' });
    canvas.setAttribute('aria-hidden', 'true');
    scroller.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.kerningOff = 'fontKerning' in this.ctx;

    this.spacer = document.createElement('div');
    scroller.appendChild(this.spacer);

    const caret = document.createElement('div');
    caret.className = 'quire-caret';
    Object.assign(caret.style, {
      position: 'absolute', width: '2px', background: COLORS.text, pointerEvents: 'none', display: 'none',
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
    mirror.setAttribute('aria-label', '문서 내용');
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

    this.layout = new PagedLayout(this.setup, this.measurer, this.cache, this.formatOf);
    this.relayout();
    this.render();
    if (opts.fonts?.length) {
      this.loadFonts(opts.fonts).then(
        () => opts.onFontsReady?.(this),
        (e: unknown) => {
          this.textEngine = 'canvas (글꼴 불러오기 실패)';
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
      if (!r.ok) throw new Error(`글꼴을 불러오지 못함: ${url} (${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    };
    // 글꼴 자리: 파일 하나는 바로 불러온 자리, 조각 목록은 조각마다 아직 안 불러온 자리
    const slots: Array<import('@quire/shaping').FontSlot & { url?: string; bytes?: number }> = [];
    const ready: Array<{ i: number; data: Uint8Array }> = [];
    const readManifest = async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`글꼴 목록을 불러오지 못함: ${url} (${r.status})`);
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
    await Promise.all(ready.map(({ i, data }) => register(families[i]!, data)));

    let loadedBytes = 0;
    const describe = () => {
      const lazy = slots.filter((s) => s.url);
      const done = lazy.filter((s) => s.font).length;
      this.textEngine = `HarfBuzz (${sources.map((s) => s.name).join(', ')}${lazy.length ? ` · 조각 ${done}/${lazy.length}, ${(loadedBytes / 1e6).toFixed(2)} MB` : ''})`;
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
    this.cache.clear();
    this.layout = new PagedLayout(this.setup, this.measurer, this.cache, this.formatOf);
    this.refresh();
    this.opts.onChange?.(this);
  }

  // ── 공개 API ──────────────────────────────────────────

  focus(): void {
    this.input.focus();
  }

  /** 쓰고 있는 입력 층 */
  get inputKind(): InputBackend['kind'] {
    return this.input.kind;
  }

  setText(text: string): void {
    this.doc = Doc.fromText(text);
    this.cache.clear();
    this.layout = new PagedLayout(this.setup, this.measurer, this.cache, this.formatOf);
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
    const { anchor, head } = this.selection();
    this.doc = doc;
    this.pending = null;
    this.cache.clear();
    this.layout = new PagedLayout(this.setup, this.measurer, this.cache, this.formatOf);
    this.history = new History();
    this.setSelection(anchor, head);
    this.refresh();
  }

  /**
   * 바깥에서 문서 모델이 바뀌었을 때(원격 편집 적용 등) 호출한다. 선택 영역은 원소 ID 기준이라 그대로 유지된다.
   * 실행 취소 기록에는 들어가지 않는다.
   */
  docChanged(): void {
    this.relayout();
    this.render();
    this.opts.onChange?.(this);
  }

  /** 다른 사용자의 캐럿·선택을 바꾼다 (프레즌스 갱신·원격 편집 뒤에 호출) */
  setRemoteCarets(list: RemoteCaret[]): void {
    this.remotes = list;
    this.scheduleRender();
  }

  getText(): string {
    return this.doc.text().slice(0, -1);
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
    const paras = this.doc.paragraphs();
    const pre = this.preedit ? { offset: this.headOffset(), text: this.preedit, fmt: this.pendingFmt() } : null;
    // 화면 아래 한 화면 분량까지만 즉시 배치하고 나머지는 백그라운드로
    const syncUntil = this.scroller.scrollTop + this.scroller.clientHeight * 2;
    this.layout.update(paras, pre, syncUntil, this.doc.takeParagraphChanges());
    this.stats.layoutMs = performance.now() - t0;
    this.stats.reflowed = this.layout.counts.reflowed;
    this.stats.repositioned = this.layout.counts.repositioned;
    this.stats.reused = this.layout.counts.reused;
    this.updateDerived();
    this.scheduleBackground();
  }

  /** 쪽 수, 스크롤 높이 등 레이아웃에서 파생되는 값 */
  private updateDerived(): void {
    const s = this.stats;
    const paras = this.doc.paragraphs();
    s.pages = this.layout.pageCount;
    s.paragraphs = paras.length;
    s.characters = this.doc.length - paras.length;
    s.cacheHits = this.cache.hits;
    s.cacheMisses = this.cache.misses;
    s.pendingParas = paras.length - this.layout.validCount;
    if (this.layout.complete) {
      let lines = 0;
      for (const p of this.layout.paras) lines += p!.lines.length;
      s.lines = lines;
    }
    const viewH = this.scroller.clientHeight;
    this.spacer.style.height = `${Math.max(0, this.layout.totalHeight - viewH)}px`;
    this.spacer.style.width = `${this.setup.width + this.setup.gap * 2}px`;
  }

  /** 남은 쪽 조립을 짧은 조각으로 나눠 유휴 시간에 진행 (02 §7) */
  private scheduleBackground(): void {
    if (this.bgTimer !== null || this.layout.complete) return;
    this.bgTimer = setTimeout(() => {
      this.bgTimer = null;
      const t0 = performance.now();
      const more = this.layout.step(8);
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
    return Math.max(this.setup.gap, (this.scroller.clientWidth - this.setup.width) / 2);
  }

  private render(): void {
    const t0 = performance.now();
    const { scroller, canvas, ctx, layout, setup } = this;
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
    ctx.fillStyle = COLORS.desk;
    ctx.fillRect(0, 0, w, h);

    // 쪽
    const firstPage = Math.max(0, Math.floor((top - setup.gap) / (setup.height + setup.gap)));
    for (let p = firstPage; p < layout.pageCount; p++) {
      const y = pageTop(setup, p) - top;
      if (y > h) break;
      ctx.shadowColor = COLORS.pageShadow;
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = COLORS.page;
      ctx.fillRect(px, y, setup.width, setup.height);
    }
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // 떠 있는 개체 (11 §4.2): 글 뒤 개체는 글보다 먼저, 나머지는 글 다음에 그린다
    const floats = layout.floatsIn(top, top + h);
    for (const f of floats) if (f.float.spec.behind) this.drawFloat(f.para, f.float, px, top);

    // 줄
    const { anchor, head } = this.selection();
    const selFrom = Math.min(anchor, head);
    const selTo = Math.max(anchor, head);
    const visibleParas = new Set<number>();
    ctx.font = this.font;
    ctx.textBaseline = 'alphabetic';
    // 셰이핑 중이면 커닝을 켠다: 같은 글꼴 파일이면 캔버스가 HarfBuzz와 같은 폭으로 그린다 (ADR-0002)
    if (this.kerningOff) ctx.fontKerning = this.shapedFonts ? 'normal' : 'none';
    // 화면 영역이 아직 배치되지 않았으면 시간 예산 안에서만 배치한다 (스크롤바로 멀리 이동한 경우 등).
    // 못 끝낸 부분은 자리표시로 그리고 다음 프레임에 이어서 한다.
    const ready = layout.ensureThroughY(top + h, RENDER_LAYOUT_BUDGET_MS);
    const validCount = layout.validCount;
    const nextRef = (r: { para: number; line: number }) => {
      if (r.line + 1 < layout.paras[r.para]!.lines.length) return { para: r.para, line: r.line + 1 };
      return r.para + 1 < validCount ? { para: r.para + 1, line: 0 } : null;
    };
    let ref: { para: number; line: number } | null = layout.firstLineBelow(top, false);
    for (; ref; ref = nextRef(ref)) {
      const para = layout.paras[ref.para]!;
      const ln = para.lines[ref.line]!;
      const y = ln.y - top;
      if (y > h) break;
      if (y + ln.height < 0) continue;
      visibleParas.add(ref.para);
      const { xs, preedit } = para.layout;
      const pStart = para.info.start;
      const x0 = px + ln.x - xs[ln.start]!;
      /** 표시 인덱스 d의 화면 x (들여쓰기·정렬·양쪽 맞춤 포함) */
      const X = (d: number) => px + lineX(para.layout, ln, d);
      const sty = this.styleKey(para.info as ParagraphInfo);

      // 끌고 있는 문단
      if (this.drag && ref.para >= this.drag.i && ref.para <= this.drag.j) {
        ctx.fillStyle = COLORS.dragSource;
        ctx.fillRect(px + ln.x - 6, y, setup.width - setup.margin * 2 + 12, ln.height);
      }

      // 형광펜 (선택 영역 아래)
      const baseY = ln.baseline - top;
      if (para.layout.fmt) this.drawHighlights(para.layout, ln, px, baseY, sty);

      // 선택 영역
      if (selFrom !== selTo) {
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
          ctx.fillStyle = this.focused ? COLORS.selection : COLORS.selectionBlur;
          ctx.fillRect(sx, y, Math.max(1, ex - sx), ln.height);
        }
      }

      // 다른 사용자의 선택 영역
      for (const rc of this.remotes) {
        if (rc.anchor === rc.head) continue;
        const pEnd = this.doc.paragraphs()[ref.para]!.end; // 이 문단 ¶의 오프셋
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

      // 목록 번호·글머리 (첫 줄, 내어쓴 자리)
      if (ln.index === 0 && para.layout.marker) this.drawMarker(para.layout, px, baseY, sty);

      // 글자
      ctx.fillStyle = COLORS.text;
      const midY = baseY;
      if (this.shapedFonts || para.layout.fmt || ln.adj || para.layout.objs) {
        this.drawRuns(para.layout, ln, px, baseY, sty);
        if (para.layout.objs) this.drawObjects(para, ln, px, baseY);
        if (para.layout.fmt) this.drawDecorations(para.layout, ln, px, baseY, sty);
        ctx.font = this.font;
        ctx.fillStyle = COLORS.text;
      } else if (this.kerningOff) {
        // 커닝을 끄면 문자열 폭 = 글자 폭의 합이므로 탭 사이 구간을 한 번에 그린다 (그리기 호출 수 ↓)
        const text = cpSlice(para.layout, ln.start, ln.end);
        let segStart = ln.start;
        let cp = ln.start;
        let u = 0;
        let segU = 0;
        const flush = (endU: number) => {
          if (endU > segU) ctx.fillText(text.slice(segU, endU), x0 + xs[segStart]!, midY);
        };
        while (u < text.length) {
          const c = text.charCodeAt(u);
          const w = c >= 0xd800 && c <= 0xdbff && u + 1 < text.length ? 2 : 1;
          if (c === 9) {
            flush(u);
            segStart = cp + 1;
            segU = u + 1;
          }
          u += w;
          cp++;
        }
        flush(text.length);
      } else {
        // 커닝을 끌 수 없는 브라우저: grapheme마다 계산된 위치에 그림
        let i = ln.start;
        while (i < ln.end) {
          let j = i + 1;
          while (j < ln.end && !para.layout.stops[j]) j++;
          const g = cpSlice(para.layout, i, j);
          if (g !== ' ' && g !== '\t') ctx.fillText(g, x0 + xs[i]!, midY);
          i = j;
        }
      }

      // 조합 중 밑줄
      if (preedit) {
        const a = Math.max(preedit[0], ln.start);
        const b = Math.min(preedit[1], ln.end);
        if (a < b) {
          ctx.fillStyle = COLORS.preedit;
          ctx.fillRect(X(a), y + ln.height - 5, X(b) - X(a), 1.5);
        }
      }
    }

    for (const f of floats) if (!f.float.spec.behind) this.drawFloat(f.para, f.float, px, top);
    ctx.textBaseline = 'middle';
    this.drawParagraphDrag(px, top);
    this.drawRemoteCarets(px, top, w, visibleParas);

    if (!ready) {
      this.drawPendingPlaceholder(px, top, w, h);
      this.scheduleRender();
    }

    this.releaseImages();
    this.updateCaret();
    this.updateMirror(visibleParas);
    this.reportSelection();
    this.stats.renderMs = performance.now() - t0;
  }

  // ── 서식 (10 §4) ──────────────────────────────────────

  /** 문단의 스타일 캐시 키: 스타일에 기본 글자 서식이 있으면 그 이름, 없으면 '' */
  private styleKey(info: ParagraphInfo): string {
    const name = info.attrs?.style ?? BODY_STYLE;
    return hasKeys(this.doc.resolvedStyle(name).marks) ? name : '';
  }

  /** 스타일 sty 문단의 서식 번호 → 레이아웃 영향 (함수는 스타일마다 하나) */
  private styleFn(sty: string): (id: number) => RunStyle {
    this.checkStyleCaches();
    let f = this.styleFns.get(sty);
    if (!f) {
      f = (id: number) => this.drawStyle(id, sty).run;
      this.styleFns.set(sty, f);
    }
    return f;
  }

  private checkStyleCaches(): void {
    const k = this.drawStylesKey;
    if (!k || k.doc !== this.doc || k.version !== this.doc.stylesVersion) {
      this.drawStyles.clear();
      this.styleFns.clear();
      this.drawStylesKey = { doc: this.doc, version: this.doc.stylesVersion };
    }
  }

  /** (문단 스타일 sty, 서식 번호) → 그리기 정보. 스타일의 기본 글자 서식 위에 글자 서식을 덮는다 */
  private drawStyle(id: number, sty = ''): DrawStyle {
    this.checkStyleCaches();
    let table = this.drawStyles.get(sty);
    if (!table) {
      table = [];
      this.drawStyles.set(sty, table);
    }
    let d = table[id];
    if (d) return d;
    const own = this.doc.markSet(id);
    const m: MarkSet = sty ? { ...this.doc.resolvedStyle(sty).marks, ...own } : own;
    if (!hasKeys(m)) d = PLAIN_DRAW;
    else {
      // 크기는 1/1000pt → px (96dpi)
      const sizePx = typeof m.size === 'number' && m.size > 0 ? (m.size / 1000) * (96 / 72) : this.fontSize;
      const base = sizePx / this.fontSize;
      const script = m.script === 'sup' || m.script === 'sub' ? m.script : null;
      const scale = script ? base * SCRIPT_SCALE : base;
      const face = m.bold ? 1 : 0;
      d = {
        run: face === 0 && scale === 1 && base === 1 ? PLAIN_STYLE : { face, scale, line: base },
        bold: !!m.bold,
        italic: !!m.italic,
        underline: !!m.underline || !!m.link,
        strike: !!m.strike,
        color: m.color ?? (m.link ? LINK_COLOR : null),
        highlight: m.highlight ?? null,
        shift: script === 'sup' ? SUP_SHIFT * sizePx : script === 'sub' ? SUB_SHIFT * sizePx : 0,
      };
    }
    table[id] = d;
    return d;
  }

  /** 문단 속성(스타일 사슬 → 직접 속성)을 px 상자로. 레이아웃에 영향이 없으면 null (기본 문단과 같은 빠른 경로) */
  private paraBox(attrs: ParaAttrs, rs: ResolvedStyle, label: ListLabel | null = null): ParaBox | null {
    const a = hasKeys(rs.para) ? mergeParaAttrs(rs.para, attrs) : attrs;
    if (!a.align && !a.indent && !a.space && !a.line && !label) return null;
    // 목록 문단: 왼쪽 들여쓰기는 목록 수준의 값, 첫 줄은 본문과 나란히 (번호는 내어쓴 자리에, 10 §4)
    const lv = label ? label.def.levels[label.level]! : null;
    return {
      align: a.align ?? 'left',
      left: lv ? pt(lv.indent) : pt(a.indent?.left),
      right: pt(a.indent?.right),
      first: lv ? 0 : pt(a.indent?.first),
      before: a.space?.before !== undefined ? pt(a.space.before) : this.setup.paraSpacing,
      after: pt(a.space?.after),
      line: a.line ? (a.line.rule === 'multiple' ? { rule: 'multiple', value: a.line.value } : { rule: a.line.rule, value: pt(a.line.value) }) : null,
    };
  }

  /** 그리기용 CSS font: 글꼴 번호 f(셰이핑 중)와 서식 */
  private cssFont(f: number, d: DrawStyle): string {
    const size = this.fontSize * d.run.scale;
    const families = this.shapedFonts;
    if (families && f < families.length) {
      // 굵은 얼굴을 불러왔으면 그것, 아니면 보통 굵기를 합성 굵게
      const boldFamily = d.bold ? this.boldFonts[f] : null;
      if (boldFamily) return `${size}px ${boldFamily}`;
      return `${d.bold ? 'bold ' : ''}${size}px ${families[f]!}`;
    }
    return `${d.bold ? 'bold ' : ''}${size}px ${this.family}`;
  }

  /**
   * 줄 글자 그리기: 어절(공백·탭 사이)과 글꼴·서식이 바뀌는 곳마다 나눠 레이아웃 위치에 fillText. 레이아웃이 같은 단위로
   * 셰이핑했으므로 어절 경계 커닝 차이가 생기지 않는다. 기울임은 기준선 기준으로 기울여 그린다 (진행폭은 바로 선 글꼴).
   * 양쪽 맞춤이 글자 사이에 나뉜 줄은 글자마다 나눠 그린다.
   */
  private drawRuns(pl: ParaLayout, ln: PlacedLine, px: number, baseY: number, sty: string): void {
    const { ctx } = this;
    const fonts = pl.fonts;
    const fmt = pl.fmt;
    const start = ln.start;
    const end = ln.end;
    const fontAt = (k: number) => (fonts ? fonts[k]! : 0);
    const idAt = (k: number) => (fmt ? fmt[k]! : 0);
    const blank = (c: string) => c === ' ' || c === '\t' || c === '　' || c === OBJ;
    const perChar = ln.adjChars;
    let lastFont = '';
    let k = start;
    while (k < end) {
      if (blank(cpSlice(pl, k, k + 1))) {
        k++;
        continue;
      }
      const f = fontAt(k);
      const id = idAt(k);
      let j = k + 1;
      while (j < end && !(perChar && pl.stops[j]) && fontAt(j) === f && idAt(j) === id && !blank(cpSlice(pl, j, j + 1))) j++;
      const d = this.drawStyle(id, sty);
      const font = this.cssFont(f, d);
      if (font !== lastFont) {
        ctx.font = font;
        lastFont = font;
      }
      ctx.fillStyle = d.color ?? COLORS.text;
      const x = px + lineX(pl, ln, k);
      const y = baseY + d.shift;
      const t = cpSlice(pl, k, j);
      if (d.italic) {
        ctx.save();
        ctx.translate(x, y);
        ctx.transform(1, 0, -ITALIC_SKEW, 1, 0, 0);
        ctx.fillText(t, 0, 0);
        ctx.restore();
      } else ctx.fillText(t, x, y);
      k = j;
    }
  }

  /** 그리기 정보가 같은 구간 [k, j)마다 fn (줄 안, 끝 공백 제외) */
  private eachFormatRun(pl: ParaLayout, ln: PlacedLine, sty: string, fn: (k: number, j: number, d: DrawStyle) => void): void {
    const fmt = pl.fmt!;
    const start = ln.start;
    let end = ln.end;
    while (end > start && /^[ \t　]$/.test(cpSlice(pl, end - 1, end))) end--;
    let k = start;
    while (k < end) {
      let j = k + 1;
      while (j < end && fmt[j] === fmt[k]) j++;
      const d = this.drawStyle(fmt[k]!, sty);
      if (d !== PLAIN_DRAW) fn(k, j, d);
      k = j;
    }
  }

  private drawHighlights(pl: ParaLayout, ln: PlacedLine, px: number, baseY: number, sty: string): void {
    const { ctx } = this;
    const { ascent, descent } = this.metrics;
    this.eachFormatRun(pl, ln, sty, (k, j, d) => {
      if (!d.highlight) return;
      const em = this.fontSize * d.run.line;
      const x = px + lineX(pl, ln, k);
      ctx.fillStyle = d.highlight;
      ctx.fillRect(x, baseY - ascent * em, px + lineX(pl, ln, j) - x, (ascent + descent) * em);
    });
  }

  /** 밑줄·취소선: 위치·두께는 기본 글꼴 치수 (post·OS/2), 글자 크기 비례 */
  private drawDecorations(pl: ParaLayout, ln: PlacedLine, px: number, baseY: number, sty: string): void {
    const { ctx } = this;
    const m = this.metrics;
    this.eachFormatRun(pl, ln, sty, (k, j, d) => {
      if (!d.underline && !d.strike) return;
      const em = this.fontSize * d.run.scale;
      const x = px + lineX(pl, ln, k);
      const w = px + lineX(pl, ln, j) - x;
      const y = baseY + d.shift;
      ctx.fillStyle = d.color ?? COLORS.text;
      if (d.underline) {
        const th = Math.max(1, m.underlineThickness * em);
        ctx.fillRect(x, y - m.underlinePosition * em - th / 2, w, th);
      }
      if (d.strike) {
        const th = Math.max(1, m.strikeThickness * em);
        ctx.fillRect(x, y - m.strikePosition * em - th / 2, w, th);
      }
    });
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

  /** 줄의 개체 그리기: 기준선 위에 선 상자. 원본이 없으면 자리표시(회색 상자 + 대체 텍스트) */
  private drawObjects(para: PlacedPara, ln: PlacedLine, px: number, baseY: number): void {
    const { ctx } = this;
    const pl = para.layout;
    const info = para.info as ParagraphInfo;
    const [selFrom, selTo] = this.range();
    for (const [k, box] of pl.objs!) {
      if (k < ln.start || k >= ln.end) continue;
      const attrs = info.objs?.get(pl.preedit && k >= pl.preedit[0] ? k - (pl.preedit[1] - pl.preedit[0]) : k);
      const x = px + lineX(pl, ln, k);
      let { w, h } = box;
      const offset = info.start + k;
      if (this.resizing && this.resizing.offset === offset) ({ w, h } = this.resizing);
      const y = baseY - h;
      const img = attrs?.asset ? this.image(attrs.asset) : 'error';
      if (img && img !== 'error') ctx.drawImage(img, x, y, w, h);
      else {
        ctx.fillStyle = '#e9e9ec';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#c7c7cc';
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.fillStyle = COLORS.placeholderText;
        ctx.font = `${Math.min(13, this.fontSize)}px ${this.family}`;
        ctx.fillText(img === 'error' ? `이미지 없음${attrs?.alt ? `: ${attrs.alt}` : ''}` : (attrs?.alt ?? '불러오는 중…'), x + 6, y + Math.min(h - 6, 18), w - 12);
      }
      // 선택한 개체: 테두리와 손잡이
      if (selTo - selFrom === 1 && selFrom === offset) {
        ctx.strokeStyle = COLORS.gripActive;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
        ctx.lineWidth = 1;
        ctx.fillStyle = '#ffffff';
        for (const [hx, hy] of handlePoints(x, y, w, h)) {
          ctx.fillRect(hx - 4, hy - 4, 8, 8);
          ctx.strokeRect(hx - 4 + 0.5, hy - 4 + 0.5, 7, 7);
        }
      }
    }
  }

  /** 떠 있는 개체 하나 그리기 (선택했으면 손잡이) */
  private drawFloat(para: PlacedPara, f: PlacedFloat, px: number, top: number): void {
    const { ctx } = this;
    const info = para.info as ParagraphInfo;
    const pl = para.layout;
    const k = pl.preedit && f.k >= pl.preedit[0] ? f.k - (pl.preedit[1] - pl.preedit[0]) : f.k;
    const attrs = info.objs?.get(k);
    const offset = info.start + k;
    let { w, h } = f;
    if (this.resizing && this.resizing.offset === offset) ({ w, h } = this.resizing);
    let x = px + f.x;
    let y = f.y - top;
    if (this.moving && this.moving.offset === offset) {
      x += this.moving.dx;
      y += this.moving.dy;
    }
    const img = attrs?.asset ? this.image(attrs.asset) : 'error';
    ctx.textBaseline = 'alphabetic';
    if (img && img !== 'error') ctx.drawImage(img, x, y, w, h);
    else {
      ctx.fillStyle = '#e9e9ec';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = COLORS.placeholderText;
      ctx.font = `${Math.min(13, this.fontSize)}px ${this.family}`;
      ctx.fillText(attrs?.alt ?? '이미지', x + 6, y + 18, w - 12);
    }
    const [from, to] = this.range();
    if (to - from === 1 && from === offset) {
      ctx.strokeStyle = COLORS.gripActive;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
      ctx.lineWidth = 1;
      ctx.fillStyle = '#ffffff';
      for (const [hx, hy] of handlePoints(x, y, w, h)) {
        ctx.fillRect(hx - 4, hy - 4, 8, 8);
        ctx.strokeRect(hx - 4 + 0.5, hy - 4 + 0.5, 7, 7);
      }
      // 앵커 표시: 개체가 붙은 문단의 첫 줄 왼쪽
      const ln = para.lines[0];
      if (ln) {
        ctx.fillStyle = COLORS.gripActive;
        ctx.font = `12px ${this.family}`;
        ctx.fillText('⚓', px + this.setup.margin - 18, ln.baseline - top);
      }
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
    const maxW = this.setup.width - this.setup.margin * 2;
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
    this.setSelection(from, from + 1); // 넣은 이미지를 선택
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
      const float: FloatAttrs = { ...attrs.float, relX: 'column', x: toPt(newX - this.setup.margin), y: toPt(newY - tTop), relY: 'paragraph' };
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
      if (corner) h = w * ratio;
      if (sx === 0) w = obj.w;
      if (sy === 0) h = obj.h;
      this.resizing = { offset: obj.offset, w, h };
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
      this.history.seal();
      if (ops.length) this.commit(ops, before);
      else this.render();
      this.history.seal();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /** 목록 번호: 본문 왼쪽에서 내어 쓴 자리, ¶ 서식으로 (10 §4) */
  private drawMarker(pl: ParaLayout, px: number, baseY: number, sty: string): void {
    const mk = pl.marker!;
    const { ctx } = this;
    const d = this.drawStyle(mk.id, sty);
    const x0 = px + this.setup.margin + (pl.box?.left ?? 0) + mk.x;
    ctx.fillStyle = d.color ?? COLORS.text;
    // 글꼴이 바뀌는 곳마다 (글머리 기호가 대체 글꼴에 있을 수 있다)
    const cps = Array.from(mk.text);
    let x = x0;
    let k = 0;
    while (k < cps.length) {
      const f = mk.fonts ? mk.fonts[k]! : 0;
      let j = k + 1;
      while (j < cps.length && (mk.fonts ? mk.fonts[j]! : 0) === f) j++;
      ctx.font = this.cssFont(f, d);
      const t = cps.slice(k, j).join('');
      ctx.fillText(t, x, baseY + d.shift);
      x += ctx.measureText(t).width;
      k = j;
    }
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
      for (const key of ['align', 'indent', 'space', 'line'] as const)
        if (JSON.stringify(a[key]) !== JSON.stringify(first[key])) mixed.add(key);
    }
    return { style: styleOf(i), attrs: first, mixed };
  }

  /** 선택한 문단들의 문단 속성 키 하나를 value로 (undefined = 해제). 실행 취소 한 단계 */
  setParagraphAttr(key: ParaKey, value: unknown): void {
    this.input.commitComposition();
    const [i, j] = this.selectedParagraphs();
    const before: Selection = { ...this.sel };
    const ops: Op[] = [];
    for (let k = i; k <= j; k++) ops.push(...this.doc.setParaAttr(k, key, value));
    if (ops.length === 0) return;
    this.history.seal();
    this.commit(ops, before);
    this.history.seal();
  }

  /** 선택한 문단들에 문단 스타일 (본문이면 style 키를 지운다) */
  setParagraphStyle(name: string): void {
    this.setParagraphAttr('style', name === BODY_STYLE ? undefined : name);
  }

  /** 문단 스타일 정의를 바꾼다 (그 스타일을 쓰는 문단만 다시 조판). 실행 취소 한 단계 */
  setStyleDef(name: string, def: Style | undefined): void {
    this.input.commitComposition();
    const before: Selection = { ...this.sel };
    const ops = this.doc.setStyle(name, def);
    if (ops.length === 0) return;
    this.history.seal();
    this.commit(ops, before);
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
    if (from === to) return null;
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
    this.replaceSelection('\n', undefined, next !== undefined && next !== name ? () => this.doc.setParaAttr(pi + 1, 'style', next === BODY_STYLE ? undefined : next) : undefined);
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
    const { ctx, setup, layout } = this;
    const g = this.drag ? this.drag.i : this.hoverPara;
    if (g >= 0 && g < layout.validCount) {
      const ln = layout.paras[g]!.lines[0]!;
      const cx = px + setup.margin - (GRIP_LEFT + GRIP_RIGHT) / 2;
      const cy = ln.y - top + ln.height / 2;
      ctx.fillStyle = this.drag || this.hoverGrip ? COLORS.gripActive : COLORS.grip;
      for (let r = -1; r <= 1; r++) {
        for (const c of [-2.5, 2.5]) {
          ctx.beginPath();
          ctx.arc(cx + c, cy + r * 5, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (!this.drag || this.drag.to < 0) return;
    const n = this.doc.paragraphs().length;
    const to = this.drag.to;
    let yLine: number;
    if (to < n) {
      if (to >= layout.validCount) return;
      yLine = layout.paras[to]!.lines[0]!.y - setup.paraSpacing / 2;
    } else {
      if (n - 1 >= layout.validCount) return;
      yLine = layout.paras[n - 1]!.bottom + setup.paraSpacing / 2;
    }
    const x = px + setup.margin - 8;
    const y = yLine - top;
    ctx.fillStyle = COLORS.dropLine;
    ctx.fillRect(x, y - 1, setup.width - setup.margin * 2 + 16, 2);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 다른 사용자의 캐럿과 이름표. 화면에 보이는 문단에 있는 것만 */
  private drawRemoteCarets(px: number, top: number, w: number, visible: Set<number>): void {
    if (this.remotes.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.font = `600 11px ${this.font.replace(/^\d+px /, '')}`;
    ctx.textBaseline = 'middle';
    for (const rc of this.remotes) {
      const head = Math.min(rc.head, this.doc.maxCaret);
      if (!visible.has(this.doc.paragraphIndexAt(head))) continue;
      const r = this.layout.caretRect(head);
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
    if (this.sel === this.reportedSel || !this.opts.onSelectionChange) return;
    this.reportedSel = this.sel;
    const { anchor, head } = this.selection();
    this.opts.onSelectionChange(anchor, head);
  }

  /** 아직 배치되지 않은 영역: 쪽 위에 옅은 막과 진행률을 그린다 */
  private drawPendingPlaceholder(px: number, top: number, w: number, h: number): void {
    const { ctx, setup, layout } = this;
    const from = Math.max(0, layout.validBottom - top);
    if (from >= h) return;
    ctx.fillStyle = COLORS.placeholder;
    ctx.fillRect(px, from, setup.width, h - from);
    const total = this.doc.paragraphs().length;
    const pct = total ? Math.floor((layout.validCount / total) * 100) : 100;
    ctx.fillStyle = COLORS.placeholderText;
    ctx.textAlign = 'center';
    ctx.fillText(`쪽 조립 중… ${pct}%`, Math.min(px + setup.width / 2, w / 2), Math.max(from, 0) + (h - from) / 2);
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
    const infos = [...paras].sort((a, b) => a - b).map((p) => this.doc.paragraphs()[p]).filter((p) => p !== undefined);
    const key = infos
      .map((p) => `${p.attrs.style ?? ''}\u0002${this.doc.listLabel(p)?.text ?? ''}\u0003${p.fmt ? `${p.text}\u0001${p.fmt.join(',')}` : p.text}`)
      .join('\n');
    if (this.mirror.dataset.key === key) return;
    this.mirror.dataset.key = key;
    // 목록 문단은 같은 목록이 이어지는 동안 ul/ol 하나에 li로. 번호는 글자로 앞에 붙인다 (화면과 같은 번호를 읽게)
    const out: HTMLElement[] = [];
    let group: { id: string; el: HTMLElement } | null = null;
    for (const info of infos) {
      const label = this.doc.listLabel(info);
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

  /** 문단 하나의 미러 요소 */
  private mirrorPara(info: ParagraphInfo, forceTag?: string): HTMLElement {
    // 제목·인용은 h1–h3·blockquote로 (04 §3): 스크린리더가 구조를 읽는다
    const tag = forceTag ?? ({ h1: 'h1', h2: 'h2', h3: 'h3', quote: 'blockquote' } as Record<string, string>)[info.attrs.style ?? ''] ?? 'p';
    const p = document.createElement(tag);
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
        img.setAttribute('aria-label', o.alt || '이미지');
        p.append(img);
        k++;
        continue;
      }
      let j = k + 1;
      while (j < cps.length && fmt[j] === fmt[k] && !info.objs?.has(j)) j++;
      const m = this.doc.markSet(fmt[k]!);
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
    this.sel = { anchor: this.doc.positionAt(anchor), head: this.doc.positionAt(head) };
    if (!keepGoal) this.goalX = null;
    if (this.pending && (anchor !== head || head !== this.pending.at)) this.pending = null;
  }

  // ── 편집 ──────────────────────────────────────────────

  /** 선택 영역을 지우고 텍스트를 넣는다. 결과를 트랜잭션 하나로 기록 */
  private replaceSelection(text: string, mergeKey?: string, extra?: () => Op[]): void {
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

  private deleteRange(from: number, to: number, mergeKey?: string): void {
    if (from === to) return;
    const before: Selection = { ...this.sel };
    const merge = this.mergeKeepAttrs(from, to);
    const ops = this.doc.deleteRange(from, to);
    if (merge) {
      ops.push(...merge());
      mergeKey = undefined;
    }
    this.setSelection(from);
    this.commit(ops, before, mergeKey);
  }

  /** 선택 영역이 걸친 문단들. [첫 문단, 끝 문단] (화면 인덱스) */
  private selectedParagraphs(): [number, number] {
    const [from, to] = this.range();
    return [this.doc.paragraphIndexAt(from), this.doc.paragraphIndexAt(to)];
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

  private commit(ops: Op[], before: Selection, mergeKey?: string): void {
    this.history.record({ ops, before, after: { ...this.sel }, mergeKey, time: Date.now() });
    this.afterChange();
  }

  private afterChange(): void {
    this.relayout();
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  private moveTo(offset: number, extend: boolean, keepGoal = false): void {
    const { anchor } = this.selection();
    this.setSelection(extend ? anchor : offset, offset, keepGoal);
    this.history.seal();
    this.scrollCaretIntoView();
    this.render();
    this.opts.onChange?.(this);
  }

  private undo(): void {
    const sel = this.history.undo(this.doc);
    if (sel) {
      this.sel = sel;
      this.afterChange();
    }
  }

  private redo(): void {
    const sel = this.history.redo(this.doc);
    if (sel) {
      this.sel = sel;
      this.afterChange();
    }
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
        const [from, to] = i.replace ?? this.range();
        if (i.replace) this.setSelection(from, to);
        if (from !== to) this.deleteRange(from, to);
        this.preedit = '';
        break;
      }
      case 'replaceText': {
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
        if (from === to) return;
        i.event.clipboardData?.setData('text/plain', this.doc.slice(from, to));
        if (i.kind === 'cut') this.deleteRange(from, to);
        break;
      }
      case 'paste':
        this.history.seal();
        if (i.files?.length) {
          for (const f of i.files) void this.insertImage(f);
          break;
        }
        this.replaceSelection(i.text);
        break;
    }
  }

  private onKey(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const head = this.headOffset();
    const [from, to] = this.range();
    let handled = true;

    if (e.altKey && shift && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      this.moveParagraphs(e.key === 'ArrowUp' ? -1 : 1);
      e.preventDefault();
      return;
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
          else this.deleteRange(head, this.wordBoundary(head, 1));
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
          else if (head > 0) this.deleteRange(this.layout.prevStop(head), head, 'delete');
          break;
        case 'Delete':
          if (from !== to) this.deleteRange(from, to);
          else if (head < this.doc.maxCaret) this.deleteRange(head, this.layout.nextStop(head), 'delete');
          break;
        case 'ArrowLeft':
          if (from !== to && !shift) this.moveTo(from, false);
          else this.moveTo(this.layout.prevStop(head), shift);
          break;
        case 'ArrowRight':
          if (from !== to && !shift) this.moveTo(to, false);
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
          // 목록 문단이면 수준 ±1 (10 §2.4), 아니면 탭 문자 (Shift+Tab은 목록에서만)
          if (!this.listLevel(shift ? -1 : 1) && !shift) this.replaceSelection('\t', 'type');
          break;
        default:
          handled = false;
      }
    }
    if (handled) e.preventDefault();
  }

  private moveVertical(dir: number, extend: boolean): void {
    const head = this.headOffset();
    const r = this.layout.caretRect(head);
    if (this.goalX === null) this.goalX = r.x;
    const target = this.layout.stepLine(r.ref, dir);
    let offset: number;
    if (target) offset = this.layout.offsetInLine(target, this.goalX);
    else offset = dir < 0 ? 0 : this.doc.maxCaret;
    this.moveTo(offset, extend, true);
  }

  /** 단어(어절) 경계. dir=-1이면 이전, 1이면 다음 */
  private wordBoundary(offset: number, dir: -1 | 1): number {
    const para = this.doc.paragraphs()[this.layout.paraIndexAt(offset)]!;
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
    if (p.y >= this.layout.validBottom) return;
    if (e.detail === 1 && this.inGrip(p.x)) {
      const ref = this.layout.firstLineBelow(p.y, false);
      if (ref) {
        this.startParagraphDrag(ref.para, e);
        return;
      }
    }
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

  // ── 문단 끌기 ─────────────────────────────────────────

  /** 쪽 왼쪽 기준 x가 문단 손잡이 영역인가 */
  private inGrip(x: number): boolean {
    const m = this.setup.margin;
    return x >= m - GRIP_LEFT && x < m - GRIP_RIGHT;
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
    const { margin, width } = this.setup;
    let para = -1;
    if (p.x >= margin - GRIP_LEFT && p.x <= width - margin && p.y < this.layout.validBottom) {
      const ref = this.layout.firstLineBelow(p.y, false);
      if (ref && p.y >= this.layout.paras[ref.para]!.lines[0]!.y - this.setup.paraSpacing) para = ref.para;
    }
    this.setHover(para, para >= 0 && this.inGrip(p.x));
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
    const layout = this.layout;
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

function hasKeys(o: object): boolean {
  for (const _ in o) return true;
  return false;
}

/** 코드포인트 수 */
function cpCount(t: string): number {
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length) i++;
    n++;
  }
  return n;
}

/** 1/1000pt → px (96dpi) */
function pt(v: number | undefined): number {
  return ((v ?? 0) / 1000) * (96 / 72);
}

/** 인라인 개체 속성 → 레이아웃 크기 (px). 크기가 없으면 100px 정사각형. 떠 있는 개체는 뺀다 */
function objSizes(objs: ReadonlyMap<number, ObjAttrs>): Map<number, { w: number; h: number }> | null {
  const out = new Map<number, { w: number; h: number }>();
  for (const [k, o] of objs) if (!o.float) out.set(k, { w: o.w ? pt(o.w) : 100, h: o.h ? pt(o.h) : 100 });
  return out.size ? out : null;
}

/** 떠 있는 개체 → 레이아웃 입력 (px) */
function floatSpecs(objs: ReadonlyMap<number, ObjAttrs>): Map<number, FloatSpec> | null {
  let out: Map<number, FloatSpec> | null = null;
  for (const [k, o] of objs) {
    const f = o.float;
    if (!f) continue;
    (out ??= new Map()).set(k, {
      w: o.w ? pt(o.w) : 100,
      h: o.h ? pt(o.h) : 100,
      relX: f.relX,
      relY: f.relY,
      x: typeof f.x === 'number' ? pt(f.x) : f.x,
      y: pt(f.y),
      wrap: f.wrap,
      side: f.side ?? 'largest',
      gap: pt(f.gap ?? 9000),
      behind: !!f.behind,
    });
  }
  return out;
}

/** 크기 조절 손잡이 8곳 (왼쪽 위부터 시계 방향) */
function handlePoints(x: number, y: number, w: number, h: number): Array<[number, number]> {
  return [
    [x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2],
    [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2],
  ];
}
