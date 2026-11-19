/**
 * 댓글 동기화 (14 §3): Loro 맵 comments에 편집 모델의 댓글 키를 그대로 둔다 (키마다 LWW). 값은 JSON (작성자는 객체).
 * Worker·메인 사이에는 바뀐 키의 값만 오간다 (null = 지움).
 */
import type { LoroDoc } from 'loro-crdt';

export const COMMENTS = 'comments';

/** 키 하나 쓰기 (undefined·null = 지움) */
export function writeCmt(loro: LoroDoc, key: string, value: unknown): void {
  const m = loro.getMap(COMMENTS);
  if (value === undefined || value === null) {
    if (m.get(key) !== undefined) m.delete(key);
  } else m.set(key, value as never);
}

/** 키 하나 읽기 (없으면 null) */
export function readCmt(loro: LoroDoc, key: string): unknown {
  const v = loro.getMap(COMMENTS).get(key);
  return v === undefined ? null : v;
}

/** 모든 키 */
export function readCmts(loro: LoroDoc): Record<string, unknown> {
  return loro.getMap(COMMENTS).toJSON() as Record<string, unknown>;
}
