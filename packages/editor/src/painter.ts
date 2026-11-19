/**
 * 쪽 그리기기 (15 §5.1): 쪽의 내용(본문 줄·표·떠 있는 개체·머리말·꼬리말·각주·단 구분선)을 그리기 대상(PaintTarget)에 그린다.
 * 편집기의 것(선택, 주석·제안·장식, 캐럿, 원격 캐럿, 활성 스토리 흐리기, 개체 손잡이)은 덧그리기(PaintOverlay) 갈고리로
 * 편집기가 그린다. 그리기 순서가 편집기와 같아 화면 결과가 그대로다. DOM에 의존하지 않는다 (Node에서 PDF·시험).
 */
import { OBJ, cellKey, noteStoryId, type Doc, type Document, type FieldKind, type ParagraphInfo, type TableGrid } from '@quire/model';
import { CELL_PAD, cellGroups, cpSlice, lineX, rowParts, type PageSetup, type PagedLayout, type ParaLayout, type PlacedFloat, type PlacedLine, type PlacedPara } from '@quire/layout';
import { NOTE_INDENT, PLAIN_DRAW, type DrawStyle, type FieldValues, type Formatter, type TableView } from './formatter';
import { dateText, layoutHF, pageHF, type PageHF } from './headers';
import type { FontRef, ImageSource, PaintTarget } from './paint';

/** 글꼴 치수 (em 비율): 기준선·밑줄·취소선 */
export interface FontMetrics {
  ascent: number;
  descent: number;
  underlinePosition: number;
  underlineThickness: number;
  strikePosition: number;
  strikeThickness: number;
}

export const DEFAULT_METRICS: FontMetrics = {
  ascent: 0.8, descent: 0.2, underlinePosition: -0.1, underlineThickness: 0.06, strikePosition: 0.3, strikeThickness: 0.06,
};

/** 기울인 그리기의 기울기 (tan 약 12°) */
export const ITALIC_SKEW = 0.21;

/** 쪽 내용의 색 */
export const PAINT_COLORS = {
  text: '#1d1d1f',
  columnRule: '#9a9aa2',
  tableBorder: '#8e8e93',
  field: '#e4e4ea',
  placeholder: '#e9e9ec',
  placeholderBorder: '#c7c7cc',
  placeholderText: '#6e6e73',
};

/**
 * 그리기기가 읽는 것들. 그릴 때마다 읽는다 (편집기는 게터로 넘긴다: 글꼴을 불러오면 셰이핑 글꼴이 바뀐다)
 */
export interface PainterEnv {
  readonly fmt: Formatter;
  readonly document: Document;
  /** 본문 레이아웃 */
  readonly layout: PagedLayout;
  readonly setup: PageSetup;
  readonly fontSize: number;
  /** 시스템 글꼴 가족 (CSS font-family) */
  readonly family: string;
  readonly metrics: FontMetrics;
  /** 셰이핑 중이면 글꼴 번호별 가족 이름 (엔진 글꼴). null이면 시스템 글꼴 */
  readonly shapedFonts: readonly string[] | null;
  /** 글꼴 번호별 굵은 얼굴 가족 이름 (없으면 합성 굵게) */
  readonly boldFonts: ReadonlyArray<string | null>;
  /** 날짜 필드 값 (없으면 오늘) */
  readonly today?: string;
  readonly images: ImageSource;
}

/** 줄 하나의 덧그리기 정보 */
export interface LinePaint {
  /** 레이아웃의 문단 번호 */
  readonly index: number;
  readonly para: PlacedPara;
  readonly ln: PlacedLine;
  readonly doc: Doc;
  readonly isBody: boolean;
  /** 쪽 왼쪽 x, 줄 위 y, 기준선 y (대상 좌표) */
  readonly px: number;
  readonly y: number;
  readonly baseY: number;
  /** 표시 인덱스 d의 x (들여쓰기·정렬·양쪽 맞춤 포함) */
  readonly X: (d: number) => number;
}

/** 한 스토리(본문·셀·머리말·각주)의 줄마다 덧그리기: 형광펜 앞, 글자 앞, 글자 뒤 */
export interface StoryOverlay {
  back?(l: LinePaint): void;
  under?(l: LinePaint): void;
  over?(l: LinePaint): void;
}

