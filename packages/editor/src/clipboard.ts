/**
 * 서식 있는 복사·붙여넣기.
 *
 * 복사는 세 형식을 함께 쓴다:
 * - `application/x-quire-fragment`: 조각(Fragment) JSON. Quire끼리 서식·문단 속성·목록·이미지·표를 잃지 않는다.
 * - `text/html`: 다른 프로그램(Word, Google Docs, 메일)용.
 * - `text/plain`: 글자만.
 *
 * 붙여넣기는 조각 → HTML(Word·Google Docs·웹 페이지) → 이미지 파일 → 글자 순서로 고른다. HTML은 DOM 없이 읽는다 (작은 파서,
 * Node 시험에서도 돈다).
 *
 * 문단 속성 규칙 (Google Docs와 같다): 붙인 첫 문단·끝 문단이 조각(문단의 일부)이면 붙인 자리 문단의 속성을 따른다. 사이의 온전한
 * 문단은 자기 속성(스타일·정렬·목록)을 가져온다. 첫 문단이 온전하고 빈 자리(문단 첫머리)에 붙이면 그 문단 속성도 가져온다.
 */
import {
  Document,
  cellKey,
  cellStoryId,
  noteStoryId,
  defaultListDef,
  normalizeTable,
  type Doc,
  type ListDef,
  type MarkKey,
  type MarkSet,
  type ObjAttrs,
  type Op,
  type ParaAttrs,
  type ParaKey,
  type ParagraphInfo,
} from '@quire/model';

export const FRAGMENT_MIME = 'application/x-quire-fragment';

export interface ClipRun {
  t?: string;
  img?: ObjAttrs;
  /** HTML에서 온 이미지의 원본 (data: URL). 붙이기 전에 자산으로 바꾼다 */
  src?: string;
  m?: MarkSet;
}

export interface ClipPara {
  p: ParaAttrs;
  c: ClipRun[];
  /** 문단 처음부터 복사했다 (온전한 문단의 앞) */
  start?: true;
  /** 문단 끝까지 복사했다 */
  end?: true;
}

export interface ClipTable {
  table: {
    /** 열 너비 (1/1000pt) */
    cols: number[];
    rows: Array<{ cells: Array<{ story: string; span?: [number, number]; fill?: string; valign?: 'top' | 'middle' | 'bottom' }>; h?: number }>;
  };
}

export type ClipBlock = ClipPara | ClipTable;

export interface Fragment {
  quire: 1;
  blocks: ClipBlock[];
  /** 마지막 블록의 ¶까지 복사했다 (붙이면 뒤에 새 문단이 생긴다) */
  closed: boolean;
  /** 표 셀 내용 (표 블록의 story 이름), 각주 내용 (note|<참조 id>) */
  stories: Record<string, ClipPara[]>;
  /** 쓰인 목록 정의 */
  lists: Record<string, ListDef>;
}

const isTable = (b: ClipBlock): b is ClipTable => 'table' in b;
const hasKeys = (o: object) => Object.keys(o).length > 0;
/** 본문 폭 (A4, 여백 72pt): 붙인 HTML 표의 열 너비 */
const BODY_WIDTH = 451000;

// ── 복사 ─────────────────────────────────────────────

/** 문단 p의 코드포인트 [s, e) → 런 (표 원소는 뺀다) */
function runsOf(doc: Doc, p: ParagraphInfo, s: number, e: number): ClipRun[] {
  const cps = Array.from(p.text);
  const out: ClipRun[] = [];
  let k = s;
  while (k < e) {
    const f = p.fmt ? p.fmt[k]! : 0;
    const m = doc.markSet(f);
    const mm = hasKeys(m) ? { m: { ...m } } : {};
    const o = p.objs?.get(k);
    if (o) {
      if (o.kind !== 'table') out.push({ img: { ...o }, ...mm });
      k++;
      continue;
    }
    let j = k + 1;
    while (j < e && (p.fmt ? p.fmt[j]! : 0) === f && !p.objs?.has(j)) j++;
    out.push({ t: cps.slice(k, j).join(''), ...mm });
    k = j;
  }
  return out;
}

/** 스토리 전체 → 문단들 */
function storyParas(doc: Doc, lists: Record<string, ListDef>, body: Doc): ClipPara[] {
  return doc.paragraphs().map((p) => para(doc, p, 0, Array.from(p.text).length, lists, body));
}

function para(doc: Doc, p: ParagraphInfo, s: number, e: number, lists: Record<string, ListDef>, body: Doc): ClipPara {
  const blk: ClipPara = { p: { ...p.attrs }, c: runsOf(doc, p, s, e) };
  if (s === 0) blk.start = true;
  if (e >= Array.from(p.text).length) blk.end = true;
  const li = p.attrs.list;
  if (li && !lists[li.id]) {
    const def = doc.listDef(li.id) ?? body.listDef(li.id);
    if (def) lists[li.id] = structuredClone(def);
  }
  return blk;
}

/**
 * 표 → 표 블록 (정규화한 격자, 정본 JSON과 같은 모양). box가 있으면 그 셀 범위만 (셀 범위 복사). 덮인 셀의 글은 주인 셀 뒤에
 */
