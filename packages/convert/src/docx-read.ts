/**
 * DOCX 가져오기 (15 §6.3): WordprocessingML → 정본. 스타일 상속(w:basedOn)과 문서 기본값을 풀어 우리 스타일(제목 1–6·인용·코드·
 * 목록 문단, 나머지는 같은 이름의 새 스타일)과 직접 서식으로 둔다. 번호, 표(가로·세로 병합), 이미지(글 안·떠 있음), 링크, 필드,
 * 각주·미주, 구역(용지·여백·방향·다단·쪽 번호·머리말·꼬리말), 댓글(답글·해결), 변경 추적(삽입·삭제 → 제안)을 읽는다.
 * 담지 못하는 것(도형·글상자, 수식, 표 안의 표, 서식 변경 추적)은 버리고 보고한다.
 */
import { PAPER_SIZES, defaultListDef, noteStoryId, type CommentThread, type FloatAttrs, type ListDef, type ListLevel, type MarkSet, type ObjAttrs, type ParaAttrs, type Style } from '@quire/model';
import { readZip, type QuireDoc, type QuireParagraph, type QuireRun, type QuireTable } from '@quire/sync';
import { Report, finishImport, addAsset, addUsedStyles, emptyQuire, mimeOf, type ImportResult, type ImportedAsset } from './common';
import { NUM_FMT, STYLE_IDS } from './docx-write';
import { descendants, kid, kids, parseXml, path, textOf, type XNode } from './xml';

const fromTwip = (v: string | undefined) => (v === undefined || v === '' ? undefined : Math.round(Number(v) * 50));
const fromEmu = (v: string | undefined) => Math.round(Number(v ?? 0) / 12.7);
const on = (n: XNode | undefined): boolean | undefined => {
  if (!n) return undefined;
  const v = n.attrs['w:val'];
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
};
const FMT_BACK: Record<string, ListLevel['format']> = Object.fromEntries(Object.entries(NUM_FMT).map(([k, v]) => [v, k as ListLevel['format']]));
const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080',
  darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000',
};
const PALETTE = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#007b83'];

interface Rel {
  type: string;
  target: string;
  external: boolean;
}

function readRels(xml: string | undefined): Map<string, Rel> {
  const out = new Map<string, Rel>();
  if (!xml) return out;
  for (const r of kids(parseXml(xml))) {
    const type = (r.attrs.Type ?? '').split('/').pop() ?? '';
    out.set(r.attrs.Id ?? '', { type, target: r.attrs.Target ?? '', external: r.attrs.TargetMode === 'External' });
  }
  return out;
}

/** 부분 경로 기준 상대 대상 → 패키지 경로 */
function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

interface RawStyle {
  id: string;
  type: string;
  name: string;
  basedOn?: string;
  pPr?: XNode;
  rPr?: XNode;
}

/** rPr → 서식 (false는 위의 것을 끈다) */
function marksOf(r: XNode | undefined, into: Record<string, unknown>): void {
  if (!r) return;
  const b = on(kid(r, 'w:b'));
  if (b !== undefined) into.bold = b;
  const i = on(kid(r, 'w:i'));
  if (i !== undefined) into.italic = i;
  const s = on(kid(r, 'w:strike')) ?? on(kid(r, 'w:dstrike'));
  if (s !== undefined) into.strike = s;
  const u = kid(r, 'w:u');
  if (u) into.underline = on(u);
  const c = kid(r, 'w:color')?.attrs['w:val'];
  if (c && /^[0-9a-f]{6}$/i.test(c)) into.color = `#${c.toLowerCase()}`;
  else if (c === 'auto') into.color = false;
  const sz = kid(r, 'w:sz')?.attrs['w:val'];
  if (sz) into.size = Number(sz) * 500;
  const f = kid(r, 'w:rFonts');
  const font = f?.attrs['w:eastAsia'] ?? f?.attrs['w:ascii'] ?? f?.attrs['w:hAnsi'];
  if (font) into.font = font;
  const hl = kid(r, 'w:highlight')?.attrs['w:val'];
  if (hl && HIGHLIGHT[hl]) into.highlight = HIGHLIGHT[hl];
  else if (hl === 'none') into.highlight = false;
  const shd = kid(r, 'w:shd')?.attrs['w:fill'];
  if (shd && /^[0-9a-f]{6}$/i.test(shd)) into.highlight = `#${shd.toLowerCase()}`;
  const va = kid(r, 'w:vertAlign')?.attrs['w:val'];
  if (va === 'superscript') into.script = 'sup';
  else if (va === 'subscript') into.script = 'sub';
  else if (va === 'baseline') into.script = false;
}

