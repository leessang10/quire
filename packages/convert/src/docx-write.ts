/**
 * DOCX 내보내기 (15 §6.3): 정본 → WordprocessingML. document.xml(본문·표·구역 sectPr), styles.xml, numbering.xml,
 * footnotes.xml, header·footer, comments.xml(+commentsExtended: 답글·해결), media, settings, core. 제안(삽입·삭제)은 w:ins·w:del.
 * 단위: 길이 1/1000pt → twip(× 1/50), EMU(× 12.7), 글자 크기 반 pt.
 */
import { DEFAULT_STYLES, LAST_SECTION, fullSection, noteStoryId, type CommentThread, type ListDef, type MarkSet, type ObjAttrs, type ParaAttrs, type SectionProps, type Style } from '@quiredoc/model';
import { writeZip, type QuireDoc, type QuireParagraph, type QuireTable } from '@quiredoc/sync';
import { EXTRA_STYLES, mimeOf, tableGrid, withSafeLinks, type AssetReader } from './common';
import { XML_HEAD, escXml, x } from './xml';

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14 w15"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const twip = (v: number) => Math.round(v / 50);
export const emu = (v: number) => Math.round(v * 12.7);
const isTable = (b: QuireParagraph | QuireTable): b is QuireTable => 'table' in b;
const cps = (s: string) => Array.from(s);

/** 우리 스타일 이름 → Word 스타일 ID·이름 */
export const STYLE_IDS: Record<string, [string, string]> = {
  body: ['Normal', 'Normal'],
  h1: ['Heading1', 'heading 1'],
  h2: ['Heading2', 'heading 2'],
  h3: ['Heading3', 'heading 3'],
  h4: ['Heading4', 'heading 4'],
  h5: ['Heading5', 'heading 5'],
  h6: ['Heading6', 'heading 6'],
  quote: ['Quote', 'Quote'],
  code: ['Code', 'Code'],
  listParagraph: ['ListParagraph', 'List Paragraph'],
};
const styleId = (name: string) => STYLE_IDS[name]?.[0] ?? `Q${name.replace(/[^A-Za-z0-9]/g, '') || 'Style'}`;

/** 번호 형식: 우리 → Word */
export const NUM_FMT: Record<string, string> = {
  bullet: 'bullet', decimal: 'decimal', hangul: 'ganada', hangulJamo: 'chosung', circled: 'decimalEnclosedCircle',
  lowerAlpha: 'lowerLetter', upperAlpha: 'upperLetter', lowerRoman: 'lowerRoman', upperRoman: 'upperRoman',
};

export function rPr(m: MarkSet | undefined, extra = ''): string {
  if (!m) return extra ? x('w:rPr', null, extra) : '';
  const parts: string[] = [extra];
  if (m.font) parts.push(x('w:rFonts', { 'w:ascii': m.font, 'w:hAnsi': m.font, 'w:eastAsia': m.font, 'w:cs': m.font }));
  if (m.bold) parts.push('<w:b/><w:bCs/>');
  if (m.italic) parts.push('<w:i/><w:iCs/>');
  if (m.strike) parts.push('<w:strike/>');
  if (m.color) parts.push(x('w:color', { 'w:val': m.color.replace('#', '').toUpperCase() }));
  if (m.size) parts.push(x('w:sz', { 'w:val': Math.round(m.size / 500) }), x('w:szCs', { 'w:val': Math.round(m.size / 500) }));
  if (m.underline) parts.push('<w:u w:val="single"/>');
  if (m.highlight) parts.push(x('w:shd', { 'w:val': 'clear', 'w:color': 'auto', 'w:fill': m.highlight.replace('#', '').toUpperCase() }));
  if (m.script) parts.push(x('w:vertAlign', { 'w:val': m.script === 'sup' ? 'superscript' : 'subscript' }));
  const body = parts.join('');
  return body ? `<w:rPr>${body}</w:rPr>` : '';
}

