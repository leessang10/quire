/**
 * 문서 단위 HTML (15 §6.1–6.2). 내보내기는 정본 → HTML 문서 (이미지는 data URL, 각주는 끝의 목록). 가져오기는 클립보드와 같은
 * 읽기 규칙(htmlToFragment, 문서 단위 선택)으로 조각을 만든 뒤 정본으로 옮긴다.
 */
import { htmlToFragment, type Fragment } from '@quire/editor';
import { defaultListDef, isNoteStory, noteStoryId, type ListDef, type MarkSet, type ObjAttrs, type ParaAttrs } from '@quire/model';
import type { QuireDoc, QuireParagraph, QuireRun, QuireTable } from '@quire/sync';
import { Report, finishImport, addAsset, addUsedStyles, emptyQuire, fromDataUrl, toDataUrl, withSafeLinks, type AssetReader, type ImportResult, type ImportedAsset } from './common';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 1/1000pt → CSS pt (소수 셋째 자리) */
const pt = (v: number) => `${Math.round(v) / 1000}pt`;
const isTable = (b: QuireParagraph | QuireTable): b is QuireTable => 'table' in b;

export interface HtmlExportOptions {
  /** 이미지 바이트 (data URL로 넣는다) */
  asset?: AssetReader;
  title?: string;
}

/** 각주 번호 (본문에 나온 순서) */
interface Notes {
  order: string[];
  num(id: string): number;
}

function paraCss(a: ParaAttrs, inList: boolean): string {
  const css: string[] = [];
  if (a.align && a.align !== 'left') css.push(`text-align:${a.align}`);
  if (a.indent && !inList) {
    if (a.indent.left) css.push(`margin-left:${pt(a.indent.left)}`);
    if (a.indent.right) css.push(`margin-right:${pt(a.indent.right)}`);
    if (a.indent.first) css.push(`text-indent:${pt(a.indent.first)}`);
  }
  if (a.space?.before) css.push(`margin-top:${pt(a.space.before)}`);
  if (a.space?.after) css.push(`margin-bottom:${pt(a.space.after)}`);
  if (a.line) css.push(`line-height:${a.line.rule === 'multiple' ? String(a.line.value) : pt(a.line.value)}`);
  return css.length ? ` style="${css.join(';')}"` : '';
}

async function runHtml(r: QuireRun, notes: Notes, asset: AssetReader | undefined): Promise<string> {
  const m: MarkSet = r.m ?? {};
  if (r.img) {
    const o = r.img as ObjAttrs;
    if (o.kind === 'note' && o.id) {
      const n = notes.num(o.id);
      return `<sup><a href="#fn-${n}" id="fnref-${n}">${n}</a></sup>`;
    }
    if (o.kind !== 'image') return '';
    const a = o.asset && asset ? await asset(o.asset).catch(() => null) : null;
    const size = `${o.w ? ` width="${Math.round(o.w / 750)}"` : ''}${o.h ? ` height="${Math.round(o.h / 750)}"` : ''}`;
    const img = `<img src="${a ? toDataUrl(a) : ''}" alt="${esc(o.alt ?? '')}"${size}>`;
    return m.link ? `<a href="${esc(m.link)}">${img}</a>` : img;
  }
  let h = esc(r.t ?? '');
  const css: string[] = [];
  if (m.color) css.push(`color:${m.color}`);
  if (m.highlight) css.push(`background-color:${m.highlight}`);
  if (m.size) css.push(`font-size:${pt(m.size)}`);
  if (m.font) css.push(`font-family:'${m.font.replace(/'/g, '')}'`);
  if (css.length) h = `<span style="${esc(css.join(';'))}">${h}</span>`;
  if (m.script) h = `<${m.script}>${h}</${m.script}>`;
  if (m.strike) h = `<s>${h}</s>`;
  if (m.underline) h = `<u>${h}</u>`;
  if (m.italic) h = `<i>${h}</i>`;
  if (m.bold) h = `<b>${h}</b>`;
  if (m.link) h = `<a href="${esc(m.link)}">${h}</a>`;
  return h;
}

async function inline(b: QuireParagraph, notes: Notes, asset: AssetReader | undefined): Promise<string> {
  let out = '';
  for (const r of b.c ?? []) out += await runHtml(r, notes, asset);
  return out;
}

const HEADING = /^h([1-6])$/;

