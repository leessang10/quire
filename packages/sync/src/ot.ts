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
import { OBJ_MARK_PREFIX, PARA_MARK_PREFIX, type RawChange, type TableChange } from '@quire/model';

/** 원격 텍스트 연산 (Loro 이벤트 델타를 차례로 적용할 단위로 편 것) */
export type RemoteOp = (
  | { kind: 'insert'; at: number; text: string; attributes?: Record<string, unknown> }
  | { kind: 'delete'; at: number; len: number }
  /** 서식만 바꿈 (Loro 델타의 retain + attributes, 10 §3). 값 null = 해제. 위치·길이는 바뀌지 않는다 */
  | { kind: 'format'; at: number; len: number; attributes: Record<string, unknown> }
) & {
  /** 본문이 아닌 스토리의 연산 (11 §2.5). 위치는 그 스토리 텍스트 기준 */
  story?: string;
};

type Fmt = Extract<RemoteOp, { kind: 'format' }>;

/** 로컬 변경: Doc의 변경 기록 + 선택 영역(프레즌스) */
export type LocalChange = (RawChange | TableChange | { kind: 'sel'; anchor: number; head: number }) & { story?: string };

type Del = { kind: 'delete'; at: number; len: number };

/** 원격 델타(retain/insert/delete) → 차례로 적용할 연산 목록. 속성을 바꾸는 retain은 format (구획 키는 뺀다) */
export function deltaToOps(
  delta: Array<{ retain?: number; insert?: string; delete?: number; attributes?: Record<string, unknown> }>,
  out: RemoteOp[] = [],
  story?: string,
): RemoteOp[] {
  const start = out.length;
  let pos = 0;
  for (const d of delta) {
    if (d.retain !== undefined) {
      if (d.attributes && d.retain > 0) {
        const attributes: Record<string, unknown> = {};
        let any = false;
        for (const [k, v] of Object.entries(d.attributes)) {
          if (k === 'seg') continue;
          attributes[k] = v ?? null;
          any = true;
        }
        if (any) out.push({ kind: 'format', at: pos, len: d.retain, attributes });
      }
      pos += d.retain;
    } else if (d.insert !== undefined) {
      if (d.insert.length === 0) continue;
      out.push(d.attributes ? { kind: 'insert', at: pos, text: d.insert, attributes: d.attributes } : { kind: 'insert', at: pos, text: d.insert });
      pos += d.insert.length;
    } else if (d.delete !== undefined && d.delete > 0) {
      out.push({ kind: 'delete', at: pos, len: d.delete });
    }
  }
  if (story !== undefined) for (let k = start; k < out.length; k++) out[k] = { ...out[k]!, story };
  return out;
}

/** 연산 하나 → Doc.applyDelta 입력 */
export function opToDelta(op: RemoteOp): Array<{ retain?: number; insert?: string; delete?: number; attributes?: Record<string, unknown> }> {
  const head = op.at > 0 ? [{ retain: op.at }] : [];
  if (op.kind === 'format') return [...head, { retain: op.len, attributes: op.attributes }];
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
/** 서식 연산 하나를 [x, y) 구간으로 자른 조각 (attrs를 바꿀 수 있음, 빈 것은 없음) */
function fmtPiece(b: Fmt, x: number, y: number, attributes = b.attributes): Fmt[] {
  return y > x && Object.keys(attributes).length > 0 ? [{ kind: 'format', at: x, len: y - x, attributes }] : [];
}

/** b의 [x, y) 구간에서 키 하나를 뺀다 (그 구간은 로컬 변경이 이긴다) */
function withoutKey(b: Fmt, key: string, x: number, y: number): Fmt[] {
  if (!(key in b.attributes)) return [b];
  const lo = Math.max(b.at, x);
  const hi = Math.min(b.at + b.len, y);
  if (lo >= hi) return [b];
  const rest = { ...b.attributes };
  delete rest[key];
  return [...fmtPiece(b, b.at, lo), ...fmtPiece(b, lo, hi, rest), ...fmtPiece(b, hi, b.at + b.len)];
}

/**
 * 로컬 변경 a와 원격 서식 b. 서식은 위치를 옮기지 않으므로 a는 그대로이고 b만 바뀐다.
 * - 로컬 삽입이 b 안에 들어오면 b를 둘로 나눈다: 넣은 글자의 서식은 로컬이 정한다 (Worker의 쓰기가 넣은 글자의 마크를
 *   Doc과 같게 고치므로 Loro에서도 그렇다).
 * - 로컬 삭제는 b를 줄인다.
 * - 로컬 서식·문단 속성이 같은 키를 겹쳐 바꾸면 그 구간에서 b의 그 키를 뺀다: Worker는 로컬 변경을 원격 뒤에 적용하므로
 *   Loro에서 로컬이 이긴다.
 */
function pairFormat(a: LocalChange, b: Fmt): [LocalChange[], RemoteOp[]] {
  if (a.kind === 'insert') {
    const la = len16(a);
    if (a.at <= b.at) return [[a], [{ ...b, at: b.at + la }]];
    if (a.at >= b.at + b.len) return [[a], [b]];
    return [[a], [...fmtPiece(b, b.at, a.at), ...fmtPiece(b, a.at + la, b.at + b.len + la)]];
  }
  if (a.kind === 'delete') {
    const d = delAfterDel({ kind: 'delete', at: b.at, len: b.len }, a.at, a.len);
    return [[a], d ? [{ ...b, at: d.at, len: d.len }] : []];
  }
  if (a.kind === 'mark') return [[a], withoutKey(b, a.key, a.at, a.at + a.len)];
  if (a.kind === 'para') return [[a], withoutKey(b, PARA_MARK_PREFIX + a.key, a.at, a.at + 1)];
  if (a.kind === 'obj') return [[a], withoutKey(b, OBJ_MARK_PREFIX + a.key, a.at, a.at + 1)];
  return [[a], [b]];
}

/** 스토리가 다르면 서로 영향이 없다. 같으면 같은 스토리 표시를 결과에 다시 붙인다 (조각낸 연산도) */
function pair(a: LocalChange, b: RemoteOp): [LocalChange[], RemoteOp[]] {
  if ((a.story ?? null) !== (b.story ?? null)) return [[a], [b]];
  const st = a.story;
  const [x, y] = pairSame(a, b);
  if (st === undefined) return [x, y];
  return [x.map((c) => (c.story === st ? c : { ...c, story: st })), y.map((o) => (o.story === st ? o : { ...o, story: st }))];
}

function pairSame(a: LocalChange, b: RemoteOp): [LocalChange[], RemoteOp[]] {
  if (a.kind === 'sel') return [[{ kind: 'sel', anchor: mapPos(a.anchor, b), head: mapPos(a.head, b) }], [b]];
  if (b.kind === 'format') return pairFormat(a, b);
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
  if (a.kind === 'para' || a.kind === 'obj') {
    // ¶·개체 하나의 위치: 앞(같은 자리 포함)에 들어온 삽입만큼 밀리고, 그 글자가 지워졌으면 버린다
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
  for (const c of changes) if (c.story === undefined) pos = mapPos(pos, c);
  return pos;
}
