/**
 * 0단계 에디터: 캔버스 렌더링 + 숨긴 textarea 입력 + 자체 선택 모델
 * 설계: docs/design/03, 04, 08
 */
import { Doc, History, type Op, type Position, type Selection } from '@quire/model';
import {
  LayoutCache,
  caretRect,
  firstLineBelow,
  hitTest,
  layoutDocument,
  lineAt,
  nextStop,
  offsetInLine,
  pageTop,
  paraIndexAt,
  prevStop,
  stepLine,
  type DocLayout,
  type Measurer,
  type PageSetup,
} from '@quire/layout';
import { TextareaInput, type InputIntent, type InputLogEntry } from './input';

export interface EditorOptions {
  host: HTMLElement;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  onInputLog?: (entry: InputLogEntry) => void;
  onChange?: (editor: Editor) => void;
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
}

const COLORS = {
  desk: '#e9e9ec',
  page: '#ffffff',
  pageShadow: 'rgba(0,0,0,0.12)',
  text: '#1d1d1f',
  selection: 'rgba(56, 132, 255, 0.28)',
  selectionBlur: 'rgba(0, 0, 0, 0.12)',
  preedit: '#1d1d1f',
};

class CanvasMeasurer implements Measurer {
  private ctx: CanvasRenderingContext2D;
  private cache = new Map<string, number>();
  constructor(font: string) {
    this.ctx = document.createElement('canvas').getContext('2d')!;
    this.ctx.font = font;
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
  layout!: DocLayout;
  stats: EditorStats = {
    layoutMs: 0, renderMs: 0, pages: 0, paragraphs: 0, lines: 0, characters: 0, cacheHits: 0, cacheMisses: 0,
    reflowed: 0, repositioned: 0, reused: 0,
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
  private readonly input: TextareaInput;
  private readonly font: string;
  private readonly measurer: Measurer;
  private readonly cache = new LayoutCache();
  private readonly setup: PageSetup;
  private readonly fontSize: number;
  private resizeObserver: ResizeObserver;
  private renderQueued = false;
  private disposers: Array<() => void> = [];

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

    this.doc = Doc.fromText(opts.text ?? '');
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

    this.spacer = document.createElement('div');
    scroller.appendChild(this.spacer);

    const caret = document.createElement('div');
    caret.className = 'quire-caret';
    Object.assign(caret.style, {
      position: 'absolute', width: '2px', background: COLORS.text, pointerEvents: 'none', display: 'none',
    });
    scroller.appendChild(caret);
    this.caretEl = caret;
    ensureCaretStyle();

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

    this.input = new TextareaInput(scroller, (i) => this.handleIntent(i), opts.onInputLog);
    this.input.el.style.font = this.font;

    // ── 이벤트 ──
    this.listen(scroller, 'mousedown', (e) => this.onMouseDown(e as MouseEvent));
    this.listen(scroller, 'scroll', () => this.scheduleRender());
    this.listen(this.input.el, 'focus', () => { this.focused = true; this.scheduleRender(); });
    this.listen(this.input.el, 'blur', () => { this.focused = false; this.scheduleRender(); });
    this.resizeObserver = new ResizeObserver(() => this.refresh());
    this.resizeObserver.observe(scroller);

    this.relayout();
    this.render();
  }

  // ── 공개 API ──────────────────────────────────────────

  focus(): void {
    this.input.focus();
  }

  setText(text: string): void {
    this.doc = Doc.fromText(text);
    this.cache.clear();
    this.layout = undefined as unknown as DocLayout; // 다른 문서의 배치를 재사용하지 않도록
    const start = this.doc.positionAt(0);
    this.sel = { anchor: start, head: start };
    this.history = new History();
    this.refresh();
    this.scroller.scrollTop = 0;
  }

  getText(): string {
    return this.doc.text().slice(0, -1);
  }

  selection(): { anchor: number; head: number } {
    return { anchor: this.doc.resolve(this.sel.anchor), head: this.doc.resolve(this.sel.head) };
  }

  destroy(): void {
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
    this.layout = layoutDocument(paras, this.setup, this.measurer, this.cache, pre, this.layout ?? null);
    const t1 = performance.now();

    const s = this.stats;
    s.layoutMs = t1 - t0;
    s.pages = this.layout.pageCount;
    s.paragraphs = paras.length;
    let lineCount = 0;
    for (const p of this.layout.paras) lineCount += p.lines.length;
    s.lines = lineCount;
    s.characters = this.doc.length - paras.length;
    s.cacheHits = this.cache.hits;
    s.cacheMisses = this.cache.misses;
    s.reflowed = this.layout.counts.reflowed;
    s.repositioned = this.layout.counts.repositioned;
    s.reused = this.layout.counts.reused;

    const viewH = this.scroller.clientHeight;
    this.spacer.style.height = `${Math.max(0, this.layout.totalHeight - viewH)}px`;
    this.spacer.style.width = `${this.setup.width + this.setup.gap * 2}px`;
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
    let ref: { para: number; line: number } | null = firstLineBelow(layout, top);
    for (; ref; ref = stepLine(layout, ref, 1)) {
      const para = layout.paras[ref.para]!;
      const ln = para.lines[ref.line]!;
      const y = ln.y - top;
      if (y > h) break;
      if (y + ln.height < 0) continue;
      visibleParas.add(ref.para);
      const { cps, xs, preedit } = para.layout;
      const x0 = px + ln.x - xs[ln.start]!;

      // 선택 영역
      if (selFrom !== selTo) {
        const lineDocStart = para.start + ln.start;
        const isLast = ln.index === para.lines.length - 1;
        const lineDocEnd = para.start + ln.end + (isLast ? 1 : 0); // 마지막 줄은 ¶ 포함
        const a = Math.max(selFrom, lineDocStart);
        const b = Math.min(selTo, lineDocEnd);
        if (a < b) {
          const da = a - para.start;
          const db = Math.min(b - para.start, ln.end);
          const sx = x0 + xs[da]!;
          let ex = x0 + xs[db]!;
          if (isLast && b > para.start + ln.end) ex += this.fontSize * 0.5; // ¶ 표시 폭
          ctx.fillStyle = this.focused ? COLORS.selection : COLORS.selectionBlur;
          ctx.fillRect(sx, y, Math.max(1, ex - sx), ln.height);
        }
      }

      // 글자 (grapheme 단위로 계산된 위치에 그림 — 측정과 그리기 위치를 일치시키기 위해)
      ctx.fillStyle = COLORS.text;
      const midY = y + ln.height / 2;
      let i = ln.start;
      while (i < ln.end) {
        let j = i + 1;
        while (j < ln.end && !para.layout.stops[j]) j++;
        const g = cps.slice(i, j).join('');
        if (g !== ' ' && g !== '\t') ctx.fillText(g, x0 + xs[i]!, midY);
        i = j;
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

    this.updateCaret();
    this.updateMirror(visibleParas);
    this.stats.renderMs = performance.now() - t0;
  }

  private updateCaret(): void {
    const head = this.headOffset();
    const r = caretRect(this.layout, head);
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
    this.caretEl.classList.remove('quire-caret-blink');
    void this.caretEl.offsetWidth;
    this.caretEl.classList.add('quire-caret-blink');
    this.input.place(x, r.y, r.height);
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
    const r = caretRect(this.layout, this.headOffset());
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
      ops.push({ type: 'delete', ids: this.doc.deleteRange(from, to) });
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
    const ids = this.doc.deleteRange(from, to);
    this.setSelection(from);
    this.commit([{ type: 'delete', ids }], before, mergeKey);
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
        const [from, to] = this.range();
        if (from !== to) this.deleteRange(from, to);
        this.preedit = '';
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
          else if (head > 0) this.deleteRange(prevStop(this.layout, head), head, 'delete');
          break;
        case 'Delete':
          if (from !== to) this.deleteRange(from, to);
          else if (head < this.doc.maxCaret) this.deleteRange(head, nextStop(this.layout, head), 'delete');
          break;
        case 'ArrowLeft':
          if (from !== to && !shift) this.moveTo(from, false);
          else this.moveTo(prevStop(this.layout, head), shift);
          break;
        case 'ArrowRight':
          if (from !== to && !shift) this.moveTo(to, false);
          else this.moveTo(Math.min(this.doc.maxCaret, nextStop(this.layout, head)), shift);
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
          const ref = lineAt(this.layout, head);
          this.moveTo(offsetInLine(this.layout, ref, -Number.MAX_SAFE_INTEGER), shift);
          break;
        }
        case 'End': {
          const ref = lineAt(this.layout, head);
          this.moveTo(offsetInLine(this.layout, ref, Number.MAX_SAFE_INTEGER), shift);
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
    const r = caretRect(this.layout, head);
    if (this.goalX === null) this.goalX = r.x;
    const target = stepLine(this.layout, r.ref, dir);
    let offset: number;
    if (target) offset = offsetInLine(this.layout, target, this.goalX);
    else offset = dir < 0 ? 0 : this.doc.maxCaret;
    this.moveTo(offset, extend, true);
  }

  /** 단어(어절) 경계. dir=-1이면 이전, 1이면 다음 */
  private wordBoundary(offset: number, dir: -1 | 1): number {
    const para = this.doc.paragraphs()[paraIndexAt(this.layout, offset)]!;
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

  private docPoint(e: MouseEvent): { x: number; y: number } {
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
    const offset = hitTest(this.layout, p.x, p.y);

    if (e.detail === 2) {
      const [a, b] = this.wordAt(offset);
      this.setSelection(a, b);
    } else if (e.detail >= 3) {
      const para = this.doc.paragraphs()[paraIndexAt(this.layout, offset)]!;
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
      const head = hitTest(this.layout, q.x, q.y);
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

  private wordAt(offset: number): [number, number] {
    const para = this.doc.paragraphs()[paraIndexAt(this.layout, offset)]!;
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

let caretStyleInjected = false;
function ensureCaretStyle(): void {
  if (caretStyleInjected) return;
  caretStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes quire-blink { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0 } }
    .quire-caret-blink { animation: quire-blink 1.06s step-end infinite; }
    @media (prefers-reduced-motion: reduce) { .quire-caret-blink { animation: none; } }
  `;
  document.head.appendChild(style);
}

export type { Position };
