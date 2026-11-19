/**
 * 주석 레이어 (01 §4, 14 §2): 문서 구조를 쪼개지 않는 범위. 스토리 어디에나 걸리고 서로 겹친다. 댓글·제안·강조가 이것을 쓴다.
 *
 * - 범위는 그 스토리 Doc의 위치(원소 ID + side)다. 시작 = 첫 원소 앞 (그 앞에 넣은 글은 밖), 끝 = 마지막 원소 뒤 (그 뒤에 넣은 글은 밖).
 *   그래서 동시 편집·실행 취소 뒤에도 같은 원소들을 덮는다.
 * - 범위 안 원소가 모두 지워지면 고아다 (주석은 남고 범위가 없다). 원소가 돌아오면 범위도 돌아온다.
 * - 동기화 (14 §2.2): Loro 맵 annotations에 키 "<id>|<key>" (type·story·start·end·data, 키마다 LWW). 시작·끝은 Loro 커서.
 */
import type { Position } from './doc';

/** 주석 하나 */
export interface Annotation {
  id: string;
  /** comment, suggestion, highlight … */
  type: string;
  /** 스토리 (null이면 본문) */
  story: string | null;
  /** 시작·끝 위치 (원소 사이의 틈). 범위가 없으면 null */
  start: Position | null;
  end: Position | null;
  /** 종류별 데이터 */
  data: Record<string, unknown>;
}

/** 주석 키 (동기화: 키마다 LWW) */
export type AnnotationKey = 'type' | 'story' | 'data' | 'range';

/**
 * 주석 변경 기록 (Document → 동기화). annKey: 범위가 아닌 키 (value undefined = 지움). annRange: 범위 (그 스토리의 화면 오프셋,
 * [start, end), 범위가 없으면 null). 지우기는 type을 지우는 것이다 (14 §2.2: 지운 것이 같은 때의 다른 키 변경을 이긴다)
 */
export type AnnotationChange =
  | { kind: 'annKey'; id: string; key: 'type' | 'story' | 'data'; value: unknown }
  | { kind: 'annRange'; id: string; story: string | null; start: number | null; end: number | null };

/** 범위를 풀어 쓴 주석 (화면 오프셋). 고아면 from = to = 원소가 있던 자리, orphan = true */
export interface AnnotationRange {
  id: string;
  type: string;
  story: string | null;
  from: number;
  to: number;
  orphan: boolean;
  data: Record<string, unknown>;
}

/** 새 주석 ID (피어마다 겹치지 않게 무작위) */
export function newAnnotationId(): string {
  return `a${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
