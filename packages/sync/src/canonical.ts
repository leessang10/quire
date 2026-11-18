/**
 * 정본 JSON (07 §4, ADR-0004): QuireDoc v1. 지금 모델은 서식 없는 문단 열이므로 body 스토리의 문단과 텍스트 런만 쓴다.
 *
 * - 문단 하나 = { "p": {}, "c": [ { "t": "…" } ] }, 빈 문단은 "c": [].
 * - 키 순서를 고정해 직렬화한다(키 사전순, 들여쓰기 2칸, 끝 줄바꿈). 같은 문서는 늘 같은 바이트열 → 해시·diff가 안정적이다.
 * - CRDT 원소 ID·묘비·구획 표식은 들어가지 않는다. 그래서 정본으로 저장했다 다시 열면 구획이 하나뿐인 깨끗한 문서가 된다.
 */
import { DEFAULT_STYLES, Doc, MARK_KEYS, type ListDef, type MarkSet, type ParaAttrs, type Style } from '@quire/model';
import type { LoroDoc } from 'loro-crdt';
import { readRaw, readState } from './shape';

export interface QuireRun {
  t: string;
  /** 글자 서식 (10 §2.1, 크기는 1/1000pt). 없으면 서식 없음 */
  m?: MarkSet;
}

export interface QuireParagraph {
  p: Record<string, unknown>;
  c: QuireRun[];
}

export interface QuireDoc {
  format: 'quire';
  version: number;
  settings: Record<string, unknown>;
  styles: Record<string, unknown>;
  sections: Array<Record<string, unknown>>;
  stories: { body: QuireParagraph[] } & Record<string, unknown>;
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
    if (!block || typeof block !== 'object' || !('p' in block)) throw new Error(`document.json: body[${i}] is not a paragraph (not supported yet)`);
    const runs = (block as QuireParagraph).c ?? [];
    if (!Array.isArray(runs)) throw new Error(`document.json: body[${i}].c must be an array`);
    for (const [k, r] of runs.entries()) {
      if (!r || typeof r !== 'object' || typeof (r as QuireRun).t !== 'string')
        throw new Error(`document.json: body[${i}].c[${k}] is not a text run (not supported yet)`);
      const t = (r as QuireRun).t;
      if (t.includes('\n') || t.includes('\r')) throw new Error(`document.json: body[${i}].c[${k}] contains a line break`);
      out += t;
    }
    out += '\n';
  });
  return out;
}

/** 지금 모델이 아는 문단 속성 키 (10 §2.2) */
const PARA_KEYS = ['style', 'align', 'indent', 'space', 'line', 'list', 'keepWithNext', 'keepTogether', 'pageBreakBefore'];

/** 서식·문단 속성이 있는 문서 → QuireDoc. 같은 서식이 이어진 글자는 한 런 (정규화) */
export function quireFromDoc(doc: Doc): QuireDoc {
  const q = quireFromText('\n');
  q.stories.body = doc.paragraphRuns().map((p) => ({
    p: { ...p.attrs },
    c: p.runs.filter((r) => r.text).map((r) => (Object.keys(r.marks).length ? { t: r.text, m: { ...r.marks } } : { t: r.text })),
  }));
  // 스타일 (10 §2.3): 기본 스타일과 다른 것만 (이름 → 정의)
  const defaults = new Map(DEFAULT_STYLES.map((st) => [st.name, JSON.stringify(st)]));
  for (const st of doc.styles()) if (defaults.get(st.name) !== JSON.stringify(st)) q.styles[st.name] = structuredClone(st);
  for (const name of defaults.keys()) if (!doc.style(name)) q.styles[name] = null;
  // 목록 정의 (10 §2.4): 문서 설정의 lists (id → 정의). 번호는 저장하지 않는다 (파생 값)
  const lists = doc.lists();
  if (lists.length) q.settings.lists = Object.fromEntries(lists.map((l) => [l.id, structuredClone(l)]));
  return q;
}

/**
 * QuireDoc → 서식·문단 속성이 있는 문서. 모르는 서식 키·문단 속성은 버리고 notes에 적는다 (07 §4의 "모르는 속성 보존"은 아직 없음).
 */
export function docFromQuire(q: QuireDoc, peer?: string): { doc: Doc; notes: string[] } {
  textFromQuire(q); // 구조 확인 (표·필드 등 아직 담을 수 없는 내용은 오류)
  const notes = new Set<string>();
  const paras = q.stories.body.map((block) => {
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
      return { text: r.t, marks: marks as MarkSet };
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