/** pPr → 문단 속성 (번호·스타일·구역 제외) */
function paraOf(p: XNode | undefined, into: Record<string, unknown>): void {
  if (!p) return;
  const jc = kid(p, 'w:jc')?.attrs['w:val'];
  if (jc) into.align = jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left';
  const ind = kid(p, 'w:ind');
  if (ind) {
    const left = fromTwip(ind.attrs['w:left'] ?? ind.attrs['w:start']);
    const right = fromTwip(ind.attrs['w:right'] ?? ind.attrs['w:end']);
    const first = ind.attrs['w:hanging'] !== undefined ? -fromTwip(ind.attrs['w:hanging'])! : fromTwip(ind.attrs['w:firstLine']);
    const v: Record<string, number> = {};
    if (left) v.left = left;
    if (right) v.right = right;
    if (first) v.first = first;
    into.indent = Object.keys(v).length ? v : undefined;
  }
  const sp = kid(p, 'w:spacing');
  if (sp) {
    const before = fromTwip(sp.attrs['w:before']);
    const after = fromTwip(sp.attrs['w:after']);
    if (before !== undefined || after !== undefined) {
      const v: Record<string, number> = {};
      if (before !== undefined) v.before = before;
      if (after !== undefined) v.after = after;
      into.space = v;
    }
    const line = sp.attrs['w:line'];
    if (line !== undefined) {
      const rule = sp.attrs['w:lineRule'] ?? 'auto';
      if (rule === 'auto') into.line = Number(line) === 240 ? undefined : { rule: 'multiple', value: Math.round((Number(line) / 240) * 100) / 100 };
      else into.line = { rule: rule === 'exact' ? 'exact' : 'atLeast', value: fromTwip(line)! };
    }
  }
  for (const [tag, key] of [
    ['w:keepNext', 'keepWithNext'],
    ['w:keepLines', 'keepTogether'],
    ['w:pageBreakBefore', 'pageBreakBefore'],
  ] as const) {
    const v = on(kid(p, tag));
    if (v !== undefined) into[key] = v;
  }
}

const clean = <T extends Record<string, unknown>>(o: T): T => {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === false) delete o[k];
  return o;
};

/** DOCX → 정본 */
/** 표 열 수·칸 합치기 상한 (Word는 63열) */
const MAX_TABLE_COLS = 1000;