export function tableBlock(
  document: Document,
  id: string,
  frag: Fragment,
  box?: { y0: number; y1: number; x0: number; x1: number },
): ClipTable | null {
  const rec = document.table(id);
  if (!rec) return null;
  const g = normalizeTable(rec);
  if (!g.rows.length || !g.cols.length) return null;
  const y0 = box?.y0 ?? 0;
  const y1 = box?.y1 ?? g.rows.length - 1;
  const x0 = box?.x0 ?? 0;
  const x1 = box?.x1 ?? g.cols.length - 1;
  const tk = Object.keys(frag.stories).length;
  const table: ClipTable['table'] = { cols: g.widths.slice(x0, x1 + 1), rows: [] };
  for (let y = y0; y <= y1; y++) {
    const r: ClipTable['table']['rows'][0] = { cells: [] };
    const mh = rec.rowAttrs[g.rows[y]!]?.minHeight;
    if (mh) r.h = mh;
    for (let x = x0; x <= x1; x++) {
      const c = g.cells[y]![x];
      if (!c) continue;
      const name = `t${tk}.${y}.${x}`;
      const cell: ClipTable['table']['rows'][0]['cells'][0] = { story: name };
      const h = Math.min(c.span[0], y1 - y + 1);
      const w = Math.min(c.span[1], x1 - x + 1);
      if (h > 1 || w > 1) cell.span = [h, w];
      const fill = rec.cellAttrs[cellKey(c.row, c.col)]?.fill;
      if (fill) cell.fill = fill;
      r.cells.push(cell);
      const paras: ClipPara[] = [];
      for (const sid of [c.story, ...c.covered]) {
        if (!document.has(sid)) continue;
        const d = document.story(sid);
        if (sid !== c.story && d.length === 1) continue;
        paras.push(...storyParas(d, frag.lists, document.body));
      }
      frag.stories[name] = paras.length ? paras : [{ p: {}, c: [], start: true }];
    }
    table.rows.push(r);
  }
  return { table };
}

/** 스토리 doc의 [from, to) → 조각. 본문의 표 문단은 표 블록으로 */
export function fragmentOf(document: Document, doc: Doc, from: number, to: number): Fragment {
  const frag: Fragment = { quire: 1, blocks: [], closed: false, stories: {}, lists: {} };
  const ps = doc.paragraphs();
  const i = doc.paragraphIndexAt(from);
  let j = doc.paragraphIndexAt(to);
  // 끝이 문단 첫머리면 앞 문단의 ¶까지 복사한 것
  if (j > i && to === ps[j]!.start) {
    j--;
    frag.closed = true;
  }
  for (let k = i; k <= j; k++) {
    const p = ps[k]!;
    const len = Array.from(p.text).length;
    const s = k === i ? from - p.start : 0;
    const e = k === j ? Math.min(len, to - p.start) : len;
    if (k === j && to > p.end) frag.closed = true;
    const t = p.objs?.get(0);
    if (t?.kind === 'table' && t.table && doc === document.body) {
      if (s === 0 && e >= 1) {
        const tb = tableBlock(document, t.table, frag);
        if (tb) frag.blocks.push(tb);
      }
      continue;
    }
    frag.blocks.push(para(doc, p, s, e, frag.lists, document.body));
  }
  // 각주 참조 (12 §6.1): 각주 내용도 싣는다 (붙이면 새 id + 내용 복사)
  if (doc === document.body)
    for (const b of frag.blocks)
      if (!isTable(b))
        for (const run of b.c) {
          const id = run.img?.kind === 'note' ? run.img.id : undefined;
          if (id && document.has(noteStoryId(id))) frag.stories[`note|${id}`] = storyParas(document.story(noteStoryId(id)), frag.lists, document.body);
        }
  return frag;
}

/** 조각 → 글자 (표는 행마다 줄, 칸은 탭) */
export function fragmentToText(frag: Fragment): string {
  const paraText = (b: ClipPara) => b.c.map((r) => r.t ?? '').join('');
  const lines: string[] = [];
  for (const b of frag.blocks) {
    if (!isTable(b)) {
      lines.push(paraText(b));
      continue;
    }
    for (const r of b.table.rows) lines.push(r.cells.map((c) => (frag.stories[c.story] ?? []).map(paraText).join(' ')).join('\t'));
  }
  return lines.join('\n') + (frag.closed ? '\n' : '');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 런 → HTML (굵게·기울임·밑줄·취소선·첨자·색·형광·크기·링크) */
function runHtml(r: ClipRun): string {
  if (r.img) return `<img alt="${esc(r.img.alt ?? '')}"${r.img.w ? ` width="${Math.round(((r.img.w / 1000) * 96) / 72)}"` : ''}>`;
  let h = esc(r.t ?? '');
  const m = r.m ?? {};
  const css: string[] = [];
  if (m.color) css.push(`color:${m.color}`);
  if (m.highlight) css.push(`background-color:${m.highlight}`);
  if (m.size) css.push(`font-size:${m.size / 1000}pt`);
  if (m.font) css.push(`font-family:${esc(m.font)}`);
  if (css.length) h = `<span style="${css.join(';')}">${h}</span>`;
  if (m.script) h = `<${m.script}>${h}</${m.script}>`;
  if (m.strike) h = `<s>${h}</s>`;
  if (m.underline) h = `<u>${h}</u>`;
  if (m.italic) h = `<i>${h}</i>`;
  if (m.bold) h = `<b>${h}</b>`;
  if (m.link) h = `<a href="${esc(m.link)}">${h}</a>`;
  return h;
}

function paraHtml(b: ClipPara, tag: string): string {
  const css: string[] = [];
  if (b.p.align && b.p.align !== 'left') css.push(`text-align:${b.p.align}`);
  const inner = b.c.map(runHtml).join('') || '<br>';
  return `<${tag}${css.length ? ` style="${css.join(';')}"` : ''}>${inner}</${tag}>`;
}

/** 조각 → HTML (목록은 ul/ol 중첩, 제목은 h1–h3, 인용은 blockquote, 표는 table) */
export function fragmentToHtml(frag: Fragment): string {
  const out: string[] = [];
  /** 열린 목록: [태그, 수준] */
  const open: Array<[string, number]> = [];
  const closeTo = (level: number) => {
    while (open.length && open[open.length - 1]![1] > level) out.push(`</${open.pop()![0]}>`);
  };
  for (const b of frag.blocks) {
    if (isTable(b)) {
      closeTo(-1);
      out.push('<table border="1" style="border-collapse:collapse">');
      for (const r of b.table.rows) {
        out.push('<tr>');
        for (const c of r.cells) {
          const span = c.span ? `${c.span[0] > 1 ? ` rowspan="${c.span[0]}"` : ''}${c.span[1] > 1 ? ` colspan="${c.span[1]}"` : ''}` : '';
          out.push(`<td${span}${c.fill ? ` style="background-color:${c.fill}"` : ''}>${(frag.stories[c.story] ?? []).map((p) => paraHtml(p, 'p')).join('')}</td>`);
        }
        out.push('</tr>');
      }
      out.push('</table>');
      continue;
    }
    const li = b.p.list;
    if (!li) {
      closeTo(-1);
      const st = b.p.style;
      const tag = st === 'h1' || st === 'h2' || st === 'h3' ? st : st === 'quote' ? 'blockquote' : 'p';
      out.push(paraHtml(b, tag));
      continue;
    }
    const tag = frag.lists[li.id]?.kind === 'bullet' ? 'ul' : 'ol';
    closeTo(li.level);
    while (!open.length || open[open.length - 1]![1] < li.level) {
      open.push([tag, open.length ? open[open.length - 1]![1] + 1 : li.level]);
      out.push(`<${tag}>`);
    }
    out.push(paraHtml(b, 'li'));
  }
  closeTo(-1);
  return `<meta charset="utf-8">${out.join('')}`;
}

// ── HTML 읽기 (Word, Google Docs, 웹) ───────────────────

interface HNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<HNode | string>;
}