/** 문단 속성 (스키마 순서) */
export function pPr(p: ParaAttrs, opts: { numId?: number; sectPr?: string; style?: boolean } = {}): string {
  const parts: string[] = [];
  if (p.style && p.style !== 'body' && opts.style !== false) parts.push(x('w:pStyle', { 'w:val': styleId(p.style) }));
  if (p.keepWithNext !== undefined) parts.push(p.keepWithNext ? '<w:keepNext/>' : '<w:keepNext w:val="0"/>');
  if (p.keepTogether !== undefined) parts.push(p.keepTogether ? '<w:keepLines/>' : '<w:keepLines w:val="0"/>');
  if (p.pageBreakBefore !== undefined) parts.push(p.pageBreakBefore ? '<w:pageBreakBefore/>' : '<w:pageBreakBefore w:val="0"/>');
  if (p.list && opts.numId) parts.push(x('w:numPr', null, x('w:ilvl', { 'w:val': p.list.level }), x('w:numId', { 'w:val': opts.numId })));
  if (p.space || p.line) {
    const a: Record<string, string | number | undefined> = {};
    if (p.space?.before !== undefined) a['w:before'] = twip(p.space.before);
    if (p.space?.after !== undefined) a['w:after'] = twip(p.space.after);
    if (p.line) {
      a['w:line'] = p.line.rule === 'multiple' ? Math.round(240 * p.line.value) : twip(p.line.value);
      a['w:lineRule'] = p.line.rule === 'multiple' ? 'auto' : p.line.rule === 'exact' ? 'exact' : 'atLeast';
    }
    parts.push(x('w:spacing', a));
  }
  if (p.indent) {
    const a: Record<string, number | undefined> = {};
    if (p.indent.left !== undefined) a['w:left'] = twip(p.indent.left);
    if (p.indent.right !== undefined) a['w:right'] = twip(p.indent.right);
    if (p.indent.first !== undefined) {
      if (p.indent.first >= 0) a['w:firstLine'] = twip(p.indent.first);
      else a['w:hanging'] = twip(-p.indent.first);
    }
    parts.push(x('w:ind', a));
  }
  if (p.align && p.align !== 'left') parts.push(x('w:jc', { 'w:val': p.align === 'justify' ? 'both' : p.align }));
  if (opts.sectPr) parts.push(opts.sectPr);
  const body = parts.join('');
  return body ? `<w:pPr>${body}</w:pPr>` : '';
}

