/**
 * 주요 요소 시험 틀 (15 §6.1): 표의 요소를 모두 담은 정본 문서와, 포맷이 담는 요소만 남겨 비교하는 투영. 포맷마다
 * "내보내기 → 가져오기" 왕복 뒤 투영이 같아야 한다 (DOCX·HWPX도 같은 틀에 열만 더한다).
 */
import { MARK_KEYS, OBJ, defaultListDef, fullSection, noteStoryId, type CommentThread, type ListDef, type MarkSet, type ObjAttrs, type ParaAttrs, type SectionProps } from '@quire/model';
import type { QuireDoc, QuireParagraph, QuireRun, QuireTable } from '@quire/sync';
import { emptyQuire, tableGrid } from './common';

export type Format = 'markdown' | 'html' | 'docx' | 'hwpx';

/** 포맷이 담는 요소 (15 §6.1의 열) */
export interface FormatSupport {
  marks: ReadonlyArray<keyof MarkSet>;
  /** 문단 스타일 (제목 1–6, 인용, 코드). 나머지 스타일은 본문으로 */
  styles: ReadonlyArray<string>;
  /** 정렬·들여쓰기·간격·줄 간격 */
  paraLayout: boolean;
  /** 빈 문단 */
  emptyParas: boolean;
  /** 강조 앞뒤 공백의 서식 (Markdown은 강조 안 끝 공백을 담지 못한다) */
  edgeSpaces: boolean;
  /** 이미지 크기 */
  imageSize: boolean;
  /** 표: 병합·열 너비·칸 바탕·세로 맞춤 */
  tableLayout: boolean;
  /** 구역·용지·여백·방향·다단·쪽 번호, 머리말·꼬리말 */
  sections: boolean;
  /** 떠 있는 이미지·어울림 */
  floats: boolean;
  /** 댓글 (스레드·답글·해결) */
  comments: boolean;
  /** 제안 (삽입·삭제) */
  suggestions: boolean;
  /** 길이의 단위 (1/1000pt): DOCX는 twip(1/20pt)이라 50 */
  unit?: number;
}

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

const NONE = { sections: false, floats: false, comments: false, suggestions: false };

export const SUPPORT: Record<'markdown' | 'html' | 'docx', FormatSupport> = {
  markdown: { marks: ['bold', 'italic', 'strike', 'link'], styles: [...HEADINGS, 'quote', 'code'], paraLayout: false, emptyParas: false, edgeSpaces: false, imageSize: false, tableLayout: false, ...NONE },
  html: { marks: MARK_KEYS, styles: [...HEADINGS, 'quote', 'code'], paraLayout: true, emptyParas: true, edgeSpaces: true, imageSize: true, tableLayout: true, ...NONE },
  docx: { marks: MARK_KEYS, styles: [...HEADINGS, 'quote', 'code'], paraLayout: true, emptyParas: true, edgeSpaces: true, imageSize: true, tableLayout: true, sections: true, floats: true, comments: true, suggestions: true, unit: 50 },
};

/** 스토리의 화면 글 (문단마다 ¶, 개체·표는 OBJ): 주석 오프셋의 기준 */
export function storyText(q: QuireDoc, name: string): string[] {
  const list = Array.isArray(q.stories[name]) ? (q.stories[name] as Array<QuireParagraph | QuireTable>) : [];
  const out: string[] = [];
  for (const b of list) {
    if ('table' in b) out.push(OBJ, '\n');
    else {
      for (const r of b.c ?? []) if (r.img) out.push(OBJ);
      else out.push(...Array.from(r.t ?? ''));
      out.push('\n');
    }
  }
  return out;
}

