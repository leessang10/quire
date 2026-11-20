/**
 * HWPX 내보내기 (15 §6.4, OWPML / KS X 6101): 정본 → zip(mimetype, version.xml, Contents/content.hpf, header.xml,
 * section0..n.xml, BinData, settings.xml, META-INF). 구조는 한글 2024가 쓴 파일을 따랐다.
 *
 * - 글자·문단 모양은 ID로 참조하므로 서식 조합을 모아 표(charPr·paraPr)를 만든다. 런·문단의 모양은 스타일 모양을 합친 절대값이다.
 * - 구역마다 sectionN.xml, 그 첫 문단 첫 런에 secPr(용지·여백·쪽 번호 시작), colPr(다단), 머리말·꼬리말.
 * - 표는 그 문단의 런에 hp:tbl (셀 주소·병합·크기), 그림은 hp:pic (글자처럼 또는 떠 있음) + BinData.
 * - 각주는 hp:footNote, 링크는 HYPERLINK 필드, 댓글은 메모(MEMO 필드: 메시지마다 하나, 같은 범위), 쪽 번호는 hp:autoNum.
 * - 제안(삽입·삭제)은 hp:t 안의 insertBegin·deleteBegin과 header의 trackChanges.
 * 단위: HWPUNIT = 1/100 pt (정본 1/1000pt ÷ 10). 글자 크기 height = pt × 100.
 */
import { DEFAULT_STYLES, LAST_SECTION, fullSection, noteStoryId, type CommentThread, type ListDef, type MarkSet, type ObjAttrs, type ParaAttrs, type SectionProps, type Style } from '@quire/model';
import { writeZip, type QuireDoc, type QuireParagraph, type QuireTable } from '@quire/sync';
import { EXTRA_STYLES, mimeOf, tableGrid, type AssetReader } from './common';
import { XML_HEAD, escXml, x } from './xml';

export const hu = (v: number) => Math.round(v / 10);
const isTable = (b: QuireParagraph | QuireTable): b is QuireTable => 'table' in b;
const cps = (s: string) => Array.from(s);

export const HWPX_NS =
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';

/** 우리 스타일 → 한글 스타일 이름 (이름, 영문 이름) */
export const HWP_STYLES: Record<string, [string, string]> = {
  body: ['바탕글', 'Normal'],
  h1: ['제목 1', 'heading 1'],
  h2: ['제목 2', 'heading 2'],
  h3: ['제목 3', 'heading 3'],
  h4: ['제목 4', 'heading 4'],
  h5: ['제목 5', 'heading 5'],
  h6: ['제목 6', 'heading 6'],
  quote: ['인용', 'Quote'],
  code: ['코드', 'Code'],
  listParagraph: ['목록 문단', 'List Paragraph'],
};

/** 번호 형식: 우리 → 한글 */
export const HWP_NUM: Record<string, string> = {
  decimal: 'DIGIT', hangul: 'HANGUL_SYLLABLE', hangulJamo: 'HANGUL_JAMO', circled: 'CIRCLED_DIGIT',
  lowerAlpha: 'LATIN_SMALL', upperAlpha: 'LATIN_CAPITAL', lowerRoman: 'ROMAN_SMALL', upperRoman: 'ROMAN_CAPITAL',
};

const LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];
const SEVEN = (v: string | number) => Object.fromEntries(['hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user'].map((k) => [k, v]));
export const BASE_FONT = 'Pretendard';
export const BASE_SIZE = 12000;
/** 한글의 줄 간격 %는 글자 크기 기준이다. 우리 한 줄은 글자 크기의 1.7배 (레이아웃 lineHeight) */
export const LINE_PERCENT = 170;

/** 모양 표: 같은 값이면 같은 ID */
class Table<T> {
  readonly items: string[] = [];
  private readonly ids = new Map<string, number>();
  constructor(private readonly render: (v: T, id: number) => string) {}
  id(v: T): number {
    const key = JSON.stringify(v);
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.items.length;
      this.ids.set(key, id);
      this.items.push(this.render(v, id));
    }
    return id;
  }
}

interface StoryAnn {
  from: number;
  to: number;
  kind: 'comment' | 'insert' | 'delete';
  /** 메모: 메시지마다 */
  memos?: Array<{ n: number; author: string; time: string; ft: string; text: string }>;
  tc?: number;
}

/** 메모 시각: Command의 FILETIME (1601년부터 100ns, 하위/상위 32비트). 한글은 이것을 시각으로 쓴다 */
export function fileTime(t: unknown): string {
  const ms = typeof t === 'number' && t > 0 ? t : 0;
  const ft = (BigInt(Math.round(ms)) + 11644473600000n) * 10000n;
  return `${ft & 0xffffffffn}/${ft >> 32n}`;
}

const isoDate = (t: unknown) => new Date(typeof t === 'number' && t > 0 ? t : 0).toISOString().replace(/\.\d+Z$/, 'Z');

export interface HwpxExportOptions {
  asset?: AssetReader;
  title?: string;
}

