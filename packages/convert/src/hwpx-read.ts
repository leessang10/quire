/**
 * HWPX 가져오기 (15 §6.4): OWPML → 정본. header.xml의 글꼴·글자 모양·문단 모양·번호·스타일 표를 풀어, 런·문단의 절대 모양에서
 * 스타일 모양을 뺀 것을 직접 서식으로 둔다. 구역(sectionN.xml마다), 머리말·꼬리말(앞 구역 것을 이어받음), 쪽 번호(autoNum,
 * 쪽 번호 매기기), 표(셀 주소·병합·바탕), 그림(글자처럼·떠 있음), 각주·미주, 링크·메모(댓글), 변경 추적(제안), 형광펜을 읽는다.
 * 담지 못하는 것(도형, 수식, 글상자, OLE 등)은 버리고 보고한다.
 */
import { PAPER_SIZES, defaultListDef, noteStoryId, type CommentThread, type FloatAttrs, type ListDef, type MarkSet, type ObjAttrs, type ParaAttrs, type Style } from '@quire/model';
import { readZip, type QuireDoc, type QuireParagraph, type QuireRun, type QuireTable } from '@quire/sync';
import { Report, finishImport, addAsset, addUsedStyles, emptyQuire, mimeOf, type ImportResult, type ImportedAsset } from './common';
import { BASE_FONT, BASE_SIZE, HWP_NUM, HWP_STYLES, LINE_PERCENT } from './hwpx-write';
import { descendants, kid, kids, parseXml, textOf, type XNode } from './xml';

const u10 = (v: string | undefined) => (v === undefined || v === '' ? 0 : Math.round(Number(v) * 10));
const NUM_BACK: Record<string, ListDef['levels'][0]['format']> = Object.fromEntries(Object.entries(HWP_NUM).map(([k, v]) => [v, k as ListDef['levels'][0]['format']]));
const PALETTE = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#007b83'];
/** 담지 못하는 그리기 개체 */
const SHAPES: Record<string, string> = {
  'hp:rect': '도형', 'hp:ellipse': '도형', 'hp:arc': '도형', 'hp:polygon': '도형', 'hp:curve': '도형', 'hp:line': '도형', 'hp:connectLine': '도형',
  'hp:container': '묶음 개체', 'hp:equation': '수식', 'hp:ole': 'OLE 개체', 'hp:textart': '글맵시', 'hp:video': '동영상', 'hp:chart': '차트', 'hp:compose': '글자 겹치기', 'hp:dutmal': '덧말', 'hp:formObject': '양식 개체',
};

interface ParaShape {
  attrs: Record<string, unknown>;
  heading: { type: string; id: string; level: number };
}

const clean = <T extends Record<string, unknown>>(o: T): T => {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === false) delete o[k];
  return o;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** HWPX → 정본 */
/** 표 열 수·칸 합치기 상한 */
const MAX_TABLE_COLS = 1000;

