/**
 * 변경 추적 — 제안 모드 (05 §5, 14 §4). 제안은 문서에 바로 들어간 변경 + 그것을 표시하는 주석(type 'suggestion')이다.
 *
 * - 삽입: 원소를 넣고 { kind: 'insert' }로 범위를 표시한다.
 * - 삭제: 원소를 지우지 않고 { kind: 'delete' }로 표시한다. 범위 안의 내 삽입 제안은 실제로 지운다 (Word와 같다).
 * - 글자 서식: 적용하고 { kind: 'format', before: { 키: 이전 값 } }. 이전 값이 같은 구간마다 주석 하나다 (원소 ID는 피어마다
 *   다르므로 런 목록 대신 구간을 나눈다: 그 사이 범위 안에 넣은 글자도 같은 값으로 되돌린다).
 * - 문단 속성: 적용하고 ¶ 하나 범위에 { kind: 'para', before: { 키: 이전 값 } }.
 * - 이전 값이 없던 키는 null로 쓴다 (JSON에 남게).
 * - 같은 작성자가 이어서 한 삽입·삭제는 한 제안으로 합친다. 같은 구간의 서식·문단 제안이 또 오면 키를 더하고, 이미 있는 키의
 *   이전 값은 처음 값을 둔다 (거부하면 제안 전으로).
 */
import type { CommentAuthor } from './comments';

export type SuggestionKind = 'insert' | 'delete' | 'format' | 'para';

/** 제안 주석의 데이터 */
export interface SuggestionData {
  kind: SuggestionKind;
  author: CommentAuthor;
  time: number;
  /** format·para: 키마다 이전 값 (없던 키는 null) */
  before?: Record<string, unknown>;
}

/** 제안 모드를 켠 편집기가 Document에 주는 것 */
export interface Suggester {
  author: CommentAuthor;
  /** 시각 (시험에서 고정) */
  now?: () => number;
}

export function isSuggestion(a: { type: string; data: Record<string, unknown> }): a is { type: 'suggestion'; data: SuggestionData & Record<string, unknown> } & typeof a {
  return a.type === 'suggestion' && typeof a.data.kind === 'string';
}

/** 겹치는 구간 합치기 ([a, b) 목록, 정렬) */
export function unionIntervals(xs: Array<[number, number]>): Array<[number, number]> {
  const s = xs.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** [a, b)에서 구간들을 뺀 나머지 */
export function subtractIntervals(a: number, b: number, cut: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let at = a;
  for (const [x, y] of unionIntervals(cut)) {
    if (y <= at || x >= b) continue;
    if (x > at) out.push([at, Math.min(x, b)]);
    at = Math.max(at, y);
    if (at >= b) break;
  }
  if (at < b) out.push([at, b]);
  return out;
}
