/**
 * 전체 기능 예제 공통 (프레임워크 무관): examples/react-full, examples/next-shadcn이 복사해 쓴다 (원본은 여기).
 * UI 코드가 아닌 것만 둔다: 화면 상태 읽기, 개요, 쪽 설정 값, 모든 형식 열기·저장(.quire 포함), 기능 둘러보기 문서,
 * 예제 문서 목록, 데모 맞춤법 검사기. 저장·내보내기 자체는 quire-demo.ts를 쓴다.
 */
import type { QuireDoc, QuireHandle } from '@quire/sdk';
import { WordListChecker, type Editor, type SpellChecker, type SpellIssue } from '@quire/editor';
import { PAPER_SIZES, type SectionProps, type SectionStart } from '@quire/model';
import { ASSET_BASE, saveFile, type SaveKind } from './quire-demo';

// ── 화면 상태 ─────────────────────────────────────────

export type Align = 'left' | 'center' | 'right' | 'justify';
export type Placement = 'inline' | 'square' | 'topBottom' | 'front' | 'behind';
export type ViewMode = 'suggestions' | 'final' | 'original';

/** 도구 막대·메뉴가 그리는 값 (섞인 값은 null) */
export interface Ui {
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  marks: {
    bold: boolean | null;
    italic: boolean | null;
    underline: boolean | null;
    strike: boolean | null;
    script: 'sup' | 'sub' | '' | null;
    /** pt */
    size: number | null;
    font: string | null;
    color: string | null;
    highlight: string | null;
    link: string | null;
  };
  para: {
    style: string | null;
    align: Align | null;
    list: 'bullet' | 'number' | null;
    /** 줄 간격 배수 (없으면 1) */
    line: number | null;
    pageBreakBefore: boolean;
    keepWithNext: boolean;
    keepTogether: boolean;
    koreanBreak: 'word' | 'char';
    hangPunct: boolean;
    squeeze: boolean;
  };
  table: { inTable: boolean; merged: boolean; range: boolean; header: boolean; cantSplit: boolean };
  object: { placement: Placement; alt: string } | null;
  headerFooter: { part: 'header' | 'footer'; titlePage: boolean; oddEven: boolean; linked: boolean; first: boolean } | null;
  note: { number: number } | null;
  section: { index: number; count: number };
  suggesting: boolean;
  viewMode: ViewMode;
  /** 화면 테마·색 모드·쪽 보기 (17) */
  appearance: { theme: 'classic' | 'minimal' | 'modern'; colorScheme: 'light' | 'dark' | 'auto'; pageView: 'print' | 'continuous' };
  /** 편집기 화면 언어 (18): 캔버스 표시·접근성 이름. 앱 UI의 번역은 앱이 한다 */
  locale: string;
  /** 편집 기호(¶, 나눔) 표시 */
  formatMarks: boolean;
  /** 화면 확대 배율 (1 = 100%) */
  zoom: number;
  spell: boolean;
  pages: number;
  threads: number;
  suggestions: number;
}

