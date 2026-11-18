/**
 * 메인 스레드 Doc ↔ Worker Loro 사이의 위치 변환 (09 §8).
 *
 * Worker로 옮기면 Doc과 Loro 사이에 지연이 생긴다. Worker가 원격 변경을 보낼 때 메인에는 아직 Worker에 닿지 않은
 * 로컬 변경이 있을 수 있고, 반대로 Worker가 로컬 변경을 받을 때 Worker에는 메인이 아직 받지 못한 원격 변경이 있을 수 있다.
 * 두 쪽 모두 같은 변환 함수로 위치를 맞춘다 (ot.js의 클라이언트·서버 방식: 보낸 것 하나 + 대기열).
 *
 * 위치는 UTF-16 단위의 살아 있는 원소 열(= Loro 텍스트) 기준이다. 구획 표식도 한 글자다.
 * 같은 자리에 양쪽이 넣으면 원격(Worker 쪽에 먼저 있던 것)이 앞, 로컬이 뒤다.
 */
import type { RawChange } from '@quire/model';

/** 원격 텍스트 연산 (Loro 이벤트 델타를 차례로 적용할 단위로 편 것) */
export type RemoteOp =
  | { kind: 'insert'; at: number; text: string; attributes?: Record<string, unknown> }
  | { kind: 'delete'; at: number; len: number };

/** 로컬 변경: Doc의 변경 기록 + 선택 영역(프레즌스) */
export type LocalChange = RawChange | { kind: 'sel'; anchor: number; head: number };

type Del = { kind: 'delete'; at: number; len: number };

/** 원격 델타(retain/insert/delete) → 차례로 적용할 연산 목록. 속성만 바꾸는 retain은 무시 */
export function deltaToOps(
  delta: Array<{ retain?: number; insert?: string; delete?: number; attributes?: Record<string, unknown> }>,
  out: RemoteOp[] = [],
): RemoteOp[] {
  let pos = 0;
  for (const d of delta) {
    if (d.retain !== undefined) pos += d.retain;
    else if (d.insert !== undefined) {
      if (d.insert.length === 0) continue;
      out.push(d.attributes ? { kind: 'insert', at: pos, text: d.insert, attributes: d.attributes } : { kind: 'insert', at: pos, text: d.insert });
      pos += d.insert.length;
    } else if (d.delete !== undefined && d.delete > 0) {
      out.push({ kind: 'delete', at: pos, len: d.delete });
    }
  }
  return out;
}

/** 연산 하나 → Doc.applyDelta 입력 */
export function opToDelta(op: RemoteOp): Array<{ retain?: number; insert?: string; delete?: number; attributes?: Record<string, unknown> }> {
  const head = op.at > 0 ? [{ retain: op.at }] : [];
  return op.kind === 'insert'
    ? [...head, op.attributes ? { insert: op.text, attributes: op.attributes } : { insert: op.text }]
    : [...head, { delete: op.len }];
}

const len16 = (op: { kind: 'insert'; text: string }) => op.text.length;

/** d를 [y, y+n) 삭제 뒤의 좌표로. 겹친 부분은 사라진다 (길이 0이면 null) */
function delAfterDel(d: Del, y: number, n: number): Del | null {
  const x1 = d.at;
  const x2 = d.at + d.len;
  const y2 = y + n;
  const before = Math.max(0, Math.min(x1, y2) - y);
  const overlap = Math.max(0, Math.min(x2, y2) - Math.max(x1, y));
  const len = d.len - overlap;
  return len > 0 ? { kind: 'delete', at: x1 - before, len } : null;
}

/** 캐럿 위치를 연산 뒤의 좌표로 (캐럿은 바로 뒤 글자에 붙는다: 같은 자리 삽입은 캐럿 앞으로) */
export function mapPos(pos: number, op: RemoteOp | LocalChange): number {
  if (op.kind === 'insert') return op.at <= pos ? pos + len16(op) : pos;
  if (op.kind === 'delete') {
    if (pos >= op.at + op.len) return pos - op.len;
    return pos > op.at ? op.at : pos;
  }
  return pos;
}

/**
 * 로컬 변경 a와 원격 연산 b(같은 상태 기준) → [b 뒤의 a, a 뒤의 b]. 삭제는 둘로 나뉠 수 있다.
 */
