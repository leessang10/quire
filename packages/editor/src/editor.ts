/**
 * 0단계 에디터: 캔버스 렌더링 + 숨긴 textarea 입력 + 자체 선택 모델
 * 설계: docs/design/03, 04, 08
 */
import { Doc, History, type Op, type Position, type Selection } from '@quire/model';
import { LayoutCache, PagedLayout, cpSlice, docToDisplay, pageTop, type Measurer, type PageSetup } from '@quire/layout';
import { EditContextInput, editContextSupported } from './edit-context';
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
   * 입력 층 (03 §2). auto(기본): EditContext를 지원하면 경로 A, 아니면 숨긴 textarea(경로 B).
   * editcontext를 골랐는데 지원하지 않으면 textarea를 쓴다.
   */
  input?: InputMode;
  onChange?: (editor: Editor) => void;
  /** 선택 영역(캐럿)이 바뀌었을 때 (프레즌스 전송용). 화면 오프셋 */
  onSelectionChange?: (anchor: number, head: number) => void;
}

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

class CanvasMeasurer implements Measurer {
  private ctx: CanvasRenderingContext2D;
  private cache = new Map<string, number>();
  constructor(font: string) {
    this.ctx = document.createElement('canvas').getContext('2d')!;
    this.ctx.font = font;
    // 렌더링과 같은 조건으로 측정 (커닝 없음 → 줄 단위로 그려도 위치가 맞음)
    if ('fontKerning' in this.ctx) this.ctx.fontKerning = 'none';
  }
  width(g: string): number {
    let w = this.cache.get(g);
    if (w === undefined) {
      w = g === '\t' ? this.ctx.measureText('    ').width : this.ctx.measureText(g).width;
      this.cache.set(g, w);
    }
    return w;
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
  private readonly measurer: Measurer;
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
    const family = opts.fontFamily ?? `'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`;
    this.font = `${this.fontSize}px ${family}`;
    this.measurer = new CanvasMeasurer(this.font);
    // A4 @96dpi
    this.setup = {
      width: 794,
      height: 1123,
      margin: 96,
      gap: 24,
      lineHeight: Math.round(this.fontSize * 1.7),
      paraSpacing: Math.round(this.fontSize * 0.5),
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
    this.listen(this.input.el, 'focus', () => { this.focused = true; this.scheduleRender(); });
    this.listen(this.input.el, 'blur', () => { this.focused = false; this.scheduleRender(); });
    this.resizeObserver = new ResizeObserver(() => this.refresh());
    this.resizeObserver.observe(scroller);

    this.layout = new PagedLayout(this.setup, this.measurer, this.cache);
    this.relayout();
    this.render();
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
    this.layout = new PagedLayout(this.setup, this.measurer, this.cache);
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
    this.cache.clear();
    this.layout = new PagedLayout(this.setup, this.measurer, this.cache);
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
    const pre = this.preedit ? { offset: this.headOffset(), text: this.preedit } : null;
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

    // 줄
    const { anchor, head } = this.selection();
    const selFrom = Math.min(anchor, head);
    const selTo = Math.max(anchor, head);
    const visibleParas = new Set<number>();
    ctx.font = this.font;
    ctx.textBaseline = 'middle';
    if (this.kerningOff) ctx.fontKerning = 'none';
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

      // 끌고 있는 문단
      if (this.drag && ref.para >= this.drag.i && ref.para <= this.drag.j) {
        ctx.fillStyle = COLORS.dragSource;
        ctx.fillRect(px + ln.x - 6, y, setup.width - setup.margin * 2 + 12, ln.height);
      }

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
          const sx = x0 + xs[da]!;
          let ex = x0 + xs[db]!;
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
        const sx = x0 + xs[sd]!;
        const ex = x0 + xs[ed]! + (withMark ? this.fontSize * 0.5 : 0);
        ctx.fillStyle = withAlpha(rc.color, 0.22);
        ctx.fillRect(sx, y, Math.max(1, ex - sx), ln.height);
      }

      // 글자
      ctx.fillStyle = COLORS.text;
      const midY = y + ln.height / 2;
      if (this.kerningOff) {
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
          ctx.fillRect(x0 + xs[a]!, y + ln.height - 5, xs[b]! - xs[a]!, 1.5);
        }
      }
    }

    this.drawParagraphDrag(px, top);
    this.drawRemoteCarets(px, top, w, visibleParas);

    if (!ready) {
      this.drawPendingPlaceholder(px, top, w, h);
      this.scheduleRender();
    }

    this.updateCaret();
    this.updateMirror(visibleParas);
    this.reportSelection();
    this.stats.renderMs = performance.now() - t0;
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
    const texts = [...paras].sort((a, b) => a - b).map((p) => this.doc.paragraphs()[p]?.text ?? '');
    const key = texts.join('\n');
    if (this.mirror.dataset.key === key) return;
    this.mirror.dataset.key = key;
    this.mirror.replaceChildren(
      ...texts.map((t) => {
        const p = document.createElement('p');
        p.textContent = t;
        return p;
      }),
    );
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
  }

  // ── 편집 ──────────────────────────────────────────────

  /** 선택 영역을 지우고 텍스트를 넣는다. 결과를 트랜잭션 하나로 기록 */
  private replaceSelection(text: string, mergeKey?: string): void {
    const before: Selection = { ...this.sel };
    const [from, to] = this.range();
    const ops: Op[] = [];
    if (from !== to) {
      ops.push(...this.doc.deleteRange(from, to));
      mergeKey = undefined;
    }
    if (text) ops.push({ type: 'insert', ids: this.doc.insertText(from, text) });
    const caret = from + Array.from(text.replace(/\r\n?/g, '\n')).length;
    this.setSelection(caret);
    this.commit(ops, before, mergeKey);
  }

  private deleteRange(from: number, to: number, mergeKey?: string): void {
    if (from === to) return;
    const before: Selection = { ...this.sel };
    const ops = this.doc.deleteRange(from, to);
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
        this.replaceSelection('\n');
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
          if (from !== to) this.deleteRange(from, to);
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
          this.replaceSelection('\t', 'type');
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