/** 편집기에서 화면 상태를 읽는다 (상태 알림마다) */
export function readUi(e: Editor): Ui {
  const { marks, mixed } = e.selectionMarks();
  const m = <T>(k: string, v: T): T | null => (mixed.has(k as never) ? null : v);
  const ps = e.paragraphState();
  const pm = <T>(k: string, v: T): T | null => (ps.mixed.has(k) ? null : v);
  const listId = ps.attrs.list?.id;
  const listKind = listId ? e.doc.listDef(listId)?.kind : undefined;
  const so = e.selectedObject();
  const fl = so?.attrs.float;
  const hf = e.headerFooterInfo();
  const note = e.noteInfo();
  const sec = e.sectionInfo();
  const sel = e.selection();
  const t = e.tableState();
  return {
    canUndo: e.history.canUndo,
    canRedo: e.history.canRedo,
    hasSelection: sel.anchor !== sel.head,
    marks: {
      bold: m('bold', !!marks.bold),
      italic: m('italic', !!marks.italic),
      underline: m('underline', !!marks.underline),
      strike: m('strike', !!marks.strike),
      script: m('script', (marks.script ?? '') as 'sup' | 'sub' | ''),
      size: m('size', marks.size !== undefined ? marks.size / 1000 : 12),
      font: m('font', marks.font ?? 'Pretendard'),
      color: m('color', marks.color ?? null),
      highlight: m('highlight', marks.highlight ?? null),
      link: m('link', marks.link ?? null),
    },
    para: {
      style: pm('style', ps.style),
      align: pm('align', (ps.attrs.align ?? 'left') as Align),
      list: listKind === 'bullet' || listKind === 'number' ? listKind : null,
      line: pm('line', ps.attrs.line?.rule === 'multiple' ? ps.attrs.line.value : 1),
      pageBreakBefore: !!ps.attrs.pageBreakBefore,
      keepWithNext: !!ps.attrs.keepWithNext,
      keepTogether: !!ps.attrs.keepTogether,
      koreanBreak: ps.attrs.koreanBreak === 'char' ? 'char' : 'word',
      hangPunct: !!ps.attrs.hangPunct,
      squeeze: !!ps.attrs.squeeze,
    },
    table: { inTable: t.inTable, merged: t.merged, range: t.range, header: t.header, cantSplit: t.cantSplit },
    object: so ? { placement: !fl ? 'inline' : fl.wrap === 'none' ? (fl.behind ? 'behind' : 'front') : (fl.wrap as Placement), alt: String(so.attrs.alt ?? '') } : null,
    headerFooter: hf ? { part: hf.part, titlePage: hf.titlePage, oddEven: hf.oddEven, linked: hf.linked, first: hf.sectionIndex === 0 } : null,
    note: note ? { number: note.number } : null,
    section: { index: sec.index, count: sec.count },
    suggesting: e.suggesting,
    appearance: { ...e.appearance },
    locale: e.locale,
    formatMarks: e.showMarks,
    zoom: e.zoom,
    viewMode: (e.viewMode === 'preview' ? 'suggestions' : e.viewMode) as ViewMode,
    spell: !!e.spellSession,
    pages: e.stats.pages,
    threads: e.threads().filter((t) => !t.resolved).length,
    suggestions: e.suggestionViews().length,
  };
}

/** 같은 값이면 같은 객체를 돌려주는 상태 읽기 (useSyncExternalStore용) */
export function uiReader(): (e: Editor | null) => Ui | null {
  let last: Ui | null = null;
  let key = '';
  return (e) => {
    if (!e) return null;
    const next = readUi(e);
    const k = JSON.stringify(next);
    if (k !== key) {
      key = k;
      last = next;
    }
    return last;
  };
}

// ── 문단 스타일·글꼴·색 목록 ───────────────────────────

export const STYLES: Array<{ id: string; label: string }> = [
  { id: 'body', label: '본문' },
  { id: 'h1', label: '제목 1' },
  { id: 'h2', label: '제목 2' },
  { id: 'h3', label: '제목 3' },
  { id: 'quote', label: '인용' },
];
export const FONTS = ['Pretendard', 'Noto Sans KR'];
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
export const COLORS = ['#000000', '#5f6368', '#c5221f', '#e37400', '#188038', '#1a73e8', '#7b1fa2', '#b06000'];
export const HIGHLIGHTS = ['#fff475', '#ccff90', '#a7ffeb', '#cbf0f8', '#fdcfe8', '#e6c9a8'];
export const LINE_SPACINGS = [1, 1.15, 1.5, 2];

// ── 개요 ──────────────────────────────────────────────

export interface Heading {
  level: number;
  text: string;
  offset: number;
}

/** 본문 제목 문단 (제목 1–3) */
export function outline(e: Editor): Heading[] {
  const out: Heading[] = [];
  for (const p of e.document.body.paragraphs()) {
    const s = p.attrs.style;
    const level = s === 'h1' ? 1 : s === 'h2' ? 2 : s === 'h3' ? 3 : -1;
    const text = p.text.replace(/￼/g, '').trim();
    if (level >= 0 && text) out.push({ level, text, offset: p.start });
  }
  return out;
}

// ── 쪽 설정 ───────────────────────────────────────────

/** 쪽 설정 대화상자의 값 (mm) */
export interface PageForm {
  paper: string;
  orientation: 'portrait' | 'landscape';
  width: number;
  height: number;
  /** 위·오른쪽·아래·왼쪽 */
  margin: [number, number, number, number];
  columns: number;
  columnGap: number;
  separator: boolean;
  start: SectionStart;
  pageNumberStart: string;
  pageNumberFormat: 'decimal' | 'roman' | 'hangul';
}

export const PAPERS = Object.keys(PAPER_SIZES);
const toMm = (v: number) => Math.round((v * 25.4) / 72) / 1000;
const fromMm = (v: number) => Math.round((v * 72000) / 25.4);

export function paperOf(w: number, h: number): string {
  for (const [name, [a, b]] of Object.entries(PAPER_SIZES)) {
    const near = (x: number, y: number) => Math.abs(x - y) < 1000;
    if ((near(w, a) && near(h, b)) || (near(w, b) && near(h, a))) return name;
  }
  return 'custom';
}