/** 그린 개체 (손잡이 덧그리기) */
export interface ObjectPaint {
  /** 그 스토리의 오프셋, 그 레이아웃 (떠 있는 개체는 본문) */
  readonly offset: number;
  readonly layout: PagedLayout;
  readonly float: boolean;
  readonly para: PlacedPara;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly px: number;
  readonly top: number;
}

/** 편집기의 덧그리기 갈고리. 없으면 쪽 내용만 (PDF·시험) */
export interface PaintOverlay {
  /** 본문(떠 있는 개체·각주 포함)의 투명도 (머리말을 편집 중이면 흐리게) */
  readonly bodyAlpha?: number;
  /** 머리말·꼬리말의 투명도 */
  readonly hfAlpha?: number;
  /** 필드에 회색 바탕 (머리말·꼬리말 편집 중) */
  readonly fieldShading?: boolean;
  /** 스토리의 줄 덧그리기 (그 스토리를 그리기 시작할 때 한 번) */
  story?(layout: PagedLayout, doc: Doc): StoryOverlay | null;
  /** 머리말·꼬리말을 그리기 전 (편집 표시). 편집 중인 레이아웃을 돌려주면 그것으로 그린다 */
  hf?(page: number, part: 'header' | 'footer', info: PageHF, px: number, top: number): PagedLayout | null | undefined;
  /** 각주 조각: 편집 중인 레이아웃을 돌려주면 그것으로 그린다 */
  note?(page: number, slot: NoteSlot): PagedLayout | null | undefined;
  /** 개체 크기·위치 미리 보기 (크기 조절·옮기기 중) */
  objectBox?(offset: number, float: boolean, w: number, h: number): { w: number; h: number; dx: number; dy: number } | null;
  /** 개체를 그린 뒤 (선택 손잡이) */
  object?(o: ObjectPaint): void;
  /** 표 칸 내용을 그린 뒤, 테두리 전 (셀 범위 선택) */
  cell?(view: TableView, tableStart: number, gx: number, gy: number, x: number, y: number, w: number, h: number): void;
}

/** 쪽의 각주 영역에 놓인 각주 하나 (그리기·누르기) */
export interface NoteSlot {
  id: string;
  num: number;
  /** 번호 자리 왼쪽, 조각 위쪽 (문서 좌표), 각주 내용 폭 */
  x: number;
  y: number;
  width: number;
  /** 각주 줄 [from, to), 높이, 앞 쪽에서 이어 씀 */
  from: number;
  to: number;
  h: number;
  cont: boolean;
  /** 그 프레임(단) 각주 영역의 첫 조각 (구분선을 그 위에) */
  first: boolean;
}

/** 쪽 p의 각주 영역에 놓인 각주들 (문서 좌표). 영역은 프레임(다단이면 단)마다 그 맨 아래에 붙는다 (12 §6.2, O-26) */
export function noteSlots(fmt: Formatter, L: PagedLayout, setup: PageSetup, p: number): NoteSlot[] {
  const places = L.notesOnPage(p);
  if (!places.length) return [];
  const sep = setup.noteSeparator ?? 16;
  const out: NoteSlot[] = [];
  const frames = [...new Set(places.map((n) => n.frame))];
  for (const k of frames) {
    const mine = places.filter((n) => n.frame === k);
    const fr = L.frames.frame(k);
    const area = sep + mine.reduce((a, n) => a + n.h, 0);
    let y = fr.top + fr.height - area + sep;
    const width = Math.max(1, fr.width - NOTE_INDENT);
    mine.forEach((n, i) => {
      out.push({ id: n.id, num: fmt.noteNumber(n.id), x: fr.x, y, width, from: n.from, to: n.to, h: n.h, cont: n.cont, first: i === 0 });
      y += n.h;
    });
  }
  return out;
}