const VOID = new Set(['br', 'img', 'meta', 'link', 'hr', 'input', 'col', 'wbr', 'area', 'base', 'source']);
const SKIP = new Set(['head', 'style', 'script', 'title', 'xml', 'template', 'noscript']);
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', copy: '©' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** 너그러운 HTML 파서: 태그·속성·글자·주석. 닫는 태그가 없거나 어긋나도 트리를 만든다 */
export function parseHtml(html: string): HNode {
  const root: HNode = { tag: '#root', attrs: {}, children: [] };
  const stack: HNode[] = [root];
  const top = () => stack[stack.length - 1]!;
  const re = /<!--[\s\S]*?-->|<!\[[\s\S]*?\]>|<!(?:[^>]*)>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) top().children.push(decode(html.slice(last, m.index)));
    last = re.lastIndex;
    if (m[1]) {
      const name = m[1].toLowerCase();
      for (let k = stack.length - 1; k > 0; k--)
        if (stack[k]!.tag === name) {
          stack.length = k;
          break;
        }
      continue;
    }
    if (!m[2]) continue; // 주석, 조건부 주석, doctype
    const tag = m[2].toLowerCase();
    const attrs: Record<string, string> = {};
    const ar = /([^\s=>/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[3] ?? ''))) attrs[a[1]!.toLowerCase()] = decode(a[3] ?? a[4] ?? a[5] ?? '');
    const node: HNode = { tag, attrs, children: [] };
    // 블록이 열리면 열린 <p>를 닫는다 (브라우저와 같다)
    if (/^(p|div|ul|ol|table|h[1-6]|blockquote|pre|section|article|header|footer)$/.test(tag)) {
      for (let k = stack.length - 1; k > 0; k--) {
        const t = stack[k]!.tag;
        if (t === 'p') {
          stack.length = k;
          break;
        }
        if (t === 'li' || t === 'td' || t === 'th' || t === 'div' || t === 'blockquote' || t === 'b' || t === 'span') break;
      }
    }
    // 문단·셀·목록 항목은 같은 것이 열려 있으면 먼저 닫는다 (<p>…<p>, <li>…<li>)
    if (['p', 'li', 'td', 'th', 'tr'].includes(tag)) {
      for (let k = stack.length - 1; k > 0; k--) {
        const t = stack[k]!.tag;
        if (t === tag || (tag === 'tr' && t === 'table') || (tag !== 'tr' && (t === 'tr' || t === 'table' || t === 'ul' || t === 'ol'))) {
          if (t === tag) stack.length = k;
          break;
        }
      }
    }
    top().children.push(node);
    if (!VOID.has(tag) && !m[4]) stack.push(node);
  }
  if (last < html.length) top().children.push(decode(html.slice(last)));
  return root;
}