/** 용지 이름·방향 → mm 크기 */
export function paperSize(paper: string, orientation: 'portrait' | 'landscape'): [number, number] | null {
  const s = PAPER_SIZES[paper];
  if (!s) return null;
  const [a, b] = s;
  return orientation === 'landscape' ? [toMm(b), toMm(a)] : [toMm(a), toMm(b)];
}

export function pageFormOf(p: SectionProps): PageForm {
  const { width, height, margin } = p.page;
  return {
    paper: paperOf(width, height),
    orientation: width > height ? 'landscape' : 'portrait',
    width: toMm(width),
    height: toMm(height),
    margin: margin.map(toMm) as PageForm['margin'],
    columns: p.columns?.count ?? 1,
    columnGap: toMm(p.columns?.gap ?? fromMm(12.5)),
    separator: !!p.columns?.separator,
    start: p.start,
    pageNumberStart: p.pageNumber?.start !== undefined ? String(p.pageNumber.start) : '',
    pageNumberFormat: p.pageNumber?.format ?? 'decimal',
  };
}

/** 값 확인: 오류 문장 또는 null (문장은 앱이 번역해 줄 수 있다) */
export function checkPageForm(
  f: PageForm,
  msg = { negative: '크기와 여백은 0 이상의 숫자여야 합니다.', tooSmall: '여백을 뺀 본문이 가로·세로 20mm보다 커야 합니다.' },
): string | null {
  const vals = [f.width, f.height, ...f.margin];
  if (vals.some((v) => !Number.isFinite(v) || v < 0)) return msg.negative;
  if (f.width - f.margin[1] - f.margin[3] < 20 || f.height - f.margin[0] - f.margin[2] < 20) return msg.tooSmall;
  return null;
}

export function applyPageForm(e: Editor, f: PageForm): void {
  const prev = e.sectionInfo().props;
  const next: SectionProps = {
    ...prev,
    page: { width: fromMm(f.width), height: fromMm(f.height), margin: f.margin.map(fromMm) as [number, number, number, number] },
    start: f.start,
  };
  const pn = { ...(f.pageNumberStart.trim() !== '' ? { start: Math.max(0, Math.round(Number(f.pageNumberStart))) } : {}), ...(f.pageNumberFormat !== 'decimal' ? { format: f.pageNumberFormat } : {}) };
  if (Object.keys(pn).length) next.pageNumber = pn;
  else delete next.pageNumber;
  if (f.columns > 1) next.columns = { count: f.columns, gap: fromMm(Math.max(0, f.columnGap)), ...(f.separator ? { separator: true } : {}) };
  else delete next.columns;
  e.setSectionProps(next);
}

// ── 열기·저장 ─────────────────────────────────────────

export const OPEN_ACCEPT = '.quire,.hwpx,.docx,.md,.markdown,.txt,.html,.htm';
export type SaveFormat = SaveKind | 'quire';
export const SAVE_FORMATS: Array<{ kind: SaveFormat; label: string; ext: string }> = [
  { kind: 'quire', label: 'Quire 문서', ext: '.quire' },
  { kind: 'hwpx', label: '한글 (HWPX)', ext: '.hwpx' },
  { kind: 'docx', label: 'Word (DOCX)', ext: '.docx' },
  { kind: 'pdf', label: 'PDF', ext: '.pdf' },
  { kind: 'md', label: 'Markdown', ext: '.md' },
  { kind: 'html', label: 'HTML', ext: '.html' },
];

/** 파일을 연다. 가져오며 버린 요소(무엇 → 개수)를 돌려준다 */
export async function openAny(h: QuireHandle, file: File): Promise<Record<string, number>> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.quire')) {
    const { openQuire } = await import('@quire/sync');
    const q = await openQuire(new Uint8Array(await file.arrayBuffer()));
    await h.load(q.doc, q.assets.map((a) => [a.id, { bytes: a.bytes, type: a.mime }] as [string, { bytes: Uint8Array; type: string }]));
    return {};
  }
  const { openFile } = await import('./quire-demo');
  return openFile(h, file);
}

/** 저장 (내려받기). 바이트 수 */
export async function saveAny(h: QuireHandle, kind: SaveFormat, title = documentTitle(h)): Promise<number> {
  if (kind !== 'quire') return saveFile(h, kind);
  const { packQuire, assetIdsOf } = await import('@quire/sync');
  const { mimeOf } = await import('@quire/convert');
  const src = h.editor.printSource();
  const assets = [];
  for (const id of assetIdsOf(h.editor.document)) {
    const bytes = await src.asset(id);
    if (bytes) assets.push({ id, mime: mimeOf(bytes), bytes });
  }
  const data = await packQuire({ document: h.editor.document, assets });
  download(data, `${title}.quire`, 'application/vnd.quire');
  return data.length;
}

