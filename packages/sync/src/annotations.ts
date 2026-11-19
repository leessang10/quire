/**
 * 주석 동기화 (14 §2.2): Loro 맵 annotations 하나에 키 "<id>|<key>" (type·story·start·end·data, 키마다 LWW).
 *
 * - start·end는 Loro 커서 (09 §7)다. start = 범위 첫 글자에 붙은 커서 (그 앞에 넣은 글은 밖), end = 마지막 글자 오른쪽에 붙은 커서
 *   (side 1: 그 뒤에 넣은 글은 밖). 마지막 글자가 지워지면 커서는 그 글자가 있던 자리를 준다.
 * - 지우기는 type을 null로. type이 없으면 주석이 없는 것이다 (같은 때의 다른 키 변경보다 지우기가 이긴다).
 * - 위치 단위는 그 스토리 Loro 텍스트의 UTF-16이다. 편집 모델 쪽 변환(화면 오프셋 ↔ UTF-16 ↔ 위치)은 부르는 쪽이 한다.
 */
import { Cursor, type LoroDoc } from 'loro-crdt';
import type { Annotation, AnnotationChange, Document } from '@quire/model';
import { BODY_NAMES, storyNames } from './shape';

export const ANNOTATIONS = 'annotations';

/** 주석 하나의 동기화 모양: 범위는 그 스토리 Loro 텍스트의 UTF-16 [start, end) (풀 수 없으면 null, 범위 안이 모두 지워졌으면 start = end) */
export interface AnnWire {
  type: string;
  story: string | null;
  data: Record<string, unknown>;
  start: number | null;
  end: number | null;
  /** 범위 안 글자가 모두 지워짐 (고아) */
  orphan: boolean;
  /** 시작·끝 커서가 지운 글자에 붙어 있다 (받은 피어가 살아 있는 글자로 다시 쓴다) */
  dead?: boolean;
}

/** 편집 모델의 범위 변경 (화면 오프셋 [start, end)) → 첫 글자·마지막 글자의 UTF-16 */
export function annRangeToU16(document: Document, c: Extract<AnnotationChange, { kind: 'annRange' }>): AnnRangeU16 {
  if (c.start === null || c.end === null || c.end <= c.start) return { start: null, last: null };
  const d = document.docOf(c.story);
  return { start: d.u16OfOffset(c.start), last: d.u16OfOffset(c.end - 1) };
}

/**
 * 동기화 모양 → 편집 모델의 주석 (그 스토리 Doc의 위치). mapU16: 아직 Loro에 가지 않은 로컬 변경을 지나게 하는 위치 변환 (Worker 경로).
 * 고아면 시작만 두고 끝은 null (범위 없음)
 */
export function annFromWire(document: Document, id: string, w: AnnWire, mapU16: (u: number, end: boolean) => number = (u) => u): Annotation {
  const base = { id, type: w.type, story: w.story, data: w.data };
  if (w.start === null || w.end === null) return { ...base, start: null, end: null };
  const d = document.docOf(w.story);
  const from = d.offsetOfU16(mapU16(w.start, false));
  const to = Math.max(from, d.offsetOfU16(mapU16(w.end, true)));
  if (w.orphan || to <= from) return { ...base, start: d.positionAt(from), end: null };
  const { start, end } = document.rangePositions(w.story, from, to);
  return { ...base, start, end };
}

/** 범위 쓰기 (UTF-16): start = 첫 글자, last = 마지막 글자 (범위가 없으면 null) */
export interface AnnRangeU16 {
  start: number | null;
  last: number | null;
}

const textOf = (loro: LoroDoc, story: string | null | undefined) => loro.getText((story ? storyNames(story) : BODY_NAMES).text);

/** 키 하나 쓰기 (value undefined = 지움: type이면 주석을 지운다) */
export function writeAnnKey(loro: LoroDoc, id: string, key: 'type' | 'story' | 'data', value: unknown): void {
  const m = loro.getMap(ANNOTATIONS);
  if (key === 'story') m.set(`${id}|story`, (value ?? '') as never);
  else m.set(`${id}|${key}`, (value === undefined ? null : structuredClone(value)) as never);
}

/** 범위 쓰기: 커서를 만든다 (UTF-16) */
export function writeAnnRange(loro: LoroDoc, id: string, story: string | null | undefined, r: AnnRangeU16): void {
  const m = loro.getMap(ANNOTATIONS);
  const t = textOf(loro, story);
  if (r.start === null || r.last === null || t.length === 0) {
    m.set(`${id}|start`, null as never);
    m.set(`${id}|end`, null as never);
    return;
  }
  const s = t.getCursor(Math.min(r.start, t.length - 1), 0);
  const e = t.getCursor(Math.min(r.last, t.length - 1), 1);
  m.set(`${id}|start`, (s ? s.encode() : null) as never);
  m.set(`${id}|end`, (e ? e.encode() : null) as never);
}

/** 맵 이벤트의 바뀐 키들 → 주석 ID들 */
export function annIdsOf(keys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const k of keys) {
    const i = k.lastIndexOf('|');
    if (i > 0) out.add(k.slice(0, i));
  }
  return out;
}

/** Loro의 모든 주석 ID */
export function annIdsInLoro(loro: LoroDoc): string[] {
  return [...annIdsOf(Object.keys(loro.getMap(ANNOTATIONS).toJSON() as Record<string, unknown>))];
}

/** 주석 하나 읽기 (지금 Loro 상태로 커서를 푼다). 없으면(지움) null */
export function readAnn(loro: LoroDoc, id: string): AnnWire | null {
  const m = loro.getMap(ANNOTATIONS);
  const type = m.get(`${id}|type`);
  if (typeof type !== 'string') return null;
  const storyV = m.get(`${id}|story`);
  const story = typeof storyV === 'string' && storyV !== '' ? storyV : null;
  const data = (m.get(`${id}|data`) as Record<string, unknown> | null) ?? {};
  const sb = m.get(`${id}|start`);
  const eb = m.get(`${id}|end`);
  let start: number | null = null;
  let end: number | null = null;
  let orphan = false;
  let dead = false;
  if (sb instanceof Uint8Array && eb instanceof Uint8Array) {
    try {
      const s = loro.getCursorPos(Cursor.decode(sb));
      const e = loro.getCursorPos(Cursor.decode(eb));
      if (s && e) {
        start = s.offset;
        // 끝 커서: 마지막 글자 오른쪽 (살아 있으면 그 글자 폭만큼 뒤)
        const alive = e.side === 1 && !e.update;
        dead = !alive || !!s.update;
        end = e.offset;
        if (alive) {
          const t = textOf(loro, story);
          const c = t.length > e.offset ? t.slice(e.offset, e.offset + 1).charCodeAt(0) : 0;
          end += c >= 0xd800 && c <= 0xdbff ? 2 : 1;
        }
        if (end <= start) {
          orphan = true;
          end = start;
        }
      }
    } catch {
      start = end = null;
    }
  }
  return { type, story, data: structuredClone(data), start, end, orphan, ...(dead && !orphan ? { dead } : {}) };
}
