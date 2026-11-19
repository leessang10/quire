/**
 * 정본 JSON (07 §4, ADR-0004): QuireDoc v1. 지금 모델은 서식 없는 문단 열이므로 body 스토리의 문단과 텍스트 런만 쓴다.
 *
 * - 문단 하나 = { "p": {}, "c": [ { "t": "…" } ] }, 빈 문단은 "c": [].
 * - 키 순서를 고정해 직렬화한다(키 사전순, 들여쓰기 2칸, 끝 줄바꿈). 같은 문서는 늘 같은 바이트열 → 해시·diff가 안정적이다.
 * - CRDT 원소 ID·묘비·구획 표식은 들어가지 않는다. 그래서 정본으로 저장했다 다시 열면 구획이 하나뿐인 깨끗한 문서가 된다.
 */
import {
  DEFAULT_STYLES,
  LAST_SECTION,
  SECTION_KEYS,
  fullSection,
  Doc,
  Document,
  MARK_KEYS,
  OBJ,
  OBJ_KEYS,
  cellKey,
  cellStoryId,
  isNoteStory,
  noteRefs,
  noteStoryId,
  emptyTable,
  newTableId,
  normalizeTable,
  type ListDef,
  type MarkSet,
  type ObjAttrs,
  type ParaAttrs,
  type SectionProps,
  type Style,
  type TableRecord,
} from '@quire/model';
import type { LoroDoc } from 'loro-crdt';
import { readRaw, readState } from './shape';

export interface QuireRun {
  /** 글 (개체 런이면 없음) */
  t?: string;
  /** 인라인 이미지 (11 §6): 개체 하나 */
  img?: ObjAttrs;
  /** 글자 서식 (10 §2.1, 크기는 1/1000pt). 없으면 서식 없음 */
  m?: MarkSet;
}

export interface QuireParagraph {
  p: Record<string, unknown>;
  c: QuireRun[];
}

/**
 * 표 블록 (11 §6): 정규화한 격자. 덮인 칸은 셀이 없다 (HTML 표처럼). 셀 내용은 stories.<story>.
 * 행·열 ID, 지운 행·열, 덮인 셀의 따로 된 스토리는 저장하지 않는다 (덮인 셀의 글은 주인 셀 스토리 뒤에 붙인다)
 */
export interface QuireTable {
  table: {
    /** 열 너비 (1/1000pt) */
    cols: number[];
    rows: Array<{ cells: Array<{ story: string; span?: [number, number]; fill?: string; valign?: string }>; h?: number; header?: true; cantSplit?: true }>;
    attrs?: Record<string, unknown>;
  };
}

export interface QuireDoc {
  format: 'quire';
  version: number;
  settings: Record<string, unknown>;
  styles: Record<string, unknown>;
  sections: Array<Record<string, unknown>>;
  stories: { body: Array<QuireParagraph | QuireTable> } & Record<string, unknown>;
  annotations: unknown[];
}

export const SCHEMA_VERSION = 1;

/** A4, 여백 72pt (단위 1/1000pt, 02 §2) */
const DEFAULT_SECTION = { id: 's1', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, columns: 1 };

/** 화면 텍스트(Doc.text(): 문단마다 ¶로 끝남) → QuireDoc */
export function quireFromText(text: string): QuireDoc {
  const paras = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  return {
    format: 'quire',
    version: SCHEMA_VERSION,
    settings: {},
    styles: {},
    sections: [structuredClone(DEFAULT_SECTION)],
    stories: { body: paras.map((t) => ({ p: {}, c: t ? [{ t }] : [] })) },
    annotations: [],
  };
}

/**
 * QuireDoc → 화면 텍스트 (끝 ¶ 포함). 지금 모델이 담을 수 없는 내용(서식 없는 텍스트 런이 아닌 것)은 오류로 알린다.
 * 연속된 런은 이어 붙인다.
 */