/** 문서 제목 (파일 이름): 본문 첫 문단, 비면 untitled */
export function documentTitle(h: QuireHandle, untitled = '제목 없는 문서'): string {
  // 본문 첫 문단 (캐럿이 표 셀·머리말에 있어도 본문을 본다)
  const first = h.editor.document.body.paragraphs()[0]?.text.replace(/￼/g, '').trim() ?? '';
  return (first || untitled).replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'quire';
}

function download(data: Uint8Array, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** PDF를 새 탭에서 연다 (인쇄용) */
export async function openPdf(h: QuireHandle): Promise<void> {
  const win = window.open('', '_blank');
  const { exportAs } = await import('./quire-demo');
  const bytes = (await exportAs(h, 'pdf')) as Uint8Array;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  if (win) win.location.href = url;
  else download(bytes, `${documentTitle(h)}.pdf`, 'application/pdf');
}

// ── 문서들 ────────────────────────────────────────────

/** 빈 문서 */
export function emptyDoc(): QuireDoc {
  return { format: 'quire', version: 1, settings: {}, styles: {}, stories: { body: [{ p: {}, c: [] }] }, annotations: [] } as unknown as QuireDoc;
}

/** 기능 둘러보기 문서: 주요 요소 문서(제목 1–6, 글자·문단 서식, 목록, 그림, 각주, 인용, 코드, 표) + 머리말·꼬리말(쪽 번호) */
export async function tourDoc(): Promise<{ doc: QuireDoc; assets: Array<[string, { bytes: Uint8Array; type: string }]> }> {
  const { elementsDocument } = await import('@quire/convert');
  const { assetIdOf } = await import('@quire/sync');
  const png = await samplePng();
  const asset = await assetIdOf(png);
  const doc = elementsDocument({ asset, w: 240 * 750, h: 120 * 750 }) as QuireDoc & { sections?: Array<Record<string, unknown>>; stories: Record<string, unknown> };
  const body = doc.stories.body as Array<{ p: Record<string, unknown>; c: Array<{ t?: string }> }>;
  if (body[0]?.c[0]) body[0].c[0].t = 'Quire 기능 둘러보기';
  body.splice(1, 0, {
    p: {},
    c: [{ t: '이 문서에는 편집기가 다루는 요소가 모두 들어 있습니다. 메뉴와 도구 막대로 고쳐 보고, 파일 메뉴에서 다른 예제 문서를 열거나 HWPX·DOCX·PDF로 저장해 보세요.' }],
  });
  const sec = (doc.sections?.[0] ?? { id: 's1', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, columns: 1 }) as Record<string, unknown>;
  sec.header = { default: 'hdr|s1|default' };
  sec.footer = { default: 'ftr|s1|default' };
  sec.id = sec.id ?? 's1';
  doc.sections = [sec];
  doc.stories['hdr|s1|default'] = [{ p: { align: 'right' }, c: [{ t: 'Quire 전체 기능 예제' }] }];
  doc.stories['ftr|s1|default'] = [{ p: { align: 'center' }, c: [{ img: { kind: 'field', field: 'page' } }, { t: ' / ' }, { img: { kind: 'field', field: 'pages' } }] }];
  return { doc: doc as QuireDoc, assets: [[asset, { bytes: png, type: 'image/png' }]] };
}

/** 둘러보기 문서의 그림 (캔버스로 그린 PNG) */
async function samplePng(): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 240;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 480, 240);
  grad.addColorStop(0, '#1a73e8');
  grad.addColorStop(1, '#34a853');
  g.fillStyle = grad;
  g.fillRect(0, 0, 480, 240);
  g.fillStyle = '#ffffff';
  g.font = 'bold 56px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('Quire', 240, 120);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** 예제 문서 (공개 폴더의 quire/samples, copy-samples.mjs가 복사) */
export const SAMPLES: Array<{ id: string; label: string; about: string }> = [
  { id: 'report', label: '보고서', about: '제목·목록·표(병합)' },
  { id: 'manual', label: '설명서', about: '머리말·꼬리말, 첫 쪽·홀짝 쪽' },
  { id: 'newsletter', label: '소식지', about: '구역·다단·용지' },
  { id: 'paper', label: '논문', about: '각주' },
  { id: 'forms', label: '신청서', about: '서식 표, 구역' },
  { id: 'schedule', label: '일정표', about: '쪽을 넘는 표 (제목 행 반복, 행 쪼개기)' },
];