/** 목록 수준의 번호 형식 → CSS list-style-type (기본과 다를 때만) */
const LIST_TYPES: Record<string, string> = {
  hangul: 'hangul', hangulJamo: 'hangul-consonant', circled: 'decimal', lowerAlpha: 'lower-alpha', upperAlpha: 'upper-alpha', lowerRoman: 'lower-roman', upperRoman: 'upper-roman',
};
function listStyle(def: ListDef | undefined, level: number): string {
  const f = def?.levels[level]?.format;
  const t = f ? LIST_TYPES[f] : undefined;
  return t ? ` style="list-style-type:${t}"` : '';
}

/** 정본 → HTML 문서 */
export async function exportHtml(q: QuireDoc, opts: HtmlExportOptions = {}): Promise<string> {
  // 위험한 링크(javascript: 등)는 내보내지 않는다 (16 §6)
  q = withSafeLinks(q);
  const lists = (q.settings.lists ?? {}) as Record<string, ListDef>;
  const order: string[] = [];
  const notes: Notes = {
    order,
    num(id) {
      let k = order.indexOf(id);
      if (k < 0) k = order.push(id) - 1;
      return k + 1;
    },
  };
  const story = (name: string) => (Array.isArray(q.stories[name]) ? (q.stories[name] as Array<QuireParagraph | QuireTable>) : []);

  /** 블록 열 → HTML (목록 중첩, 연속 코드 문단은 pre 하나) */
  const blocks = async (list: Array<QuireParagraph | QuireTable>): Promise<string> => {
    const out: string[] = [];
    /** 열린 목록: 태그, 수준, li가 열렸나 */
    const open: Array<{ tag: string; level: number; li: boolean }> = [];
    const closeAll = (level = -1) => {
      while (open.length && open[open.length - 1]!.level > level) {
        const o = open.pop()!;
        if (o.li) out.push('</li>');
        out.push(`</${o.tag}>`);
      }
    };
    let code: string[] | null = null;
    const flushCode = () => {
      if (code) out.push(`<pre>${code.join('\n')}</pre>`);
      code = null;
    };
    for (const b of list) {
      if (isTable(b)) {
        flushCode();
        closeAll();
        out.push(await table(b));
        continue;
      }
      const p = b.p as ParaAttrs;
      if (p.style === 'code' && !p.list) {
        closeAll();
        code ??= [];
        code.push((b.c ?? []).map((r) => esc(r.t ?? '')).join(''));
        continue;
      }
      flushCode();
      const body = await inline(b, notes, opts.asset);
      if (!p.list) {
        closeAll();
        const h = HEADING.exec(p.style ?? '');
        const tag = h ? `h${h[1]}` : p.style === 'quote' ? 'blockquote' : 'p';
        const cls = !h && p.style && p.style !== 'quote' && p.style !== 'body' ? ` data-style="${esc(p.style)}"` : '';
        out.push(`<${tag}${cls}${paraCss(p, false)}>${body}</${tag}>`);
        continue;
      }
      const tag = lists[p.list.id]?.kind === 'bullet' ? 'ul' : 'ol';
      const level = p.list.level;
      closeAll(level);
      let top = open[open.length - 1];
      if (top && top.level === level && top.tag !== tag) {
        closeAll(level - 1);
        top = open[open.length - 1];
      }
      if (top && top.level === level) {
        if (top.li) out.push('</li>');
      } else {
        // 모자란 수준만큼 연다 (중첩 목록은 앞 li 안에)
        let at = top ? top.level + 1 : level;
        if (at > level) at = level;
        for (; at <= level; at++) {
          out.push(`<${tag}${listStyle(lists[p.list.id], at)}>`);
          open.push({ tag, level: at, li: false });
          if (at < level) {
            out.push('<li>');
            open[open.length - 1]!.li = true;
          }
        }
        top = open[open.length - 1];
      }
      out.push(`<li${paraCss(p, true)}>${body}`);
      top!.li = true;
    }
    flushCode();
    closeAll();
    return out.join('\n');
  };

  const table = async (b: QuireTable): Promise<string> => {
    const t = b.table;
    const out: string[] = ['<table>'];
    out.push(`<colgroup>${t.cols.map((w) => `<col style="width:${pt(w)}">`).join('')}</colgroup>`);
    for (const r of t.rows) {
      out.push(`<tr${r.h ? ` style="height:${pt(r.h)}"` : ''}>`);
      for (const c of r.cells) {
        const span = c.span ? `${c.span[0] > 1 ? ` rowspan="${c.span[0]}"` : ''}${c.span[1] > 1 ? ` colspan="${c.span[1]}"` : ''}` : '';
        const css = [c.fill ? `background-color:${c.fill}` : '', c.valign && c.valign !== 'top' ? `vertical-align:${c.valign}` : ''].filter(Boolean).join(';');
        const paras = story(c.story);
        out.push(`<td${span}${css ? ` style="${css}"` : ''}>${await blocks(paras.length ? paras : [{ p: {}, c: [] }])}</td>`);
      }
      out.push('</tr>');
    }
    out.push('</table>');
    return out.join('');
  };

  const body = await blocks(q.stories.body);
  // 각주: 참조 순서대로 (각주 안의 각주는 없다)
  let foot = '';
  if (order.length) {
    const items: string[] = [];
    for (let k = 0; k < order.length; k++) {
      const n = k + 1;
      const content = await blocks(story(noteStoryId(order[k]!)));
      items.push(`<li id="fn-${n}">${content}<a href="#fnref-${n}" class="footnote-backref">↩</a></li>`);
    }
    foot = `\n<section class="footnotes" data-footnotes>\n<ol>\n${items.join('\n')}\n</ol>\n</section>`;
  }
  const title = opts.title ?? '';
  return (
    `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n` +
    '<style>body{font-family:Pretendard,"Noto Sans KR",sans-serif;max-width:46em;margin:2em auto;line-height:1.6}' +
    'table{border-collapse:collapse}td{border:1px solid #999;padding:4px 6px;vertical-align:top}td>p{margin:0}' +
    'blockquote{color:#555;font-style:italic}pre{background:#f5f5f7;padding:8px}</style>\n' +
    `</head>\n<body>\n${body}${foot}\n</body>\n</html>\n`
  );
}