export async function importHwpx(bytes: Uint8Array): Promise<ImportResult> {
  const report = new Report();
  const assets = new Map<string, ImportedAsset>();
  const entries = await readZip(bytes);
  const files = new Map(entries.map((e) => [e.name.replace(/^\//, ''), e.data]));
  const dec = new TextDecoder();
  const text = (name: string) => {
    const d = files.get(name);
    return d ? dec.decode(d) : undefined;
  };
  // ── 패키지: content.hpf의 목록과 순서 ──
  const containerXml = text('META-INF/container.xml');
  const hpfPath = (containerXml && [...descendants(parseXml(containerXml))].find((n) => /rootfile$/.test(n.name) && /\.hpf$/.test(n.attrs['full-path'] ?? ''))?.attrs['full-path']) || 'Contents/content.hpf';
  const hpf = text(hpfPath) ? parseXml(text(hpfPath)!) : undefined;
  const items = new Map<string, { href: string; type: string }>();
  for (const it of descendants(hpf ?? { name: '', attrs: {}, children: [] })) if (/item$/.test(it.name) && it.attrs.id) items.set(it.attrs.id, { href: it.attrs.href ?? '', type: it.attrs['media-type'] ?? '' });
  const spine = [...descendants(hpf ?? { name: '', attrs: {}, children: [] })].filter((n) => /itemref$/.test(n.name)).map((n) => items.get(n.attrs.idref ?? '')?.href ?? '');
  let sectionPaths = spine.filter((h) => /section\d+\.xml$/i.test(h));
  if (!sectionPaths.length) sectionPaths = [...files.keys()].filter((n) => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  if (!sectionPaths.length) throw new Error('HWPX: 구역 파일(Contents/section0.xml)이 없습니다');
  const headerPath = spine.find((h) => /header\.xml$/i.test(h)) ?? 'Contents/header.xml';
  const head = text(headerPath) ? parseXml(text(headerPath)!) : undefined;
  const refList = kid(head, 'hh:refList');

  // ── 글꼴, 테두리·채우기 ──
  const hangulFonts = new Map<string, string>();
  for (const ff of kids(kid(refList, 'hh:fontfaces'), 'hh:fontface')) if (ff.attrs.lang === 'HANGUL') for (const f of kids(ff, 'hh:font')) hangulFonts.set(f.attrs.id ?? '', f.attrs.face ?? '');
  const fills = new Map<string, string>();
  for (const bf of kids(kid(refList, 'hh:borderFills'), 'hh:borderFill')) {
    const c = [...descendants(bf, 'hc:winBrush')][0]?.attrs.faceColor;
    if (c && /^#[0-9a-f]{6}$/i.test(c) && c.toLowerCase() !== '#ffffff') fills.set(bf.attrs.id ?? '', c.toLowerCase());
  }

  // ── 글자 모양 ──
  const charMarks = new Map<string, Record<string, unknown>>();
  for (const c of kids(kid(refList, 'hh:charProperties'), 'hh:charPr')) {
    const m: Record<string, unknown> = {};
    m.size = Number(c.attrs.height ?? 1000) * 10;
    const color = (c.attrs.textColor ?? '#000000').toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color) && color !== '#000000') m.color = color;
    const shade = (c.attrs.shadeColor ?? 'none').toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(shade) && shade !== '#ffffff') m.highlight = shade;
    else if (fills.has(c.attrs.borderFillIDRef ?? '')) m.highlight = fills.get(c.attrs.borderFillIDRef ?? '');
    if (kid(c, 'hh:bold')) m.bold = true;
    if (kid(c, 'hh:italic')) m.italic = true;
    if ((kid(c, 'hh:underline')?.attrs.type ?? 'NONE') !== 'NONE') m.underline = true;
    if ((kid(c, 'hh:strikeout')?.attrs.shape ?? 'NONE') !== 'NONE') m.strike = true;
    if (kid(c, 'hh:supscript')) m.script = 'sup';
    else if (kid(c, 'hh:subscript')) m.script = 'sub';
    const font = hangulFonts.get(kid(c, 'hh:fontRef')?.attrs.hangul ?? '');
    if (font) m.font = font;
    charMarks.set(c.attrs.id ?? '', m);
  }

  // ── 문단 모양 ──
  const paraShapes = new Map<string, ParaShape>();
  for (const p of kids(kid(refList, 'hh:paraProperties'), 'hh:paraPr')) {
    const a: Record<string, unknown> = {};
    const al = kid(p, 'hh:align')?.attrs.horizontal;
    if (al === 'CENTER') a.align = 'center';
    else if (al === 'RIGHT') a.align = 'right';
    else if (al === 'JUSTIFY' || al === 'DISTRIBUTE' || al === 'DISTRIBUTE_SPACE') a.align = 'justify';
    const sw = kid(p, 'hp:switch');
    const box = kid(sw, 'hp:case') ?? kid(sw, 'hp:default') ?? p;
    const mg = kid(box, 'hh:margin');
    const val = (name: string) => u10(kid(mg, name)?.attrs.value);
    const indent = clean({ left: val('hc:left') || undefined, right: val('hc:right') || undefined, first: val('hc:intent') || undefined });
    if (Object.keys(indent).length) a.indent = indent;
    const before = val('hc:prev');
    const after = val('hc:next');
    if (before || after) a.space = clean({ before: before || undefined, after: after || undefined });
    const ls = kid(box, 'hh:lineSpacing');
    if (ls) {
      const v = Number(ls.attrs.value ?? LINE_PERCENT);
      if (ls.attrs.type === 'PERCENT' || !ls.attrs.type) {
        if (v !== LINE_PERCENT) a.line = { rule: 'multiple', value: Math.round((v / LINE_PERCENT) * 100) / 100 };
      } else a.line = { rule: ls.attrs.type === 'FIXED' ? 'exact' : 'atLeast', value: v * 10 };
    }
    const bs = kid(p, 'hh:breakSetting');
    if (bs?.attrs.keepWithNext === '1') a.keepWithNext = true;
    if (bs?.attrs.keepLines === '1') a.keepTogether = true;
    if (bs?.attrs.pageBreakBefore === '1') a.pageBreakBefore = true;
    const h = kid(p, 'hh:heading');
    paraShapes.set(p.attrs.id ?? '', { attrs: a, heading: { type: h?.attrs.type ?? 'NONE', id: h?.attrs.idRef ?? '0', level: Number(h?.attrs.level ?? 0) } });
  }

  // ── 번호·글머리표 ──
  const numberings = new Map(kids(kid(refList, 'hh:numberings'), 'hh:numbering').map((n) => [n.attrs.id ?? '', n]));
  const bullets = new Map(kids(kid(refList, 'hh:bullets'), 'hh:bullet').map((n) => [n.attrs.id ?? '', n]));
  const lists = new Map<string, ListDef>();
  const listOf = (type: string, id: string): string | null => {
    if (type === 'NUMBER') {
      const key = `h${id}`;
      if (lists.has(key)) return key;
      const n = numberings.get(id);
      if (!n) return null;
      const heads = kids(n, 'hh:paraHead');
      const bullet = heads.filter((h) => textOf(h)).every((h) => !textOf(h).includes('^'));
      const def = defaultListDef(key, bullet ? 'bullet' : 'number');
      for (const h of heads) {
        const lv = def.levels[Number(h.attrs.level ?? 1) - 1];
        if (!lv) continue;
        const t = textOf(h);
        if (bullet) {
          if (t) lv.text = t;
        } else {
          lv.format = NUM_BACK[h.attrs.numFormat ?? 'DIGIT'] ?? 'decimal';
          if (t) lv.text = t.replace(/\^(\d)/g, '%$1');
        }
      }
      lists.set(key, def);
      return key;
    }
    if (type === 'BULLET') {
      const key = `b${id}`;
      if (lists.has(key)) return key;
      const b = bullets.get(id);
      if (!b) return null;
      const def = defaultListDef(key, 'bullet');
      const ch = b.attrs.char;
      if (ch) for (const lv of def.levels) lv.text = ch;
      lists.set(key, def);
      return key;
    }
    return null;
  };

  // ── 스타일 ──
  const styles = new Map(kids(kid(refList, 'hh:styles'), 'hh:style').map((s) => [s.attrs.id ?? '', s]));
  const ourStyle = new Map<string, string>();
  const nameOf = (id: string): string => {
    const known = ourStyle.get(id);
    if (known) return known;
    const s = styles.get(id);
    const nm = (s?.attrs.name ?? '').trim();
    const eng = (s?.attrs.engName ?? '').trim().toLowerCase();
    let ours = Object.entries(HWP_STYLES).find(([, [n, e]]) => n === nm || (e.toLowerCase() === eng && eng !== ''))?.[0];
    if (!ours && (id === '0' || nm === '바탕글' || eng === 'normal')) ours = 'body';
    if (!ours) {
      const h = /^(?:heading|제목)\s*([1-6])$/i.exec(eng || nm);
      ours = h ? `h${h[1]}` : (nm || `style${id}`).replace(/[\s|]/g, '');
    }
    ourStyle.set(id, ours);
    return ours;
  };
  const styleShape = (id: string) => {
    const s = styles.get(id);
    return { para: paraShapes.get(s?.attrs.paraPrIDRef ?? '')?.attrs ?? {}, marks: charMarks.get(s?.attrs.charPrIDRef ?? '') ?? {} };
  };
  const bodyShape = styleShape([...styles.values()].find((s) => s.attrs.type !== 'CHAR')?.attrs.id ?? '0');
  const baseSize = (bodyShape.marks.size as number | undefined) ?? BASE_SIZE;
  const baseFont = (bodyShape.marks.font as string | undefined) ?? BASE_FONT;

  // ── 변경 추적 ──
  const tcAuthors = new Map(kids(kid(refList, 'hh:trackChangeAuthors'), 'hh:trackChangeAuthor').map((a) => [a.attrs.id ?? '', a.attrs.name ?? '']));
  const tcs = new Map(kids(kid(refList, 'hh:trackChanges'), 'hh:trackChange').map((t) => [t.attrs.id ?? '', t]));

  // ── 읽기 ──
  const stories: Record<string, unknown> = {};
  const annotations: Array<Record<string, unknown>> = [];
  const memos: Array<{ story: string; start: number; end: number; author: string; time: number; text: string }> = [];
  let tableSeq = 0;
  let imgSeq = 0;
  let noteSeq = 0;
  const pendingImages: Array<{ run: QuireRun; ref: string; alt: string }> = [];
  const authorOf = (name: string) => {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
    return { id: `hwpx:${name || '?'}`, name: name || '이름 없음', color: PALETTE[h % PALETTE.length]! };
  };

  interface Ctx {
    story: string;
    offset: number;
  }
  /** 구역 읽기 상태 (구역 정의, 머리말·꼬리말, 쪽 번호 형식) */
  let sec: { props: Record<string, unknown>; hf: Array<{ part: 'header' | 'footer'; apply: string; node: XNode }>; pageNum?: XNode; numFormat?: string; colSeen?: boolean } | null = null;
  /** 문단 중간의 단 정의: 그 문단부터 이어지는 구역 (다단 설정 또는 null = 한 단) */
  const colStarts = new Map<QuireParagraph, Record<string, unknown> | null>();

  const readBlocks = (nodes: XNode[], ctx: Ctx): Array<QuireParagraph | QuireTable> => {
    const out: Array<QuireParagraph | QuireTable> = [];
    for (const n of nodes) if (n.name === 'hp:p') out.push(...readPara(n, ctx));
    return out;
  };

  const readPara = (p: XNode, ctx: Ctx): Array<QuireParagraph | QuireTable> => {
    const shape = paraShapes.get(p.attrs.paraPrIDRef ?? '') ?? { attrs: {}, heading: { type: 'NONE', id: '0', level: 0 } };
    const sid = p.attrs.styleIDRef ?? '0';
    const style = nameOf(sid);
    const st = styleShape(sid);
    // 직접 속성 = 문단 모양 − 스타일 모양
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(shape.attrs)) if (!same(v, st.para[k])) attrs[k] = v;
    if (style !== 'body') attrs.style = style;
    const listId = listOf(shape.heading.type, shape.heading.id);
    if (listId) {
      attrs.list = { id: listId, level: shape.heading.level };
      // 번호 문단의 들여쓰기가 목록 정의에서 나온 것이면 뺀다
      const lv = lists.get(listId)!.levels[shape.heading.level];
      const ind = attrs.indent as { left?: number; first?: number; right?: number } | undefined;
      if (lv && ind && !ind.right && Math.abs((ind.left ?? 0) - (lv.indent - lv.hanging)) <= 10 && Math.abs((ind.first ?? 0) + lv.hanging) <= 10) delete attrs.indent;
    }
    if (p.attrs.pageBreak === '1') attrs.pageBreakBefore = true;
    if (p.attrs.columnBreak === '1') attrs.columnBreakBefore = true;
    const out: Array<QuireParagraph | QuireTable> = [];
    let cur: QuireParagraph = { p: { ...attrs }, c: [] };
    out.push(cur);
    const split = () => {
      ctx.offset++;
      cur = { p: { ...attrs }, c: [] };
      delete cur.p.pageBreakBefore;
      delete cur.p.columnBreakBefore;
      out.push(cur);
    };
    const pushText = (t: string, m: Record<string, unknown>) => {
      if (!t) return;
      const mm = clean({ ...m }) as MarkSet;
      const last = cur.c[cur.c.length - 1];
      if (last && last.t !== undefined && same(last.m ?? {}, mm)) last.t += t;
      else cur.c.push({ t, ...(Object.keys(mm).length ? { m: mm } : {}) });
      ctx.offset += Array.from(t).length;
    };
    const pushObj = (o: ObjAttrs, m?: Record<string, unknown>): QuireRun => {
      const mm = m ? (clean({ ...m }) as MarkSet) : {};
      const run: QuireRun = { img: o, ...(Object.keys(mm).length ? { m: mm } : {}) };
      cur.c.push(run);
      ctx.offset++;
      return run;
    };
    let link: string | undefined;
    const fields = new Map<string, { type: string; start: number; story: string; author?: string; time?: number; text?: string }>();
    const revs = new Map<string, { kind: 'insert' | 'delete'; start: number }>();
    let markpen: string | undefined;

    for (const run of kids(p, 'hp:run')) {
      const base = charMarks.get(run.attrs.charPrIDRef ?? '') ?? {};
      const m: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(base)) if (!same(v, st.marks[k])) m[k] = v;
      if (m.size === baseSize && st.marks.size === undefined) delete m.size;
      if (m.font === baseFont && st.marks.font === undefined) delete m.font;
      const marks = () => ({ ...m, ...(link ? { link } : {}), ...(markpen ? { highlight: markpen } : {}) });
      for (const c of kids(run)) {
        switch (c.name) {
          case 'hp:secPr':
            if (sec && ctx.story === 'body') sec.props = sectionProps(c);
            break;
          case 'hp:ctrl':
            for (const k of kids(c)) ctrl(k);
            break;
          case 'hp:t':
            for (const t of c.children) {
              if (typeof t === 'string') {
                pushText(t, marks());
                continue;
              }
              switch (t.name) {
                case 'hp:tab':
                  pushText('\t', marks());
                  break;
                case 'hp:lineBreak':
                  split();
                  break;
                case 'hp:nbSpace':
                  pushText(' ', marks());
                  break;
                case 'hp:fwSpace':
                  pushText('　', marks());
                  break;
                case 'hp:hyphen':
                  pushText('-', marks());
                  break;
                case 'hp:markpenBegin':
                  markpen = (t.attrs.color ?? '#ffff00').toLowerCase();
                  break;
                case 'hp:markpenEnd':
                  markpen = undefined;
                  break;
                case 'hp:insertBegin':
                case 'hp:deleteBegin':
                  revs.set(t.attrs.Id ?? t.attrs.id ?? '', { kind: t.name === 'hp:insertBegin' ? 'insert' : 'delete', start: ctx.offset });
                  break;
                case 'hp:insertEnd':
                case 'hp:deleteEnd': {
                  const id = t.attrs.Id ?? t.attrs.id ?? '';
                  const r = revs.get(id);
                  revs.delete(id);
                  const tc = tcs.get(t.attrs.TcId ?? id);
                  if (r && ctx.offset > r.start) addRev(r.kind, tcAuthors.get(tc?.attrs.authorID ?? '') ?? '', Date.parse(tc?.attrs.date ?? '') || 0, ctx.story, r.start, ctx.offset);
                  break;
                }
                default:
                  break;
              }
            }
            break;
          case 'hp:tbl':
            if (ctx.story === 'body') {
              // 표는 제 문단: 앞 글 문단, 표 블록, 뒤 글 문단
              const hadText = cur.c.length > 0;
              if (hadText) ctx.offset++;
              else out.pop();
              out.push(readTable(c, ctx));
              ctx.offset += 2;
              cur = { p: { ...attrs }, c: [] };
              delete cur.p.pageBreakBefore;
              delete cur.p.columnBreakBefore;
              out.push(cur);
              (cur as { tail?: boolean } & QuireParagraph).tail = true;
            } else {
              report.drop(ctx.story.includes('.r') ? '표 안의 표' : '본문 밖의 표');
              for (const tc of descendants(c, 'hp:tc')) for (const b of readBlocks(kids(kid(tc, 'hp:subList')), ctx)) if (!('table' in b)) out.push(b);
            }
            break;
          case 'hp:pic':
            picture(c, marks());
            break;
          default:
            if (SHAPES[c.name]) report.drop(SHAPES[c.name]!);
            break;
        }
      }
    }
    // 표 뒤에 남은 빈 꼬리 문단은 버린다
    const last = out[out.length - 1] as QuireParagraph & { tail?: boolean };
    if (last && 'c' in last && last.tail) {
      delete last.tail;
      if (!last.c.length) out.pop();
    }
    ctx.offset++; // ¶
    // 표만 있던 문단: 오프셋은 표 블록이 셌다
    if (out.length && 'table' in out[out.length - 1]!) ctx.offset--;
    return out;

    function ctrl(k: XNode) {
      switch (k.name) {
        case 'hp:colPr':
          if (sec && ctx.story === 'body') {
            const n = Number(k.attrs.colCount ?? 1);
            const columns = n > 1 ? { count: n, gap: u10(k.attrs.sameGap), ...(kid(k, 'hp:colLine') && kid(k, 'hp:colLine')!.attrs.type !== 'NONE' ? { separator: true } : {}) } : null;
            // 구역 첫 단 정의는 구역의 다단, 그 뒤의 단 정의는 이어지는 구역의 시작
            if (!sec.colSeen) {
              sec.colSeen = true;
              if (columns) sec.props.columns = columns;
            } else colStarts.set(cur, columns);
          }
          break;
        case 'hp:header':
        case 'hp:footer':
          if (sec) sec.hf.push({ part: k.name === 'hp:header' ? 'header' : 'footer', apply: k.attrs.applyPageType ?? 'BOTH', node: k });
          break;
        case 'hp:pageNum':
          if (sec) sec.pageNum = k;
          break;
        case 'hp:autoNum':
        case 'hp:newNum': {
          const t = k.attrs.numType;
          const fmt = kid(k, 'hp:autoNumFormat')?.attrs.type;
          if (sec && t === 'PAGE' && fmt) sec.numFormat ??= fmt;
          if (t === 'PAGE') pushObj({ kind: 'field', field: 'page' });
          else if (t === 'TOTAL_PAGE') pushObj({ kind: 'field', field: 'pages' });
          break;
        }
        case 'hp:footNote':
        case 'hp:endNote': {
          const id = `n${++noteSeq}`;
          const sid2 = noteStoryId(id);
          const blocks = readBlocks(kids(kid(k, 'hp:subList')), { story: sid2, offset: 0 });
          const first = blocks[0] as QuireParagraph | undefined;
          const t0 = first?.c?.[0];
          if (t0?.t) {
            t0.t = t0.t.replace(/^\s+/, '');
            if (!t0.t) first!.c.shift();
          }
          stories[sid2] = blocks;
          pushObj({ id, kind: 'note' });
          break;
        }
        case 'hp:fieldBegin': {
          const params = new Map(kids(kid(k, 'hp:parameters')).map((pp) => [pp.attrs.name ?? '', textOf(pp)]));
          const type = k.attrs.type ?? '';
          const f: { type: string; start: number; story: string; author?: string; time?: number; text?: string } = { type, start: ctx.offset, story: ctx.story };
          if (type === 'HYPERLINK') {
            const url = params.get('Path') || (params.get('Command') ?? '').split(/(?<!\\);/)[0]!.replace(/\\(.)/g, '$1');
            if (url) link = url;
          } else if (type === 'MEMO') {
            f.author = params.get('Author') ?? '';
            // 시각: Command의 FILETIME을 먼저 (한글의 CreateDateTime은 현지 시각에 Z를 붙인 값이다)
            const cmd = /^MEMO\/\d+\/\d+\/(\d+)\/(\d+)\//.exec(params.get('Command') ?? '');
            const ft = cmd ? BigInt(cmd[2]!) * 4294967296n + BigInt(cmd[1]!) : 0n;
            f.time = ft > 0n ? Number(ft / 10000n) - 11644473600000 : Date.parse(params.get('CreateDateTime') ?? '') || 0;
            f.text = kids(kid(k, 'hp:subList'), 'hp:p')
              .map((pp) => [...descendants(pp, 'hp:t')].map(textOf).join(''))
              .join('\n');
          }
          fields.set(k.attrs.id ?? '', f);
          break;
        }
        case 'hp:fieldEnd': {
          const f = fields.get(k.attrs.beginIDRef ?? '');
          if (!f) break;
          fields.delete(k.attrs.beginIDRef ?? '');
          if (f.type === 'HYPERLINK') link = undefined;
          else if (f.type === 'MEMO') memos.push({ story: f.story, start: f.start, end: ctx.offset, author: f.author ?? '', time: f.time ?? 0, text: f.text ?? '' });
          break;
        }
        default:
          if (SHAPES[k.name]) report.drop(SHAPES[k.name]!);
          break;
      }
    }

    function picture(c: XNode, mk: Record<string, unknown>) {
      const img = [...descendants(c, 'hc:img')][0];
      const ref = img?.attrs.binaryItemIDRef ?? '';
      const sz = kid(c, 'hp:sz');
      const comment = textOf(kid(c, 'hp:shapeComment') ?? '').trim();
      const alt = /^그림입니다\./.test(comment) ? '' : comment;
      const o: ObjAttrs = { id: `img${++imgSeq}`, kind: 'image', w: u10(sz?.attrs.width), h: u10(sz?.attrs.height), ...(alt ? { alt } : {}) };
      const pos = kid(c, 'hp:pos');
      if (pos?.attrs.treatAsChar !== '1') o.float = floatOf(c, pos);
      const run = pushObj(o, mk.link ? { link: mk.link } : undefined);
      pendingImages.push({ run, ref, alt });
    }
  };

  const addRev = (kind: 'insert' | 'delete', name: string, time: number, story: string, start: number, end: number) => {
    const prev = annotations[annotations.length - 1] as { type?: string; data?: { kind?: string; author?: { name?: string }; time?: number }; end?: { story: string; offset: number } } | undefined;
    const author = authorOf(name);
    if (prev?.type === 'suggestion' && prev.data?.kind === kind && prev.data.author?.name === author.name && prev.data.time === time && prev.end?.story === story && prev.end.offset >= start - 1) {
      prev.end.offset = end;
      return;
    }
    annotations.push({ id: `s${annotations.length + 1}`, type: 'suggestion', data: { kind, author, time }, start: { story, offset: start }, end: { story, offset: end } });
  };

  const readTable = (tbl: XNode, ctx: Ctx): QuireTable => {
    const tk = ++tableSeq;
    // 망가진 값이 배열·칸을 수억 개 만들지 않게 (16 §6)
    const colCnt = Math.min(MAX_TABLE_COLS, Math.max(1, Math.floor(Number(tbl.attrs.colCnt ?? 1)) || 1));
    const rowCnt = kids(tbl, 'hp:tr').length;
    const widths: number[] = Array.from({ length: colCnt }, () => 0);
    const rows: QuireTable['table']['rows'] = [];
    kids(tbl, 'hp:tr').forEach((tr, y) => {
      const row: QuireTable['table']['rows'][0] = { cells: [] };
      const cells = kids(tr, 'hp:tc')
        .map((tc) => ({ tc, x: Number(kid(tc, 'hp:cellAddr')?.attrs.colAddr ?? 0), y: Number(kid(tc, 'hp:cellAddr')?.attrs.rowAddr ?? y) }))
        .sort((a, b) => a.x - b.x);
      for (const { tc, x } of cells) {
        const span = kid(tc, 'hp:cellSpan');
        const cs = Math.min(colCnt, Math.max(1, Math.floor(Number(span?.attrs.colSpan ?? 1)) || 1));
        const rs = Math.min(Math.max(1, rowCnt - y), Math.max(1, Math.floor(Number(span?.attrs.rowSpan ?? 1)) || 1));
        const w = u10(kid(tc, 'hp:cellSz')?.attrs.width);
        if (cs === 1 && x < colCnt && w) widths[x] = w;
        const name = `t${tk}.r${y + 1}c${x + 1}`;
        const sub = kid(tc, 'hp:subList');
        stories[name] = readBlocks(kids(sub), { story: name, offset: 0 });
        const cell: QuireTable['table']['rows'][0]['cells'][0] = { story: name };
        if (cs > 1 || rs > 1) cell.span = [rs, cs];
        const fill = fills.get(tc.attrs.borderFillIDRef ?? '');
        if (fill) cell.fill = fill;
        const va = sub?.attrs.vertAlign;
        if (va === 'CENTER' || va === 'BOTTOM') cell.valign = va === 'CENTER' ? 'middle' : 'bottom';
        if (tc.attrs.header === '1') row.header = true;
        row.cells.push(cell);
        const h = u10(kid(tc, 'hp:cellSz')?.attrs.height);
        if (rs === 1 && h > 2820) row.h = Math.max(row.h ?? 0, h);
      }
      rows.push(row);
    });
    // 너비를 모르는 열: 전체 너비를 나눈다
    const total = u10(kid(tbl, 'hp:sz')?.attrs.width) || 451000;
    const known = widths.reduce((s, v) => s + v, 0);
    const unknown = widths.filter((v) => !v).length;
    for (let i = 0; i < widths.length; i++) if (!widths[i]) widths[i] = Math.max(10000, Math.round((total - known) / Math.max(1, unknown)));
    void ctx;
    return { table: { cols: widths, rows } };
  };

  /** secPr → 구역 설정 */
  const sectionProps = (s: XNode): Record<string, unknown> => {
    const pg = kid(s, 'hp:pagePr');
    const mar = kid(pg, 'hp:margin');
    let w = u10(pg?.attrs.width) || 595276;
    let h = u10(pg?.attrs.height) || 841890;
    if (pg?.attrs.landscape === 'NARROWLY') [w, h] = [Math.max(w, h), Math.min(w, h)];
    for (const [pw, ph] of Object.values(PAPER_SIZES))
      for (const [a, b] of [
        [pw, ph],
        [ph, pw],
      ] as const)
        if (Math.abs(w - a) <= 10 && Math.abs(h - b) <= 10) [w, h] = [a, b];
    const e: Record<string, unknown> = { page: { width: w, height: h, margin: [u10(mar?.attrs.top), u10(mar?.attrs.right), u10(mar?.attrs.bottom), u10(mar?.attrs.left)] } };
    const startOn = kid(s, 'hp:startNum')?.attrs.pageStartsOn;
    e.start = startOn === 'ODD' ? 'oddPage' : startOn === 'EVEN' ? 'evenPage' : 'nextPage';
    const startPage = Number(kid(s, 'hp:startNum')?.attrs.page ?? 0);
    if (startPage > 0) e.pageNumber = { start: startPage };
    const hd = u10(mar?.attrs.header);
    const fd = u10(mar?.attrs.footer);
    if (mar?.attrs.header !== undefined && hd !== 36000) e.headerDistance = hd;
    if (mar?.attrs.footer !== undefined && fd !== 36000) e.footerDistance = fd;
    const vis = kid(s, 'hp:visibility');
    if (vis?.attrs.hideFirstHeader === '1' || vis?.attrs.hideFirstFooter === '1') e.titlePage = true;
    return e;
  };

  // ── 구역들 ──
  const body: Array<QuireParagraph | QuireTable> = [];
  const sections: Array<Record<string, unknown>> = [];
  const ctx: Ctx = { story: 'body', offset: 0 };
  const inherited = new Map<string, string | null>();
  sectionPaths.forEach((sp, k) => {
    const xml = text(sp.replace(/^\//, ''));
    if (!xml) return;
    const id = k === sectionPaths.length - 1 ? (k === 0 ? 's1' : 'last') : `s${k + 1}`;
    sec = { props: {}, hf: [] };
    const blocks = readBlocks(kids(parseXml(xml)), ctx);
    const e: Record<string, unknown> = { id, ...sec.props };
    // 머리말·꼬리말: 이 구역에서 정의한 것, 없으면 앞 구역 것 (빈 것은 "없음")
    let oddEven = false;
    for (const h of sec.hf) {
      const kind = h.apply === 'EVEN' ? 'even' : 'default';
      if (h.apply === 'EVEN' || h.apply === 'ODD') oddEven = true;
      const storyId = `${h.part === 'header' ? 'hdr' : 'ftr'}|${id}|${kind}`;
      const blocks2 = readBlocks(kids(kid(h.node, 'hp:subList')), { story: storyId, offset: 0 });
      const empty = blocks2.every((b) => 'c' in b && !b.c.length);
      if (empty) inherited.set(`${h.part}.${kind}`, null);
      else {
        stories[storyId] = blocks2;
        inherited.set(`${h.part}.${kind}`, storyId);
      }
    }
    // 쪽 번호 매기기 (머리말·꼬리말이 없으면 그 자리에 쪽 번호 필드)
    const pn = sec.pageNum;
    if (pn && pn.attrs.pos && pn.attrs.pos !== 'NONE') {
      const part = pn.attrs.pos.startsWith('TOP') ? 'header' : 'footer';
      if (!inherited.get(`${part}.default`)) {
        const storyId = `${part === 'header' ? 'hdr' : 'ftr'}|${id}|default`;
        const align = /CENTER/.test(pn.attrs.pos) ? 'center' : /RIGHT|OUTSIDE/.test(pn.attrs.pos) ? 'right' : undefined;
        const fmt = pn.attrs.formatType;
        if (fmt === 'ROMAN_CAPITAL' || fmt === 'ROMAN_SMALL') e.pageNumber = { ...((e.pageNumber as object) ?? {}), format: 'roman' };
        stories[storyId] = [{ p: align ? { align } : {}, c: [{ img: { kind: 'field', field: 'page' } }] }];
        inherited.set(`${part}.default`, storyId);
      }
    }
    for (const [key, sid] of inherited) {
      if (!sid) continue;
      const [part, kind] = key.split('.') as ['header' | 'footer', string];
      e[part] = { ...((e[part] as object) ?? {}), [kind]: sid };
    }
    if (oddEven) e.oddEven = true;
    // 쪽 번호 형식: 머리말·꼬리말의 쪽 번호 모양
    if (sec.numFormat === 'ROMAN_CAPITAL' || sec.numFormat === 'ROMAN_SMALL') e.pageNumber = { ...((e.pageNumber as object) ?? {}), format: 'roman' };
    else if (sec.numFormat === 'HANGUL_SYLLABLE') e.pageNumber = { ...((e.pageNumber as object) ?? {}), format: 'hangul' };
    // 이어지는 구역 (문단 중간의 단 정의)으로 나눈다
    const chunks: Array<{ blocks: Array<QuireParagraph | QuireTable>; e: Record<string, unknown> }> = [{ blocks: [], e }];
    for (const b of blocks) {
      if ('c' in b && colStarts.has(b) && chunks[chunks.length - 1]!.blocks.length) {
        const prev = chunks[chunks.length - 1]!;
        const cols = colStarts.get(b);
        const next: Record<string, unknown> = { ...prev.e, start: 'continuous' };
        delete next.columns;
        delete next.titlePage;
        if (cols) next.columns = cols;
        chunks.push({ blocks: [], e: next });
      }
      chunks[chunks.length - 1]!.blocks.push(b);
    }
    chunks.forEach((ch, j) => {
      const lastChunk = k === sectionPaths.length - 1 && j === chunks.length - 1;
      const cid = lastChunk ? id : j === chunks.length - 1 ? id : `${id}c${j + 1}`;
      ch.e.id = cid;
      if (!lastChunk) {
        const lastPara = [...ch.blocks].reverse().find((b): b is QuireParagraph => 'c' in b);
        if (lastPara) lastPara.p.section = cid;
        else {
          ch.blocks.push({ p: { section: cid }, c: [] });
          ctx.offset++;
        }
      }
      body.push(...ch.blocks);
      sections.push(ch.e);
    });
  });

  // ── 그림 ──
  for (const pi of pendingImages) {
    const img = pi.run.img!;
    const it = items.get(pi.ref);
    const data = it ? files.get(it.href.replace(/^\//, '')) : undefined;
    if (!data) {
      report.drop('이미지 (파일 없음)');
      delete pi.run.img;
      pi.run.t = pi.alt;
      continue;
    }
    const { id } = await addAsset(assets, { bytes: data, type: it?.type?.startsWith('image/') ? it.type : mimeOf(data) }, img.w, img.h);
    img.asset = id;
  }

  // ── 메모 → 스레드 (같은 범위에 이어진 메모는 답글) ──
  const threads: CommentThread[] = [];
  let lastMemo: (typeof memos)[0] | null = null;
  for (const [i, mm] of memos.entries()) {
    const msg = { id: `m${i + 1}`, author: authorOf(mm.author), time: mm.time, text: mm.text };
    if (lastMemo && lastMemo.story === mm.story && lastMemo.start === mm.start && lastMemo.end === mm.end) {
      threads[threads.length - 1]!.messages.push(msg);
      continue;
    }
    lastMemo = mm;
    const t: CommentThread = { id: `c${threads.length + 1}`, anchor: `ca${threads.length + 1}`, resolved: false, deleted: false, messages: [msg] };
    threads.push(t);
    annotations.push({ id: t.anchor, type: 'comment', data: { thread: t.id }, start: { story: mm.story, offset: mm.start }, end: { story: mm.story, offset: mm.end } });
  }

  const q: QuireDoc = emptyQuire(body);
  Object.assign(q.stories as Record<string, unknown>, stories);
  q.sections = sections;
  if (lists.size) q.settings.lists = Object.fromEntries(lists);
  if (annotations.length) q.annotations = annotations;
  if (threads.length) q.threads = threads;
  // 우리 스타일이 아닌 한글 스타일: 그 모양에서 바탕글 모양을 뺀 정의
  for (const [id, ours] of ourStyle) {
    if (HWP_STYLES[ours] || q.styles[ours]) continue;
    const s = styleShape(id);
    const para: Record<string, unknown> = {};
    const marks: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.para)) if (!same(v, bodyShape.para[k])) para[k] = v;
    for (const [k, v] of Object.entries(s.marks)) if (!same(v, bodyShape.marks[k])) marks[k] = v;
    const def: Style = { name: ours, label: styles.get(id)?.attrs.name ?? ours, basedOn: 'body' };
    if (Object.keys(para).length) def.para = para as ParaAttrs;
    if (Object.keys(marks).length) def.marks = marks as MarkSet;
    q.styles[ours] = def;
  }
  // 바탕글 모양이 우리 기본(12pt, Pretendard, 줄 1, 간격 0)과 다르면 본문 스타일로
  const bodyMarks: Record<string, unknown> = {};
  if (baseSize !== BASE_SIZE) bodyMarks.size = baseSize;
  if (baseFont !== BASE_FONT) bodyMarks.font = baseFont;
  const bodyPara: Record<string, unknown> = {};
  for (const k of ['line', 'space', 'align', 'indent']) if (bodyShape.para[k] !== undefined) bodyPara[k] = bodyShape.para[k];
  if (Object.keys(bodyMarks).length || Object.keys(bodyPara).length)
    q.styles.body = { name: 'body', label: '본문', ...(Object.keys(bodyPara).length ? { para: bodyPara } : {}), ...(Object.keys(bodyMarks).length ? { marks: bodyMarks } : {}) };
  addUsedStyles(q);
  finishImport(q, report);
  return { doc: q, assets, report };
}

function floatOf(c: XNode, pos: XNode | undefined): FloatAttrs {
  const hr = pos?.attrs.horzRelTo ?? 'COLUMN';
  const vr = pos?.attrs.vertRelTo ?? 'PARA';
  const ha = pos?.attrs.horzAlign ?? 'LEFT';
  const f: FloatAttrs = {
    relX: hr === 'PAPER' ? 'page' : hr === 'PAGE' ? 'margin' : 'column',
    relY: vr === 'PAPER' ? 'page' : vr === 'PAGE' ? 'margin' : 'paragraph',
    x: ha === 'CENTER' ? 'center' : ha === 'RIGHT' || ha === 'OUTSIDE' ? 'right' : u10(pos?.attrs.horzOffset),
    y: u10(pos?.attrs.vertOffset),
    wrap: 'none',
  };
  const wrap = c.attrs.textWrap ?? 'TOP_AND_BOTTOM';
  if (wrap === 'SQUARE' || wrap === 'TIGHT' || wrap === 'THROUGH') {
    f.wrap = 'square';
    const flow = c.attrs.textFlow ?? 'BOTH_SIDES';
    f.side = flow === 'LEFT_ONLY' ? 'left' : flow === 'RIGHT_ONLY' ? 'right' : flow === 'LARGEST_ONLY' ? 'largest' : 'both';
  } else if (wrap === 'TOP_AND_BOTTOM') f.wrap = 'topBottom';
  else if (wrap === 'BEHIND_TEXT') f.behind = true;
  const gap = u10(kid(c, 'hp:outMargin')?.attrs.left);
  if (gap) f.gap = gap;
  return f;
}