export function textFromQuire(q: QuireDoc): string {
  const body = q.stories?.body;
  if (!Array.isArray(body) || body.length === 0) throw new Error('document.json: stories.body must be a non-empty array');
  let out = '';
  body.forEach((block, i) => {
    if (block && typeof block === 'object' && 'table' in block) {
      out += `${OBJ}\n`; // 표 문단 = 표 원소 하나
      return;
    }
    if (!block || typeof block !== 'object' || !('p' in block)) throw new Error(`document.json: body[${i}] is not a paragraph (not supported yet)`);
    const runs = (block as QuireParagraph).c ?? [];
    if (!Array.isArray(runs)) throw new Error(`document.json: body[${i}].c must be an array`);
    for (const [k, r] of runs.entries()) {
      if (r && typeof r === 'object' && (r as QuireRun).img && typeof (r as QuireRun).img === 'object') {
        out += OBJ; // 인라인 이미지 = 개체 글자 하나
        continue;
      }
      if (!r || typeof r !== 'object' || typeof (r as QuireRun).t !== 'string')
        throw new Error(`document.json: body[${i}].c[${k}] is not a text run (not supported yet)`);
      const t = (r as QuireRun).t!;
      if (t.includes('\n') || t.includes('\r')) throw new Error(`document.json: body[${i}].c[${k}] contains a line break`);
      out += t;
    }
    out += '\n';
  });
  return out;
}

/** 지금 모델이 아는 문단 속성 키 (10 §2.2) */
const PARA_KEYS = ['style', 'align', 'indent', 'space', 'line', 'list', 'keepWithNext', 'keepTogether', 'pageBreakBefore', 'columnBreakBefore', 'koreanBreak', 'hangPunct', 'squeeze', 'section'];

/**
 * 구역 (12 §3.2): 문서 순서의 구역 배열, 마지막이 기본 구역. 구역 나눔 문단의 p.section이 앞 구역의 ID를 가리킨다.
 * 구역 나눔도 마지막 구역 설정도 없으면 기본 구역 하나 (지금까지와 같은 바이트열)
 */
function sectionsOf(doc: Doc): Array<Record<string, unknown>> {
  const last = doc.sectionDef(LAST_SECTION);
  const ids = doc.sectionBreaks().map((i) => doc.paraAttrs(i).section!);
  if (!ids.length && !last) return [structuredClone(DEFAULT_SECTION)];
  const entry = (id: string, def: SectionProps | undefined) => ({ ...structuredClone(fullSection(def)), id });
  return [...ids.map((id) => entry(id, doc.sectionDef(id))), entry(LAST_SECTION, last)];
}

/** 정본 구역 항목 → 구역 설정 (모르는 키는 버린다. 옛 columns: 1은 단 하나) */
function sectionProps(e: Record<string, unknown>): SectionProps {
  const out: Record<string, unknown> = {};
  for (const k of SECTION_KEYS) if (e[k] !== undefined) out[k] = e[k];
  if (typeof out.columns === 'number') {
    if (out.columns > 1) out.columns = { count: out.columns, gap: 36000 };
    else delete out.columns;
  }
  return fullSection(out as Partial<SectionProps>);
}

/** 정본의 구역 배열을 문서에 넣는다. 마지막 구역은 LAST_SECTION (기본 구역과 같으면 넣지 않는다) */
function putSections(doc: Doc, q: QuireDoc): void {
  const list = Array.isArray(q.sections) ? q.sections.filter((e) => e && typeof e === 'object') : [];
  list.forEach((e, k) => {
    const def = sectionProps(e);
    if (k === list.length - 1) {
      if (canonicalJson(def) !== canonicalJson(fullSection(undefined))) doc.setSection(LAST_SECTION, def);
    } else if (typeof e.id === 'string') doc.setSection(e.id, def);
  });
}

/** 정본에 기본이 아닌 구역이 있는가 (서식 없는 빠른 길을 쓸 수 없다) */
function hasSections(q: QuireDoc): boolean {
  const list = Array.isArray(q.sections) ? q.sections : [];
  if (list.length > 1) return true;
  return list.length === 1 && canonicalJson(sectionProps(list[0]!)) !== canonicalJson(fullSection(undefined));
}