export async function sampleDocument(id: string): Promise<QuireDoc> {
  const r = await fetch(`${ASSET_BASE}/samples/${id}.json`);
  if (!r.ok) throw new Error(`예제 문서를 받지 못함: ${id}`);
  return (await r.json()) as QuireDoc;
}

// ── 맞춤법 (데모) ─────────────────────────────────────

/** 자주 틀리는 표기 → 고칠 말 */
const MISTAKES: Array<[string, string[], SpellIssue['kind'], string?]> = [
  ['되요', ['돼요'], 'spelling', '‘되어요’의 준말은 ‘돼요’'],
  ['됬', ['됐'], 'spelling', '‘되었’의 준말은 ‘됐’'],
  ['안되', ['안 되'], 'spacing', '‘안’은 부사라 띄어 쓴다'],
  ['몇일', ['며칠'], 'spelling'],
  ['어떻해', ['어떡해', '어떻게 해'], 'spelling'],
  ['왠만', ['웬만'], 'spelling'],
  ['금새', ['금세'], 'spelling'],
  ['할께', ['할게'], 'spelling'],
  ['오랫만', ['오랜만'], 'spelling'],
  ['역활', ['역할'], 'spelling'],
  ['할수', ['할 수'], 'spacing', '의존 명사 ‘수’는 띄어 쓴다'],
];

/** 데모 검사기: 한국어 표기 몇 가지 + 작은 영어 낱말 목록. 실제 검사기는 앱이 끼운다 (15 §4) */
export class DemoSpellChecker implements SpellChecker {
  private readonly added = new Set<string>();
  private readonly english = new WordListChecker(
    `a an the and or but of to in on at for with by from as is are was were be it this that not no if do have will can
    editor document page text word table image font layout print find replace spell check quire korean english sample hello world`.split(/\s+/),
  );

  async check(text: string, lang: string, signal: AbortSignal): Promise<SpellIssue[]> {
    if (signal.aborted) throw signal.reason;
    const out: SpellIssue[] = [];
    for (const [wrong, fix, kind, message] of MISTAKES) {
      if (this.added.has(wrong)) continue;
      let i = text.indexOf(wrong);
      while (i >= 0) {
        const from = Array.from(text.slice(0, i)).length;
        out.push({ from, to: from + Array.from(wrong).length, kind, message, suggestions: fix });
        i = text.indexOf(wrong, i + wrong.length);
      }
    }
    const cps = Array.from(text);
    for (const e of await this.english.check(text, lang, signal)) {
      const w = cps.slice(e.from, e.to).join('');
      if (/^[A-Za-z']+$/.test(w) && !this.added.has(w.toLowerCase())) out.push(e);
    }
    return out.sort((a, b) => a.from - b.from);
  }

  addWord(word: string): void {
    this.added.add(word.toLowerCase());
    this.english.addWord(word.toLowerCase());
  }
}

// ── 단축키 ────────────────────────────────────────────

export const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl+B / I / U', '굵게 / 기울임 / 밑줄'],
  ['Ctrl+Z / Ctrl+Y', '실행 취소 / 다시 실행'],
  ['Ctrl+F / Ctrl+H', '찾기 / 바꾸기'],
  ['Ctrl+Enter', '쪽 나누기'],
  ['Ctrl+Shift+Enter', '단 나누기'],
  ['Ctrl+Alt+Enter', '구역 나누기'],
  ['Ctrl+Shift+8 / 7', '글머리 목록 / 번호 목록'],
  ['Tab / Shift+Tab', '목록 수준, 표에서 다음 셀'],
  ['Alt+Shift+↑ / ↓', '문단 옮기기'],
  ['Alt+클릭, Ctrl+Alt+↑ / ↓', '캐럿 더하기 (다중 커서)'],
  ['Ctrl+Alt+M', '댓글 달기'],
  ['Ctrl+Alt+K / J', '강조 낱말 더하기 / 다음 강조 낱말'],
  ['Ctrl+S', 'Quire 문서로 저장'],
  ['Ctrl+P', '인쇄 (PDF)'],
];

/** 확대·축소 단추가 밟는 배율 (워드프로세서들이 쓰는 값) */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

/** 다음 배율 단계 (dir 1: 크게, -1: 작게). 단계 사이 값이면 가까운 쪽 단계로 */
export function zoomStep(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_STEPS[0]!;
}

/** 배율 → "125%" */
export const zoomPercent = (z: number): string => `${Math.round(z * 100)}%`;