/** 각주 조각의 레이아웃: 줄 from이 조각 위쪽에 오도록 원점을 둔다 */
export function noteLayout(fmt: Formatter, document: Document, s: NoteSlot, pre: { offset: number; text: string; fmt?: number } | null = null): PagedLayout {
  const doc = document.story(noteStoryId(s.id));
  const L = fmt.layoutStory(doc, s.width, null, pre);
  const lines = fmt.noteLines(s.id, s.width);
  let before = 0;
  for (let k = 0; k < s.from; k++) before += lines[k] ?? 0;
  L.setOrigin(s.x + NOTE_INDENT, s.y - before);
  return L;
}

/** 그리기 범위: 문서 y [top, top + h)를 대상 y 0부터, 쪽 왼쪽을 대상 x px에 */
export interface PaintRegion {
  px: number;
  top: number;
  h: number;
  overlay?: PaintOverlay;
  /** 본문 영역이 아직 배치되지 않았으면 이 시간 안에서만 배치한다 (기본: 끝까지) */
  budgetMs?: number;
  /** 보인 본문 문단 번호를 모은다 */
  visible?: Set<number>;
}

const NO_OVERLAY: PaintOverlay = {};

export class PagePainter {
  /** 지금 그리는 스토리 (서식 스타일), 머리말·꼬리말의 필드 값, 덧그리기, 대상 */
  private doc!: Doc;
  private fields: FieldValues | null = null;
  private ov: PaintOverlay = NO_OVERLAY;
  private t!: PaintTarget;

  constructor(readonly env: PainterEnv) {}

  /**
   * 쪽 하나의 내용 (편집기 덧그리기 없이). 대상 좌표는 쪽 왼쪽 위가 (0, 0)이다.
   * 조판이 끝난 레이아웃을 받는다
   */
  paintPage(page: number, target: PaintTarget, overlay?: PaintOverlay): void {
    const pb = this.env.layout.pageBox(page);
    target.save();
    target.clip(0, 0, pb.width, pb.height);
    this.paint(target, { px: -pb.x, top: pb.top, h: pb.height, overlay });
    target.restore();
  }

  /**
   * 문서 y [top, top + h)에 걸친 쪽들의 내용 (편집기 화면). 쪽 바탕은 그리지 않는다.
   * 본문 영역이 아직 배치되지 않았으면 false (못 끝낸 부분은 그리지 않았다)
   */
  paint(target: PaintTarget, r: PaintRegion): boolean {
    const { layout } = this.env;
    const { px, top, h } = r;
    this.t = target;
    this.ov = r.overlay ?? NO_OVERLAY;
    const t = target;
    // 단 구분선 (12 §7.1)
    if (layout.frames.multi?.())
      for (let p = layout.pageAt(top); p < layout.pageCount; p++) {
        if (layout.pageBox(p).top - top > h) break;
        const cols = layout.frames.columnsOn?.(p) ?? [];
        for (let i = 1; i < cols.length; i++) {
          const a = cols[i - 1]!;
          const b = cols[i]!;
          if (!b.sep || b.frame.column === 0 || a.frame.top !== b.frame.top) continue;
          const x = (a.frame.x + a.frame.width + b.frame.x) / 2;
          t.fillRect(px + x - 0.5, b.frame.top - top, 1, b.frame.height, PAINT_COLORS.columnRule);
        }
      }

    // 머리말·꼬리말 (12 §5): 쪽마다 그 쪽의 필드 값으로
    for (let p = layout.pageAt(top); p < layout.pageCount; p++) {
      if (layout.pageBox(p).top - top > h) break;
      this.pageHF(p, px, top, h);
    }

    t.save();
    if (this.ov.bodyAlpha !== undefined && this.ov.bodyAlpha !== 1) t.alpha(this.ov.bodyAlpha);
    // 떠 있는 개체 (11 §4.2): 글 뒤 개체는 글보다 먼저, 나머지는 글 다음에 그린다
    const floats = layout.floatsIn(top, top + h);
    for (const f of floats) if (f.float.spec.behind) this.float(f.para, f.float, px, top);
    // 줄 (표 문단은 표로, 셀 내용은 셀 레이아웃으로)
    const body = this.env.document.body;
    const ready = this.lines(layout, body, px, top, h, r.visible ?? null, r.budgetMs ?? Infinity);
    for (const f of floats) if (!f.float.spec.behind) this.float(f.para, f.float, px, top);
    // 각주 영역 (12 §6.2)
    for (let p = layout.pageAt(top); p < layout.pageCount; p++) {
      if (layout.pageBox(p).top - top > h) break;
      this.pageNotes(p, px, top, h);
    }
    t.restore();
    this.ov = NO_OVERLAY;
    return ready;
  }