/** 문서의 문단들 → 정본 문단 배열 */
function paragraphsOf(doc: Doc): QuireParagraph[] {
  return doc.paragraphRuns().map((p) => ({
    p: { ...p.attrs },
    c: p.runs
      .filter((r) => r.text)
      .map((r): QuireRun => {
        const m = Object.keys(r.marks).length ? { m: { ...r.marks } } : {};
        return r.obj ? { img: { ...r.obj }, ...m } : { t: r.text, ...m };
      }),
  }));
}

const emptyStory = (d: Doc) => d.text() === '\n' && d.plain && Object.keys(d.paraAttrs(0)).length === 0;

/**
 * 여러 스토리 문서 → QuireDoc (11 §6): 비지 않은 스토리는 stories.<ID>. 표 문단은 표 블록으로, 셀 스토리는 표 순서·격자 자리로
 * 이름을 새로 붙인다 (t<표>.r<행>c<열>): 같은 문서는 늘 같은 정본
 */
export function quireFromDocument(document: Document): QuireDoc {
  const q = quireFromDoc(document.body);
  const stories = q.stories as Record<string, unknown>;
  /** 셀 스토리 ID → 정본 이름 (주석 위치) */
  const cellNames = new Map<string, string>();
  let tk = 0;
  q.stories.body = q.stories.body.map((block) => {
    const run = 'c' in block && block.c.length === 1 ? block.c[0]! : null;
    const rec = run?.img?.kind === 'table' && run.img.table ? document.table(run.img.table) : undefined;
    if (!rec) return block;
    const g = normalizeTable(rec);
    if (!g.rows.length || !g.cols.length) return block;
    tk++;
    const table: QuireTable['table'] = { cols: g.widths, rows: [] };
    if (Object.keys(rec.attrs).length) table.attrs = { ...rec.attrs };
    g.cells.forEach((row, y) => {
      const r: QuireTable['table']['rows'][0] = { cells: [] };
      const ra = rec.rowAttrs[g.rows[y]!];
      if (ra?.minHeight) r.h = ra.minHeight;
      if (ra?.header) r.header = true;
      if (ra?.cantSplit) r.cantSplit = true;
      row.forEach((c, x) => {
        if (!c) return;
        const name = `t${tk}.r${y + 1}c${x + 1}`;
        cellNames.set(c.story, name);
        const cell: QuireTable['table']['rows'][0]['cells'][0] = { story: name };
        if (c.span[0] > 1 || c.span[1] > 1) cell.span = [c.span[0], c.span[1]];
        const ca = rec.cellAttrs[cellKey(c.row, c.col)];
        if (ca?.fill) cell.fill = ca.fill;
        if (ca?.valign) cell.valign = ca.valign;
        r.cells.push(cell);
        // 주인 셀 + 비지 않은 덮인 셀 (화면과 같은 순서)
        const paras: QuireParagraph[] = [];
        for (const sid of [c.story, ...c.covered]) {
          if (!document.has(sid)) continue;
          const d = document.story(sid);
          if (sid !== c.story && emptyStory(d)) continue;
          paras.push(...paragraphsOf(d));
        }
        if (paras.length && !(paras.length === 1 && paras[0]!.c.length === 0 && Object.keys(paras[0]!.p).length === 0)) stories[name] = paras;
      });
      table.rows.push(r);
    });
    return { table };
  });
  // 표 셀이 아닌 스토리 (3단계: 머리말·각주·글상자). 표 레코드가 있는 표의 셀은 표 블록이 쓴다
  const usedNotes = new Set(noteRefs(document.body).map((n) => noteStoryId(n.id)));
  for (const id of document.storyIds().sort()) {
    if (id.includes('|') && document.table(id.split('|')[0]!)) continue; // 표 셀 (표 블록이 썼다)
    if (isNoteStory(id) && !usedNotes.has(id)) continue; // 참조가 지워진 각주 (12 §6.1)
    const d = document.story(id);
    if (emptyStory(d)) continue;
    stories[id] = paragraphsOf(d);
  }
  // 주석 (14 §2.3): 위치는 스토리 이름 + 코드포인트 오프셋. 범위가 없으면(고아) story만
  const anns: Array<Record<string, unknown>> = [];
  for (const id of document.annotationIds().sort()) {
    const a = document.annotation(id)!;
    let story: string | null;
    if (a.story === null) story = 'body';
    else if (cellNames.has(a.story)) story = cellNames.get(a.story)!;
    else if (a.story.includes('|') && document.table(a.story.split('|')[0]!)) story = null; // 덮인 셀 (주인 셀에 합쳐 저장): 위치를 잃는다
    else story = a.story;
    if (story === null) continue;
    const range = document.resolveRange(a);
    const e: Record<string, unknown> = { id, type: a.type, data: structuredClone(a.data) };
    if (range && !range.orphan) {
      e.start = { story, offset: range.from };
      e.end = { story, offset: range.to };
    } else e.story = story;
    anns.push(e);
  }
  q.annotations = anns;
  return q;
}