/** 요소 표의 모든 요소를 담은 문서. image는 자산 ID (시험이 바이트를 준다) */
export function elementsDocument(image: { asset: string; w: number; h: number }): QuireDoc {
  const t = (text: string, m?: MarkSet): QuireRun => ({ t: text, ...(m ? { m } : {}) });
  const p = (c: QuireRun[], attrs: Record<string, unknown> = {}): QuireParagraph => ({ p: attrs, c });
  const bullet = defaultListDef('L1', 'bullet');
  const number = defaultListDef('L2', 'number');
  const body: Array<QuireParagraph | QuireTable> = [
    p([t('주요 요소 문서')], { style: 'h1' }),
    p([t('제목 2')], { style: 'h2' }),
    p([t('제목 3')], { style: 'h3' }),
    p([t('제목 4')], { style: 'h4' }),
    p([t('제목 5')], { style: 'h5' }),
    p([t('제목 6')], { style: 'h6' }),
    p([
      t('보통 글, '),
      t('굵게', { bold: true }),
      t(', '),
      t('기울임', { italic: true }),
      t(', '),
      t('굵은 기울임', { bold: true, italic: true }),
      t(', '),
      t('밑줄', { underline: true }),
      t(', '),
      t('취소선', { strike: true }),
      t(', '),
      t('링크', { link: 'https://example.com/a?b=1' }),
      t(', '),
      t('굵은 링크', { bold: true, link: 'https://example.com/b' }),
      t('.'),
    ]),
    p([t('크기 ', {}), t('16pt', { size: 16000 }), t(', '), t('빨강', { color: '#c00000' }), t(', '), t('형광펜', { highlight: '#fff59d' }), t(', H'), t('2', { script: 'sub' }), t('O, x'), t('2', { script: 'sup' }), t(', '), t('글꼴', { font: 'Noto Sans KR' })]),
    p([t('가운데 정렬')], { align: 'center' }),
    p([t('오른쪽 정렬')], { align: 'right' }),
    p([t('양쪽 정렬과 들여쓰기')], { align: 'justify', indent: { left: 36000, first: 18000 } }),
    p([t('줄 간격 1.5와 문단 간격')], { line: { rule: 'multiple', value: 1.5 }, space: { before: 12000, after: 6000 } }),
    p([]),
    p([t('글머리 하나')], { list: { id: 'L1', level: 0 } }),
    p([t('글머리 둘 (수준 2)')], { list: { id: 'L1', level: 1 } }),
    p([t('글머리 셋')], { list: { id: 'L1', level: 0 } }),
    p([t('사이 문단')], { section: 's1' }),
    p([t('번호 하나')], { list: { id: 'L2', level: 0 } }),
    p([t('번호 둘')], { list: { id: 'L2', level: 0 } }),
    p([t('번호 아래 (가.)')], { list: { id: 'L2', level: 1 } }),
    p([t('그림 앞 '), { img: { id: 'img1', kind: 'image', asset: image.asset, w: image.w, h: image.h, alt: '파란 상자' } }, t(' 그림 뒤')]),
    p([t('각주가 달린 문장'), { img: { id: 'n1', kind: 'note' } }, t('입니다.')]),
    p([t('인용한 문단')], { style: 'quote' }),
    p([t('const a = 1;')], { style: 'code' }),
    p([t('  return a * 2;')], { style: 'code' }),
    {
      table: {
        cols: [120000, 150000, 180000],
        rows: [
          { cells: [{ story: 't1.r1c1' }, { story: 't1.r1c2', span: [1, 2], fill: '#dde7f5' }] },
          { cells: [{ story: 't1.r2c1', span: [2, 1], valign: 'middle' }, { story: 't1.r2c2' }, { story: 't1.r2c3' }] },
          { cells: [{ story: 't1.r3c2' }, { story: 't1.r3c3' }] },
        ],
      },
    },
    p([t('표 뒤 문단')]),
    p([
      t('떠 있는 그림'),
      { img: { id: 'img2', kind: 'image', asset: image.asset, w: image.w, h: image.h, alt: '떠 있는 상자', float: { relX: 'column', relY: 'paragraph', x: 'right', y: 6000, wrap: 'square', side: 'both', gap: 9000 } } },
      t('이 오른쪽에 있고 글이 어울립니다.'),
    ]),
  ];
  const q = emptyQuire(body);
  const stories = q.stories as Record<string, unknown>;
  const cell = (s: string, text: string, m?: MarkSet) => (stories[s] = [p([t(text, m)])]);
  cell('t1.r1c1', '칸 1');
  cell('t1.r1c2', '합친 칸 (가로)', { bold: true });
  cell('t1.r2c1', '합친 칸 (세로)');
  cell('t1.r2c2', '칸 5');
  cell('t1.r2c3', '칸 6');
  cell('t1.r3c2', '칸 8');
  cell('t1.r3c3', '칸 9');
  stories[noteStoryId('n1')] = [p([t('각주 내용 '), t('굵게', { bold: true }), t('.')])];
  q.settings.lists = { L1: bullet, L2: number };
  q.styles = {};
  // 구역 둘: 첫 구역은 머리말·꼬리말(쪽 번호 필드), 둘째는 가로·두 단·로마 숫자 쪽 번호
  stories['hdr|s1|default'] = [p([t('머리말 글')])];
  stories['ftr|s1|default'] = [p([t('쪽 '), { img: { kind: 'field', field: 'page' } }, t(' / '), { img: { kind: 'field', field: 'pages' } }], { align: 'center' })];
  stories['ftr|last|default'] = [p([t('둘째 구역 '), { img: { kind: 'field', field: 'page' } }])];
  q.sections = [
    { id: 's1', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, start: 'nextPage', header: { default: 'hdr|s1|default' }, footer: { default: 'ftr|s1|default' } },
    {
      id: 'last',
      page: { width: 841890, height: 595276, margin: [54000, 60000, 54000, 60000] },
      start: 'nextPage',
      columns: { count: 2, gap: 24000, separator: true },
      pageNumber: { start: 5, format: 'roman' },
      footer: { default: 'ftr|last|default' },
    },
  ];
  // 댓글 둘 (답글, 해결)과 제안 둘 (삽입, 삭제): 오프셋은 본문 글에서 찾는다
  const text = storyText(q, 'body').join('');
  const range = (needle: string) => {
    const u = text.indexOf(needle);
    const from = Array.from(text.slice(0, u)).length;
    return { start: { story: 'body', offset: from }, end: { story: 'body', offset: from + Array.from(needle).length } };
  };
  const alice = { id: 'u1', name: '김하나', color: '#1a73e8' };
  const bob = { id: 'u2', name: 'Bob', color: '#d93025' };
  const T = 1767225600000;
  q.annotations = [
    { id: 'a1', type: 'comment', data: { thread: 'th1' }, ...range('굵은 기울임') },
    { id: 'a2', type: 'comment', data: { thread: 'th2' }, ...range('취소선') },
    { id: 'a3', type: 'suggestion', data: { kind: 'insert', author: alice, time: T + 60000 }, ...range('인용한') },
    { id: 'a4', type: 'suggestion', data: { kind: 'delete', author: bob, time: T + 120000 }, ...range('사이 ') },
  ];
  q.threads = [
    { id: 'th1', anchor: 'a1', resolved: false, deleted: false, messages: [{ id: 'm1', author: alice, time: T, text: '여기를 고칠까요?\n두 줄 댓글' }, { id: 'm2', author: bob, time: T + 1000, text: 'Yes' }] },
    { id: 'th2', anchor: 'a2', resolved: true, deleted: false, messages: [{ id: 'm3', author: bob, time: T + 2000, text: '해결한 댓글' }] },
  ] satisfies CommentThread[];
  return q;
}

