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
  DEFAULT_HF_DISTANCE,
  LAST_SECTION,
  fullSection,
  noteRefs,
  noteStoryId,
  type NoteRefAt,
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
  type FieldKind,
  type HFKind,
} from '@quire/model';
import {
  CELL_PAD,
  LayoutCache,
  PLAIN_STYLE,
  PagedLayout,
  columnWidth,
  TableLayouter,
  geomKey,
  type FloatSpec,
  type FormatSource,
  type Measurer,
  type NoteSpec,
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

/** 필드 값 (12 §5.1): 그리는 쪽의 값 */
export type FieldValues = Record<FieldKind, string>;

/** 자리표시 값 (12 §5.2): 머리말 높이를 이 값의 폭으로 잰다. 그래서 본문 프레임은 쪽 번호와 무관하다 */
export const FIELD_PLACEHOLDER: FieldValues = { page: '999', pages: '999', sectionPages: '999', date: '0000. 00. 00.' };

/** 각주 영역에서 번호 자리 (px): 각주 내용은 그만큼 들여 조판한다 */
export const NOTE_INDENT = 24;

/** 구역 하나의 머리말·꼬리말 (문서 순서로 이어 쓴 것까지) */
export interface SectionHF {
  id: string;
  def: SectionProps | undefined;
  /** 이어 쓴 스토리 ID */
  header: Partial<Record<HFKind, string>>;
  footer: Partial<Record<HFKind, string>>;
  /** 쓰는 종류 중 가장 큰 높이 (px, 자리표시 값) */
  heights: [header: number, footer: number];
  geom: SectionGeom;
}

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
  /** 문서 순서의 구역: 머리말·꼬리말 이어 쓰기와 높이를 넣은 쪽 모양 (syncSections) */
  private secs: SectionHF[] = [];
  /** 머리말·꼬리말 스토리 → 잰 높이 (스토리 판·폭·스타일 판이 같으면 그대로) */
  private readonly hfHeights = new Map<string, { version: number; styles: number; width: number; height: number }>();
  /** 머리말·꼬리말 문단 레이아웃 캐시 (필드 값마다 폭이 다르다) */
  private readonly hfCache = new LayoutCache(2000);
  private measurer: Measurer | null = null;
  /** 지금 조판하는 필드 값 (null이면 자리표시) */
  fields: FieldValues | null = null;
  /** 각주 참조 (본문 판마다 훑는다, 12 §6.1) */
  private noteScan: { version: number; refs: NoteRefAt[]; nums: Map<string, number> } = { version: -1, refs: [], nums: new Map() };
  /** 각주 → 줄 높이들 (스토리 판·폭·스타일 판이 같으면 그대로) */
  private readonly noteLineCache = new Map<string, { version: number; styles: number; width: number; lines: number[] }>();
  /** 각주 → 마지막으로 참조 문단 서식에 쓴 값 (번호 자릿수·줄 높이). 바뀌면 그 문단을 다시 조판한다 */
  private readonly noteUsed = new Map<string, string>();
  /** 지난 syncNotes의 참조 차례 (같으면 번호가 그대로) */
  private noteOrder: string[] = [];
  /** 본문 문단 → 구역 차례·쪽 모양 (12 §3.3, SectionFrames). 머리말·꼬리말이 크면 본문을 민다 (§5.2) */
  readonly sections: SectionSource = {
    sectionOf: (m) => {
      const s = this.body.sectionOf(m);
      return { index: s.index, geom: this.sectionAt(s.index, s.id).geom };
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
    this.measurer = measurer;
    this.noteLineCache.clear();
    this.noteUsed.clear();
    this.hfHeights.clear();
    this.hfCache.clear();
    this.secs = [];
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
    // 다단 (12 §7): 단이 둘 이상일 때만 (한 단이면 지금까지와 같은 모양·키)
    const cols = f.columns && f.columns.count > 1 ? { cols: Math.min(8, Math.round(f.columns.count)), gap: px(f.columns.gap), sep: !!f.columns.separator } : {};
    const g = { width: px(f.page.width), height: px(f.page.height), top: px(t), right: px(r), bottom: px(b), left: px(l), start: f.start, ...cols };
    const geom = { ...g, key: geomKey(g) };
    this.geoms.set(id, { def, geom });
    return geom;
  }

  /** 구역 차례 i (ID id): 설정 객체가 같으면 지난 syncSections 값, 아니면 다시 맞춘다 */
  sectionAt(i: number, id: string): SectionHF {
    const s = this.secs[i];
    if (s && s.id === id && s.def === this.body.sectionDef(id) && this.secs.length === this.body.sectionBreaks().length + 1) return s;
    this.syncSections();
    return this.secs[i] ?? this.secs[this.secs.length - 1]!;
  }

  /** 문서 순서의 구역들 (머리말·꼬리말 포함) */
  sectionList(): readonly SectionHF[] {
    if (this.secs.length !== this.body.sectionBreaks().length + 1) this.syncSections();
    return this.secs;
  }

  /**
   * 구역들의 머리말·꼬리말을 다시 맞춘다 (12 §5.2): 이어 쓰기, 스토리 높이(자리표시 값). 본문을 조판하기 전에 부른다.
   * 쪽 모양이 바뀐 첫 구역의 차례 (없으면 -1): 부르는 쪽이 그 구역 첫 문단부터 다시 놓게 한다
   */
  syncSections(): number {
    const b = this.body;
    const breaks = b.sectionBreaks();
    const n = breaks.length + 1;
    const old = this.secs;
    const out: SectionHF[] = [];
    let header: Partial<Record<HFKind, string>> = {};
    let footer: Partial<Record<HFKind, string>> = {};
    let changed = -1;
    for (let i = 0; i < n; i++) {
      const id = i < n - 1 ? b.paraAttrs(breaks[i]!).section! : LAST_SECTION;
      const def = b.sectionDef(id);
      if (def?.header) header = { ...header, ...pick(def.header) };
      if (def?.footer) footer = { ...footer, ...pick(def.footer) };
      const base = this.sectionGeom(id);
      const f = fullSection(def);
      const kinds: HFKind[] = ['default', ...(f.titlePage ? (['first'] as const) : []), ...(f.oddEven ? (['even'] as const) : [])];
      const width = base.width - base.left - base.right;
      const hh = Math.max(0, ...kinds.map((k) => this.storyHeight(header[k], width)));
      const fh = Math.max(0, ...kinds.map((k) => this.storyHeight(footer[k], width)));
      let geom = base;
      if (hh > 0 || fh > 0) {
        const top = hh > 0 ? Math.max(base.top, Math.ceil(pt(f.headerDistance ?? DEFAULT_HF_DISTANCE) + hh)) : base.top;
        const bottom = fh > 0 ? Math.max(base.bottom, Math.ceil(pt(f.footerDistance ?? DEFAULT_HF_DISTANCE) + fh)) : base.bottom;
        if (top !== base.top || bottom !== base.bottom) {
          const g = { ...base, top, bottom, key: undefined };
          delete g.key;
          geom = { ...g, key: geomKey(g) };
        }
      }
      out.push({ id, def, header, footer, heights: [hh, fh], geom });
      if (changed < 0 && old[i]?.geom.key !== geom.key) changed = i;
    }
    this.secs = out;
    return old.length ? changed : -1;
  }

  /** 머리말·꼬리말 스토리의 높이 (px, 자리표시 값). 스토리가 없으면 0 */
  storyHeight(story: string | undefined, width: number): number {
    if (!story) return 0;
    const doc = this.document().story(story);
    const hit = this.hfHeights.get(story);
    const styles = this.body.stylesVersion;
    if (hit && hit.version === doc.version && hit.width === width && hit.styles === styles) return hit.height;
    const height = this.layoutStory(doc, width, null).contentBottom;
    this.hfHeights.set(story, { version: doc.version, styles, width, height });
    return height;
  }

  /**
   * 머리말·꼬리말 스토리를 폭 width로 조판한다 (원점 0, 쪽 하나). fields: 그 쪽의 필드 값 (null이면 자리표시).
   * 문단 레이아웃은 캐시에 있으므로 쪽마다 새로 만들어도 싸다
   */
  layoutStory(doc: Doc, width: number, fields: FieldValues | null, preedit: { offset: number; text: string; fmt?: number } | null = null): PagedLayout {
    const setup: PageSetup = { ...this.setup, width, height: 1e9, margin: 0, gap: 0, originX: 0, originY: 0 };
    const L = new PagedLayout(setup, this.measurer!, this.hfCache, this.cellFormat(doc));
    const prev = this.fields;
    this.fields = fields;
    try {
      L.update(doc.paragraphs(), preedit, Infinity, null);
    } finally {
      this.fields = prev;
    }
    return L;
  }

  // ── 각주 (12 §6) ──────────────────────────────────

  private notesNow(): { refs: NoteRefAt[]; nums: Map<string, number> } {
    const b = this.body;
    if (this.noteScan.version !== b.version) {
      const refs = noteRefs(b);
      const nums = new Map<string, number>();
      refs.forEach((n, i) => {
        if (!nums.has(n.id)) nums.set(n.id, i + 1);
      });
      this.noteScan = { version: b.version, refs, nums };
    }
    return this.noteScan;
  }

  /** 각주 번호 (참조 순서, 1부터). 참조가 없으면 0 */
  noteNumber(id: string): number {
    return this.notesNow().nums.get(id) ?? 0;
  }

  /** 본문의 각주 참조 (문서 순서) */
  noteList(): readonly NoteRefAt[] {
    return this.notesNow().refs;
  }

  /** 본문 문단 i의 각주 영역 폭 (px): 그 구역 본문 폭 − 번호 자리 */
  noteWidth(i: number): number {
    const s = this.body.sectionOf(i);
    return Math.max(1, columnWidth(this.sectionAt(s.index, s.id).geom) - NOTE_INDENT);
  }

  /** 각주 내용의 줄 높이들 (px, 폭 width로 조판, 합 = 각주 높이) */
  noteLines(id: string, width: number): number[] {
    const doc = this.document().story(noteStoryId(id));
    const styles = this.body.stylesVersion;
    const hit = this.noteLineCache.get(id);
    if (hit && hit.version === doc.version && hit.width === width && hit.styles === styles) return hit.lines;
    const L = this.layoutStory(doc, width, null);
    const tops: number[] = [];
    for (const pp of L.paras) for (const ln of pp!.lines) tops.push(ln.y);
    const bottom = L.contentBottom;
    const lines = tops.map((t, k) => (k + 1 < tops.length ? tops[k + 1]! : bottom) - t);
    this.noteLineCache.set(id, { version: doc.version, styles, width, lines });
    return lines;
  }

  private noteKey(id: string, width: number): string {
    return `${String(this.noteNumber(id)).length}|${this.noteLines(id, width).join('/')}`;
  }

  /**
   * 각주 번호 자릿수(참조 폭)나 각주 높이가 바뀐 참조 문단들 (12 §6.2): 부르는 쪽이 다시 조판하게 한다. 본문을 조판하기 전에 부른다
   */
  syncNotes(): number[] {
    const out: number[] = [];
    const refs = this.notesNow().refs;
    // 참조 차례가 같으면 번호도 같다: 내용이 바뀐 각주만 본다 (입력마다 모든 참조의 키를 만들지 않는다)
    const order = this.noteOrder;
    const same = refs.length === order.length && refs.every((n, i) => n.id === order[i]);
    if (!same) this.noteOrder = refs.map((n) => n.id);
    const styles = this.body.stylesVersion;
    const document = this.document();
    for (const n of refs) {
      const used = this.noteUsed.get(n.id);
      if (used === undefined) continue;
      if (same) {
        const c = this.noteLineCache.get(n.id);
        const sid = noteStoryId(n.id);
        if (c && c.styles === styles && (!document.has(sid) || c.version === document.story(sid).version)) continue;
      }
      if (used !== this.noteKey(n.id, this.noteWidth(n.para))) out.push(n.para);
    }
    return out;
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
    const objs = p.objs ? this.objSizes(p, doc, styled ? (attrs.style ?? BODY_STYLE) : '') : null;
    const notes = p.objs && doc === body ? this.noteSpecs(p) : null;
    // 셀 안의 떠 있는 개체는 인라인으로 (셀 원점이 바뀌어도 놓인 자리를 다시 구하지 않으므로)
    const floats = p.objs && doc === body ? floatSpecs(p.objs) : null;
    const sty = styled ? (attrs.style ?? BODY_STYLE) : '';
    // 스타일 글자 서식은 서식 번호 0에도 걸리므로 fmt가 없으면 0으로 채운 열을 준다
    const fmt = p.fmt ?? (styled ? new Uint16Array(cpCount(p.text)) : null);
    // 서식 번호의 뜻은 스토리마다 다르므로 셀은 캐시 키에 스토리 번호를 넣는다
    const key = (doc === body ? '' : `d${this.docId(doc)}`) + (styled ? `${sty}@${body.stylesVersion}` : '');
    return { fmt, mark: p.mark ?? 0, style: this.styleFn(sty, doc), box, marker, objs, floats, notes, key: key || undefined };
  }

  /** 인라인 개체 크기 (px). 필드는 값(또는 자리표시)의 글자 폭, 높이는 글자 ascent보다 작게 (줄 높이를 바꾸지 않는다) */
  private objSizes(p: ParagraphInfo, doc: Doc, sty: string): Map<number, { w: number; h: number }> | null {
    const out = objSizes(p.objs!);
    if (!out) return null;
    for (const [k, o] of p.objs!) {
      if (o.float) continue;
      const run = this.drawStyle(p.fmt?.[k] ?? 0, sty, doc).run;
      if (o.kind === 'field') out.set(k, { w: this.textWidth(this.fieldText(o.field), run.face) * run.scale, h: 0.7 * this.fontSize * run.scale });
      // 각주 참조: 번호(위 첨자)의 폭 (12 §6.2)
      else if (o.kind === 'note') out.set(k, { w: this.textWidth(String(this.noteNumber(o.id ?? '') || 0), run.face) * run.scale * SCRIPT_SCALE, h: 0.7 * this.fontSize * run.scale });
    }
    return out;
  }

  /** 본문 문단의 각주 참조 → 각주 줄 높이 (그 구역의 각주 영역 폭) */
  private noteSpecs(p: ParagraphInfo): Map<number, NoteSpec> | null {
    let out: Map<number, NoteSpec> | null = null;
    let width = -1;
    for (const [k, o] of p.objs!) {
      if (o.kind !== 'note' || !o.id) continue;
      if (width < 0) width = this.noteWidth(this.body.paragraphIndexAt(p.start));
      (out ??= new Map()).set(k, { id: o.id, lines: this.noteLines(o.id, width) });
      this.noteUsed.set(o.id, this.noteKey(o.id, width));
    }
    return out;
  }

  /** 필드 하나의 글자 (지금 필드 값, 없으면 자리표시) */
  fieldText(kind: FieldKind | undefined): string {
    return kind ? (this.fields ?? FIELD_PLACEHOLDER)[kind] : '?';
  }

  /** 글자열 폭 (px, 기본 크기) */
  textWidth(text: string, face = 0): number {
    const m = this.measurer;
    if (!m) return text.length * this.fontSize * 0.6;
    let w = 0;
    if (m.advances) {
      for (const a of m.advances(text, face)) w += a;
      return w;
    }
    for (const ch of text) w += m.width(ch, face);
    return w;
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
    const keep =
      a.pageBreakBefore || a.keepWithNext || a.keepTogether || a.columnBreakBefore
        ? {
            ...(a.pageBreakBefore ? { breakBefore: true as const } : {}),
            ...(a.keepWithNext ? { next: true as const } : {}),
            ...(a.keepTogether ? { together: true as const } : {}),
            ...(a.columnBreakBefore ? { column: true as const } : {}),
          }
        : undefined;
    if (!a.align && !a.indent && !a.space && !a.line && !label && !keep) return null;
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
      ...(keep ? { keep } : {}),
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
    // 과부·고아 줄 막기 (12 §4, Word·한글 프로그램 기본과 같이 켬)
    widowControl: true,
  };
}

/** 스토리 ID가 있는 종류만 */
function pick(m: Partial<Record<HFKind, string>>): Partial<Record<HFKind, string>> {
  const out: Partial<Record<HFKind, string>> = {};
  for (const k of ['default', 'first', 'even'] as const) if (m[k]) out[k] = m[k];
  return out;
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
