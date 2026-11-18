/**
 * 문서 → 레이아웃 서식 (10 §4, 11 §4.3). DOM을 쓰지 않는다: 편집기, Node 시험(기준 문서 세트, 12 §1), 나중에 Worker·PDF가
 * 같은 서식으로 조판한다 (02 R6).
 *
 * - 서식 번호 → 런 영향(얼굴·크기 배율·줄 높이)과 그리기 정보(색·밑줄 …). 서식 번호의 뜻은 스토리마다 다르므로 캐시도 스토리마다.
 * - 문단 속성(스타일 사슬 → 직접 속성) → 문단 상자 (px). 목록 번호, 인라인·떠 있는 개체 크기.
 * - 본문의 표 문단 → 표 레코드 → 격자 → 셀 레이아웃 → 행 높이 (TableLayouter).
 */
import {
  BODY_STYLE,
  fullSection,
  mergeParaAttrs,
  normalizeTable,
  type Doc,
  type Document,
  type ListLabel,
  type MarkSet,
  type ObjAttrs,
  type ParaAttrs,
  type ParagraphInfo,
  type Position,
  type ResolvedStyle,
  type SectionProps,
  type TableGrid,
} from '@quire/model';
import {
  CELL_PAD,
  LayoutCache,
  PLAIN_STYLE,
  TableLayouter,
  geomKey,
  type FloatSpec,
  type FormatSource,
  type Measurer,
  type PageSetup,
  type ParaBox,
  type PreeditAt,
  type RunStyle,
  type SectionGeom,
  type SectionSource,
  type TableGridInput,
  type TableMeasure,
  type TableSpec,
} from '@quire/layout';

/** 서식 번호 하나의 그리기 정보 (10 §4) */
export interface DrawStyle {
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

export const PLAIN_DRAW: DrawStyle = {
  run: PLAIN_STYLE, bold: false, italic: false, underline: false, strike: false, color: null, highlight: null, shift: 0,
};
/** 위·아래 첨자: 크기 배율, 기준선 이동 (em) */
const SCRIPT_SCALE = 0.65;
const SUP_SHIFT = -0.33;
const SUB_SHIFT = 0.2;
const LINK_COLOR = '#1a5fb4';

/** 조판한 표: 격자, 레이아웃 입력, 행 높이, 표 원소 위치 (본문) */
export interface TableView {
  id: string;
  grid: TableGrid;
  input: TableGridInput;
  measure: TableMeasure;
  at: Position;
}

export class Formatter {
  /** 조판한 표 (표 ID → 격자·행 높이·자리) */
  readonly tableViews = new Map<string, TableView>();
  /** 편집 중인 셀의 조합 문자열 (그 표를 잴 때 셀 레이아웃에 넣는다) */
  cellPreedit: PreeditAt | null = null;
  tables!: TableLayouter;
  /** 스토리마다 (문단 스타일, 서식 번호)별 그리기 정보. 스타일 판이 바뀌면 비운다 */
  private readonly styleCaches = new WeakMap<
    Doc,
    { version: number; draw: Map<string, Array<DrawStyle | undefined>>; fns: Map<string, (id: number) => RunStyle> }
  >();
  private readonly docIds = new WeakMap<Doc, number>();
  private docSeq = 0;
  private readonly cellFormats = new WeakMap<Doc, FormatSource>();
  /** 본문 문단 → 레이아웃 서식 */
  readonly formatOf: FormatSource = (info, force) => this.formatWith(this.document().body, info, force);
  /** 구역 설정 → 쪽 모양 (설정 객체가 바뀌면 다시) */
  private readonly geoms = new Map<string, { def: SectionProps | undefined; geom: SectionGeom }>();
  /** 본문 문단 → 구역 차례·쪽 모양 (12 §3.3, SectionFrames) */
  readonly sections: SectionSource = {
    sectionOf: (m) => {
      const s = this.body.sectionOf(m);
      return { index: s.index, geom: this.sectionGeom(s.id) };
    },
    count: () => this.body.sectionBreaks().length + 1,
  };

  constructor(
    /** 지금 문서 (편집기가 문서를 바꿀 수 있다) */
    private readonly document: () => Document,
    private readonly setup: PageSetup,
    /** 기본 글자 크기 (px) */
    private readonly fontSize: number,
  ) {}