function styleOf(n: HNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (n.attrs.style ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

/** CSS 색 → #rrggbb (검정·투명은 없음) */
function cssColor(v: string | undefined): string | undefined {
  if (!v) return undefined;
  v = v.trim().toLowerCase();
  let hex: string | undefined;
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(v);
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return undefined;
    hex = '#' + [rgb[1], rgb[2], rgb[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
  } else if (/^#[0-9a-f]{6}$/.test(v)) hex = v;
  else if (/^#[0-9a-f]{3}$/.test(v)) hex = '#' + [...v.slice(1)].map((c) => c + c).join('');
  else if (v === 'red') hex = '#ff0000';
  else if (v === 'blue') hex = '#0000ff';
  else if (v === 'green') hex = '#008000';
  else if (v === 'yellow') hex = '#ffff00';
  if (!hex || hex === '#000000' || v === 'transparent' || v === 'windowtext' || v === 'inherit') return undefined;
  return hex;
}

/** CSS 길이 → 1/1000pt */
function cssPt(v: string | undefined, signed = false): number | undefined {
  const m = /^(-?[\d.]+)\s*(pt|px)$/.exec((v ?? '').trim().toLowerCase());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n < 0 && !signed) return undefined;
  return Math.round((m[2] === 'px' ? n * 0.75 : n) * 1000);
}

/** 요소가 더하거나 지우는 글자 서식 */
function marksOf(n: HNode, base: MarkSet, fonts = false): MarkSet {
  const m: Record<string, unknown> = { ...base };
  const t = n.tag;
  if (t === 'b' || t === 'strong') m.bold = true;
  if (t === 'i' || t === 'em') m.italic = true;
  if (t === 'u' || t === 'ins') m.underline = true;
  if (t === 's' || t === 'strike' || t === 'del') m.strike = true;
  if (t === 'sup' || t === 'sub') m.script = t;
  if (t === 'a' && n.attrs.href && !n.attrs.href.startsWith('#')) m.link = n.attrs.href;
  if (t === 'font' && n.attrs.color) m.color = cssColor(n.attrs.color);
  const st = styleOf(n);
  const fw = st['font-weight'];
  if (fw) {
    if (fw === 'bold' || fw === 'bolder' || Number(fw) >= 600) m.bold = true;
    else if (fw === 'normal' || fw === 'lighter' || Number(fw) < 600) delete m.bold; // Google Docs는 전체를 <b style="font-weight:normal">로 감싼다
  }
  if (st['font-style'] === 'italic') m.italic = true;
  else if (st['font-style'] === 'normal') delete m.italic;
  const td = st['text-decoration'] ?? st['text-decoration-line'];
  if (td?.includes('underline')) m.underline = true;
  if (td?.includes('line-through')) m.strike = true;
  const va = st['vertical-align'];
  if (va === 'super') m.script = 'sup';
  else if (va === 'sub') m.script = 'sub';
  if (st.color) {
    const c = cssColor(st.color);
    if (c) m.color = c;
    else delete m.color;
  }
  const bg = cssColor(st['background-color'] ?? st.background);
  if (bg && bg !== '#ffffff') m.highlight = bg;
  const size = cssPt(st['font-size']);
  if (size) m.size = size;
  if (fonts) {
    const fam = (st['font-family'] ?? (t === 'font' ? n.attrs.face : undefined))?.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
    if (fam && !/^(serif|sans-serif|monospace|inherit|initial)$/i.test(fam)) m.font = fam;
  }
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  return m as MarkSet;
}

/** HTML 읽기 선택 (문서 단위 가져오기, 15 §6.2) */
export interface HtmlReadOptions {
  /**
   * 문서 단위: 제목 1–6을 그대로(붙여넣기는 1–3으로 줄인다), <pre>는 코드 스타일 문단, 문단 간격과 정확한 줄 간격, 글꼴 이름도 가져온다
   */
  document?: boolean;
  /** 담을 수 없어 버린 요소 (가져오기 보고) */
  drop?: (what: string) => void;
}

/** 버리면 보고하는 요소 */
const DROPPED: Record<string, string> = {
  hr: '가로줄', iframe: '내장 문서', video: '동영상', audio: '소리', svg: 'SVG 그림', canvas: '캔버스', object: '내장 개체', embed: '내장 개체',
  form: '입력 양식', input: '입력 양식', select: '입력 양식', button: '입력 양식', textarea: '입력 양식', math: '수식',
};

/** 각주 칸: GFM(section.footnotes의 li#id), Word(div#ftnN, 참조 href="#_ftnN") */
function footnoteTargets(root: HNode): Map<string, HNode> {
  const out = new Map<string, HNode>();
  const visit = (n: HNode, inNotes: boolean) => {
    const notes = inNotes || isFootnoteBox(n);
    if (notes && n.tag === 'li' && n.attrs.id) out.set(n.attrs.id, n);
    if (n.tag === 'div' && /^ftn\d+$/.test(n.attrs.id ?? '')) out.set(`_${n.attrs.id}`, n);
    for (const c of n.children) if (typeof c !== 'string') visit(c, notes);
  };
  visit(root, false);
  return out;
}

/** 각주 칸을 담은 요소 (본문에서 건너뛴다) */
function isFootnoteBox(n: HNode): boolean {
  const cls = ` ${n.attrs.class ?? ''} `;
  return cls.includes(' footnotes ') || 'data-footnotes' in n.attrs || (n.tag === 'div' && /^ftn\d+$/.test(n.attrs.id ?? ''));
}

/** HTML → 조각 */
export function htmlToFragment(html: string, opts: HtmlReadOptions = {}): Fragment {
  const frag: Fragment = { quire: 1, blocks: [], closed: false, stories: {}, lists: {} };
  let listSeq = 0;
  let tableSeq = 0;
  let noteSeq = 0;
  const drop = (what: string) => opts.drop?.(what);
  const root = parseHtml(html);
  const noteBoxes = footnoteTargets(root);
  /** 각주 칸 → 각주 ID (참조를 처음 만날 때 정한다) */
  const noteIds = new Map<HNode, string>();

  /** 블록들을 모으는 틀 (본문 또는 셀) */
  const collector = (out: ClipBlock[], inNote = false) => {
    let cur: ClipPara | null = null;
    /** cur가 목록 항목(li)이 연 문단이다: 비어 있는 채로 속에 블록(<p>)이 오면 버린다 (Google Docs는 <li><p>…</p></li>) */
    let soft = false;
    /** 열린 HTML 목록: 종류, 이 목록 묶음의 id */
    const lists: Array<'number' | 'bullet'> = [];
    let listId: Record<string, string> = {};
    const flush = () => {
      if (!cur) return;
      // 앞뒤 공백 정리 (문서 단위의 코드 문단은 그대로)
      const keep = opts.document && cur.p.style === 'code';
      const first = cur.c.find((r) => r.t !== undefined);
      if (first && !keep) first.t = first.t!.replace(/^[  ]+/, '');
      for (let k = cur.c.length - 1; k >= 0 && !keep; k--) {
        const r = cur.c[k]!;
        if (r.t === undefined) break;
        r.t = r.t.replace(/[ ]+$/, '');
        if (r.t) break;
      }
      cur.c = cur.c.filter((r) => r.img || r.t);
      out.push(cur);
      cur = null;
    };
    const start = (p: ParaAttrs, isSoft = false) => {
      if (cur && soft && !(cur as ClipPara).c.length) cur = null;
      else flush();
      cur = { p, c: [], start: true, end: true };
      soft = isSoft;
    };
    const text = (s: string, m: MarkSet, keep = false) => {
      if (!s) return;
      // 블록 사이 공백(줄바꿈)은 문단을 열지 않는다
      if (!cur && !keep && !s.trim()) return;
      if (!cur) start({});
      const c = cur!;
      const lastRun = c.c[c.c.length - 1];
      // 앞 글자가 공백이면 이어진 공백을 줄인다
      const prevSpace = !lastRun ? true : lastRun.t !== undefined && /[ ]$/.test(lastRun.t);
      if (prevSpace && !keep) s = s.replace(/^ +/, '');
      if (!s) return;
      if (lastRun && lastRun.t !== undefined && JSON.stringify(lastRun.m ?? {}) === JSON.stringify(m)) lastRun.t += s;
      else c.c.push({ t: s, ...(hasKeys(m) ? { m } : {}) });
      soft = false;
    };

    const blockAttrs = (n: HNode, base: ParaAttrs): ParaAttrs => {
      const p: ParaAttrs = { ...base };
      const st = styleOf(n);
      const al = (st['text-align'] ?? n.attrs.align ?? '').toLowerCase();
      if (al === 'center' || al === 'right' || al === 'justify') p.align = al;
      if (!opts.document) return p;
      // 우리 내보내기의 기타 스타일 (data-style)
      const ds = n.attrs['data-style'];
      if (ds && /^[\w-]+$/.test(ds) && !p.style) p.style = ds;
      // 들여쓰기·간격·줄 간격 (pt·px만: Word·Google Docs·우리 내보내기)
      const left = cssPt(st['margin-left']);
      const right = cssPt(st['margin-right']);
      const first = cssPt(st['text-indent'], true);
      if (left || right || first) p.indent = { ...(left ? { left } : {}), ...(right ? { right } : {}), ...(first ? { first } : {}) };
      const before = cssPt(st['margin-top']);
      const after = cssPt(st['margin-bottom']);
      if (before || after) p.space = { ...(before ? { before } : {}), ...(after ? { after } : {}) };
      const lh = (st['line-height'] ?? '').trim();
      if (/^[\d.]+$/.test(lh) && Number(lh) > 0 && Number(lh) !== 1) p.line = { rule: 'multiple', value: Number(lh) };
      else if (/^[\d.]+%$/.test(lh) && Number(lh.slice(0, -1)) > 0 && Number(lh.slice(0, -1)) !== 100) p.line = { rule: 'multiple', value: Number(lh.slice(0, -1)) / 100 };
      else {
        const v = cssPt(lh);
        if (v) p.line = { rule: 'exact', value: v };
      }
      return p;
    };

    const walk = (n: HNode | string, m: MarkSet, pre: boolean, base: ParaAttrs): void => {
      if (typeof n === 'string') {
        if (pre) {
          const lines = n.split(/\r?\n/);
          lines.forEach((line, k) => {
            if (k > 0) start(base);
            text(line.replace(/\t/g, '    '), m, !!opts.document);
          });
        } else text(n.replace(/[ \t\r\n\f]+/g, ' '), m);
        return;
      }
      const t = n.tag;
      if (SKIP.has(t) || t.startsWith('o:') && t !== 'o:p' || t.startsWith('v:') || t.startsWith('w:') || t.startsWith('m:')) return;
      const st = styleOf(n);
      if (/mso-list\s*:\s*ignore/i.test(n.attrs.style ?? '')) return; // Word의 가짜 번호
      if (st.display === 'none') return;
      if (DROPPED[t]) {
        drop(DROPPED[t]);
        return;
      }
      if (isFootnoteBox(n)) return; // 각주 내용은 참조에서 읽는다
      if (t === 'a' && n.attrs.href?.startsWith('#')) {
        const box = noteBoxes.get(n.attrs.href.slice(1));
        if (box && !inNote) {
          // 각주 참조 (12 §6.1)
          let id = noteIds.get(box);
          if (!id) {
            id = `n${++noteSeq}`;
            noteIds.set(box, id);
            const blocks: ClipBlock[] = [];
            const col = collector(blocks, true);
            for (const c of box.children) col.walk(c, {}, false, {});
            col.flush();
            const paras = blocks.filter((b): b is ClipPara => !isTable(b));
            frag.stories[`note|${id}`] = paras.length ? paras : [{ p: {}, c: [], start: true }];
          }
          if (!cur) start(base);
          cur!.c.push({ img: { id, kind: 'note' } });
          soft = false;
          return;
        }
        if (inNote) return; // 각주 안의 되돌아가기 고리 (↩, [1])
      }
      if (t === 'br') {
        start(base);
        return;
      }
      if (t === 'img') {
        const src = n.attrs.src ?? '';
        if (!cur) start(base);
        const w = Number(n.attrs.width) || undefined;
        const h = Number(n.attrs.height) || undefined;
        const img: ObjAttrs = { id: '', kind: 'image', asset: '', ...(n.attrs.alt ? { alt: n.attrs.alt } : {}) };
        if (w) img.w = Math.round(w * 750);
        if (h) img.h = Math.round(h * 750);
        if (src.startsWith('data:image/')) cur!.c.push({ img, src });
        else {
          drop('이미지 (외부 주소)');
          if (n.attrs.alt) text(n.attrs.alt, m);
        }
        return;
      }
      if (t === 'table') {
        flush();
        out.push(tableOf(n));
        return;
      }
      if (t === 'ul' || t === 'ol') {
        flush();
        if (!lists.length) listId = {};
        lists.push(t === 'ul' ? 'bullet' : 'number');
        for (const c of n.children) walk(c, m, pre, base);
        lists.pop();
        flush();
        return;
      }
      if (t === 'li') {
        const kind = lists[lists.length - 1] ?? 'bullet';
        const id = (listId[kind] ??= `h${++listSeq}`);
        frag.lists[id] ??= defaultListDef(id, kind);
        start(blockAttrs(n, { ...base, list: { id, level: Math.max(0, lists.length - 1) } }), true);
        for (const c of n.children) walk(c, marksOf(n, m, opts.document), pre, cur ? (cur as ClipPara).p : base);
        flush();
        return;
      }
      const heading = /^h([1-6])$/.exec(t);
      if (heading || t === 'p' || t === 'div' || t === 'blockquote' || t === 'pre' || t === 'section' || t === 'article' || t === 'header' || t === 'footer' || t === 'dd' || t === 'dt') {
        let p: ParaAttrs = { ...base };
        if (heading) p.style = `h${opts.document ? Number(heading[1]) : Math.min(3, Number(heading[1]))}`;
        if (t === 'blockquote') p.style = 'quote';
        if (t === 'pre' && opts.document) p.style = 'code';
        // Word 목록 문단: style="mso-list:l0 level1 lfo1"
        const ml = /mso-list\s*:\s*l(\d+)\s+level(\d+)/i.exec(n.attrs.style ?? '');
        if (ml) {
          const marker = findIgnored(n);
          const kind: 'number' | 'bullet' = /^[\s(]*([0-9]+|[a-z]{1,3}|[ivxlc]+|[가-힣])[.)]/i.test(marker) ? 'number' : 'bullet';
          const id = `w${ml[1]}${kind[0]}`;
          frag.lists[id] ??= defaultListDef(id, kind);
          p.list = { id, level: Math.max(0, Number(ml[2]) - 1) };
        }
        p = blockAttrs(n, p);
        if (t === 'div' && n.children.some((c) => typeof c !== 'string' && isBlockTag(c.tag))) {
          // 블록을 감싼 div: 문단을 만들지 않고 속을 본다
          flush();
          for (const c of n.children) walk(c, marksOf(n, m, opts.document), pre, base);
          flush();
          return;
        }
        if (t === 'blockquote' && n.children.some((c) => typeof c !== 'string' && isBlockTag(c.tag))) {
          flush();
          for (const c of n.children) walk(c, marksOf(n, m, opts.document), pre, p);
          flush();
          return;
        }
        start(p);
        for (const c of n.children) walk(c, marksOf(n, m, opts.document), pre || t === 'pre', p);
        flush();
        return;
      }
      for (const c of n.children) walk(c, marksOf(n, m, opts.document), pre, base);
    };

    return { walk, flush };
  };

  /** <table> → 표 블록 (rowspan·colspan) */
  function tableOf(n: HNode): ClipTable {
    const tk = tableSeq++;
    const rows: HNode[] = [];
    const collect = (x: HNode) => {
      for (const c of x.children) {
        if (typeof c === 'string') continue;
        if (c.tag === 'tr') rows.push(c);
        else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') collect(c);
      }
    };
    collect(n);
    const taken = new Set<string>();
    let ncols = 0;
    const out: ClipTable['table']['rows'] = [];
    rows.forEach((tr, y) => {
      const r: ClipTable['table']['rows'][0] = { cells: [] };
      let x = 0;
      for (const td of tr.children) {
        if (typeof td === 'string' || (td.tag !== 'td' && td.tag !== 'th')) continue;
        while (taken.has(`${y},${x}`)) x++;
        const h = Math.max(1, Number(td.attrs.rowspan) || 1);
        const w = Math.max(1, Number(td.attrs.colspan) || 1);
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) taken.add(`${yy},${xx}`);
        const name = `h${tk}.${y}.${x}`;
        const blocks: ClipBlock[] = [];
        const col = collector(blocks);
        for (const c of td.children) col.walk(c, td.tag === 'th' ? { bold: true } : {}, false, {});
        col.flush();
        const paras = blocks.filter((b): b is ClipPara => !isTable(b));
        frag.stories[name] = paras.length ? paras : [{ p: {}, c: [], start: true }];
        const cell: ClipTable['table']['rows'][0]['cells'][0] = { story: name };
        if (h > 1 || w > 1) cell.span = [h, w];
        const fill = cssColor(styleOf(td)['background-color'] ?? td.attrs.bgcolor);
        if (fill && fill !== '#ffffff') cell.fill = fill;
        if (opts.document) {
          const va = (styleOf(td)['vertical-align'] ?? td.attrs.valign ?? '').toLowerCase();
          if (va === 'middle' || va === 'bottom') cell.valign = va;
        }
        r.cells.push(cell);
        x += w;
        ncols = Math.max(ncols, x);
      }
      if (opts.document) {
        const rh = cssPt(styleOf(tr)['height']);
        if (rh) r.h = rh;
      }
      out.push(r);
    });
    ncols = Math.max(1, ncols);
    let cols = Array.from({ length: ncols }, () => Math.floor(BODY_WIDTH / ncols));
    if (opts.document) {
      // 열 너비: <col style="width:…pt"> 또는 width="…"(px)
      const widths: number[] = [];
      const visit = (x: HNode) => {
        for (const c of x.children) {
          if (typeof c === 'string') continue;
          if (c.tag === 'col') {
            const w = cssPt(styleOf(c)['width']) ?? (Number(c.attrs.width) ? Math.round(Number(c.attrs.width) * 750) : undefined);
            for (let k = 0; k < Math.max(1, Number(c.attrs.span) || 1); k++) widths.push(w ?? 0);
          } else if (c.tag === 'colgroup') visit(c);
        }
      };
      visit(n);
      if (widths.length === ncols && widths.every((w) => w > 0)) cols = widths;
    }
    return { table: { cols, rows: out } };
  }

  // Word·Google Docs가 넣는 조각 표시 사이만 (<!--StartFragment-->는 주석이라 이미 빠짐)
  const col = collector(frag.blocks);
  col.walk(root, {}, false, {});
  col.flush();
  // 빈 문단 하나뿐이면 조각이 아니다
  if (frag.blocks.length === 0) frag.blocks.push({ p: {}, c: [], start: true });
  return frag;
}

function isBlockTag(t: string): boolean {
  return /^(p|div|h[1-6]|ul|ol|li|table|blockquote|pre|section|article|header|footer)$/.test(t);
}

/** Word 목록 문단의 가짜 번호 글자 (mso-list:Ignore) */
function findIgnored(n: HNode): string {
  for (const c of n.children) {
    if (typeof c === 'string') continue;
    if (/mso-list\s*:\s*ignore/i.test(c.attrs.style ?? '')) return textOf(c);
    const t = findIgnored(c);
    if (t) return t;
  }
  return '';
}

function textOf(n: HNode | string): string {
  return typeof n === 'string' ? n : n.children.map(textOf).join('');
}

// ── 붙여넣기 ─────────────────────────────────────────

export interface PasteTarget {
  document: Document;
  /** 붙일 스토리 (본문 또는 셀) */
  doc: Doc;
  /** 셀 안이면 표는 문단으로 펼친다 */
  inCell: boolean;
  /** 새 개체 ID */
  newId: () => string;
}

/** 조각을 doc의 offset에 붙인다 (선택은 먼저 지운 상태). 실행 취소 연산과 붙인 뒤 캐럿 */
export function pasteFragment(t: PasteTarget, offset: number, frag: Fragment): { ops: Op[]; caret: number } {
  const { doc } = t;
  const ops: Op[] = [];
  // 목록 id: 붙일 문서에 같은 종류로 있으면 그대로 (같은 문서·같은 협업 문서: 번호가 이어진다), 없으면 정의를 복사해 새 목록
  const listMap = new Map<string, string>();
  const mapList = (li: ParaAttrs['list']): ParaAttrs['list'] => {
    if (!li) return li;
    let id = listMap.get(li.id);
    if (!id) {
      const def = frag.lists[li.id];
      const have = doc.listDef(li.id);
      if (have && (!def || have.kind === def.kind)) id = li.id;
      else {
        const [nid, created] = doc.createList(def?.kind ?? 'bullet');
        ops.push(...created);
        if (def) ops.push(...doc.setList(nid, { ...structuredClone(def), id: nid }));
        id = nid;
      }
      listMap.set(li.id, id);
    }
    return { id, level: li.level };
  };

  // 셀 안: 표는 셀 문단들로 펼친다
  let blocks: ClipBlock[] = frag.blocks;
  if (t.inCell) {
    blocks = blocks.flatMap((b) => (isTable(b) ? b.table.rows.flatMap((r) => r.cells.flatMap((c) => frag.stories[c.story] ?? [])) : [b]));
    if (!blocks.length) return { ops, caret: offset };
  }
  let closed = frag.closed;
  if (isTable(blocks[blocks.length - 1]!)) closed = true; // 표 문단 뒤 글은 다음 문단에

  const ps0 = doc.paragraphs();
  let pi0 = doc.paragraphIndexAt(offset);
  let at = offset;
  const atStart = offset === ps0[pi0]!.start;
  /** 붙인 자리 뒤에 그 문단의 글이 없다 */
  const atEnd = offset === ps0[pi0]!.end;
  // 첫 블록이 표인데 문단 가운데면 먼저 나눈다
  if (isTable(blocks[0]!) && !atStart) {
    ops.push({ type: 'insert', ids: doc.insertText(at, '\n') });
    at++;
    pi0++;
  }

  const insertRuns = (d: Doc, pos: number, runs: ClipRun[]): { ops: Op[]; pos: number } => {
    const o: Op[] = [];
    for (const r of runs) {
      if (r.img?.kind === 'note') {
        // 각주 참조: 본문에만. 새 id로 넣고 각주 내용을 새 각주 스토리에 복사한다
        if (t.inCell || d !== t.document.body) continue;
        const id = t.newId();
        o.push(...d.insertObject(pos, { ...r.img, id }, r.m ?? {}));
        const sid = noteStoryId(id);
        o.push(...Document.tag(sid, fillStory(t, t.document.story(sid), frag.stories[`note|${r.img.id}`] ?? [], mapList)));
        pos++;
      } else if (r.img) {
        if (!r.img.asset && r.img.kind !== 'field') continue; // 원본을 못 가져온 이미지
        o.push(...d.insertObject(pos, { ...r.img, id: t.newId() }, r.m ?? {}));
        pos++;
      } else if (r.t) {
        o.push({ type: 'insert', ids: d.insertText(pos, r.t, r.m ?? {}) });
        pos += Array.from(r.t).length;
      }
    }
    return { ops: o, pos };
  };

  const setAttrs = (d: Doc, i: number, p: ParaAttrs, mapIds: boolean): Op[] => {
    const o: Op[] = [];
    const want: ParaAttrs = { ...p };
    if (want.list) want.list = mapIds ? mapList(want.list) : want.list;
    const cur = d.paraAttrs(i);
    for (const k of new Set([...Object.keys(cur), ...Object.keys(want)]) as Set<ParaKey>)
      if (JSON.stringify(cur[k]) !== JSON.stringify(want[k])) o.push(...d.setParaAttr(i, k, want[k]));
    return o;
  };

  const tables: Array<{ b: number; block: ClipTable }> = [];
  blocks.forEach((b, k) => {
    if (k > 0) {
      ops.push({ type: 'insert', ids: doc.insertText(at, '\n') });
      at++;
    }
    if (isTable(b)) {
      tables.push({ b: k, block: b });
      return; // 표 원소는 문단을 다 만든 뒤 넣는다 (아래)
    }
    const r = insertRuns(doc, at, b.c);
    ops.push(...r.ops);
    at = r.pos;
  });
  if (closed) {
    ops.push({ type: 'insert', ids: doc.insertText(at, '\n') });
    at++;
  }

  // 문단 속성 (규칙은 위 머리말)
  // 온전한 문단이 붙은 자리를 다 차지하면 (앞·뒤에 붙인 자리의 글이 없으면) 그 문단 속성을 가져온다
  const nb = blocks.length;
  blocks.forEach((b, k) => {
    if (isTable(b)) return;
    const pi = pi0 + k;
    const last = k === nb - 1;
    const ownEnd = !last || closed || (b.end === true && atEnd);
    const ownStart = k > 0 || (b.start === true && (atStart || isTable(blocks[0]!)));
    if (ownStart && ownEnd) ops.push(...setAttrs(doc, pi, b.p, true));
  });

  // 표: 빈 문단 자리에 표 원소, 레코드와 셀 내용
  for (const { b, block } of tables) {
    const pi = pi0 + b;
    const pos = doc.paragraphs()[pi]!.start;
    const id = buildTable(t, block, frag, ops, mapList);
    ops.push(...doc.insertObject(pos, { id, kind: 'table', table: id }));
    ops.push(...setAttrs(doc, pi, {}, false));
    if (pos < at) at++;
  }
  return { ops, caret: at };
}

/** 표 블록 → 새 표 레코드 + 셀 내용 (셀 연산은 스토리로 감싸 ops에) */
function buildTable(t: PasteTarget, block: ClipTable, frag: Fragment, ops: Op[], mapList: (li: ParaAttrs['list']) => ParaAttrs['list']): string {
  const d = t.document;
  const nrows = block.table.rows.length;
  const ncols = block.table.cols.length;
  const id = d.createTable(Math.max(1, nrows), Math.max(1, ncols));
  const rec = d.table(id)!;
  const rows = [...rec.rows];
  const cols = [...rec.cols];
  block.table.cols.forEach((w, x) => ops.push(...d.setColWidth(id, cols[x]!, (w * 96) / 72 / 1000 > 0 ? w : 100000)));
  const taken = new Set<string>();
  block.table.rows.forEach((r, y) => {
    if (r.h) ops.push(...d.setRowAttrs(id, rows[y]!, { minHeight: r.h }));
    let x = 0;
    for (const c of r.cells) {
      while (taken.has(`${y},${x}`)) x++;
      if (x >= ncols) break;
      const [h, w] = c.span ?? [1, 1];
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) taken.add(`${yy},${xx}`);
      if (h > 1 || w > 1) ops.push(...d.mergeCells(id, rows[y]!, cols[x]!, rows.slice(y + 1, y + h), cols.slice(x + 1, x + w)));
      if (c.fill) ops.push(...d.setCellAttrs(id, rows[y]!, cols[x]!, { fill: c.fill }));
      const sid = cellStoryId(id, rows[y]!, cols[x]!);
      ops.push(...Document.tag(sid, fillStory(t, d.story(sid), frag.stories[c.story] ?? [], mapList)));
      x += w;
    }
  });
  return id;
}

/** 빈 스토리(셀·각주)에 문단들을 쓴다 (각주 참조·원본 없는 이미지는 빼고, 떠 있는 개체는 인라인으로). 연산은 감싸지 않은 채 */
function fillStory(t: PasteTarget, story: Doc, paras: ClipPara[], mapList: (li: ParaAttrs['list']) => ParaAttrs['list']): Op[] {
  const o: Op[] = [];
  let pos = 0;
  paras.forEach((p, k) => {
    if (k > 0) {
      o.push({ type: 'insert', ids: story.insertText(pos, '\n') });
      pos++;
    }
    for (const r2 of p.c) {
      if (r2.img) {
        if (r2.img.kind === 'note' || (!r2.img.asset && r2.img.kind !== 'field')) continue;
        o.push(...story.insertObject(pos, { ...r2.img, id: t.newId(), float: undefined }, r2.m ?? {}));
        pos++;
      } else if (r2.t) {
        o.push({ type: 'insert', ids: story.insertText(pos, r2.t, r2.m ?? {}) });
        pos += Array.from(r2.t).length;
      }
    }
  });
  paras.forEach((p, k) => {
    const want: ParaAttrs = { ...p.p, ...(p.p.list ? { list: mapList(p.p.list) } : {}) };
    for (const key of Object.keys(want) as ParaKey[]) if (want[key] !== undefined) o.push(...story.setParaAttr(k, key, want[key]));
  });
  return o;
}

/** 붙여넣기 조각이 이미지 원본(data: URL)을 가졌는가 */
export function pendingImages(frag: Fragment): ClipRun[] {
  const out: ClipRun[] = [];
  const scan = (ps: ClipBlock[]) => {
    for (const b of ps) if (!isTable(b)) for (const r of b.c) if (r.img && r.src) out.push(r);
  };
  scan(frag.blocks);
  for (const ps of Object.values(frag.stories)) scan(ps);
  return out;
}

export type { MarkKey };