/** 패키지 부분 하나의 관계 */
class Part {
  readonly rels: string[] = [];
  constructor(readonly path: string) {}
  rel(type: string, target: string, external = false): string {
    const id = `rId${this.rels.length + 1}`;
    this.rels.push(x('Relationship', { Id: id, Type: `${REL}/${type}`, Target: target, TargetMode: external ? 'External' : undefined }));
    return id;
  }
  relsXml(): string {
    return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.rels.join('')}</Relationships>`;
  }
}

interface StoryAnn {
  from: number;
  to: number;
  kind: 'comment' | 'insert' | 'delete';
  /** comment: Word 댓글 번호들 (스레드의 메시지마다) */
  ids?: number[];
  author?: string;
  date?: string;
}

const isoDate = (t: number | undefined) => new Date(typeof t === 'number' && t > 0 ? t : 0).toISOString().replace(/\.\d+Z$/, 'Z');

export interface DocxExportOptions {
  asset?: AssetReader;
  title?: string;
}

/** 정본 → DOCX 바이트 */
export async function exportDocx(q: QuireDoc, opts: DocxExportOptions = {}): Promise<Uint8Array> {
  // 위험한 링크(javascript: 등)는 내보내지 않는다 (16 §6)
  q = withSafeLinks(q);
  const lists = (q.settings.lists ?? {}) as Record<string, ListDef>;
  const story = (name: string) => (Array.isArray(q.stories[name]) ? (q.stories[name] as Array<QuireParagraph | QuireTable>) : []);
  const files: Array<{ name: string; data: Uint8Array; deflate?: boolean }> = [];
  const enc = new TextEncoder();
  const addFile = (name: string, text: string) => files.push({ name, data: enc.encode(text), deflate: true });

  // ── 목록: 목록 정의마다 abstractNum + num ──
  const numIds = new Map<string, number>();
  const usedLists = Object.keys(lists).sort();
  usedLists.forEach((id, k) => numIds.set(id, k + 1));

  // ── 매체 ──
  const media = new Map<string, string>(); // 자산 → media/파일
  const mediaFiles: Array<{ name: string; data: Uint8Array }> = [];
  const mediaOf = async (asset: string): Promise<string | null> => {
    const known = media.get(asset);
    if (known) return known;
    const a = opts.asset ? await opts.asset(asset).catch(() => null) : null;
    if (!a) return null;
    const type = a.type || mimeOf(a.bytes);
    const ext = type === 'image/jpeg' ? 'jpeg' : type === 'image/gif' ? 'gif' : type === 'image/webp' ? 'webp' : 'png';
    const name = `media/image${media.size + 1}.${ext}`;
    media.set(asset, name);
    mediaFiles.push({ name: `word/${name}`, data: a.bytes });
    return name;
  };
  let docPr = 0;

  // ── 주석: 스토리마다 범위 ──
  const threads = new Map<string, CommentThread>();
  for (const t of (q.threads ?? []) as CommentThread[]) if (t && typeof t.id === 'string' && !t.deleted) threads.set(t.id, t);
  const anns = new Map<string, StoryAnn[]>();
  const comments: Array<{ id: number; author: string; date: string; text: string; parent: number | null; done: boolean }> = [];
  for (const raw of (q.annotations ?? []) as Array<Record<string, unknown>>) {
    const start = raw.start as { story?: string; offset?: number } | undefined;
    const end = raw.end as { offset?: number } | undefined;
    if (!start || typeof start.offset !== 'number' || typeof end?.offset !== 'number') continue;
    const storyName = start.story ?? 'body';
    const data = (raw.data ?? {}) as Record<string, unknown>;
    const list = anns.get(storyName) ?? [];
    if (raw.type === 'comment') {
      const t = threads.get(String(data.thread ?? ''));
      const msgs = t?.messages.filter((m) => !m.deleted) ?? [];
      if (!t || !msgs.length) continue;
      const ids: number[] = [];
      let root: number | null = null;
      for (const m of msgs) {
        const id = comments.length;
        comments.push({ id, author: m.author?.name ?? '', date: isoDate(m.time), text: m.text, parent: root, done: t.resolved });
        root ??= id;
        ids.push(id);
      }
      list.push({ from: start.offset, to: end.offset, kind: 'comment', ids });
    } else if (raw.type === 'suggestion' && (data.kind === 'insert' || data.kind === 'delete')) {
      const author = (data.author as { name?: string } | undefined)?.name ?? '';
      list.push({ from: start.offset, to: end.offset, kind: data.kind, author, date: isoDate(data.time as number) });
    } else continue;
    anns.set(storyName, list);
  }
  let revId = 1;

  // ── 스토리 쓰기 ──
  /** 문단 하나 (offset: 스토리 안 시작) */
  const paragraph = async (b: QuireParagraph, part: Part, sa: StoryAnn[], offset: number, sectPr?: string): Promise<string> => {
    const p = b.p as ParaAttrs;
    const items: Array<{ xml: string; link?: string; wrap?: StoryAnn }> = [];
    const marksAt = (at: number) => {
      // 이 위치에서 시작·끝나는 댓글 범위
      for (const a of sa) if (a.kind === 'comment' && a.from === at) for (const id of a.ids!) items.push({ xml: x('w:commentRangeStart', { 'w:id': id }) });
      for (const a of sa)
        if (a.kind === 'comment' && a.to === at)
          for (const id of a.ids!) items.push({ xml: x('w:commentRangeEnd', { 'w:id': id }) + `<w:r>${rPr(undefined, '<w:rStyle w:val="CommentReference"/>')}${x('w:commentReference', { 'w:id': id })}</w:r>` });
    };
    const wrapAt = (a: number, b2: number) => sa.find((s) => s.kind !== 'comment' && s.from <= a && b2 <= s.to);
    let at = offset;
    if (p.columnBreakBefore) items.push({ xml: '<w:r><w:br w:type="column"/></w:r>' });
    for (const r of b.c ?? []) {
      const m = r.m;
      if (r.img) {
        marksAt(at);
        const o = r.img as ObjAttrs;
        const wrap = wrapAt(at, at + 1);
        items.push({ xml: await objectRun(o, m, part), link: o.kind === 'image' ? m?.link : undefined, wrap });
        at++;
        continue;
      }
      const chars = cps(r.t ?? '');
      // 경계(주석 시작·끝)에서 나눈다
      const cuts = new Set<number>([0, chars.length]);
      for (const s of sa) for (const v of [s.from, s.to]) if (v > at && v < at + chars.length) cuts.add(v - at);
      const sorted = [...cuts].sort((u, v) => u - v);
      for (let k = 0; k + 1 < sorted.length; k++) {
        const s0 = sorted[k]!;
        const s1 = sorted[k + 1]!;
        marksAt(at + s0);
        const text = chars.slice(s0, s1).join('');
        const wrap = wrapAt(at + s0, at + s1);
        const tag = wrap?.kind === 'delete' ? 'w:delText' : 'w:t';
        // 탭은 w:tab
        const t = text
          .split('\t')
          .map((part) => (part ? `<${tag}${/^\s|\s$/.test(part) ? ' xml:space="preserve"' : ''}>${escXml(part)}</${tag}>` : ''))
          .join('<w:tab/>');
        items.push({ xml: `<w:r>${rPr(m, m?.link ? '<w:rStyle w:val="Hyperlink"/>' : '')}${t}</w:r>`, link: m?.link, wrap });
      }
      at += chars.length;
    }
    marksAt(at);
    // 묶기: 같은 제안(ins/del)이 이어진 항목, 같은 링크가 이어진 항목
    let out = '';
    let i = 0;
    while (i < items.length) {
      const link = items[i]!.link;
      let j = i;
      let inner = '';
      while (j < items.length && items[j]!.link === link) {
        const wrap = items[j]!.wrap;
        let k = j;
        let seg = '';
        while (k < items.length && items[k]!.link === link && items[k]!.wrap === wrap) seg += items[k++]!.xml;
        if (wrap) {
          const tag = wrap.kind === 'insert' ? 'w:ins' : 'w:del';
          seg = x(tag, { 'w:id': revId++, 'w:author': wrap.author ?? '', 'w:date': wrap.date }, seg);
        }
        inner += seg;
        j = k;
      }
      out += link ? x('w:hyperlink', { 'r:id': part.rel('hyperlink', link, true), 'w:history': 1 }, inner) : inner;
      i = j;
    }
    return `<w:p>${pPr(p, { numId: p.list ? numIds.get(p.list.id) : undefined, sectPr })}${out}</w:p>`;
  };

  const objectRun = async (o: ObjAttrs, m: MarkSet | undefined, part: Part): Promise<string> => {
    if (o.kind === 'note' && o.id) {
      const n = noteNum(o.id);
      return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>${x('w:footnoteReference', { 'w:id': n })}</w:r>`;
    }
    if (o.kind === 'field') {
      const instr = o.field === 'pages' ? 'NUMPAGES' : o.field === 'sectionPages' ? 'SECTIONPAGES' : o.field === 'date' ? 'DATE \\@ "yyyy. M. d."' : 'PAGE';
      return x('w:fldSimple', { 'w:instr': ` ${instr} ` }, `<w:r>${rPr(m)}<w:t>${o.field === 'date' ? '' : '1'}</w:t></w:r>`);
    }
    if (o.kind !== 'image') return '';
    const file = o.asset ? await mediaOf(o.asset) : null;
    if (!file) return o.alt ? `<w:r><w:t xml:space="preserve">${escXml(o.alt)}</w:t></w:r>` : '';
    const rid = part.rel('image', file);
    const cx = emu(o.w ?? 72000);
    const cy = emu(o.h ?? 72000);
    const id = ++docPr;
    const graphic =
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
      `<pic:nvPicPr>${x('pic:cNvPr', { id: 0, name: file.slice(6), descr: o.alt })}<pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill>${x('a:blip', { 'r:embed': rid })}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/>${x('a:ext', { cx, cy })}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic>`;
    const docPrXml = x('wp:docPr', { id, name: `그림 ${id}`, descr: o.alt });
    const f = o.float;
    if (!f) {
      return `<w:r><w:drawing>${x('wp:inline', { distT: 0, distB: 0, distL: 0, distR: 0 })
        .replace('/>', '>')}${x('wp:extent', { cx, cy })}${docPrXml}<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>${graphic}</wp:inline></w:drawing></w:r>`;
    }
    const gap = emu(f.gap ?? 9000);
    const posH = typeof f.x === 'number' ? `<wp:posOffset>${emu(f.x)}</wp:posOffset>` : `<wp:align>${f.x}</wp:align>`;
    const wrap =
      f.wrap === 'square'
        ? x('wp:wrapSquare', { wrapText: f.side === 'left' ? 'left' : f.side === 'right' ? 'right' : f.side === 'largest' ? 'largest' : 'bothSides' })
        : f.wrap === 'topBottom'
          ? '<wp:wrapTopAndBottom/>'
          : '<wp:wrapNone/>';
    return (
      `<w:r><w:drawing>` +
      `<wp:anchor distT="${gap}" distB="${gap}" distL="${gap}" distR="${gap}" simplePos="0" relativeHeight="${id}" behindDoc="${f.behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/>${x('wp:positionH', { relativeFrom: f.relX }, posH)}${x('wp:positionV', { relativeFrom: f.relY }, `<wp:posOffset>${emu(f.y)}</wp:posOffset>`)}` +
      `${x('wp:extent', { cx, cy })}<wp:effectExtent l="0" t="0" r="0" b="0"/>${wrap}${docPrXml}<wp:cNvGraphicFramePr/>${graphic}</wp:anchor></w:drawing></w:r>`
    );
  };

  const table = async (b: QuireTable, part: Part): Promise<string> => {
    const t = b.table;
    const grid = tableGrid(t);
    // 칸 → 셀 정보 (주인 칸), 덮인 칸 → 주인
    const cells = new Map<string, { y: number; x: number; h: number; w: number; cell: QuireTable['table']['rows'][0]['cells'][0] }>();
    t.rows.forEach((row) => {
      for (const c of row.cells) {
        for (let y = 0; y < grid.length; y++) {
          const xx = grid[y]!.indexOf(c.story);
          if (xx >= 0) {
            const [h, w] = c.span ?? [1, 1];
            cells.set(c.story, { y, x: xx, h, w, cell: c });
          }
        }
      }
    });
    const owner = (y: number, xx: number) => {
      for (const v of cells.values()) if (y >= v.y && y < v.y + v.h && xx >= v.x && xx < v.x + v.w) return v;
      return null;
    };
    const total = t.cols.reduce((s, w) => s + twip(w), 0);
    let out =
      `<w:tbl><w:tblPr>${x('w:tblW', { 'w:w': total, 'w:type': 'dxa' })}<w:tblBorders>` +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((e) => x(`w:${e}`, { 'w:val': 'single', 'w:sz': 4, 'w:space': 0, 'w:color': '8E8E93' })).join('') +
      `</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${t.cols.map((w) => x('w:gridCol', { 'w:w': twip(w) })).join('')}</w:tblGrid>`;
    for (let y = 0; y < t.rows.length; y++) {
      const row = t.rows[y]!;
      const trPr = [row.h ? x('w:trHeight', { 'w:val': twip(row.h), 'w:hRule': 'atLeast' }) : '', row.header ? '<w:tblHeader/>' : '', row.cantSplit ? '<w:cantSplit/>' : ''].join('');
      out += `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}`;
      for (let xx = 0; xx < t.cols.length; ) {
        const o = owner(y, xx);
        if (!o) {
          out += `<w:tc><w:tcPr>${x('w:tcW', { 'w:w': twip(t.cols[xx]!), 'w:type': 'dxa' })}</w:tcPr><w:p/></w:tc>`;
          xx++;
          continue;
        }
        const width = t.cols.slice(o.x, o.x + o.w).reduce((s, w) => s + twip(w), 0);
        const c = o.cell;
        const tcPr =
          x('w:tcW', { 'w:w': width, 'w:type': 'dxa' }) +
          (o.w > 1 ? x('w:gridSpan', { 'w:val': o.w }) : '') +
          (o.h > 1 ? (o.y === y ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : '') +
          (c.fill ? x('w:shd', { 'w:val': 'clear', 'w:color': 'auto', 'w:fill': c.fill.replace('#', '').toUpperCase() }) : '') +
          (c.valign && c.valign !== 'top' ? x('w:vAlign', { 'w:val': c.valign === 'middle' ? 'center' : 'bottom' }) : '');
        const body = o.y === y ? await blocks(story(c.story), part, c.story) : '';
        out += `<w:tc><w:tcPr>${tcPr}</w:tcPr>${body || '<w:p/>'}</w:tc>`;
        xx += o.w;
      }
      out += '</w:tr>';
    }
    return `${out}</w:tbl>`;
  };

  /** 블록 열. sectFor(i): i번째 블록 문단에 넣을 sectPr */
  const blocks = async (list: Array<QuireParagraph | QuireTable>, part: Part, name: string, sectFor?: (b: QuireParagraph) => string | undefined): Promise<string> => {
    const sa = anns.get(name) ?? [];
    let out = '';
    let offset = 0;
    for (const b of list) {
      if (isTable(b)) {
        out += await table(b, part);
        offset += 2;
        continue;
      }
      out += await paragraph(b, part, sa, offset, sectFor?.(b));
      offset += (b.c ?? []).reduce((s, r) => s + (r.img ? 1 : cps(r.t ?? '').length), 0) + 1;
    }
    return out;
  };

  // ── 각주 번호 (참조 순서) ──
  const noteOrder: string[] = [];
  const noteNum = (id: string) => {
    let k = noteOrder.indexOf(id);
    if (k < 0) k = noteOrder.push(id) - 1;
    return k + 1;
  };

  // ── 구역 ──
  const doc = new Part('word/document.xml');
  const sections = (Array.isArray(q.sections) && q.sections.length ? q.sections : [{ id: LAST_SECTION }]) as Array<Record<string, unknown>>;
  const hfParts: Array<{ path: string; xml: string; part: Part; kind: 'header' | 'footer' }> = [];
  let anyOddEven = false;
  /** 앞 구역들이 쓴 머리말·꼬리말 종류 */
  const hfUsed = new Set<string>();
  const sectPr = async (e: Record<string, unknown>): Promise<string> => {
    const s = fullSection(e as Partial<SectionProps>);
    let refs = '';
    for (const part of ['header', 'footer'] as const) {
      const def = s[part];
      for (const kind of ['default', 'first', 'even'] as const) {
        const sid = def?.[kind];
        const has = !!sid && Array.isArray(q.stories[sid]);
        // Word는 머리말이 없는 구역이 앞 구역의 것을 이어받는다: 앞 구역에 있었으면 빈 머리말로 끊는다
        if (!has && !hfUsed.has(`${part}.${kind}`)) continue;
        hfUsed.add(`${part}.${kind}`);
        const n = hfParts.length + 1;
        const path = `word/${part}${n}.xml`;
        const p = new Part(path);
        const body = (has ? await blocks(story(sid!), p, sid!) : '') || '<w:p/>';
        const root = part === 'header' ? 'w:hdr' : 'w:ftr';
        hfParts.push({ path, xml: `${XML_HEAD}<${root} ${W_NS}>${body}</${root}>`, part: p, kind: part });
        refs += x(`w:${part}Reference`, { 'w:type': kind, 'r:id': doc.rel(part, `${part}${n}.xml`) });
      }
    }
    if (s.oddEven) anyOddEven = true;
    const [top, right, bottom, left] = s.page.margin;
    const landscape = s.page.width > s.page.height;
    const cols = s.columns && s.columns.count > 1 ? x('w:cols', { 'w:num': s.columns.count, 'w:space': twip(s.columns.gap), 'w:sep': s.columns.separator ? 1 : undefined }) : '';
    const pg = s.pageNumber
      ? x('w:pgNumType', { 'w:start': s.pageNumber.start, 'w:fmt': s.pageNumber.format === 'roman' ? 'upperRoman' : s.pageNumber.format === 'hangul' ? 'ganada' : undefined })
      : '';
    return (
      `<w:sectPr>${refs}${x('w:type', { 'w:val': s.start })}` +
      x('w:pgSz', { 'w:w': twip(s.page.width), 'w:h': twip(s.page.height), 'w:orient': landscape ? 'landscape' : undefined }) +
      x('w:pgMar', { 'w:top': twip(top), 'w:right': twip(right), 'w:bottom': twip(bottom), 'w:left': twip(left), 'w:header': twip(s.headerDistance ?? 36000), 'w:footer': twip(s.footerDistance ?? 36000), 'w:gutter': 0 }) +
      `${pg}${cols}${s.titlePage ? '<w:titlePg/>' : ''}</w:sectPr>`
    );
  };
  const sectById = new Map<string, string>();
  for (let k = 0; k < sections.length - 1; k++) {
    const e = sections[k]!;
    if (typeof e.id === 'string') sectById.set(e.id, await sectPr(e));
  }
  const body = await blocks(q.stories.body, doc, 'body', (b) => {
    const id = (b.p as ParaAttrs).section;
    return id ? sectById.get(id) : undefined;
  });
  const finalSect = await sectPr(sections[sections.length - 1]!);
  // 본문이 표로 끝나면 Word처럼 빈 문단을 둔다
  const lastBlock = q.stories.body[q.stories.body.length - 1];
  const tail = lastBlock && isTable(lastBlock) ? '<w:p/>' : '';
  addFile('word/document.xml', `${XML_HEAD}<w:document ${W_NS}><w:body>${body}${tail}${finalSect}</w:body></w:document>`);

  // ── 각주 (참조가 각주·머리말 안에서도 나올 수 있어 본문 뒤에) ──
  const notesPart = new Part('word/footnotes.xml');
  let notesXml =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';
  for (let k = 0; k < noteOrder.length; k++) {
    const sid = noteStoryId(noteOrder[k]!);
    let inner = await blocks(story(sid), notesPart, sid);
    // 첫 문단 앞에 각주 번호 표시
    const ref = '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>';
    inner = inner ? inner.replace(/^<w:p>(<w:pPr>[\s\S]*?<\/w:pPr>)?/, (all, pp: string | undefined) => `<w:p>${pp ?? '<w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'}${ref}`) : `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${ref}</w:p>`;
    notesXml += `<w:footnote w:id="${k + 1}">${inner}</w:footnote>`;
  }
  addFile('word/footnotes.xml', `${XML_HEAD}<w:footnotes ${W_NS}>${notesXml}</w:footnotes>`);
  if (notesPart.rels.length) addFile('word/_rels/footnotes.xml.rels', notesPart.relsXml());

  // ── 댓글 ──
  if (comments.length) {
    const paraId = (id: number) => (0x10000000 + id).toString(16).toUpperCase();
    const cx = comments
      .map((c) => {
        const lines = c.text.split('\n');
        const paras = lines
          .map((line, k) => {
            const ann = k === 0 ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : '';
            const pid = k === lines.length - 1 ? { 'w14:paraId': paraId(c.id), 'w14:textId': '77777777' } : null;
            return `${x('w:p', pid, '<w:pPr><w:pStyle w:val="CommentText"/></w:pPr>', ann, line ? `<w:r><w:t xml:space="preserve">${escXml(line)}</w:t></w:r>` : '')}`;
          })
          .join('');
        return x('w:comment', { 'w:id': c.id, 'w:author': c.author, 'w:date': c.date, 'w:initials': cps(c.author)[0] ?? '' }, paras);
      })
      .join('');
    addFile('word/comments.xml', `${XML_HEAD}<w:comments ${W_NS}>${cx}</w:comments>`);
    const ex = comments.map((c) => x('w15:commentEx', { 'w15:paraId': paraId(c.id), 'w15:paraIdParent': c.parent !== null ? paraId(c.parent) : undefined, 'w15:done': c.done ? 1 : 0 })).join('');
    addFile('word/commentsExtended.xml', `${XML_HEAD}<w15:commentsEx ${W_NS}>${ex}</w15:commentsEx>`);
  }

  // ── 머리말·꼬리말 부분 ──
  for (const h of hfParts) {
    addFile(h.path, h.xml);
    if (h.part.rels.length) addFile(h.path.replace('word/', 'word/_rels/') + '.rels', h.part.relsXml());
  }

  // ── 스타일 ──
  const styleDefs = new Map<string, Style>();
  for (const st of DEFAULT_STYLES) styleDefs.set(st.name, st);
  for (const [name, def] of Object.entries(q.styles ?? {})) {
    if (def === null) continue;
    if (def && typeof def === 'object') styleDefs.set(name, { ...(def as Style), name });
  }
  // 쓰인 덧붙인 스타일
  const usedStyles = new Set<string>();
  for (const v of Object.values(q.stories)) if (Array.isArray(v)) for (const b of v as QuireParagraph[]) if (typeof b.p?.style === 'string') usedStyles.add(b.p.style);
  for (const n of usedStyles) if (!styleDefs.has(n) && EXTRA_STYLES[n]) styleDefs.set(n, EXTRA_STYLES[n]);
  let stylesXml =
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Pretendard" w:hAnsi="Pretendard" w:eastAsia="Pretendard" w:cs="Pretendard"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>';
  for (const st of styleDefs.values()) {
    const [id, nm] = STYLE_IDS[st.name] ?? [styleId(st.name), st.label ?? st.name];
    const isDefault = st.name === 'body';
    const heading = /^h([1-6])$/.exec(st.name);
    const para = { ...(st.para ?? {}) } as ParaAttrs;
    const ppr = pPr(para, { style: false }).replace('</w:pPr>', heading ? `<w:outlineLvl w:val="${Number(heading[1]) - 1}"/></w:pPr>` : '</w:pPr>');
    stylesXml += x(
      'w:style',
      { 'w:type': 'paragraph', 'w:default': isDefault ? 1 : undefined, 'w:styleId': id },
      x('w:name', { 'w:val': nm }),
      !isDefault ? x('w:basedOn', { 'w:val': st.basedOn ? styleId(st.basedOn) : 'Normal' }) : '',
      st.next ? x('w:next', { 'w:val': styleId(st.next) }) : '',
      heading ? '<w:uiPriority w:val="9"/>' : '',
      '<w:qFormat/>',
      heading && ppr === '' ? `<w:pPr><w:outlineLvl w:val="${Number(heading[1]) - 1}"/></w:pPr>` : ppr,
      rPr(st.marks),
    );
  }
  stylesXml +=
    '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1A5FB4"/><w:u w:val="single"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>';
  addFile('word/styles.xml', `${XML_HEAD}<w:styles ${W_NS}>${stylesXml}</w:styles>`);

  // ── 번호 ──
  if (usedLists.length) {
    let abs = '';
    let nums = '';
    usedLists.forEach((id, k) => {
      const def = lists[id]!;
      const lvls = (def.levels ?? [])
        .slice(0, 9)
        .map((l, i) => {
          const fmt = NUM_FMT[l.format] ?? 'decimal';
          return x(
            'w:lvl',
            { 'w:ilvl': i },
            x('w:start', { 'w:val': 1 }),
            x('w:numFmt', { 'w:val': fmt }),
            x('w:lvlText', { 'w:val': l.text }),
            x('w:lvlJc', { 'w:val': 'left' }),
            x('w:pPr', null, x('w:ind', { 'w:left': twip(l.indent), 'w:hanging': twip(l.hanging) })),
          );
        })
        .join('');
      abs += x('w:abstractNum', { 'w:abstractNumId': k }, x('w:multiLevelType', { 'w:val': 'multilevel' }), lvls);
      nums += x('w:num', { 'w:numId': k + 1 }, x('w:abstractNumId', { 'w:val': k }));
    });
    addFile('word/numbering.xml', `${XML_HEAD}<w:numbering ${W_NS}>${abs}${nums}</w:numbering>`);
  }

  // ── 설정, 속성 ──
  addFile(
    'word/settings.xml',
    `${XML_HEAD}<w:settings ${W_NS}><w:defaultTabStop w:val="800"/>${anyOddEven ? '<w:evenAndOddHeaders/>' : ''}<w:characterSpacingControl w:val="doNotCompress"/>` +
      '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
  );
  addFile(
    'docProps/core.xml',
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${opts.title ? `<dc:title>${escXml(opts.title)}</dc:title>` : ''}<dc:creator>Quire</dc:creator></cp:coreProperties>`,
  );

  // ── 관계 ──
  doc.rel('styles', 'styles.xml');
  doc.rel('settings', 'settings.xml');
  doc.rel('footnotes', 'footnotes.xml');
  if (usedLists.length) doc.rel('numbering', 'numbering.xml');
  if (comments.length) {
    doc.rel('comments', 'comments.xml');
    doc.rels.push(x('Relationship', { Id: `rId${doc.rels.length + 1}`, Type: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended', Target: 'commentsExtended.xml' }));
  }
  addFile('word/_rels/document.xml.rels', doc.relsXml());
  addFile(
    '_rels/.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
  );
  const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const over = (part: string, type: string) => x('Override', { PartName: `/${part}`, ContentType: type });
  let types =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="webp" ContentType="image/webp"/>' +
    over('word/document.xml', `${WML}.document.main+xml`) +
    over('word/styles.xml', `${WML}.styles+xml`) +
    over('word/settings.xml', `${WML}.settings+xml`) +
    over('word/footnotes.xml', `${WML}.footnotes+xml`) +
    over('docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml');
  if (usedLists.length) types += over('word/numbering.xml', `${WML}.numbering+xml`);
  if (comments.length) types += over('word/comments.xml', `${WML}.comments+xml`) + over('word/commentsExtended.xml', `${WML}.commentsExtended+xml`);
  for (const h of hfParts) types += over(h.path, `${WML}.${h.kind}+xml`);
  addFile('[Content_Types].xml', `${types}</Types>`);

  const order = ['[Content_Types].xml', '_rels/.rels'];
  files.sort((a, b) => (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99));
  return writeZip([...files, ...mediaFiles.map((m) => ({ ...m, deflate: false }))]);
}