// ── 투영 ─────────────────────────────────────────────

type Block = Record<string, unknown>;

/** 시각은 분 단위로 (Word는 댓글 시각을 분까지만 저장한다) */
const minute = (t: unknown) => (typeof t === 'number' ? Math.floor(t / 60000) * 60000 : null);

/** 포맷이 담는 요소만 남긴 정본 (비교용). 이름(목록 ID, 표 스토리 이름, 각주 ID)에 무관하다 */
export function project(q: QuireDoc, s: FormatSupport): Block[] {
  const unit = s.unit ?? 1;
  /** 길이를 포맷의 단위로 */
  const L = (v: number) => Math.round(v / unit) * unit;
  const lengths = (o: Record<string, number | undefined>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? L(v) : v]));
  const lists = (q.settings.lists ?? {}) as Record<string, ListDef>;
  const story = (name: string) => (Array.isArray(q.stories[name]) ? (q.stories[name] as Array<QuireParagraph | QuireTable>) : []);
  const marksOf = (m: MarkSet | undefined): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of s.marks) if (m?.[k] !== undefined) out[k] = m[k];
    return out;
  };
  const runs = (c: QuireRun[]): unknown[] => {
    const out: Array<Record<string, unknown>> = [];
    for (const r of c) {
      if (r.img) {
        const o = r.img as ObjAttrs;
        if (o.kind === 'note' && o.id) out.push({ note: blocks(story(noteStoryId(o.id))) });
        else if (o.kind === 'field') out.push({ field: o.field });
        else if (o.kind === 'image') {
          const f = o.float;
          const float = s.floats && f ? { float: { relX: f.relX, relY: f.relY, x: f.x, y: f.y, wrap: f.wrap, side: f.wrap === 'square' ? (f.side ?? 'both') : null, gap: f.gap ?? 9000, behind: !!f.behind } } : {};
          out.push({ img: { asset: o.asset, alt: o.alt ?? '', ...(s.imageSize ? { w: Math.round((o.w ?? 0) / 750), h: Math.round((o.h ?? 0) / 750) } : {}), ...float } });
        }
        continue;
      }
      const m = marksOf(r.m);
      const push = (t: string, mm: Record<string, unknown>) => {
        if (!t) return;
        const last = out[out.length - 1];
        if (last && typeof last.t === 'string' && JSON.stringify(last.m) === JSON.stringify(mm)) last.t += t;
        else out.push({ t, m: mm });
      };
      const t = r.t ?? '';
      if (s.edgeSpaces) push(t, m);
      else {
        // 강조 앞뒤 공백의 서식은 포맷이 담지 못한다 (링크만 남긴다)
        const lead = /^\s*/.exec(t)![0];
        const trail = t.length > lead.length ? /\s*$/.exec(t)![0] : '';
        const bare = m.link !== undefined ? { link: m.link } : {};
        push(lead, bare);
        push(t.slice(lead.length, t.length - trail.length), m);
        push(trail, bare);
      }
    }
    return out;
  };
  const blocks = (list: Array<QuireParagraph | QuireTable>): Block[] => {
    const out: Block[] = [];
    for (const b of list) {
      if ('table' in b) {
        const t = b.table;
        const text = (name: string | null) =>
          name
            ? story(name)
                .map((x) => ('c' in x ? (x.c ?? []).map((r2) => r2.t ?? '').join('') : ''))
                .join('\n')
            : '';
        out.push(
          s.tableLayout
            ? {
                table: t.rows.map((r) => r.cells.map((c) => ({ text: text(c.story), span: c.span ?? [1, 1], fill: c.fill ?? null, valign: c.valign ?? 'top' }))),
                cols: t.cols.map(L),
              }
            : { table: tableGrid(t).map((r) => r.map(text)) },
        );
        continue;
      }
      const a = b.p as ParaAttrs;
      const c = runs(b.c ?? []);
      if (!c.length && !s.emptyParas) continue;
      const blk: Block = { c };
      const style = a.style && s.styles.includes(a.style) ? a.style : null;
      if (style) blk.style = style;
      if (a.list) blk.list = { kind: lists[a.list.id]?.kind ?? 'bullet', level: a.list.level };
      if (s.sections && a.section) blk.sectionEnd = true;
      if (s.paraLayout) {
        if (a.align && a.align !== 'left') blk.align = a.align;
        if (a.indent) blk.indent = lengths(a.indent);
        if (a.space) blk.space = lengths(a.space);
        if (a.line) blk.line = a.line.rule === 'multiple' ? a.line : { rule: a.line.rule, value: L(a.line.value) };
      }
      out.push(blk);
    }
    return out;
  };
  const out = blocks(q.stories.body);
  if (s.sections) {
    const list = (Array.isArray(q.sections) ? q.sections : []) as Array<Record<string, unknown>>;
    out.push({
      sections: list.map((e) => {
        const f = fullSection(e as Partial<SectionProps>);
        const hf: Record<string, unknown> = {};
        for (const part of ['header', 'footer'] as const) for (const kind of ['default', 'first', 'even'] as const) if (f[part]?.[kind]) hf[`${part}.${kind}`] = blocks(story(f[part]![kind]!));
        return {
          page: { width: L(f.page.width), height: L(f.page.height), margin: f.page.margin.map(L) },
          start: f.start,
          columns: f.columns && f.columns.count > 1 ? { count: f.columns.count, gap: L(f.columns.gap), separator: !!f.columns.separator } : null,
          titlePage: !!f.titlePage,
          pageNumber: f.pageNumber ?? null,
          hf,
        };
      }),
    });
  }
  const anns = ((q.annotations ?? []) as Array<{ type?: string; data?: Record<string, unknown>; start?: { story?: string; offset?: number }; end?: { offset?: number } }>)
    .filter((a) => a.start && typeof a.start.offset === 'number' && typeof a.end?.offset === 'number')
    .sort((a, b) => a.start!.offset! - b.start!.offset! || String(a.type).localeCompare(String(b.type)));
  const rangeText = (a: (typeof anns)[0]) => storyText(q, a.start!.story ?? 'body').slice(a.start!.offset!, a.end!.offset!).join('');
  if (s.comments) {
    const threads = new Map(((q.threads ?? []) as CommentThread[]).map((t) => [t.id, t]));
    out.push({
      comments: anns
        .filter((a) => a.type === 'comment')
        .map((a) => {
          const t = threads.get(String(a.data?.thread));
          return { story: a.start!.story === 'body' || !a.start!.story ? 'body' : 'other', text: rangeText(a), resolved: !!t?.resolved, messages: (t?.messages ?? []).filter((m) => !m.deleted).map((m) => ({ author: m.author?.name, text: m.text, time: minute(m.time) })) };
        }),
    });
  }
  if (s.suggestions)
    out.push({
      suggestions: anns
        .filter((a) => a.type === 'suggestion')
        .map((a) => ({ kind: a.data?.kind, author: (a.data?.author as { name?: string } | undefined)?.name, time: minute(a.data?.time), text: rangeText(a) })),
    });
  return out;
}

/** 두 투영의 첫 차이 (같으면 null) */
export function firstDifference(a: Block[], b: Block[]): string | null {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = JSON.stringify(a[i] ?? null);
    const y = JSON.stringify(b[i] ?? null);
    if (x !== y) return `블록 ${i}: 기대 ${x} / 실제 ${y}`;
  }
  return null;
}