  /** 셀 레이아웃을 새로 (측정이 바뀌었거나 문서가 바뀜) */
  reset(measurer: Measurer, cellCache: LayoutCache): void {
    this.tables = new TableLayouter(
      this.setup,
      measurer,
      cellCache,
      (id) => this.document().story(id),
      (id) => this.cellFormat(this.document().story(id)),
    );
    this.tableViews.clear();
  }

  private get body(): Doc {
    return this.document().body;
  }

  /** 구역 ID → 쪽 모양 (px, 정수로 반올림: 기본 구역 = defaultPageSetup) */
  sectionGeom(id: string): SectionGeom {
    const def = this.body.sectionDef(id);
    const hit = this.geoms.get(id);
    if (hit && hit.def === def) return hit.geom;
    const f = fullSection(def);
    const px = (v: number) => Math.round(pt(v));
    const [t, r, b, l] = f.page.margin;
    const g = { width: px(f.page.width), height: px(f.page.height), top: px(t), right: px(r), bottom: px(b), left: px(l), start: f.start };
    const geom = { ...g, key: geomKey(g) };
    this.geoms.set(id, { def, geom });
    return geom;
  }

  /** 가장 넓은 쪽 폭 (px): 화면 가로 스크롤 폭 */
  maxPageWidth(): number {
    let w = this.setup.width;
    const b = this.body;
    for (const i of b.sectionBreaks()) w = Math.max(w, this.sectionGeom(b.paraAttrs(i).section!).width);
    return Math.max(w, this.sectionGeom('last').width);
  }

  /** 문단 → 레이아웃 서식: 글자 서식, 스타일의 기본 글자 서식, 문단 상자. 본문의 표 문단은 행 (11 §4.3) */
  formatWith(doc: Doc, info: Parameters<FormatSource>[0], force: boolean): ReturnType<FormatSource> {
    const p = info as ParagraphInfo;
    const body = this.body;
    if (doc === body) {
      const t = p.objs?.get(0);
      if (t?.kind === 'table' && t.table) {
        const table = this.tableSpec(t.table, p.start);
        if (table) return { fmt: null, mark: 0, style: () => PLAIN_STYLE, table };
      }
    }
    const attrs = p.attrs ?? {};
    // 스타일 정의는 문서에 하나 (본문에 있다)
    const rs = body.resolvedStyle(attrs.style ?? BODY_STYLE);
    const styled = hasKeys(rs.marks);
    const label = attrs.list ? doc.listLabel(p) : null;
    const box = this.paraBox(attrs, rs, label);
    if (!p.fmt && !p.mark && !force && !box && !styled && !p.objs) return null;
    const marker = label ? { text: label.text, id: p.mark ?? 0, hanging: pt(label.def.levels[label.level]!.hanging) } : null;
    const objs = p.objs ? objSizes(p.objs) : null;
    // 셀 안의 떠 있는 개체는 인라인으로 (셀 원점이 바뀌어도 놓인 자리를 다시 구하지 않으므로)
    const floats = p.objs && doc === body ? floatSpecs(p.objs) : null;
    const sty = styled ? (attrs.style ?? BODY_STYLE) : '';
    // 스타일 글자 서식은 서식 번호 0에도 걸리므로 fmt가 없으면 0으로 채운 열을 준다
    const fmt = p.fmt ?? (styled ? new Uint16Array(cpCount(p.text)) : null);
    // 서식 번호의 뜻은 스토리마다 다르므로 셀은 캐시 키에 스토리 번호를 넣는다
    const key = (doc === body ? '' : `d${this.docId(doc)}`) + (styled ? `${sty}@${body.stylesVersion}` : '');
    return { fmt, mark: p.mark ?? 0, style: this.styleFn(sty, doc), box, marker, objs, floats, key: key || undefined };
  }

  private docId(doc: Doc): number {
    let id = this.docIds.get(doc);
    if (id === undefined) this.docIds.set(doc, (id = ++this.docSeq));
    return id;
  }

  /** 셀 스토리의 FormatSource (스토리마다 하나) */
  cellFormat(doc: Doc): FormatSource {
    let f = this.cellFormats.get(doc);
    if (!f) this.cellFormats.set(doc, (f = (info, force) => this.formatWith(doc, info, force)));
    return f;
  }