/** QuireDoc → 여러 스토리 문서 (스토리는 가벼운 모양) */
export function documentFromQuire(q: QuireDoc, peer?: string): { document: Document; notes: string[] } {
  // 표 블록 → 표 원소 문단 + 새 표 레코드 (새 ID). 셀 스토리 이름 → (표, 행, 열) 스토리 ID
  const tables: TableRecord[] = [];
  const rename = new Map<string, string>();
  const body = q.stories.body.map((block): QuireParagraph => {
    if (!('table' in block)) return block;
    const t = block.table;
    const id = newTableId();
    const rec = emptyTable(id);
    rec.cols = t.cols.map((_, x) => `c${x + 1}`);
    rec.rows = t.rows.map((_, y) => `r${y + 1}`);
    t.cols.forEach((w, x) => (rec.widths[rec.cols[x]!] = w));
    if (t.attrs) rec.attrs = { ...t.attrs };
    // 덮인 칸을 건너뛰며 셀을 격자에 놓는다 (HTML 표와 같은 방식)
    const taken = new Set<string>();
    t.rows.forEach((row, y) => {
      const r = rec.rows[y]!;
      if (row.h) rec.rowAttrs[r] = { ...rec.rowAttrs[r], minHeight: row.h };
      if (row.header) rec.rowAttrs[r] = { ...rec.rowAttrs[r], header: true };
      if (row.cantSplit) rec.rowAttrs[r] = { ...rec.rowAttrs[r], cantSplit: true };
      let x = 0;
      for (const cell of row.cells) {
        while (taken.has(`${y},${x}`)) x++;
        if (x >= rec.cols.length) break;
        const [h, w] = cell.span ?? [1, 1];
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) taken.add(`${yy},${xx}`);
        const c = rec.cols[x]!;
        if (h > 1 || w > 1) rec.spans[cellKey(r, c)] = { rows: rec.rows.slice(y + 1, y + h), cols: rec.cols.slice(x + 1, x + w) };
        if (cell.fill || cell.valign)
          rec.cellAttrs[cellKey(r, c)] = { ...(cell.fill ? { fill: cell.fill } : {}), ...(cell.valign ? { valign: cell.valign as 'top' } : {}) };
        rename.set(cell.story, cellStoryId(id, r, c));
        x += w;
      }
    });
    tables.push(rec);
    return { p: {}, c: [{ img: { id, kind: 'table', table: id } }] };
  });
  const { doc, notes } = docFromQuire({ ...q, stories: { ...q.stories, body } }, peer);
  const built = new Map<string, Doc>();
  for (const [name, paras] of Object.entries(q.stories)) {
    if (name === 'body' || !Array.isArray(paras)) continue;
    const runs = (paras as QuireParagraph[]).map((b) => ({
      attrs: (b.p ?? {}) as ParaAttrs,
      runs: (b.c ?? []).map((r) => (r.img ? { text: OBJ, marks: r.m, obj: r.img } : { text: r.t ?? '', marks: r.m })),
    }));
    built.set(rename.get(name) ?? name, Doc.fromParagraphRuns(runs, peer, true));
  }
  const document = new Document(doc, (id) => built.get(id) ?? Doc.fromParagraphRuns([{ runs: [] }], peer, true));
  for (const id of built.keys()) document.story(id);
  for (const t of tables) document.putTable(t);
  document.takeDirtyTables();
  // 주석 (14 §2.3)
  for (const raw of Array.isArray(q.annotations) ? q.annotations : []) {
    const e = raw as { id?: unknown; type?: unknown; data?: unknown; story?: unknown; start?: { story?: unknown; offset?: unknown }; end?: { offset?: unknown } };
    if (typeof e.id !== 'string' || typeof e.type !== 'string') continue;
    const name = typeof e.start?.story === 'string' ? e.start.story : typeof e.story === 'string' ? e.story : 'body';
    const story = name === 'body' ? null : (rename.get(name) ?? name);
    const data = e.data && typeof e.data === 'object' ? structuredClone(e.data as Record<string, unknown>) : {};
    const base = { id: e.id, type: e.type, story, data };
    if (typeof e.start?.offset === 'number' && typeof e.end?.offset === 'number') {
      const d = document.docOf(story);
      const from = Math.max(0, Math.min(d.maxCaret, e.start.offset));
      const to = Math.max(from, Math.min(d.maxCaret, e.end.offset));
      document.applyRemoteAnnotation(e.id, { ...base, ...document.rangePositions(story, from, to) });
    } else document.applyRemoteAnnotation(e.id, { ...base, start: null, end: null });
  }
  return { document, notes };
}