/** 조각(클립보드 읽기 결과) → 정본. data URL 이미지는 자산으로 */
export async function fragmentToQuire(frag: Fragment, report: Report): Promise<ImportResult> {
  const assets = new Map<string, ImportedAsset>();
  let imgSeq = 0;
  const paras = async (list: Fragment['blocks']): Promise<Array<QuireParagraph | QuireTable>> => {
    const out: Array<QuireParagraph | QuireTable> = [];
    for (const b of list) {
      if ('table' in b) {
        out.push({ table: structuredClone(b.table) } as QuireTable);
        continue;
      }
      const c: QuireRun[] = [];
      for (const r of b.c) {
        if (r.img) {
          const img: ObjAttrs = { ...r.img };
          if (img.kind === 'image') {
            const a = r.src ? fromDataUrl(r.src) : null;
            if (!a) {
              report.drop('unreadableImage');
              continue;
            }
            const { id, w, h } = await addAsset(assets, a, img.w, img.h);
            img.id = `img${++imgSeq}`;
            img.asset = id;
            if (w) img.w = w;
            if (h) img.h = h;
          }
          c.push({ img, ...(r.m && Object.keys(r.m).length ? { m: { ...r.m } } : {}) });
        } else if (r.t) c.push({ t: r.t, ...(r.m && Object.keys(r.m).length ? { m: { ...r.m } } : {}) });
      }
      out.push({ p: { ...b.p }, c });
    }
    return out;
  };
  const q = emptyQuire(await paras(frag.blocks));
  const stories = q.stories as Record<string, unknown>;
  for (const [name, list] of Object.entries(frag.stories)) {
    const key = name.startsWith('note|') ? noteStoryId(name.slice(5)) : name;
    stories[key] = await paras(list);
  }
  if (Object.keys(frag.lists).length) q.settings.lists = structuredClone(frag.lists);
  // 목록 정의가 빠진 목록 문단: 기본 정의
  const lists = (q.settings.lists ?? {}) as Record<string, ListDef>;
  for (const v of Object.values(q.stories))
    if (Array.isArray(v))
      for (const b of v) {
        const li = (b as QuireParagraph).p?.list as ParaAttrs['list'];
        if (li && !lists[li.id]) lists[li.id] = defaultListDef(li.id, 'bullet');
      }
  if (Object.keys(lists).length) q.settings.lists = lists;
  // 쓰이지 않는 각주 스토리는 정본에 두지 않는다
  for (const k of Object.keys(stories)) if (isNoteStory(k) && !Array.isArray(stories[k])) delete stories[k];
  addUsedStyles(q);
  finishImport(q, report);
  return { doc: q, assets, report };
}

/** HTML 문서 → 정본 */
export async function importHtml(html: string): Promise<ImportResult> {
  const report = new Report();
  const frag = htmlToFragment(html, { document: true, drop: report.drop });
  return fragmentToQuire(frag, report);
}