  /** 기본 글꼴 (서식 없는 글자, 시스템 글꼴) */
  private get baseFont(): FontRef {
    const { fontSize, family } = this.env;
    return { css: `${fontSize}px ${family}`, slot: -1, size: fontSize, bold: false };
  }

  /** 그리기 글꼴: 글꼴 번호 f(셰이핑 중)와 서식 */
  fontOf(f: number, d: DrawStyle): FontRef {
    const { env } = this;
    const size = env.fontSize * d.run.scale;
    const bold = !!d.bold;
    const families = env.shapedFonts;
    if (families && f < families.length) {
      // 굵은 얼굴을 불러왔으면 그것, 아니면 보통 굵기를 합성 굵게
      const boldFamily = bold ? env.boldFonts[f] : null;
      if (boldFamily) return { css: `${size}px ${boldFamily}`, slot: f, size, bold };
      return { css: `${bold ? 'bold ' : ''}${size}px ${families[f]!}`, slot: f, size, bold };
    }
    return { css: `${bold ? 'bold ' : ''}${size}px ${env.family}`, slot: -1, size, bold };
  }

  /**
   * 레이아웃의 보이는 줄을 그린다 (본문, 표 셀, 머리말·꼬리말, 각주). 셀 레이아웃은 본문과 같은 문서 좌표다 (원점을 옮겨 놓았다).
   * 본문 영역이 아직 배치되지 않았으면 false
   */
  private lines(layout: PagedLayout, doc: Doc, px: number, top: number, h: number, visible: Set<number> | null, budget: number): boolean {
    const { t, env } = this;
    const isBody = doc === env.document.body;
    this.doc = doc;
    const so = this.ov.story?.(layout, doc) ?? null;
    const base = this.baseFont;
    // 셰이핑 중이면 커닝을 켠다: 같은 글꼴 파일이면 캔버스가 HarfBuzz와 같은 폭으로 그린다 (ADR-0002)
    const kern = !!env.shapedFonts;
    // 화면 영역이 아직 배치되지 않았으면 시간 예산 안에서만 배치한다 (스크롤바로 멀리 이동한 경우 등)
    const ready = isBody ? layout.ensureThroughY(top + h, budget) : true;
    let lastTable = -1;
    const validCount = layout.validCount;
    const nextRef = (r: { para: number; line: number }) => {
      if (r.line + 1 < layout.paras[r.para]!.lines.length) return { para: r.para, line: r.line + 1 };
      return r.para + 1 < validCount ? { para: r.para + 1, line: 0 } : null;
    };
    let ref: { para: number; line: number } | null = layout.firstLineBelow(top, false);
    // 다단 (12 §7): 앞 단의 줄이 화면 아래로 가도 뒤 단의 줄이 화면에 있을 수 있다. 화면의 마지막 쪽을 지나면 멈춘다
    const multi = isBody && !!layout.frames.multi?.();
    const lastPage = multi ? layout.pageAt(top + h) : 0;
    for (; ref; ref = nextRef(ref)) {
      const para = layout.paras[ref.para]!;
      const ln = para.lines[ref.line]!;
      const y = ln.y - top;
      if (y > h) {
        if (!multi || ln.page > lastPage) break;
        continue;
      }
      if (y + ln.height < 0) continue;
      visible?.add(ref.para);
      if (para.layout.table) {
        // 표 문단: 처음 보이는 행에서 표 전체(보이는 부분)를 그린다
        if (lastTable !== ref.para) {
          lastTable = ref.para;
          this.table(para, px, top, h);
          this.doc = doc;
        }
        continue;
      }
      const { xs } = para.layout;
      const x0 = px + ln.x - xs[ln.start]!;
      const X = (d: number) => px + lineX(para.layout, ln, d);
      const sty = env.fmt.styleKey(para.info as ParagraphInfo);
      const baseY = ln.baseline - top;
      const l: LinePaint = { index: ref.para, para, ln, doc, isBody, px, y, baseY, X };

      so?.back?.(l);
      // 형광펜 (선택 영역 아래)
      if (para.layout.fmt) this.highlights(para.layout, ln, px, baseY, sty);
      so?.under?.(l);

      // 목록 번호·글머리 (첫 줄, 내어쓴 자리)
      if (ln.index === 0 && para.layout.marker) this.marker(para.layout, px + para.frameLeft, baseY, sty, kern);

      // 글자
      if (env.shapedFonts || para.layout.fmt || ln.adj || para.layout.objs) {
        this.runs(para.layout, ln, px, baseY, sty, kern);
        if (para.layout.objs) this.objects(layout, para, ln, px, baseY, kern);
        if (para.layout.fmt) this.textLines(para.layout, ln, px, baseY, sty);
      } else if (t.exactRuns) {
        // 커닝을 끄면 문자열 폭 = 글자 폭의 합이므로 탭 사이 구간을 한 번에 그린다 (그리기 호출 수 ↓)
        const text = cpSlice(para.layout, ln.start, ln.end);
        let segStart = ln.start;
        let cp = ln.start;
        let u = 0;
        let segU = 0;
        const flush = (endU: number) => {
          if (endU > segU) t.text({ text: text.slice(segU, endU), font: base, kern }, x0 + xs[segStart]!, baseY, PAINT_COLORS.text);
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
        // 커닝을 끌 수 없는 대상: grapheme마다 계산된 위치에 그림
        let i = ln.start;
        while (i < ln.end) {
          let j = i + 1;
          while (j < ln.end && !para.layout.stops[j]) j++;
          const g = cpSlice(para.layout, i, j);
          if (g !== ' ' && g !== '\t') t.text({ text: g, font: base, kern }, x0 + xs[i]!, baseY, PAINT_COLORS.text);
          i = j;
        }
      }
      so?.over?.(l);
    }
    return ready;
  }

  /** 쪽 p의 머리말·꼬리말 (12 §5) */
  private pageHF(p: number, px: number, top: number, h: number): void {
    const { env, t } = this;
    const info = pageHF(env.fmt, env.layout, p, env.today ?? dateText());
    for (const part of ['header', 'footer'] as const) {
      const slot = part === 'header' ? info.header : info.footer;
      const editing = this.ov.hf?.(p, part, info, px, top);
      const L = editing ?? layoutHF(env.fmt, (id) => env.document.story(id), info, part);
      if (!L || !slot.story) continue;
      t.save();
      const a = this.ov.hfAlpha;
      if (a !== undefined && a !== 1) t.alpha(a);
      this.fields = info.fields;
      this.lines(L, env.document.story(slot.story), px, top, h, null, Infinity);
      this.fields = null;
      t.restore();
    }
  }

  /** 쪽 p의 각주 영역: 구분선(이어 쓴 각주로 시작하면 전체 폭), 번호와 내용. 나눈 각주는 그 쪽 조각만 잘라 그린다 */
  private pageNotes(p: number, px: number, top: number, h: number): void {
    const { env, t } = this;
    const slots = noteSlots(env.fmt, env.layout, env.setup, p);
    if (!slots.length) return;
    const sep = env.setup.noteSeparator ?? 16;
    t.save();
    for (const s0 of slots) {
      if (!s0.first) continue;
      const lineW = s0.cont ? s0.width + NOTE_INDENT : Math.min(160, (s0.width + NOTE_INDENT) / 3);
      t.fillRect(px + s0.x, s0.y - sep / 2 - top, lineW, 0.75, PAINT_COLORS.text);
    }
    t.restore();
    for (const s of slots) {
      const L = this.ov.note?.(p, s) ?? noteLayout(env.fmt, env.document, s);
      const doc = env.document.story(noteStoryId(s.id));
      t.save();
      t.clip(px + s.x - 2, s.y - top, s.width + NOTE_INDENT + 4, s.h);
      if (!s.cont && s.num > 0) {
        const ln = L.paras[0]?.lines[0];
        if (ln) {
          const size = Math.round(env.fontSize * 0.75);
          t.text({ text: String(s.num), font: { css: `${size}px ${env.family}`, slot: -1, size, bold: false }, kern: !!env.shapedFonts }, px + s.x, ln.baseline - top - env.fontSize * 0.3, PAINT_COLORS.text);
        }
      }
      this.lines(L, doc, px, top, h, null, Infinity);
      t.restore();
    }
  }

  /** 표 하나 (11 §4.3): 셀 배경, 셀 내용(덮인 셀은 주인 셀 아래에 이어서), 셀 범위 선택(덧그리기), 테두리 */
  private table(para: PlacedPara, px: number, top: number, h: number): void {
    const { env, t } = this;
    const info = para.info as ParagraphInfo;
    const id = info.objs?.get(0)?.table;
    const v = id ? env.fmt.tableViews.get(id) : undefined;
    if (!v) return;
    const lines = para.lines;
    env.fmt.tables.place(v.input, v.measure, lines);
    const rec = env.document.table(v.id);
    const colX = v.measure.colX;
    // 행 조각 (12 §8): 셀은 그 행들의 조각마다 (같은 쪽에서 이어지면 하나로) 그린다
    const parts = rowParts(v.grid.cells.length, lines);
    const drawCell = (cell: NonNullable<TableGrid['cells'][0][0]>, x: number, y: number, rect: { x: number; top: number; height: number }, repeat: boolean) => {
      const cx = px + rect.x + colX[x]!;
      const cw = colX[x + cell.span[1]]! - colX[x]!;
      const cy = rect.top - top;
      const ch = rect.height;
      if (cy > h || cy + ch < 0) return;
      const fill = rec?.cellAttrs[cellKey(cell.row, cell.col)]?.fill;
      if (fill) t.fillRect(cx, cy, cw, ch, fill);
      t.save();
      t.clip(cx, cy, cw, ch);
      for (const sid of [cell.story, ...cell.covered]) {
        const c = env.fmt.tables.cells.get(sid);
        const d = env.document.story(sid);
        if (!c || (sid !== cell.story && d.length === 1)) continue;
        if (repeat) {
          // 다시 그린 제목 행: 같은 셀 레이아웃을 이 자리 원점으로 잠깐 옮겨 그린다 (편집은 원래 자리에서만)
          const L = c.layout;
          const sx = L.setup.originX ?? 0;
          const sy = L.setup.originY ?? 0;
          L.setOrigin(rect.x + colX[x]! + CELL_PAD, rect.top + CELL_PAD);
          this.lines(L, d, px, top, h, null, Infinity);
          L.setOrigin(sx, sy);
        } else this.lines(c.view, d, px, top, h, null, Infinity);
      }
      t.restore();
      if (!repeat) this.ov.cell?.(v, info.start, x, y, cx, cy, cw, ch);
      t.strokeRect(Math.round(cx) + 0.5, Math.round(cy) + 0.5, Math.round(cw), Math.round(ch), PAINT_COLORS.tableBorder, 1);
    };
    for (let y = 0; y < v.grid.cells.length; y++) {
      const row = v.grid.cells[y]!;
      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (!cell) continue;
        const mine: PlacedLine[] = [];
        for (let k = y; k < y + cell.span[0]; k++) mine.push(...(parts[k] ?? []));
        for (const g of cellGroups(mine)) drawCell(cell, x, y, { x: g.x, top: g.top, height: g.height }, false);
      }
    }
    for (const ln of lines) {
      if (!ln.repeat || ln.row === undefined) continue;
      const row = v.grid.cells[ln.row]!;
      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (cell) drawCell(cell, x, ln.row, { x: ln.x, top: ln.y, height: ln.height }, true);
      }
    }
  }

  /**
   * 줄 글자 그리기: 어절(공백·탭 사이)과 글꼴·서식이 바뀌는 곳마다 나눠 레이아웃 위치에. 레이아웃이 같은 단위로
   * 셰이핑했으므로 어절 경계 커닝 차이가 생기지 않는다. 기울임은 기준선 기준으로 기울여 그린다 (진행폭은 바로 선 글꼴).
   * 양쪽 맞춤이 글자 사이에 나뉜 줄은 글자마다 나눠 그린다.
   */
  private runs(pl: ParaLayout, ln: PlacedLine, px: number, baseY: number, sty: string, kern: boolean): void {
    const { t, env } = this;
    const fonts = pl.fonts;
    const fmt = pl.fmt;
    const start = ln.start;
    const end = ln.end;
    const fontAt = (k: number) => (fonts ? fonts[k]! : 0);
    const idAt = (k: number) => (fmt ? fmt[k]! : 0);
    const blank = (c: string) => c === ' ' || c === '\t' || c === '　' || c === OBJ;
    const perChar = ln.adjChars;
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
      const d = env.fmt.drawStyle(id, sty, this.doc);
      t.text({ text: cpSlice(pl, k, j), font: this.fontOf(f, d), kern, skew: d.italic ? ITALIC_SKEW : undefined }, px + lineX(pl, ln, k), baseY + d.shift, d.color ?? PAINT_COLORS.text);
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
      const d = this.env.fmt.drawStyle(fmt[k]!, sty, this.doc);
      if (d !== PLAIN_DRAW) fn(k, j, d);
      k = j;
    }
  }

  private highlights(pl: ParaLayout, ln: PlacedLine, px: number, baseY: number, sty: string): void {
    const { ascent, descent } = this.env.metrics;
    this.eachFormatRun(pl, ln, sty, (k, j, d) => {
      if (!d.highlight) return;
      const em = this.env.fontSize * d.run.line;
      const x = px + lineX(pl, ln, k);
      this.t.fillRect(x, baseY - ascent * em, px + lineX(pl, ln, j) - x, (ascent + descent) * em, d.highlight);
    });
  }

  /** 밑줄·취소선: 위치·두께는 기본 글꼴 치수 (post·OS/2), 글자 크기 비례 */
  private textLines(pl: ParaLayout, ln: PlacedLine, px: number, baseY: number, sty: string): void {
    const m = this.env.metrics;
    this.eachFormatRun(pl, ln, sty, (k, j, d) => {
      if (!d.underline && !d.strike) return;
      const em = this.env.fontSize * d.run.scale;
      const x = px + lineX(pl, ln, k);
      const w = px + lineX(pl, ln, j) - x;
      const y = baseY + d.shift;
      const color = d.color ?? PAINT_COLORS.text;
      if (d.underline) {
        const th = Math.max(1, m.underlineThickness * em);
        this.t.fillRect(x, y - m.underlinePosition * em - th / 2, w, th, color);
      }
      if (d.strike) {
        const th = Math.max(1, m.strikeThickness * em);
        this.t.fillRect(x, y - m.strikePosition * em - th / 2, w, th, color);
      }
    });
  }

  /** 목록 번호·글머리: 글꼴이 바뀌는 곳마다 (글머리 기호가 대체 글꼴에 있을 수 있다) */
  private marker(pl: ParaLayout, left: number, baseY: number, sty: string, kern: boolean): void {
    const { t, env } = this;
    const mk = pl.marker!;
    const d = env.fmt.drawStyle(mk.id, sty, this.doc);
    const color = d.color ?? PAINT_COLORS.text;
    const cps = Array.from(mk.text);
    let x = left + (pl.box?.left ?? 0) + mk.x;
    let k = 0;
    while (k < cps.length) {
      const f = mk.fonts ? mk.fonts[k]! : 0;
      let j = k + 1;
      while (j < cps.length && (mk.fonts ? mk.fonts[j]! : 0) === f) j++;
      const font = this.fontOf(f, d);
      const text = cps.slice(k, j).join('');
      t.text({ text, font, kern }, x, baseY + d.shift, color);
      x += t.measure(text, font);
      k = j;
    }
  }

  /** 줄의 개체: 기준선 위에 선 상자. 원본이 없으면 자리표시(회색 상자 + 대체 텍스트). 필드, 각주 참조 번호 */
  private objects(layout: PagedLayout, para: PlacedPara, ln: PlacedLine, px: number, baseY: number, kern: boolean): void {
    const { t, env } = this;
    const pl = para.layout;
    const info = para.info as ParagraphInfo;
    for (const [k, box] of pl.objs!) {
      if (k < ln.start || k >= ln.end) continue;
      const attrs = info.objs?.get(pl.preedit && k >= pl.preedit[0] ? k - (pl.preedit[1] - pl.preedit[0]) : k);
      const x = px + lineX(pl, ln, k);
      if (attrs?.kind === 'field') {
        this.field(pl, k, attrs.field, info, x, box.w, baseY, kern);
        continue;
      }
      if (attrs?.kind === 'note') {
        // 각주 참조: 번호를 위 첨자로 (12 §6.2)
        const d = env.fmt.drawStyle(pl.fmt?.[k] ?? 0, env.fmt.styleKey(info), this.doc);
        const font = this.fontOf(0, { ...d, run: { ...d.run, scale: d.run.scale * 0.65 } });
        t.text({ text: String(env.fmt.noteNumber(attrs.id ?? '') || '?'), font, kern }, x, baseY - env.fontSize * d.run.scale * 0.33, d.color ?? PAINT_COLORS.text);
        continue;
      }
      let { w, h } = box;
      const offset = info.start + k;
      const g = this.ov.objectBox?.(offset, false, w, h);
      if (g) ({ w, h } = g);
      const y = baseY - h;
      this.image(attrs?.asset, attrs?.alt, x, y, w, h, false);
      this.ov.object?.({ offset, layout, float: false, para, x, y, w, h, px, top: 0 });
    }
  }

  /** 이미지 또는 자리표시 */
  private image(asset: string | undefined, alt: string | undefined, x: number, y: number, w: number, h: number, float: boolean): void {
    const { t, env } = this;
    const st = asset ? env.images.state(asset) : 'error';
    if (st === 'ready') {
      t.image(asset!, x, y, w, h);
      return;
    }
    const size = Math.min(13, env.fontSize);
    const font: FontRef = { css: `${size}px ${env.family}`, slot: -1, size, bold: false };
    const kern = !!env.shapedFonts;
    t.fillRect(x, y, w, h, PAINT_COLORS.placeholder);
    if (float) {
      t.text({ text: alt ?? '이미지', font, kern, maxWidth: w - 12 }, x + 6, y + 18, PAINT_COLORS.placeholderText);
      return;
    }
    t.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1, PAINT_COLORS.placeholderBorder, 1);
    const text = st === 'error' ? `이미지 없음${alt ? `: ${alt}` : ''}` : (alt ?? '불러오는 중…');
    t.text({ text, font, kern, maxWidth: w - 12 }, x + 6, y + Math.min(h - 6, 18), PAINT_COLORS.placeholderText);
  }

  /** 필드 (12 §5.1): 그 쪽의 값을 글자 서식으로. 덧그리기가 바라면 회색 바탕으로 필드임을 보인다 */
  private field(pl: ParaLayout, k: number, kind: FieldKind | undefined, info: ParagraphInfo, x: number, w: number, baseY: number, kern: boolean): void {
    const { t, env } = this;
    const d = env.fmt.drawStyle(pl.fmt?.[k] ?? 0, env.fmt.styleKey(info), this.doc);
    const em = env.fontSize * d.run.scale;
    if (this.ov.fieldShading) t.fillRect(x, baseY - em * 0.85, w, em * 1.1, PAINT_COLORS.field);
    const text = this.fields && kind ? this.fields[kind] : env.fmt.fieldText(kind);
    t.text({ text, font: this.fontOf(0, d), kern }, x, baseY + d.shift, d.color ?? PAINT_COLORS.text);
  }

  /** 떠 있는 개체 하나 */
  private float(para: PlacedPara, f: PlacedFloat, px: number, top: number): void {
    const info = para.info as ParagraphInfo;
    const pl = para.layout;
    const k = pl.preedit && f.k >= pl.preedit[0] ? f.k - (pl.preedit[1] - pl.preedit[0]) : f.k;
    const attrs = info.objs?.get(k);
    const offset = info.start + k;
    let { w, h } = f;
    let x = px + f.x;
    let y = f.y - top;
    const g = this.ov.objectBox?.(offset, true, w, h);
    if (g) {
      ({ w, h } = g);
      x += g.dx;
      y += g.dy;
    }
    this.image(attrs?.asset, attrs?.alt, x, y, w, h, true);
    this.ov.object?.({ offset, layout: this.env.layout, float: true, para, x, y, w, h, px, top });
  }
}