/** 정본 → HWPX 바이트 */
export async function exportHwpx(q: QuireDoc, opts: HwpxExportOptions = {}): Promise<Uint8Array> {
  const lists = (q.settings.lists ?? {}) as Record<string, ListDef>;
  const story = (name: string) => (Array.isArray(q.stories[name]) ? (q.stories[name] as Array<QuireParagraph | QuireTable>) : []);
  const enc = new TextEncoder();

  // ── 스타일 정의 (기본 + 정본 + 쓰인 덧붙인 스타일) ──
  const styleDefs = new Map<string, Style>();
  for (const st of DEFAULT_STYLES) styleDefs.set(st.name, st);
  for (const [name, def] of Object.entries(q.styles ?? {})) if (def && typeof def === 'object') styleDefs.set(name, { ...(def as Style), name });
  for (const v of Object.values(q.stories))
    if (Array.isArray(v)) for (const b of v as QuireParagraph[]) if (typeof b.p?.style === 'string' && !styleDefs.has(b.p.style) && EXTRA_STYLES[b.p.style]) styleDefs.set(b.p.style, EXTRA_STYLES[b.p.style]!);
  /** 스타일 사슬을 푼 글자 서식·문단 속성 */
  const resolved = (name: string | undefined): { marks: MarkSet; para: ParaAttrs } => {
    const chain: Style[] = [];
    const seen = new Set<string>();
    let n: string | undefined = name ?? 'body';
    while (n && styleDefs.has(n) && !seen.has(n)) {
      seen.add(n);
      chain.unshift(styleDefs.get(n)!);
      n = styleDefs.get(n)!.basedOn;
    }
    if (name !== 'body' && styleDefs.has('body') && !seen.has('body')) chain.unshift(styleDefs.get('body')!);
    const marks: Record<string, unknown> = {};
    const para: Record<string, unknown> = {};
    for (const s of chain) {
      Object.assign(marks, s.marks ?? {});
      Object.assign(para, s.para ?? {});
    }
    return { marks: marks as MarkSet, para: para as ParaAttrs };
  };

  // ── 글꼴 ──
  const fonts: string[] = [BASE_FONT];
  const fontId = (f: string | undefined) => {
    const face = f ?? BASE_FONT;
    let i = fonts.indexOf(face);
    if (i < 0) i = fonts.push(face) - 1;
    return i;
  };

  // ── 테두리·채우기: 1 없음, 2 글자용 없음, 3 표 칸 테두리, 4.. 칸 바탕 ──
  const fills = new Map<string, number>();
  const borderFill = (id: number, border: boolean, fill: string | null) =>
    x(
      'hh:borderFill',
      { id, threeD: 0, shadow: 0, centerLine: 'NONE', breakCellSeparateLine: 0 },
      '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>',
      ...['left', 'right', 'top', 'bottom'].map((e) => x(`hh:${e}Border`, { type: border ? 'SOLID' : 'NONE', width: border ? '0.12 mm' : '0.1 mm', color: border ? '#8E8E93' : '#000000' })),
      '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>',
      fill ? `<hc:fillBrush>${x('hc:winBrush', { faceColor: fill.toUpperCase(), hatchColor: '#000000', alpha: 0 })}</hc:fillBrush>` : '',
    );
  const cellFill = (fill: string | undefined) => {
    if (!fill) return 3;
    let id = fills.get(fill);
    if (id === undefined) {
      id = 4 + fills.size;
      fills.set(fill, id);
    }
    return id;
  };

  // ── 글자 모양 ──
  const charPrs = new Table<MarkSet>((m, id) => {
    const f = fontId(m.font);
    return x(
      'hh:charPr',
      { id, height: hu(m.size ?? BASE_SIZE), textColor: (m.color ?? '#000000').toUpperCase(), shadeColor: m.highlight ? m.highlight.toUpperCase() : 'none', useFontSpace: 0, useKerning: 0, symMark: 'NONE', borderFillIDRef: 2 },
      x('hh:fontRef', SEVEN(f)),
      x('hh:ratio', SEVEN(100)),
      x('hh:spacing', SEVEN(0)),
      x('hh:relSz', SEVEN(100)),
      x('hh:offset', SEVEN(0)),
      m.bold ? '<hh:bold/>' : '',
      m.italic ? '<hh:italic/>' : '',
      x('hh:underline', { type: m.underline ? 'BOTTOM' : 'NONE', shape: 'SOLID', color: (m.color ?? '#000000').toUpperCase() }),
      x('hh:strikeout', { shape: m.strike ? 'SOLID' : 'NONE', color: (m.color ?? '#000000').toUpperCase() }),
      '<hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/>',
      m.script === 'sup' ? '<hh:supscript/>' : m.script === 'sub' ? '<hh:subscript/>' : '',
    );
  });
  /** 런의 글자 모양: 문단 스타일 서식 + 런 서식 (링크는 모양이 아니다) */
  const charOf = (style: string | undefined, m: MarkSet | undefined) => {
    const all: Record<string, unknown> = { ...resolved(style).marks, ...(m ?? {}) };
    delete all.link;
    return charPrs.id(all as MarkSet);
  };

  // ── 번호 (목록 정의마다) ──
  const numIds = new Map<string, number>();
  const numberings: string[] = [];
  for (const id of Object.keys(lists).sort()) {
    const def = lists[id]!;
    const nid = numberings.length + 1;
    numIds.set(id, nid);
    const heads = (def.levels ?? []).slice(0, 10).map((l, i) => {
      const bullet = l.format === 'bullet';
      const text = bullet ? l.text : l.text.replace(/%(\d)/g, '^$1');
      return x(
        'hh:paraHead',
        { start: 1, level: i + 1, align: 'LEFT', useInstWidth: 1, autoIndent: 0, widthAdjust: 0, textOffsetType: 'PERCENT', textOffset: 50, numFormat: bullet ? 'DIGIT' : (HWP_NUM[l.format] ?? 'DIGIT'), charPrIDRef: 4294967295, checkable: 0 },
        escXml(text),
      );
    });
    numberings.push(x('hh:numbering', { id: nid, start: 0 }, ...heads));
  }

  // ── 문단 모양 ──
  interface ParaKey {
    align?: string;
    left: number;
    right: number;
    first: number;
    before: number;
    after: number;
    line: [string, number];
    keepWithNext: boolean;
    keepTogether: boolean;
    pageBreakBefore: boolean;
    heading: [string, number, number];
  }
  const margin = (k: ParaKey) =>
    `<hh:margin>${x('hc:intent', { value: k.first, unit: 'HWPUNIT' })}${x('hc:left', { value: k.left, unit: 'HWPUNIT' })}${x('hc:right', { value: k.right, unit: 'HWPUNIT' })}${x('hc:prev', { value: k.before, unit: 'HWPUNIT' })}${x('hc:next', { value: k.after, unit: 'HWPUNIT' })}</hh:margin>` +
    x('hh:lineSpacing', { type: k.line[0], value: k.line[1], unit: 'HWPUNIT' });
  const paraPrs = new Table<ParaKey>((k, id) =>
    x(
      'hh:paraPr',
      { id, tabPrIDRef: 0, condense: 0, fontLineHeight: 0, snapToGrid: 1, suppressLineNumbers: 0, checked: 0, textDir: 'AUTO' },
      x('hh:align', { horizontal: k.align ?? 'LEFT', vertical: 'BASELINE' }),
      x('hh:heading', { type: k.heading[0], idRef: k.heading[1], level: k.heading[2] }),
      x('hh:breakSetting', { breakLatinWord: 'KEEP_WORD', breakNonLatinWord: 'KEEP_WORD', widowOrphan: 0, keepWithNext: k.keepWithNext ? 1 : 0, keepLines: k.keepTogether ? 1 : 0, pageBreakBefore: k.pageBreakBefore ? 1 : 0, lineWrap: 'BREAK' }),
      '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>',
      `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin(k)}</hp:case><hp:default>${margin(k)}</hp:default></hp:switch>`,
      '<hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>',
    ),
  );
  const paraOf = (p: ParaAttrs) => {
    const a: ParaAttrs = { ...resolved(p.style).para, ...p };
    const k: ParaKey = {
      align: a.align === 'justify' ? 'JUSTIFY' : a.align === 'center' ? 'CENTER' : a.align === 'right' ? 'RIGHT' : 'LEFT',
      left: hu(a.indent?.left ?? 0),
      right: hu(a.indent?.right ?? 0),
      first: hu(a.indent?.first ?? 0),
      before: hu(a.space?.before ?? 0),
      after: hu(a.space?.after ?? 0),
      line: a.line ? (a.line.rule === 'multiple' ? ['PERCENT', Math.round(a.line.value * LINE_PERCENT)] : [a.line.rule === 'exact' ? 'FIXED' : 'AT_LEAST', hu(a.line.value)]) : ['PERCENT', LINE_PERCENT],
      keepWithNext: !!a.keepWithNext,
      keepTogether: !!a.keepTogether,
      pageBreakBefore: !!a.pageBreakBefore,
      heading: ['NONE', 0, 0],
    };
    if (p.list && numIds.has(p.list.id)) {
      const lv = lists[p.list.id]!.levels[p.list.level];
      k.heading = ['NUMBER', numIds.get(p.list.id)!, p.list.level];
      // 번호 문단: 왼쪽 = 들여쓰기 − 내어쓰기, 첫 줄 = −내어쓰기 (한글)
      if (lv && !p.indent) {
        k.left = hu(lv.indent - lv.hanging);
        k.first = -hu(lv.hanging);
      }
    }
    return paraPrs.id(k);
  };

  // ── 스타일 표 (id 0 = 바탕글) ──
  const styleOrder = ['body', ...[...styleDefs.keys()].filter((n) => n !== 'body')];
  const styleIds = new Map(styleOrder.map((n, i) => [n, i]));

  // ── 그림 ──
  const bins: Array<{ id: string; path: string; data: Uint8Array; type: string }> = [];
  const binOf = new Map<string, string>();
  const binFor = async (asset: string): Promise<string | null> => {
    const known = binOf.get(asset);
    if (known) return known;
    const a = opts.asset ? await opts.asset(asset).catch(() => null) : null;
    if (!a) return null;
    const type = a.type || mimeOf(a.bytes);
    const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/gif' ? 'gif' : type === 'image/bmp' ? 'bmp' : 'png';
    const id = `image${bins.length + 1}`;
    bins.push({ id, path: `BinData/${id}.${ext}`, data: a.bytes, type });
    binOf.set(asset, id);
    return id;
  };

  // ── 주석 (댓글 → 메모, 제안 → 변경 추적) ──
  const threads = new Map<string, CommentThread>();
  for (const t of (q.threads ?? []) as CommentThread[]) if (t && typeof t.id === 'string' && !t.deleted) threads.set(t.id, t);
  const anns = new Map<string, StoryAnn[]>();
  const authors: string[] = [];
  const authorId = (n: string) => {
    let i = authors.indexOf(n);
    if (i < 0) i = authors.push(n) - 1;
    return i + 1;
  };
  const changes: string[] = [];
  let memoN = 0;
  for (const raw of (q.annotations ?? []) as Array<Record<string, unknown>>) {
    const start = raw.start as { story?: string; offset?: number } | undefined;
    const end = raw.end as { offset?: number } | undefined;
    if (!start || typeof start.offset !== 'number' || typeof end?.offset !== 'number') continue;
    const name = start.story ?? 'body';
    const data = (raw.data ?? {}) as Record<string, unknown>;
    const list = anns.get(name) ?? [];
    if (raw.type === 'comment') {
      const t = threads.get(String(data.thread ?? ''));
      const msgs = t?.messages.filter((m) => !m.deleted) ?? [];
      if (!msgs.length) continue;
      list.push({ from: start.offset, to: end.offset, kind: 'comment', memos: msgs.map((m) => ({ n: ++memoN, author: m.author?.name ?? '', time: isoDate(m.time), ft: fileTime(m.time), text: m.text })) });
    } else if (raw.type === 'suggestion' && (data.kind === 'insert' || data.kind === 'delete')) {
      const author = (data.author as { name?: string } | undefined)?.name ?? '';
      const tc = changes.length + 1;
      changes.push(x('hh:trackChange', { type: data.kind === 'insert' ? 'Insert' : 'Delete', date: isoDate(data.time), authorID: authorId(author), hide: 0, id: tc }));
      list.push({ from: start.offset, to: end.offset, kind: data.kind, tc });
    } else continue;
    anns.set(name, list);
  }

  let pid = 0;
  let objId = 1000;
  const noteOrder: string[] = [];

  const subList = (inner: string, vert = 'TOP', w = 0, h = 0) =>
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${vert}" linkListIDRef="0" linkListNextIDRef="0" textWidth="${w}" textHeight="${h}" hasTextRef="0" hasNumRef="0">${inner}</hp:subList>`;

  /** 블록 열 → hp:p들. head: 첫 문단 첫 런 앞에 넣을 것 (구역 정의, 머리말) */
  const blocks = async (list: Array<QuireParagraph | QuireTable>, name: string, startOffset = 0, head = ''): Promise<{ xml: string; offset: number }> => {
    const sa = anns.get(name) ?? [];
    let out = '';
    let offset = startOffset;
    let first = true;
    for (const b of list) {
      const lead = first ? head : '';
      first = false;
      if (isTable(b)) {
        out += `<hp:p id="${++pid}" paraPrIDRef="${paraOf({})}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${lead ? `<hp:run charPrIDRef="${charOf(undefined, undefined)}">${lead}</hp:run>` : ''}<hp:run charPrIDRef="${charOf(undefined, undefined)}">${await table(b)}<hp:t/></hp:run></hp:p>`;
        offset += 2;
        continue;
      }
      out += await paragraph(b, sa, offset, lead);
      offset += (b.c ?? []).reduce((s, r) => s + (r.img ? 1 : cps(r.t ?? '').length), 0) + 1;
    }
    if (!out) out = `<hp:p id="${++pid}" paraPrIDRef="${paraOf({})}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${charOf(undefined, undefined)}">${head}<hp:t/></hp:run></hp:p>`;
    return { xml: out, offset };
  };

  const paragraph = async (b: QuireParagraph, sa: StoryAnn[], offset: number, lead: string): Promise<string> => {
    const p = b.p as ParaAttrs;
    const style = p.style ?? 'body';
    const sid = styleIds.get(style) ?? 0;
    const runs: Array<{ cp: number; body: string }> = [];
    const push = (cp: number, body: string) => {
      const last = runs[runs.length - 1];
      if (last && last.cp === cp) last.body += body;
      else runs.push({ cp, body });
    };
    const plain = charOf(style, undefined);
    if (lead) push(plain, lead);
    let at = offset;
    /** 열린 변경 추적 (문단을 넘으면 문단 끝에서 닫고 다음 문단에서 다시 연다) */
    const open = new Set<StoryAnn>();
    const endsAt = (pos: number) => {
      let s = '';
      for (const a of [...open])
        if (a.to <= pos) {
          s += `<hp:${a.kind}End Id="${a.tc}" TcId="${a.tc}" paraend="0"/>`;
          open.delete(a);
        }
      return s;
    };
    const beginsAt = (pos: number) => {
      let s = '';
      for (const a of sa)
        if (a.kind !== 'comment' && a.from <= pos && pos < a.to && !open.has(a)) {
          s += `<hp:${a.kind}Begin Id="${a.tc}" TcId="${a.tc}"/>`;
          open.add(a);
        }
      return s;
    };
    let link: string | undefined;
    let linkId = 0;
    const closeLink = (cp: number) => {
      if (link) push(cp, `<hp:ctrl><hp:fieldEnd beginIDRef="${linkId}" fieldid="${linkId}"/></hp:ctrl>`);
      link = undefined;
    };
    const marksAt = (pos: number, cp: number) => {
      for (const a of sa)
        if (a.kind === 'comment' && a.to === pos)
          for (const m of a.memos!) push(cp, `<hp:ctrl><hp:fieldEnd beginIDRef="${900000 + m.n}" fieldid="${900000 + m.n}"/></hp:ctrl>`);
      for (const a of sa)
        if (a.kind === 'comment' && a.from === pos)
          for (const m of a.memos!) {
            const paras = m.text
              .split('\n')
              .map((line) => `<hp:p id="0" paraPrIDRef="${paraOf({})}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${plain}"><hp:t>${escXml(line)}</hp:t></hp:run></hp:p>`)
              .join('');
            push(
              cp,
              `<hp:ctrl>${x(
                'hp:fieldBegin',
                { id: 900000 + m.n, type: 'MEMO', name: '', editable: 1, dirty: 1, zorder: m.n, fieldid: 900000 + m.n, metaTag: '' },
                `<hp:parameters cnt="7" name=""><hp:integerParam name="Prop">0</hp:integerParam><hp:stringParam name="Command">MEMO/65535/${m.n}/${m.ft}/${escXml(m.author)}/\\;;</hp:stringParam><hp:stringParam name="ID">memo${m.n}</hp:stringParam><hp:integerParam name="Number">${m.n}</hp:integerParam><hp:stringParam name="Author">${escXml(m.author)}</hp:stringParam><hp:stringParam name="MemoShapeIDRef">1</hp:stringParam><hp:stringParam name="CreateDateTime">${m.time}</hp:stringParam></hp:parameters>`,
                subList(paras),
              )}</hp:ctrl>`,
            );
          }
    };
    for (const r of b.c ?? []) {
      const m = r.m;
      const cp = charOf(style, m);
      if (m?.link !== link) {
        closeLink(cp);
        if (m?.link) {
          link = m.link;
          linkId = ++objId;
          const cmd = m.link.replace(/([\\:?;])/g, '\\$1');
          push(
            cp,
            `<hp:ctrl>${x(
              'hp:fieldBegin',
              { id: linkId, type: 'HYPERLINK', name: '', editable: 0, dirty: 1, zorder: -1, fieldid: linkId, metaTag: '' },
              `<hp:parameters cnt="6" name=""><hp:integerParam name="Prop">0</hp:integerParam><hp:stringParam name="Command">${escXml(cmd)};1;5;-1;</hp:stringParam><hp:stringParam name="Path">${escXml(m.link)}</hp:stringParam><hp:stringParam name="Category">HWPHYPERLINK_TYPE_URL</hp:stringParam><hp:stringParam name="TargetType">HWPHYPERLINK_TARGET_HYPERLINK</hp:stringParam><hp:stringParam name="DocOpenType">HWPHYPERLINK_JUMP_DONTCARE</hp:stringParam></hp:parameters>`,
            )}</hp:ctrl>`,
          );
        }
      }
      if (r.img) {
        marksAt(at, cp);
        push(cp, await object(r.img as ObjAttrs));
        at++;
        continue;
      }
      // 글: 주석 경계와 변경 추적 표지
      const chars = cps(r.t ?? '');
      let t = '';
      for (let k = 0; k <= chars.length; k++) {
        const pos = at + k;
        t += endsAt(pos);
        const hasComment = sa.some((a) => a.kind === 'comment' && (a.from === pos || a.to === pos));
        if (hasComment && k < chars.length) {
          if (t) push(cp, `<hp:t>${t}</hp:t>`);
          t = '';
          marksAt(pos, cp);
        }
        if (k < chars.length) {
          t += beginsAt(pos);
          const ch = chars[k]!;
          t += ch === '\t' ? '<hp:tab/>' : escXml(ch);
        }
      }
      if (t) push(cp, `<hp:t>${t}</hp:t>`);
      at += chars.length;
    }
    // 문단 끝: 열린 변경 추적을 닫는다
    if (open.size) {
      let s = '';
      for (const a of open) s += `<hp:${a.kind}End Id="${a.tc}" TcId="${a.tc}" paraend="0"/>`;
      open.clear();
      push(plain, `<hp:t>${s}</hp:t>`);
    }
    closeLink(plain);
    marksAt(at, plain);
    if (!runs.length || runs.every((r) => !r.body.includes('<hp:t'))) push(plain, '<hp:t/>');
    const body = runs.map((r) => `<hp:run charPrIDRef="${r.cp}">${r.body}</hp:run>`).join('');
    return `<hp:p id="${++pid}" paraPrIDRef="${paraOf(p)}" styleIDRef="${sid}" pageBreak="0" columnBreak="${p.columnBreakBefore ? 1 : 0}" merged="0">${body}</hp:p>`;
  };

  const object = async (o: ObjAttrs): Promise<string> => {
    if (o.kind === 'note' && o.id) {
      const k = noteOrder.indexOf(o.id) >= 0 ? noteOrder.indexOf(o.id) + 1 : noteOrder.push(o.id);
      const { xml } = await blocks(story(noteStoryId(o.id)), noteStoryId(o.id), 0, `<hp:ctrl><hp:autoNum num="${k}" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="1"/></hp:autoNum></hp:ctrl><hp:t> </hp:t>`);
      return `<hp:ctrl><hp:footNote number="${k}" instId="${++objId}">${subList(xml)}</hp:footNote></hp:ctrl>`;
    }
    if (o.kind === 'field') {
      const type = o.field === 'page' ? 'PAGE' : o.field === 'pages' || o.field === 'sectionPages' ? 'TOTAL_PAGE' : null;
      if (!type) return '';
      return `<hp:ctrl><hp:autoNum num="1" numType="${type}"><hp:autoNumFormat type="${pageFormat}" userChar="" prefixChar="" suffixChar="" supscript="0"/></hp:autoNum></hp:ctrl>`;
    }
    if (o.kind !== 'image') return '';
    const bin = o.asset ? await binFor(o.asset) : null;
    if (!bin) return o.alt ? `<hp:t>${escXml(o.alt)}</hp:t>` : '';
    const w = hu(o.w ?? 72000);
    const h = hu(o.h ?? 72000);
    const f = o.float;
    const id = ++objId;
    const wrap = !f ? 'TOP_AND_BOTTOM' : f.behind ? 'BEHIND_TEXT' : f.wrap === 'square' ? 'SQUARE' : f.wrap === 'topBottom' ? 'TOP_AND_BOTTOM' : 'IN_FRONT_OF_TEXT';
    const flow = f?.side === 'left' ? 'LEFT_ONLY' : f?.side === 'right' ? 'RIGHT_ONLY' : f?.side === 'largest' ? 'LARGEST_ONLY' : 'BOTH_SIDES';
    const rel = (v: string, axis: 'x' | 'y') => (v === 'page' ? 'PAPER' : v === 'margin' ? 'PAGE' : axis === 'x' ? (v === 'column' ? 'COLUMN' : 'PARA') : 'PARA');
    const gap = f ? hu(f.gap ?? 9000) : 0;
    const pos = f
      ? x('hp:pos', {
          treatAsChar: 0, affectLSpacing: 0, flowWithText: 1, allowOverlap: 1, holdAnchorAndSO: 0, vertRelTo: rel(f.relY, 'y'), horzRelTo: rel(f.relX, 'x'), vertAlign: 'TOP',
          horzAlign: typeof f.x === 'number' ? 'LEFT' : f.x.toUpperCase(), vertOffset: hu(f.y), horzOffset: typeof f.x === 'number' ? hu(f.x) : 0,
        })
      : '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>';
    return (
      `<hp:pic id="${id}" zOrder="${id}" numberingType="PICTURE" textWrap="${wrap}" textFlow="${flow}" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}" reverse="0">` +
      `<hp:offset x="0" y="0"/>${x('hp:orgSz', { width: w, height: h })}<hp:curSz width="0" height="0"/><hp:flip horizontal="0" vertical="0"/>` +
      `${x('hp:rotationInfo', { angle: 0, centerX: Math.round(w / 2), centerY: Math.round(h / 2), rotateimage: 1 })}` +
      '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
      `${x('hc:img', { binaryItemIDRef: bin, bright: 0, contrast: 0, effect: 'REAL_PIC', alpha: 0 })}` +
      `<hp:imgRect><hc:pt0 x="0" y="0"/>${x('hc:pt1', { x: w, y: 0 })}${x('hc:pt2', { x: w, y: h })}${x('hc:pt3', { x: 0, y: h })}</hp:imgRect>` +
      '<hp:imgClip left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="0" dimheight="0"/><hp:effects/>' +
      `${x('hp:sz', { width: w, widthRelTo: 'ABSOLUTE', height: h, heightRelTo: 'ABSOLUTE', protect: 0 })}${pos}` +
      `${x('hp:outMargin', { left: gap, right: gap, top: gap, bottom: gap })}<hp:shapeComment>${escXml(o.alt ?? '')}</hp:shapeComment></hp:pic>`
    );
  };

  const table = async (b: QuireTable): Promise<string> => {
    const t = b.table;
    const grid = tableGrid(t);
    const cols = t.cols.map(hu);
    let rowsXml = '';
    let totalH = 0;
    for (let y = 0; y < t.rows.length; y++) {
      const row = t.rows[y]!;
      const h = row.h ? hu(row.h) : 282;
      totalH += h;
      let tr = '';
      for (const c of row.cells) {
        let xx = -1;
        for (let k = 0; k < cols.length; k++) if (grid[y]![k] === c.story) xx = k;
        if (xx < 0) continue;
        const [rs, cs] = c.span ?? [1, 1];
        const width = cols.slice(xx, xx + cs).reduce((s, v) => s + v, 0);
        const paras = story(c.story);
        const { xml } = await blocks(paras.length ? paras : [{ p: {}, c: [] }], c.story);
        tr +=
          `<hp:tc name="" header="${row.header ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${cellFill(c.fill)}">` +
          subList(xml, c.valign === 'middle' ? 'CENTER' : c.valign === 'bottom' ? 'BOTTOM' : 'TOP') +
          `${x('hp:cellAddr', { colAddr: xx, rowAddr: y })}${x('hp:cellSpan', { colSpan: cs, rowSpan: rs })}${x('hp:cellSz', { width, height: h })}<hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>`;
      }
      rowsXml += `<hp:tr>${tr}</hp:tr>`;
    }
    const id = ++objId;
    return (
      `<hp:tbl id="${id}" zOrder="${id}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${t.rows.length}" colCnt="${cols.length}" cellSpacing="0" borderFillIDRef="3" noAdjust="0">` +
      `${x('hp:sz', { width: cols.reduce((s, v) => s + v, 0), widthRelTo: 'ABSOLUTE', height: totalH, heightRelTo: 'ABSOLUTE', protect: 0 })}` +
      '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="141" right="141" top="141" bottom="141"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>' +
      `${rowsXml}</hp:tbl>`
    );
  };

  // ── 구역: 본문을 구역 끝 문단에서 나눈다 ──
  const sections = (Array.isArray(q.sections) && q.sections.length ? q.sections : [{ id: LAST_SECTION }]) as Array<Record<string, unknown>>;
  const groups: Array<Array<QuireParagraph | QuireTable>> = [[]];
  for (const b of q.stories.body) {
    groups[groups.length - 1]!.push(b);
    if (!isTable(b) && (b.p as ParaAttrs).section) groups.push([]);
  }
  if (groups.length > sections.length) groups[groups.length - 2]!.push(...groups.pop()!);
  while (groups.length < sections.length) groups.push([]);
  let pageFormat = 'DIGIT';
  const sectionFiles: string[] = [];
  const sectionBodies: string[] = [];
  let offset = 0;
  const hfUsed = new Set<string>();
  for (let k = 0; k < sections.length; k++) {
    const s = fullSection(sections[k] as Partial<SectionProps>);
    if (k > 0 && s.start === 'continuous' && sectionFiles.length) {
      // 이어지는 구역: 한글은 구역을 나누면 새 쪽이므로 같은 구역 파일 안에서 단 정의만 바꾼다
      const n = s.columns && s.columns.count > 1 ? s.columns.count : 1;
      const cp = `<hp:ctrl>${x('hp:colPr', { id: '', type: 'NEWSPAPER', layout: 'LEFT', colCount: n, sameSz: 1, sameGap: n > 1 ? hu(s.columns!.gap) : 0 }, n > 1 && s.columns!.separator ? '<hp:colLine type="SOLID" width="0.12 mm" color="#000000"/>' : '')}</hp:ctrl>`;
      const { xml, offset: next } = await blocks(groups[k]!, 'body', offset, cp);
      offset = next;
      sectionBodies[sectionBodies.length - 1] += xml;
      continue;
    }
    pageFormat = s.pageNumber?.format === 'roman' ? 'ROMAN_CAPITAL' : s.pageNumber?.format === 'hangul' ? 'HANGUL_SYLLABLE' : 'DIGIT';
    const [top, right, bottom, left] = s.page.margin.map(hu) as [number, number, number, number];
    const landscape = s.page.width > s.page.height;
    const pw = hu(Math.min(s.page.width, s.page.height));
    const ph = hu(Math.max(s.page.width, s.page.height));
    const noteLine = '<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>';
    const secPr =
      `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="1" textVerticalWidthHead="0" masterPageCnt="0">` +
      '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>' +
      x('hp:startNum', { pageStartsOn: s.start === 'oddPage' ? 'ODD' : s.start === 'evenPage' ? 'EVEN' : 'BOTH', page: s.pageNumber?.start ?? 0, pic: 0, tbl: 0, equation: 0 }) +
      x('hp:visibility', { hideFirstHeader: s.titlePage ? 1 : 0, hideFirstFooter: s.titlePage ? 1 : 0, hideFirstMasterPage: 0, border: 'SHOW_ALL', fill: 'SHOW_ALL', hideFirstPageNum: 0, hideFirstEmptyLine: 0, showLineNumber: 0 }) +
      '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>' +
      x('hp:pagePr', { landscape: landscape ? 'NARROWLY' : 'WIDELY', width: pw, height: ph, gutterType: 'LEFT_ONLY' }, x('hp:margin', { header: hu(s.headerDistance ?? 36000), footer: hu(s.footerDistance ?? 36000), gutter: 0, left, right, top, bottom })) +
      `<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="1"/>${noteLine}<hp:noteSpacing betweenNotes="283" belowLine="0" aboveLine="1000"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>` +
      `<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="1"/>${noteLine}<hp:noteSpacing betweenNotes="0" belowLine="0" aboveLine="1000"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>` +
      ['BOTH', 'EVEN', 'ODD'].map((tp) => `<hp:pageBorderFill type="${tp}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`).join('') +
      '</hp:secPr>';
    const colCount = s.columns && s.columns.count > 1 ? s.columns.count : 1;
    const colPr = `<hp:ctrl>${x('hp:colPr', { id: '', type: 'NEWSPAPER', layout: 'LEFT', colCount, sameSz: 1, sameGap: colCount > 1 ? hu(s.columns!.gap) : 0 }, colCount > 1 && s.columns!.separator ? '<hp:colLine type="SOLID" width="0.12 mm" color="#000000"/>' : '')}</hp:ctrl>`;
    let hf = '';
    for (const part of ['header', 'footer'] as const) {
      for (const kind of ['default', 'even'] as const) {
        const sid = s[part]?.[kind];
        const has = !!sid && Array.isArray(q.stories[sid]);
        // 한글도 앞 구역 머리말을 이어받는다: 앞에 있던 종류는 빈 머리말로 끊는다
        if (!has && !hfUsed.has(`${part}.${kind}`)) continue;
        hfUsed.add(`${part}.${kind}`);
        const apply = kind === 'even' ? 'EVEN' : s.oddEven ? 'ODD' : 'BOTH';
        const { xml } = has ? await blocks(story(sid!), sid!) : await blocks([], `${part}.empty`);
        const textW = hu(s.page.width) - left - right;
        hf += `<hp:ctrl>${x(`hp:${part}`, { id: ++objId, applyPageType: apply }, subList(xml, part === 'header' ? 'TOP' : 'BOTTOM', textW, hu(part === 'header' ? (s.headerDistance ?? 36000) : (s.footerDistance ?? 36000))))}</hp:ctrl>`;
      }
    }
    const { xml, offset: next } = await blocks(groups[k]!, 'body', offset, secPr + colPr + hf);
    offset = next;
    sectionBodies.push(xml);
    sectionFiles.push('');
  }
  for (let i = 0; i < sectionBodies.length; i++) sectionFiles[i] = `${XML_HEAD}<hs:sec ${HWPX_NS}>${sectionBodies[i]}</hs:sec>`;

  // ── header.xml ──
  const styleXml = styleOrder.map((n, i) => {
    const st = styleDefs.get(n)!;
    const [nm, eng] = HWP_STYLES[n] ?? [st.label ?? n, n];
    return x('hh:style', { id: i, type: 'PARA', name: nm, engName: eng, paraPrIDRef: paraOf({ style: n }), charPrIDRef: charOf(n, undefined), nextStyleIDRef: styleIds.get(st.next ?? n) ?? i, langID: 1042, lockForm: 0 });
  });
  const fontfaces = LANGS.map((lang) =>
    x(
      'hh:fontface',
      { lang, fontCnt: fonts.length },
      ...fonts.map((f, i) => x('hh:font', { id: i, face: f, type: 'TTF', isEmbedded: 0 }, '<hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>')),
    ),
  ).join('');
  const borderFills = [borderFill(1, false, null), borderFill(2, false, null), borderFill(3, true, null), ...[...fills].map(([c, id]) => borderFill(id, true, c))];
  const header =
    `${XML_HEAD}<hh:head ${HWPX_NS} version="1.5" secCnt="${sectionFiles.length}">` +
    '<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList>' +
    `<hh:fontfaces itemCnt="7">${fontfaces}</hh:fontfaces>` +
    `<hh:borderFills itemCnt="${borderFills.length}">${borderFills.join('')}</hh:borderFills>` +
    `<hh:charProperties itemCnt="${charPrs.items.length}">${charPrs.items.join('')}</hh:charProperties>` +
    '<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>' +
    (numberings.length ? `<hh:numberings itemCnt="${numberings.length}">${numberings.join('')}</hh:numberings>` : '') +
    `<hh:paraProperties itemCnt="${paraPrs.items.length}">${paraPrs.items.join('')}</hh:paraProperties>` +
    `<hh:styles itemCnt="${styleXml.length}">${styleXml.join('')}</hh:styles>` +
    '<hh:memoProperties itemCnt="1"><hh:memoPr id="1" width="15024" lineWidth="1" lineType="SOLID" lineColor="#B6D7AE" fillColor="#F0FFE9" activeColor="#CFF1C7" memoType="NOMAL"/></hh:memoProperties>' +
    (changes.length ? `<hh:trackChanges itemCnt="${changes.length}">${changes.join('')}</hh:trackChanges>` : '') +
    (authors.length ? `<hh:trackChangeAuthors itemCnt="${authors.length}">${authors.map((a, i) => x('hh:trackChangeAuthor', { name: a, mark: 1, id: i + 1 })).join('')}</hh:trackChangeAuthors>` : '') +
    '</hh:refList><hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>' +
    '<hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption><hh:trackchageConfig flags="56"/></hh:head>';

  // ── 패키지 ──
  const secNames = sectionFiles.map((_, i) => `section${i}`);
  const hpf =
    `${XML_HEAD}<opf:package ${HWPX_NS} version="" unique-identifier="" id=""><opf:metadata>${x('opf:title', null, escXml(opts.title ?? ''))}<opf:language>ko</opf:language><opf:meta name="creator" content="text">Quire</opf:meta></opf:metadata>` +
    `<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>${secNames.map((n) => `<opf:item id="${n}" href="Contents/${n}.xml" media-type="application/xml"/>`).join('')}` +
    `${bins.map((b) => x('opf:item', { id: b.id, href: b.path, 'media-type': b.type, isEmbeded: 1 })).join('')}<opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest>` +
    `<opf:spine><opf:itemref idref="header" linear="yes"/>${secNames.map((n) => `<opf:itemref idref="${n}" linear="yes"/>`).join('')}</opf:spine></opf:package>`;
  const rdf =
    `${XML_HEAD}<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    ['Contents/header.xml', ...secNames.map((n) => `Contents/${n}.xml`)]
      .map(
        (p, i) =>
          `<rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="${p}"/></rdf:Description><rdf:Description rdf:about="${p}"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#${i === 0 ? 'HeaderFile' : 'SectionFile'}"/></rdf:Description>`,
      )
      .join('') +
    '<rdf:Description rdf:about=""><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/></rdf:Description></rdf:RDF>';
  const file = (name: string, text: string, deflate = true) => ({ name, data: enc.encode(text), deflate });
  return writeZip([
    file('mimetype', 'application/hwp+zip', false),
    file('version.xml', `${XML_HEAD}<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.5" application="Quire" appVersion="1, 0, 0, 0"/>`),
    file('Contents/header.xml', header),
    ...sectionFiles.map((s, i) => file(`Contents/section${i}.xml`, s)),
    ...bins.map((b) => ({ name: b.path, data: b.data, deflate: false })),
    file('settings.xml', `${XML_HEAD}<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`),
    file('META-INF/container.rdf', rdf),
    file('Contents/content.hpf', hpf),
    file('META-INF/container.xml', `${XML_HEAD}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="META-INF/container.rdf" media-type="application/rdf+xml"/></ocf:rootfiles></ocf:container>`),
    file('META-INF/manifest.xml', `${XML_HEAD}<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`),
  ]);
}