export async function importDocx(bytes: Uint8Array): Promise<ImportResult> {
  const report = new Report();
  const assets = new Map<string, ImportedAsset>();
  const entries = await readZip(bytes);
  const files = new Map(entries.map((e) => [e.name.replace(/^\//, ''), e.data]));
  const dec = new TextDecoder();
  const text = (name: string) => {
    const d = files.get(name);
    return d ? dec.decode(d) : undefined;
  };
  // 본문 부분 (패키지 관계에서)
  const pkg = readRels(text('_rels/.rels'));
  const mainPath = [...pkg.values()].find((r) => r.type === 'officeDocument')?.target.replace(/^\//, '') ?? 'word/document.xml';
  const relsPath = (p: string) => p.replace(/([^/]+)$/, '_rels/$1.rels');
  const docXml = text(mainPath);
  if (!docXml) throw new Error('DOCX: word/document.xml이 없습니다');
  const docRels = readRels(text(relsPath(mainPath)));
  const partOf = (type: string) => {
    const r = [...docRels.values()].find((x) => x.type === type);
    return r ? resolve(mainPath, r.target) : undefined;
  };

  // ── 스타일 ──
  const styles = new Map<string, RawStyle>();
  const stylesPath = partOf('styles');
  const stylesRoot = stylesPath && text(stylesPath) ? parseXml(text(stylesPath)!) : undefined;
  for (const s of kids(stylesRoot, 'w:style'))
    styles.set(s.attrs['w:styleId'] ?? '', {
      id: s.attrs['w:styleId'] ?? '',
      type: s.attrs['w:type'] ?? 'paragraph',
      name: kid(s, 'w:name')?.attrs['w:val'] ?? s.attrs['w:styleId'] ?? '',
      basedOn: kid(s, 'w:basedOn')?.attrs['w:val'],
      pPr: kid(s, 'w:pPr'),
      rPr: kid(s, 'w:rPr'),
    });
  const chain = (id: string | undefined): RawStyle[] => {
    const out: RawStyle[] = [];
    const seen = new Set<string>();
    while (id && styles.has(id) && !seen.has(id)) {
      seen.add(id);
      const s = styles.get(id)!;
      out.unshift(s);
      id = s.basedOn;
    }
    return out;
  };
  const defaultPara = kids(stylesRoot, 'w:style').find((s) => s.attrs['w:type'] === 'paragraph' && on(s.attrs['w:default'] ? { name: '', attrs: { 'w:val': s.attrs['w:default'] }, children: [] } : undefined))?.attrs['w:styleId'] ?? 'Normal';
  /** Word 스타일 → 우리 스타일 이름 */
  const ourStyle = new Map<string, string>();
  const nameOf = (id: string): string | undefined => {
    if (ourStyle.has(id)) return ourStyle.get(id);
    const s = styles.get(id);
    if (!s || s.type !== 'paragraph') return undefined;
    const n = s.name.toLowerCase();
    let ours: string | undefined;
    const h = /^heading ([1-6])$/.exec(n);
    if (id === defaultPara || n === 'normal') ours = 'body';
    else if (h) ours = `h${h[1]}`;
    else if (n === 'quote' || n === 'intense quote') ours = 'quote';
    else if (n === 'code' || n === 'html preformatted') ours = 'code';
    else if (n === 'list paragraph') ours = 'listParagraph';
    else {
      const known = Object.entries(STYLE_IDS).find(([, [sid]]) => sid === id)?.[0];
      ours = known ?? (id.startsWith('Q') ? id.slice(1) : id).replace(/[^\w-]/g, '') ?? 'custom';
    }
    ourStyle.set(id, ours);
    return ours;
  };
  /** 문서 기본값 + 기본 문단 스타일 */
  const defaults = path(stylesRoot, 'w:docDefaults');
  const baseMarks: Record<string, unknown> = {};
  marksOf(path(defaults, 'w:rPrDefault/w:rPr'), baseMarks);
  const basePara: Record<string, unknown> = {};
  paraOf(path(defaults, 'w:pPrDefault/w:pPr'), basePara);
  for (const s of chain(defaultPara)) {
    marksOf(s.rPr, baseMarks);
    paraOf(s.pPr, basePara);
  }
  const charStyleMarks = (id: string | undefined): Record<string, unknown> => {
    const m: Record<string, unknown> = {};
    for (const s of chain(id)) {
      // 링크·각주·댓글 참조 글자 스타일은 우리 그리기가 정한다
      if (/^(hyperlink|footnote reference|endnote reference|annotation reference)$/i.test(s.name)) continue;
      marksOf(s.rPr, m);
    }
    return m;
  };

  // ── 번호 ──
  const lists = new Map<string, ListDef>();
  const numberingPath = partOf('numbering');
  const numRoot = numberingPath && text(numberingPath) ? parseXml(text(numberingPath)!) : undefined;
  const abstracts = new Map(kids(numRoot, 'w:abstractNum').map((a) => [a.attrs['w:abstractNumId'] ?? '', a]));
  const numAbs = new Map(kids(numRoot, 'w:num').map((n) => [n.attrs['w:numId'] ?? '', kid(n, 'w:abstractNumId')?.attrs['w:val'] ?? '']));
  const listOf = (numId: string): string | null => {
    if (!numId || numId === '0') return null;
    const id = `w${numId}`;
    if (lists.has(id)) return id;
    const abs = abstracts.get(numAbs.get(numId) ?? '');
    if (!abs) return null;
    const lvls = kids(abs, 'w:lvl');
    const fmt0 = kid(lvls[0], 'w:numFmt')?.attrs['w:val'];
    const def = defaultListDef(id, fmt0 === 'bullet' ? 'bullet' : 'number');
    for (const l of lvls) {
      const k = Number(l.attrs['w:ilvl'] ?? 0);
      const lv = def.levels[k];
      if (!lv) continue;
      const f = kid(l, 'w:numFmt')?.attrs['w:val'];
      if (f && FMT_BACK[f]) lv.format = FMT_BACK[f]!;
      const t = kid(l, 'w:lvlText')?.attrs['w:val'];
      if (t !== undefined) lv.text = t;
      const ind = path(l, 'w:pPr/w:ind');
      const left = fromTwip(ind?.attrs['w:left'] ?? ind?.attrs['w:start']);
      const hang = fromTwip(ind?.attrs['w:hanging']);
      if (left !== undefined) lv.indent = left;
      if (hang !== undefined) lv.hanging = hang;
    }
    lists.set(id, def);
    return id;
  };

  // ── 각주·미주, 댓글 ──
  const notesById = new Map<string, XNode>();
  for (const [type, tag] of [
    ['footnotes', 'w:footnote'],
    ['endnotes', 'w:endnote'],
  ] as const) {
    const p = partOf(type);
    const root = p && text(p) ? parseXml(text(p)!) : undefined;
    for (const n of kids(root, tag)) if (!n.attrs['w:type'] || n.attrs['w:type'] === 'normal') notesById.set(`${type}:${n.attrs['w:id']}`, n);
  }
  const notesRels = (type: string) => {
    const p = partOf(type);
    return { path: p ?? '', rels: p ? readRels(text(relsPath(p))) : new Map<string, Rel>() };
  };
  const commentsPath = partOf('comments');
  const commentNodes = new Map(kids(commentsPath && text(commentsPath) ? parseXml(text(commentsPath)!) : undefined, 'w:comment').map((c) => [c.attrs['w:id'] ?? '', c]));
  const exPath = [...docRels.values()].find((r) => r.type === 'commentsExtended');
  const exRoot = exPath && text(resolve(mainPath, exPath.target)) ? parseXml(text(resolve(mainPath, exPath.target))!) : undefined;
  const commentEx = new Map(kids(exRoot, 'w15:commentEx').map((e) => [e.attrs['w15:paraId'] ?? '', e]));

  // ── 읽기 상태 ──
  const stories: Record<string, unknown> = {};
  const noteIds = new Map<string, string>();
  const annotations: Array<Record<string, unknown>> = [];
  const commentPos = new Map<string, { story: string; start?: number; end?: number; ref?: number }>();
  let tableSeq = 0;
  let imgSeq = 0;
  const pendingImages: Array<{ run: QuireRun; data: Uint8Array | undefined; alt: string }> = [];
  const authorOf = (name: string) => {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
    return { id: `docx:${name || '?'}`, name: name || '이름 없음', color: PALETTE[h % PALETTE.length]! };
  };

  interface Ctx {
    story: string;
    partPath: string;
    rels: Map<string, Rel>;
    offset: number;
  }

  /** 블록 요소들 → 블록 */
  const readBlocks = (nodes: XNode[], ctx: Ctx, onSection?: (sectPr: XNode, last: QuireParagraph) => void): Array<QuireParagraph | QuireTable> => {
    const out: Array<QuireParagraph | QuireTable> = [];
    for (const n of nodes) {
      if (n.name === 'w:p') out.push(...readPara(n, ctx, onSection));
      else if (n.name === 'w:tbl') {
        if (ctx.story === 'body') {
          out.push(readTable(n, ctx));
          ctx.offset += 2;
        } else {
          // 본문 밖(셀·머리말·각주)의 표는 담지 못한다: 칸 글만 문단으로
          report.drop(ctx.story.includes('.r') ? '표 안의 표' : '본문 밖의 표');
          for (const tc of descendants(n, 'w:tc')) out.push(...readBlocks(kids(tc, 'w:p'), ctx));
        }
      } else if (n.name === 'w:sdt') out.push(...readBlocks(kids(kid(n, 'w:sdtContent')), ctx, onSection));
      else if (n.name === 'w:customXml' || n.name === 'w:ins' || n.name === 'w:moveTo') out.push(...readBlocks(kids(n), ctx, onSection));
    }
    return out;
  };

  const readTable = (tbl: XNode, ctx: Ctx): QuireTable => {
    const tk = ++tableSeq;
    const cols = kids(kid(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => fromTwip(g.attrs['w:w']) ?? 72000);
    const rows: QuireTable['table']['rows'] = [];
    /** 칸 (y, x) → 주인 셀 (세로 병합을 늘린다) */
    const owners = new Map<string, QuireTable['table']['rows'][0]['cells'][0]>();
    kids(tbl, 'w:tr').forEach((tr, y) => {
      const trPr = kid(tr, 'w:trPr');
      const row: QuireTable['table']['rows'][0] = { cells: [] };
      const h = fromTwip(kid(trPr, 'w:trHeight')?.attrs['w:val']);
      if (h) row.h = h;
      if (on(kid(trPr, 'w:tblHeader'))) row.header = true;
      if (on(kid(trPr, 'w:cantSplit'))) row.cantSplit = true;
      let x = Math.min(MAX_TABLE_COLS, Math.max(0, Math.floor(Number(kid(trPr, 'w:gridBefore')?.attrs['w:val'] ?? 0)) || 0));
      for (const tc of kids(tr).flatMap((c) => (c.name === 'w:tc' ? [c] : c.name === 'w:sdt' ? kids(kid(c, 'w:sdtContent'), 'w:tc') : []))) {
        const tcPr = kid(tc, 'w:tcPr');
        // 망가진 값이 칸을 수억 개 만들지 않게 (16 §6): 열 수 상한 안으로
        const span = Math.min(MAX_TABLE_COLS, Math.max(1, Math.floor(Number(kid(tcPr, 'w:gridSpan')?.attrs['w:val'] ?? 1)) || 1));
        const vm = kid(tcPr, 'w:vMerge');
        if (vm && vm.attrs['w:val'] !== 'restart') {
          const above = owners.get(`${y - 1},${x}`);
          if (above) {
            above.span = [(above.span?.[0] ?? 1) + 1, above.span?.[1] ?? span];
            for (let k = 0; k < span; k++) owners.set(`${y},${x + k}`, above);
          }
          x += span;
          continue;
        }
        const name = `t${tk}.r${y + 1}c${x + 1}`;
        const cell: QuireTable['table']['rows'][0]['cells'][0] = { story: name };
        if (span > 1) cell.span = [1, span];
        const fill = kid(tcPr, 'w:shd')?.attrs['w:fill'];
        if (fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toLowerCase() !== 'ffffff') cell.fill = `#${fill.toLowerCase()}`;
        const va = kid(tcPr, 'w:vAlign')?.attrs['w:val'];
        if (va === 'center' || va === 'bottom') cell.valign = va === 'center' ? 'middle' : 'bottom';
        stories[name] = readBlocks(kids(tc), { ...ctx, story: name, offset: 0 });
        for (let k = 0; k < span; k++) owners.set(`${y},${x + k}`, cell);
        row.cells.push(cell);
        x += span;
      }
      rows.push(row);
    });
    for (const r of rows) for (const c of r.cells) if (c.span && c.span[0] === 1 && c.span[1] === 1) delete c.span;
    return { table: { cols, rows } };
  };

  /** 문단 하나 → 문단들 (문단 안 줄 바꿈·쪽 나눔은 문단을 나눈다) */
  const readPara = (p: XNode, ctx: Ctx, onSection?: (sectPr: XNode, last: QuireParagraph) => void): QuireParagraph[] => {
    const ppr = kid(p, 'w:pPr');
    const attrs: Record<string, unknown> = {};
    const sid = kid(ppr, 'w:pStyle')?.attrs['w:val'];
    const style = sid ? nameOf(sid) : undefined;
    if (style && style !== 'body') attrs.style = style;
    paraOf(ppr, attrs);
    // 번호: 직접 numPr, 없으면 스타일의 numPr (제목 스타일의 개요 번호는 뺀다)
    let numPr = kid(ppr, 'w:numPr');
    if (!numPr && sid && !/^h[1-6]$/.test(style ?? '')) for (const s of chain(sid)) numPr = kid(s.pPr, 'w:numPr') ?? numPr;
    if (numPr) {
      const id = listOf(kid(numPr, 'w:numId')?.attrs['w:val'] ?? '');
      if (id) attrs.list = { id, level: Number(kid(numPr, 'w:ilvl')?.attrs['w:val'] ?? 0) };
    }
    if (kid(ppr, 'w:pPrChange')) report.drop('문단 서식 변경 추적 (받아들임)');
    clean(attrs);
    const pieces: QuireParagraph[] = [{ p: { ...attrs }, c: [] }];
    let cur = pieces[0]!;
    const fresh = () => !cur.c.length;
    const split = (extra: Record<string, unknown>) => {
      ctx.offset++; // 앞 문단의 ¶
      const next: QuireParagraph = { p: { ...attrs, ...extra }, c: [] };
      delete next.p.pageBreakBefore;
      Object.assign(next.p, extra);
      pieces.push(next);
      cur = next;
    };
    const pushText = (t: string, m: Record<string, unknown>) => {
      if (!t) return;
      const mm = clean({ ...m }) as MarkSet;
      const last = cur.c[cur.c.length - 1];
      if (last && last.t !== undefined && JSON.stringify(last.m ?? {}) === JSON.stringify(mm)) last.t += t;
      else cur.c.push({ t, ...(Object.keys(mm).length ? { m: mm } : {}) });
      ctx.offset += Array.from(t).length;
    };
    const pushObj = (o: ObjAttrs, m?: Record<string, unknown>) => {
      const mm = m ? (clean({ ...m }) as MarkSet) : {};
      const run: QuireRun = { img: o, ...(Object.keys(mm).length ? { m: mm } : {}) };
      cur.c.push(run);
      ctx.offset++;
      return run;
    };
    // 변경 추적 구간
    const revs: Array<{ kind: 'insert' | 'delete'; author: string; date: string; start: number }> = [];
    // 복합 필드
    let field: { instr: string; kind: ObjAttrs['field'] | null; link?: string; result: boolean } | null = null;

    const walk = (nodes: Array<XNode | string>, link: string | undefined): void => {
      for (const n of nodes) {
        if (typeof n === 'string') continue;
        switch (n.name) {
          case 'w:r':
            run(n, link);
            break;
          case 'w:hyperlink': {
            const r = n.attrs['r:id'] ? ctx.rels.get(n.attrs['r:id']) : undefined;
            walk(n.children, r?.target ?? link);
            break;
          }
          case 'w:ins':
          case 'w:del':
          case 'w:moveTo':
          case 'w:moveFrom': {
            const kind = n.name === 'w:ins' || n.name === 'w:moveTo' ? 'insert' : 'delete';
            const rev = { kind: kind as 'insert' | 'delete', author: n.attrs['w:author'] ?? '', date: n.attrs['w:date'] ?? '', start: ctx.offset };
            revs.push(rev);
            walk(n.children, link);
            if (ctx.offset > rev.start) addRev(rev, ctx);
            revs.pop();
            break;
          }
          case 'w:fldSimple': {
            const kind = fieldKind(n.attrs['w:instr'] ?? '');
            if (kind) pushObj({ kind: 'field', field: kind });
            else {
              const url = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(n.attrs['w:instr'] ?? '')?.[1];
              walk(n.children, url ?? link);
            }
            break;
          }
          case 'w:commentRangeStart':
          case 'w:commentRangeEnd': {
            const id = n.attrs['w:id'] ?? '';
            const e = commentPos.get(id) ?? { story: ctx.story };
            if (n.name === 'w:commentRangeStart') {
              e.start = ctx.offset;
              e.story = ctx.story;
            } else e.end = ctx.offset;
            commentPos.set(id, e);
            break;
          }
          case 'w:sdt':
            walk(kid(n, 'w:sdtContent')?.children ?? [], link);
            break;
          case 'w:smartTag':
          case 'w:customXml':
            walk(n.children, link);
            break;
          case 'm:oMath':
          case 'm:oMathPara':
            report.drop('수식');
            break;
          default:
            break;
        }
      }
    };

    const run = (r: XNode, link: string | undefined): void => {
      const rpr = kid(r, 'w:rPr');
      if (kid(rpr, 'w:rPrChange')) report.drop('글자 서식 변경 추적 (받아들임)');
      const m: Record<string, unknown> = { ...charStyleMarks(kid(rpr, 'w:rStyle')?.attrs['w:val']) };
      marksOf(rpr, m);
      // 문서 기본값과 같은 글꼴·크기는 서식이 아니다
      if (m.font === baseMarks.font) delete m.font;
      if (m.size === baseMarks.size) delete m.size;
      if (link) m.link = link;
      for (const c of r.children) {
        if (typeof c === 'string') continue;
        if (field && c.name !== 'w:fldChar' && !field.result) {
          if (c.name === 'w:instrText') field.instr += textOf(c);
          continue;
        }
        switch (c.name) {
          case 'w:t':
          case 'w:delText':
            if (field?.result && field.kind) break; // 필드 결과 (그릴 때 정한다)
            pushText(textOf(c), field?.link ? { ...m, link: field.link } : m);
            break;
          case 'w:tab':
            pushText('\t', m);
            break;
          case 'w:noBreakHyphen':
            pushText('‑', m);
            break;
          case 'w:sym': {
            const ch = c.attrs['w:char'];
            if (ch) pushText(String.fromCharCode(parseInt(ch, 16) >= 0xf000 ? parseInt(ch, 16) - 0xf000 : parseInt(ch, 16)), m);
            break;
          }
          case 'w:br':
          case 'w:cr': {
            const type = c.attrs['w:type'];
            if (type === 'page') {
              if (fresh()) cur.p.pageBreakBefore = true;
              else split({ pageBreakBefore: true });
            } else if (type === 'column') {
              if (fresh()) cur.p.columnBreakBefore = true;
              else split({ columnBreakBefore: true });
            } else split({});
            break;
          }
          case 'w:drawing':
            drawing(c, m);
            break;
          case 'mc:AlternateContent': {
            const choice = kid(c, 'mc:Choice');
            const d = choice && [...descendants(choice, 'w:drawing')].find((dd) => [...descendants(dd, 'pic:pic')].length);
            if (d) drawing(d, m);
            else report.drop('도형·글상자');
            break;
          }
          case 'w:pict':
          case 'w:object':
            report.drop('VML 그림·개체');
            break;
          case 'w:footnoteReference':
          case 'w:endnoteReference': {
            const key = `${c.name === 'w:footnoteReference' ? 'footnotes' : 'endnotes'}:${c.attrs['w:id']}`;
            const node = notesById.get(key);
            if (!node) break;
            let id = noteIds.get(key);
            if (!id) {
              id = `n${noteIds.size + 1}`;
              noteIds.set(key, id);
              const sid2 = noteStoryId(id);
              const nr = notesRels(key.split(':')[0]!);
              const blocks = readBlocks(kids(node), { story: sid2, partPath: nr.path, rels: nr.rels, offset: 0 });
              // 첫 문단 앞의 각주 번호 뒤 공백
              const first = blocks[0] as QuireParagraph | undefined;
              const t0 = first?.c?.[0];
              if (t0?.t) {
                t0.t = t0.t.replace(/^\s+/, '');
                if (!t0.t) first!.c.shift();
              }
              stories[sid2] = blocks;
            }
            pushObj({ id, kind: 'note' });
            break;
          }
          case 'w:fldChar': {
            const t = c.attrs['w:fldCharType'];
            if (t === 'begin') field = { instr: '', kind: null, result: false };
            else if (t === 'separate' && field) {
              field.result = true;
              field.kind = fieldKind(field.instr) ?? null;
              field.link = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(field.instr)?.[1];
              if (field.kind) pushObj({ kind: 'field', field: field.kind }, m);
            } else if (t === 'end' && field) {
              if (!field.result) {
                const k = fieldKind(field.instr);
                if (k) pushObj({ kind: 'field', field: k }, m);
              }
              field = null;
            }
            break;
          }
          default:
            break;
        }
      }
    };

    const drawing = (d: XNode, m: Record<string, unknown>) => {
      const box = kid(d, 'wp:inline') ?? kid(d, 'wp:anchor');
      if (!box) return;
      const blip = [...descendants(box, 'a:blip')][0];
      const rel = blip?.attrs['r:embed'] ? ctx.rels.get(blip.attrs['r:embed']) : undefined;
      if (!blip || !rel) {
        report.drop('도형·글상자');
        return;
      }
      const ext = kid(box, 'wp:extent');
      const alt = kid(box, 'wp:docPr')?.attrs.descr ?? '';
      const o: ObjAttrs = { id: `img${++imgSeq}`, kind: 'image', w: fromEmu(ext?.attrs.cx), h: fromEmu(ext?.attrs.cy), ...(alt ? { alt } : {}) };
      if (box.name === 'wp:anchor') o.float = floatOf(box);
      const run = pushObj(o, m.link ? { link: m.link } : undefined);
      pendingImages.push({ run, data: files.get(resolve(ctx.partPath, rel.target)), alt });
    };

    walk(p.children, undefined);
    ctx.offset++; // ¶
    const last = pieces[pieces.length - 1]!;
    const sect = kid(ppr, 'w:sectPr');
    if (sect && onSection) onSection(sect, last);
    return pieces;
  };

  const addRev = (rev: { kind: 'insert' | 'delete'; author: string; date: string; start: number }, ctx: Ctx) => {
    // 같은 사람·시각·종류가 이어지면 합친다
    const prev = annotations[annotations.length - 1] as { type?: string; data?: { kind?: string; author?: { name?: string }; time?: number }; end?: { story: string; offset: number } } | undefined;
    const time = Date.parse(rev.date) || 0;
    const author = authorOf(rev.author);
    if (prev?.type === 'suggestion' && prev.data?.kind === rev.kind && prev.data.author?.name === author.name && prev.data.time === time && prev.end?.story === ctx.story && prev.end.offset >= rev.start - 1) {
      prev.end.offset = ctx.offset;
      return;
    }
    annotations.push({ id: `s${annotations.length + 1}`, type: 'suggestion', data: { kind: rev.kind, author, time }, start: { story: ctx.story, offset: rev.start }, end: { story: ctx.story, offset: ctx.offset } });
  };

  // ── 본문과 구역 ──
  const body = path(parseXml(docXml), 'w:body');
  if (!body) throw new Error('DOCX: w:body가 없습니다');
  const settingsPath = partOf('settings');
  const settings = settingsPath && text(settingsPath) ? parseXml(text(settingsPath)!) : undefined;
  const oddEven = on(kid(settings, 'w:evenAndOddHeaders')) ?? false;
  const sections: Array<Record<string, unknown>> = [];
  const sectionOf = (s: XNode, id: string): Record<string, unknown> => {
    const pg = kid(s, 'w:pgSz');
    const mar = kid(s, 'w:pgMar');
    let w = fromTwip(pg?.attrs['w:w']) ?? 595276;
    let h = fromTwip(pg?.attrs['w:h']) ?? 841890;
    if (pg?.attrs['w:orient'] === 'landscape' && w < h) [w, h] = [h, w];
    // twip은 1/20pt라 표준 용지(A4 등)의 크기가 반올림된다: 1 twip 안이면 표준 크기로
    for (const [pw, ph] of Object.values(PAPER_SIZES))
      for (const [a, b] of [
        [pw, ph],
        [ph, pw],
      ] as const)
        if (Math.abs(w - a) <= 50 && Math.abs(h - b) <= 50) [w, h] = [a, b];
    const e: Record<string, unknown> = {
      id,
      page: { width: w, height: h, margin: [fromTwip(mar?.attrs['w:top']) ?? 72000, fromTwip(mar?.attrs['w:right']) ?? 72000, fromTwip(mar?.attrs['w:bottom']) ?? 72000, fromTwip(mar?.attrs['w:left']) ?? 72000] },
      start: ({ continuous: 'continuous', evenPage: 'evenPage', oddPage: 'oddPage' } as Record<string, string>)[kid(s, 'w:type')?.attrs['w:val'] ?? ''] ?? 'nextPage',
    };
    const cols = kid(s, 'w:cols');
    const num = Number(cols?.attrs['w:num'] ?? 1);
    if (num > 1) e.columns = { count: num, gap: fromTwip(cols?.attrs['w:space']) ?? 36000, ...(on(cols?.attrs['w:sep'] ? { name: '', attrs: { 'w:val': cols.attrs['w:sep'] }, children: [] } : undefined) ? { separator: true } : {}) };
    const hd = fromTwip(mar?.attrs['w:header']);
    const fd = fromTwip(mar?.attrs['w:footer']);
    if (hd !== undefined && hd !== 36000) e.headerDistance = hd;
    if (fd !== undefined && fd !== 36000) e.footerDistance = fd;
    if (on(kid(s, 'w:titlePg'))) e.titlePage = true;
    if (oddEven) e.oddEven = true;
    const pn = kid(s, 'w:pgNumType');
    if (pn && (pn.attrs['w:start'] || pn.attrs['w:fmt'])) {
      const fmt = pn.attrs['w:fmt'];
      e.pageNumber = clean({ start: pn.attrs['w:start'] ? Number(pn.attrs['w:start']) : undefined, format: fmt === 'upperRoman' || fmt === 'lowerRoman' ? 'roman' : fmt === 'ganada' ? 'hangul' : undefined });
    }
    for (const ref of kids(s)) {
      const part = ref.name === 'w:headerReference' ? 'header' : ref.name === 'w:footerReference' ? 'footer' : null;
      if (!part) continue;
      const kind = (ref.attrs['w:type'] ?? 'default') as 'default' | 'first' | 'even';
      const rel = docRels.get(ref.attrs['r:id'] ?? '');
      if (!rel) continue;
      const pp = resolve(mainPath, rel.target);
      const xml = text(pp);
      if (!xml) continue;
      const storyId = `${part === 'header' ? 'hdr' : 'ftr'}|${id}|${kind}`;
      const blocks = readBlocks(kids(parseXml(xml)), { story: storyId, partPath: pp, rels: readRels(text(relsPath(pp))), offset: 0 });
      // 빈 머리말은 "없음" (앞 구역 것을 끊는다)
      const empty = blocks.every((b) => 'c' in b && !b.c.length);
      if (empty) inherited.set(`${part}.${kind}`, null);
      else {
        stories[storyId] = blocks;
        inherited.set(`${part}.${kind}`, storyId);
      }
    }
    // 참조가 없는 종류는 앞 구역 것을 이어받는다 (Word)
    for (const [key, sid] of inherited) {
      if (!sid) continue;
      const [part, kind] = key.split('.') as ['header' | 'footer', string];
      e[part] = { ...((e[part] as object) ?? {}), [kind]: sid };
    }
    return e;
  };
  let secSeq = 0;
  /** 머리말·꼬리말 종류 → 지금까지의 스토리 (null: 없음) */
  const inherited = new Map<string, string | null>();
  const blocks = readBlocks(kids(body), { story: 'body', partPath: mainPath, rels: docRels, offset: 0 }, (sectPr, last) => {
    const id = `s${++secSeq}`;
    last.p.section = id;
    sections.push(sectionOf(sectPr, id));
  });
  const finalSect = kid(body, 'w:sectPr');
  sections.push(sectionOf(finalSect ?? { name: 'w:sectPr', attrs: {}, children: [] }, secSeq ? 'last' : 's1'));

  // ── 이미지 ──
  for (const pi of pendingImages) {
    const img = pi.run.img!;
    if (!pi.data) {
      report.drop('이미지 (파일 없음)');
      delete pi.run.img;
      pi.run.t = pi.alt || '';
      continue;
    }
    const { id } = await addAsset(assets, { bytes: pi.data, type: mimeOf(pi.data) }, img.w, img.h);
    img.asset = id;
  }

  // ── 댓글 → 스레드 ──
  const threads: CommentThread[] = [];
  const paraIdOf = (c: XNode) => {
    const ps = kids(c, 'w:p');
    return ps[ps.length - 1]?.attrs['w14:paraId'] ?? '';
  };
  const byPara = new Map([...commentNodes].map(([id, c]) => [paraIdOf(c), id]));
  const threadOf = new Map<string, CommentThread>();
  for (const [id, c] of commentNodes) {
    const ex = commentEx.get(paraIdOf(c));
    const parentId = ex?.attrs['w15:paraIdParent'] ? byPara.get(ex.attrs['w15:paraIdParent']) : undefined;
    const msg = {
      id: `m${id}`,
      author: authorOf(c.attrs['w:author'] ?? ''),
      time: Date.parse(c.attrs['w:date'] ?? '') || 0,
      text: kids(c, 'w:p')
        .map((p) => [...descendants(p, 'w:t')].map(textOf).join(''))
        .join('\n'),
    };
    const parent = parentId ? threadOf.get(parentId) : undefined;
    if (parent) {
      parent.messages.push(msg);
      threadOf.set(id, parent);
      continue;
    }
    const pos = commentPos.get(id);
    const t: CommentThread = { id: `c${id}`, anchor: `ca${id}`, resolved: ex?.attrs['w15:done'] === '1', deleted: false, messages: [msg] };
    threads.push(t);
    threadOf.set(id, t);
    const story = pos?.story ?? 'body';
    const start = pos?.start ?? pos?.end ?? 0;
    annotations.push({ id: `ca${id}`, type: 'comment', data: { thread: t.id }, start: { story, offset: start }, end: { story, offset: Math.max(start, pos?.end ?? start) } });
  }

  const q: QuireDoc = emptyQuire(blocks);
  Object.assign(q.stories as Record<string, unknown>, stories);
  q.sections = sections;
  if (lists.size) q.settings.lists = Object.fromEntries(lists);
  if (annotations.length) q.annotations = annotations;
  if (threads.length) q.threads = threads;
  // 우리 스타일이 아닌 Word 스타일: 상속을 푼 정의
  for (const [id, ours] of ourStyle) {
    if (STYLE_IDS[ours] || q.styles[ours]) continue;
    const para: Record<string, unknown> = {};
    const marks: Record<string, unknown> = {};
    for (const s of chain(id)) {
      if (s.id === defaultPara) continue;
      paraOf(s.pPr, para);
      marksOf(s.rPr, marks);
    }
    const def: Style = { name: ours, label: styles.get(id)?.name ?? ours, basedOn: 'body' };
    if (Object.keys(clean(para)).length) def.para = para as ParaAttrs;
    if (Object.keys(clean(marks)).length) def.marks = marks as MarkSet;
    q.styles[ours] = def;
  }
  // 기본 문단: 문서 기본값이 우리 기본(12pt, Pretendard, 간격 0·줄 1)과 다르면 본문 스타일로
  const bodyMarks: Record<string, unknown> = {};
  if (baseMarks.size && baseMarks.size !== 12000) bodyMarks.size = baseMarks.size;
  if (typeof baseMarks.font === 'string' && baseMarks.font !== 'Pretendard') bodyMarks.font = baseMarks.font;
  const bodyPara: Record<string, unknown> = {};
  const sp = basePara.space as { before?: number; after?: number } | undefined;
  if (sp && (sp.before || sp.after)) bodyPara.space = sp;
  if (basePara.line) bodyPara.line = basePara.line;
  if (Object.keys(bodyMarks).length || Object.keys(bodyPara).length)
    q.styles.body = { name: 'body', label: '본문', ...(Object.keys(bodyPara).length ? { para: bodyPara } : {}), ...(Object.keys(bodyMarks).length ? { marks: bodyMarks } : {}) };
  addUsedStyles(q);
  finishImport(q, report);
  return { doc: q, assets, report };
}

function fieldKind(instr: string): ObjAttrs['field'] | undefined {
  const w = instr.trim().split(/\s+/)[0]?.toUpperCase();
  if (w === 'PAGE') return 'page';
  if (w === 'NUMPAGES') return 'pages';
  if (w === 'SECTIONPAGES') return 'sectionPages';
  if (w === 'DATE' || w === 'TIME' || w === 'CREATEDATE' || w === 'SAVEDATE') return 'date';
  return undefined;
}

function floatOf(a: XNode): FloatAttrs {
  const ph = kid(a, 'wp:positionH');
  const pv = kid(a, 'wp:positionV');
  const rx = ph?.attrs.relativeFrom ?? 'column';
  const ry = pv?.attrs.relativeFrom ?? 'paragraph';
  const alignH = textOf(kid(ph, 'wp:align') ?? '').trim();
  const f: FloatAttrs = {
    relX: rx === 'page' ? 'page' : rx === 'margin' || rx === 'leftMargin' || rx === 'rightMargin' ? 'margin' : 'column',
    relY: ry === 'page' ? 'page' : ry === 'margin' || ry === 'topMargin' || ry === 'bottomMargin' ? 'margin' : 'paragraph',
    x: alignH ? (alignH === 'center' ? 'center' : alignH === 'right' || alignH === 'outside' ? 'right' : 'left') : fromEmu(textOf(kid(ph, 'wp:posOffset') ?? '0').trim()),
    y: fromEmu(textOf(kid(pv, 'wp:posOffset') ?? '0').trim()),
    wrap: 'none',
  };
  const sq = kid(a, 'wp:wrapSquare') ?? kid(a, 'wp:wrapTight') ?? kid(a, 'wp:wrapThrough');
  if (sq) {
    f.wrap = 'square';
    const wt = sq.attrs.wrapText;
    f.side = wt === 'left' ? 'left' : wt === 'right' ? 'right' : wt === 'largest' ? 'largest' : 'both';
  } else if (kid(a, 'wp:wrapTopAndBottom')) f.wrap = 'topBottom';
  const gap = fromEmu(a.attrs.distL);
  if (gap) f.gap = gap;
  if (a.attrs.behindDoc === '1' || a.attrs.behindDoc === 'true') f.behind = true;
  return f;
}