function pair(a: LocalChange, b: RemoteOp): [LocalChange[], RemoteOp[]] {
  if (a.kind === 'sel') return [[{ kind: 'sel', anchor: mapPos(a.anchor, b), head: mapPos(a.head, b) }], [b]];
  if (a.kind === 'mark') {
    // 서식 범위: 원격 삽입이 안에 들어오면 둘로 나눈다 (넣은 글자는 이 서식 대상이 아니다). 원격 삭제는 범위를 줄인다
    if (b.kind === 'insert') {
      const lb = len16(b);
      if (b.at <= a.at) return [[{ ...a, at: a.at + lb }], [b]];
      if (b.at >= a.at + a.len) return [[a], [b]];
      return [[{ ...a, len: b.at - a.at }, { ...a, at: b.at + lb, len: a.at + a.len - b.at }], [b]];
    }
    const d = delAfterDel({ kind: 'delete', at: a.at, len: a.len }, b.at, b.len);
    return [d ? [{ ...a, at: d.at, len: d.len }] : [], [b]];
  }
  if (a.kind === 'para') {
    // ¶ 하나의 위치: 앞(같은 자리 포함)에 들어온 삽입만큼 밀리고, ¶가 지워졌으면 버린다
    if (b.kind === 'insert') return [[b.at <= a.at ? { ...a, at: a.at + len16(b) } : a], [b]];
    if (a.at >= b.at && a.at < b.at + b.len) return [[], [b]];
    return [[a.at >= b.at + b.len ? { ...a, at: a.at - b.len } : a], [b]];
  }
  if (a.kind !== 'insert' && a.kind !== 'delete') return [[a], [b]];
  if (a.kind === 'insert') {
    const la = len16(a);
    if (b.kind === 'insert') {
      // 같은 자리면 원격이 앞
      return b.at <= a.at ? [[{ ...a, at: a.at + len16(b) }], [b]] : [[a], [{ ...b, at: b.at + la }]];
    }
    // b: 삭제
    if (a.at <= b.at) return [[a], [{ ...b, at: b.at + la }]];
    if (a.at >= b.at + b.len) return [[{ ...a, at: a.at - b.len }], [b]];
    // 삭제 범위 안에 넣음: 넣은 글자는 남고 삭제는 그 앞뒤로 나뉜다
    const left: Del = { kind: 'delete', at: b.at, len: a.at - b.at };
    const right: Del = { kind: 'delete', at: b.at + la, len: b.at + b.len - a.at };
    return [[{ ...a, at: b.at }], [left, right]];
  }
  // a: 삭제
  if (b.kind === 'insert') {
    const lb = len16(b);
    if (b.at <= a.at) return [[{ ...a, at: a.at + lb }], [b]];
    if (b.at >= a.at + a.len) return [[a], [{ ...b, at: b.at - a.len }]];
    const left: Del = { kind: 'delete', at: a.at, len: b.at - a.at };
    const right: Del = { kind: 'delete', at: a.at + lb, len: a.at + a.len - b.at };
    return [[left, right], [{ ...b, at: a.at }]];
  }
  const a2 = delAfterDel(a, b.at, b.len);
  const b2 = delAfterDel(b, a.at, a.len);
  return [a2 ? [a2] : [], b2 ? [b2] : []];
}

/**
 * 로컬 변경 목록 A와 원격 연산 목록 B(같은 상태 기준, 각자 차례로 적용) →
 * [B를 적용한 뒤에 적용할 A, A를 적용한 뒤에 적용할 B].
 */
export function transform(A: readonly LocalChange[], B: readonly RemoteOp[]): [LocalChange[], RemoteOp[]] {
  if (A.length === 0 || B.length === 0) return [[...A], [...B]];
  if (A.length === 1 && B.length === 1) return pair(A[0]!, B[0]!);
  if (A.length > 1) {
    const [a0, B1] = transform([A[0]!], B);
    const [rest, B2] = transform(A.slice(1), B1);
    return [[...a0, ...rest], B2];
  }
  const [A1, b0] = transform(A, [B[0]!]);
  const [A2, rest] = transform(A1, B.slice(1));
  return [A2, [...b0, ...rest]];
}

/** 위치 하나를 로컬 변경 목록 뒤의 좌표로 (원격 캐럿을 메인 Doc 좌표로 옮길 때) */
export function mapPosThrough(pos: number, changes: readonly LocalChange[]): number {
  for (const c of changes) pos = mapPos(pos, c);
  return pos;
}