/** 서식·문단 속성이 있는 문서 → QuireDoc. 같은 서식이 이어진 글자는 한 런 (정규화) */
export function quireFromDoc(doc: Doc): QuireDoc {
  if (doc.plain) return quireFromText(doc.text()); // 서식 없는 문서: 빠른 길 (같은 결과)
  const q = quireFromText('\n');
  q.stories.body = doc.paragraphRuns().map((p) => ({
    p: { ...p.attrs },
    c: p.runs
      .filter((r) => r.text)
      .map((r): QuireRun => {
        const m = Object.keys(r.marks).length ? { m: { ...r.marks } } : {};
        return r.obj ? { img: { ...r.obj }, ...m } : { t: r.text, ...m };
      }),
  }));
  // 스타일 (10 §2.3): 기본 스타일과 다른 것만 (이름 → 정의)
  const defaults = new Map(DEFAULT_STYLES.map((st) => [st.name, JSON.stringify(st)]));
  for (const st of doc.styles()) if (defaults.get(st.name) !== JSON.stringify(st)) q.styles[st.name] = structuredClone(st);
  for (const name of defaults.keys()) if (!doc.style(name)) q.styles[name] = null;
  // 목록 정의 (10 §2.4): 문서 설정의 lists (id → 정의). 번호는 저장하지 않는다 (파생 값)
  const lists = doc.lists();
  if (lists.length) q.settings.lists = Object.fromEntries(lists.map((l) => [l.id, structuredClone(l)]));
  q.sections = sectionsOf(doc);
  return q;
}

/**
 * QuireDoc → 서식·문단 속성이 있는 문서. 모르는 서식 키·문단 속성은 버리고 notes에 적는다 (07 §4의 "모르는 속성 보존"은 아직 없음).
 */