  /** 문단의 스타일 캐시 키: 스타일에 기본 글자 서식이 있으면 그 이름, 없으면 '' */
  styleKey(info: ParagraphInfo): string {
    const name = info.attrs?.style ?? BODY_STYLE;
    return hasKeys(this.body.resolvedStyle(name).marks) ? name : '';
  }

  /** 스타일 sty 문단의 서식 번호 → 레이아웃 영향 (함수는 스타일마다 하나) */
  styleFn(sty: string, doc: Doc): (id: number) => RunStyle {
    const c = this.styleCache(doc);
    let f = c.fns.get(sty);
    if (!f) {
      f = (id: number) => this.drawStyle(id, sty, doc).run;
      c.fns.set(sty, f);
    }
    return f;
  }

  /** 스토리의 서식 캐시 (스타일 정의 판이 바뀌면 새로) */
  private styleCache(doc: Doc) {
    const v = this.body.stylesVersion;
    let c = this.styleCaches.get(doc);
    if (!c || c.version !== v) this.styleCaches.set(doc, (c = { version: v, draw: new Map(), fns: new Map() }));
    return c;
  }

  /** (문단 스타일 sty, 서식 번호) → 그리기 정보. 스타일의 기본 글자 서식 위에 글자 서식을 덮는다 */
  drawStyle(id: number, sty: string, doc: Doc): DrawStyle {
    const c = this.styleCache(doc);
    let table = c.draw.get(sty);
    if (!table) {
      table = [];
      c.draw.set(sty, table);
    }
    let d = table[id];
    if (d) return d;
    const own = doc.markSet(id);
    const m: MarkSet = sty ? { ...this.body.resolvedStyle(sty).marks, ...own } : own;
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
  paraBox(attrs: ParaAttrs, rs: ResolvedStyle, label: ListLabel | null = null): ParaBox | null {
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

  /** 표 문단의 레이아웃 입력: 표 레코드 → 격자 → 셀 레이아웃 → 행 높이. 표 문단을 조판할 때 부른다 */
  tableSpec(id: string, start: number): TableSpec | null {
    const document = this.document();
    const rec = document.table(id);
    if (!rec) return null;
    const grid = normalizeTable(rec);
    if (!grid.rows.length || !grid.cols.length) return null;
    const input: TableGridInput = {
      widths: grid.widths.map((w) => pt(w)),
      minHeights: grid.rows.map((r) => pt(rec.rowAttrs[r]?.minHeight)),
      cells: grid.cells,
    };
    const pre = this.cellPreedit && this.cellPreedit.story.startsWith(`${id}|`) ? this.cellPreedit : null;
    const measure = this.tables.measure(input, this.setup.lineHeight + CELL_PAD * 2, pre);
    this.tableViews.set(id, { id, grid, input, measure, at: document.body.positionAt(start) });
    return { width: measure.width, rows: measure.rows };
  }
}

/** 편집기의 쪽 설정 (A4 @96dpi, 여백 1인치). 기준 문서 세트 시험도 같은 값으로 조판한다 */
export function defaultPageSetup(fontSize = 16): PageSetup {
  return {
    width: 794,
    height: 1123,
    margin: 96,
    gap: 24,
    lineHeight: Math.round(fontSize * 1.7),
    paraSpacing: Math.round(fontSize * 0.5),
    fontSize,
  };
}

export function hasKeys(o: object): boolean {
  for (const _ in o) return true;
  return false;
}

/** 코드포인트 수 */
export function cpCount(t: string): number {
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length) i++;
    n++;
  }
  return n;
}

/** 1/1000pt → px (96dpi) */
export function pt(v: number | undefined): number {
  return ((v ?? 0) / 1000) * (96 / 72);
}

/** 인라인 개체 속성 → 레이아웃 크기 (px). 크기가 없으면 100px 정사각형. 떠 있는 개체는 뺀다 */
export function objSizes(objs: ReadonlyMap<number, ObjAttrs>): Map<number, { w: number; h: number }> | null {
  const out = new Map<number, { w: number; h: number }>();
  for (const [k, o] of objs) if (!o.float) out.set(k, { w: o.w ? pt(o.w) : 100, h: o.h ? pt(o.h) : 100 });
  return out.size ? out : null;
}

/** 떠 있는 개체 → 레이아웃 입력 (px) */
export function floatSpecs(objs: ReadonlyMap<number, ObjAttrs>): Map<number, FloatSpec> | null {
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
