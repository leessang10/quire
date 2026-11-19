/**
 * 버전 비교 (14 §5.3, 4-6): Loro diff(A, B)를 A 시점 문서 위의 비영속 제안 주석으로 바꾼다.
 *   - 텍스트 insert: 넣고 삽입 제안으로 표시
 *   - 텍스트 delete: 지우지 않고 삭제 제안으로 표시 (A의 글자가 그대로 남는다)
 *   - 서식(마크)·문단 속성 변경: 적용하고 이전 값과 함께 서식·문단 제안으로 표시
 * 원소 ID(Loro) 기준이라 텍스트 diff 추정이 없다. 결과를 모두 수락하면 B, 모두 거부하면 A다 (시험).
 * 구획 이동(문단 순서)·표 구조는 표시하지 않는다 (A의 순서로 보인다, 4-8).
 */
import { MARK_KEYS, PARA_MARK_PREFIX, newAnnotationId, type CommentAuthor, type Document, type Doc, type TextDelta } from '@quire/model';
import type { LoroDoc } from 'loro-crdt';
import { TEXT, documentFromLoro, storyIdsOf, storyNames } from './shape';

export type Frontiers = Array<{ peer: string; counter: number }>;

const COMPARE: CommentAuthor = { id: 'compare', name: '비교', color: '#7c3aed' };

/**
 * loro(두 시점의 이력을 모두 가진 문서)에서 from → to 비교 문서를 만든다. 편집기는 읽기 전용으로 보여 준다 (previewDocument)
 */
export function compareVersions(loro: LoroDoc, from: Frontiers, to: Frontiers, author: CommentAuthor = COMPARE): Document {
  const a = loro.forkAt(from as never);
  const document = documentFromLoro(a);
  const route = new Map<string, string | null>();
  route.set(String(loro.getText(TEXT).id), null);
  for (const id of new Set([...storyIdsOf(loro), ...storyIdsOf(a)])) route.set(String(loro.getText(storyNames(id).text).id), id);
  const time = Date.now();
  /** UTF-16 구간 [u, u + n)의 화면 끝: 마지막 글자 자리 + 1 (구간 바로 뒤가 구획 표식이면 같은 자리로 접히므로) */
  const endOf = (d: Doc, u: number, n: number) => (n > 0 ? d.offsetOfU16(u + n - 1) + 1 : d.offsetOfU16(u));
  const mark = (story: string | null, kind: 'insert' | 'delete' | 'format' | 'para', s: number, e: number, before?: Record<string, unknown>) => {
    if (e <= s) return;
    document.annotate({ id: newAnnotationId(), type: 'suggestion', story, from: s, to: e, data: { kind, author, time, ...(before ? { before } : {}) } });
  };
  for (const [cid, diff] of loro.diff(from as never, to as never, false)) {
    if (diff.type !== 'text' || !route.has(String(cid))) continue;
    const story = route.get(String(cid))!;
    const d = document.docOf(story);
    let u = 0;
    for (const op of diff.diff as TextDelta) {
      if (op.retain !== undefined) {
        if (op.attributes) markFormat(d, u, op.retain, endOf(d, u, op.retain), op.attributes, (s, e, kind, before) => mark(story, kind, s, e, before));
        u += op.retain;
      } else if (op.insert !== undefined) {
        const s = d.offsetOfU16(u);
        d.applyDelta([...(u ? [{ retain: u }] : []), { insert: op.insert, ...(op.attributes ? { attributes: op.attributes } : {}) }]);
        mark(story, 'insert', s, endOf(d, u, op.insert.length));
        u += op.insert.length;
      } else if (op.delete !== undefined) {
        mark(story, 'delete', d.offsetOfU16(u), endOf(d, u, op.delete));
        u += op.delete;
      }
    }
  }
  return document;
}

/** 서식 변경 (retain + attributes): 키마다 이전 값이 같은 구간을 표시한 뒤 적용한다. 문단 속성은 ¶마다 */
function markFormat(
  d: Doc,
  u: number,
  n: number,
  e: number,
  attrs: Record<string, unknown>,
  mark: (s: number, e: number, kind: 'format' | 'para', before: Record<string, unknown>) => void,
): void {
  const s = d.offsetOfU16(u);
  const out: Array<[number, number, 'format' | 'para', Record<string, unknown>]> = [];
  for (const k of Object.keys(attrs)) {
    if ((MARK_KEYS as readonly string[]).includes(k)) {
      let runStart = s;
      let runVal: string | null = null;
      let val: unknown = null;
      for (let i = s; i <= e; i++) {
        const v = i < e ? ((d.marksAt(i) as Record<string, unknown>)[k] ?? null) : undefined;
        const key = i < e ? JSON.stringify(v) : null;
        if (i > s && key !== runVal) {
          out.push([runStart, i, 'format', { [k]: val }]);
          runStart = i;
        }
        runVal = key;
        val = v;
      }
    } else if (k.startsWith(PARA_MARK_PREFIX)) {
      const key = k.slice(PARA_MARK_PREFIX.length);
      const text = Array.from(d.text());
      for (let i = s; i < e; i++) {
        if (text[i] !== '\n') continue;
        const pi = d.paragraphIndexAt(i);
        out.push([i, i + 1, 'para', { [key]: (d.paraAttrs(pi) as Record<string, unknown>)[key] ?? null }]);
      }
    }
  }
  d.applyDelta([...(u ? [{ retain: u }] : []), { retain: n, attributes: attrs }]);
  for (const [a, b, kind, before] of out) mark(a, b, kind, before);
}