export function docFromQuire(q: QuireDoc, peer?: string): { doc: Doc; notes: string[] } {
  textFromQuire(q); // 구조 확인 (필드 등 아직 담을 수 없는 내용은 오류)
  // 표 블록은 본문 하나만 여는 이 함수에서는 빈 문단 (표는 documentFromQuire가 연다)
  const blocks = q.stories.body.map((b): QuireParagraph => ('table' in b ? { p: {}, c: [] } : b));
  const text = textFromQuire({ ...q, stories: { ...q.stories, body: blocks } });
  // 서식 없는 문서: 빠른 길
  const plainBody = blocks.every((b) => Object.keys(b.p ?? {}).length === 0 && (b.c ?? []).every((r) => !r.img && (!r.m || Object.keys(r.m).length === 0)));
  if (plainBody && Object.keys(q.styles ?? {}).length === 0 && !q.settings?.lists && !hasSections(q)) return { doc: Doc.fromText(text.slice(0, -1), peer), notes: [] };
  const notes = new Set<string>();
  const paras = blocks.map((block) => {
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(block.p ?? {})) {
      if (PARA_KEYS.includes(k)) attrs[k] = v;
      else notes.add(`문단 속성 ${k}`);
    }
    const runs = (block.c ?? []).map((r) => {
      const marks: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.m ?? {})) {
        if ((MARK_KEYS as readonly string[]).includes(k)) marks[k] = v;
        else notes.add(`글자 서식 ${k}`);
      }
      if (r.img) {
        const obj: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r.img)) {
          if ((OBJ_KEYS as readonly string[]).includes(k)) obj[k] = v;
          else notes.add(`개체 속성 ${k}`);
        }
        return { text: OBJ, marks: marks as MarkSet, obj: obj as ObjAttrs };
      }
      return { text: r.t!, marks: marks as MarkSet };
    });
    return { attrs: attrs as ParaAttrs, runs };
  });
  const doc = Doc.fromParagraphRuns(paras, peer);
  // 스타일: null이면 기본 스타일을 지운 것
  for (const [name, def] of Object.entries(q.styles ?? {})) {
    if (def === null) doc.setStyle(name, undefined);
    else if (def && typeof def === 'object') doc.setStyle(name, { ...(def as Style), name });
  }
  const lists = q.settings?.lists;
  if (lists && typeof lists === 'object')
    for (const [id, def] of Object.entries(lists as Record<string, ListDef>)) if (def && typeof def === 'object') doc.setList(id, { ...def, id });
  putSections(doc, q);
  doc.takeParagraphChanges();
  return { doc, notes: [...notes].map((n) => `${n}: 이 엔진이 모르는 값이라 버림`) };
}

/** 스키마 확인 + 마이그레이션 (07 §6). 지금은 v1뿐이다 */
export function migrateQuire(value: unknown): { doc: QuireDoc; readOnly: boolean } {
  if (!value || typeof value !== 'object') throw new Error('document.json: not an object');
  const v = value as Partial<QuireDoc>;
  if (v.format !== 'quire') throw new Error('document.json: format must be "quire"');
  if (typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1)
    throw new Error('document.json: bad version');
  // 엔진보다 새 스키마: 아는 부분만 읽고 읽기 전용으로 연다
  return { doc: v as QuireDoc, readOnly: v.version > SCHEMA_VERSION };
}

/** 키 순서를 고정한 JSON (07 §4: 같은 문서는 같은 바이트열) */
export function canonicalJson(value: unknown): string {
  return `${write(value, '')}\n`;
}

function write(v: unknown, indent: string): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('canonicalJson: non-finite number');
    if (v === undefined) throw new Error('canonicalJson: undefined');
    return JSON.stringify(v);
  }
  const inner = `${indent}  `;
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[\n${v.map((x) => inner + write(x, inner)).join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(v as object)
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .sort();
  if (keys.length === 0) return '{}';
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${write((v as Record<string, unknown>)[k], inner)}`).join(',\n')}\n${indent}}`;
}

const encoder = new TextEncoder();

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 정본 상태 해시: 정본 JSON 바이트열의 SHA-256 (07 §3의 stateHash) */
export function stateHash(q: QuireDoc): Promise<string> {
  return sha256Hex(canonicalJson(q));
}

/** Loro 문서의 화면 텍스트 (Doc.fromRaw로 화면 순서·숨김을 적용한 결과) */
export function displayText(loro: LoroDoc): string {
  const { raw, keys } = readRaw(loro);
  if (raw.length === 0) return '';
  return Doc.fromRaw(raw, keys, readState(loro)).text();
}
