/**
 * 위치 변환 성질 시험: 같은 상태에서 A 다음 B' = B 다음 A' (TP1), 캐럿 위치도 같은 글자 앞에 남는다.
 */
import { describe, expect, it } from 'vitest';
import { mapPosThrough, transform, type LocalChange, type RemoteOp } from './ot';

function apply(s: string, ops: ReadonlyArray<LocalChange | RemoteOp>): string {
  for (const op of ops) {
    if (op.kind === 'insert') s = s.slice(0, op.at) + op.text + s.slice(op.at);
    else if (op.kind === 'delete') s = s.slice(0, op.at) + s.slice(op.at + op.len);
  }
  return s;
}

function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

/** s 위에서 차례로 적용할 수 있는 무작위 연산 n개. 넣는 글자에 표식을 붙여 서로 구별되게 한다 */
function randomOps(r: () => number, s: string, n: number, tag: string): RemoteOp[] {
  const ops: RemoteOp[] = [];
  let len = s.length;
  for (let k = 0; k < n; k++) {
    if (len === 0 || r() < 0.55) {
      const at = Math.floor(r() * (len + 1));
      const text = tag.repeat(1 + Math.floor(r() * 3));
      ops.push({ kind: 'insert', at, text });
      len += text.length;
    } else {
      const at = Math.floor(r() * len);
      const n2 = 1 + Math.floor(r() * Math.min(5, len - at));
      ops.push({ kind: 'delete', at, len: n2 });
      len -= n2;
    }
  }
  return ops;
}

describe('transform', () => {
  it('converges (TP1) on random op lists', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const r = rng(seed);
      const base = 'abcdefghij'.slice(0, Math.floor(r() * 11));
      const A = randomOps(r, base, 1 + Math.floor(r() * 4), 'L');
      const B = randomOps(r, base, 1 + Math.floor(r() * 4), 'R');
      const [A2, B2] = transform(A, B);
      const viaA = apply(apply(base, A), B2);
      const viaB = apply(apply(base, B), A2);
      expect(viaA, `seed ${seed}`).toBe(viaB);
    }
  });

  it('puts the remote insert first when both insert at the same place', () => {
    const [A2, B2] = transform([{ kind: 'insert', at: 1, text: 'L' }], [{ kind: 'insert', at: 1, text: 'R' }]);
    expect(apply(apply('ab', [{ kind: 'insert', at: 1, text: 'R' }]), A2)).toBe('aRLb');
    expect(apply(apply('ab', [{ kind: 'insert', at: 1, text: 'L' }]), B2)).toBe('aRLb');
  });

  it('keeps a caret in front of the same character', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const r = rng(seed);
      const base = 'abcdefghij';
      const B = randomOps(r, base, 1 + Math.floor(r() * 4), 'R');
      const at = Math.floor(r() * base.length);
      const ch = base[at]!;
      const after = apply(base, B);
      const [[sel]] = transform([{ kind: 'sel', anchor: at, head: at }], B) as unknown as [[{ kind: 'sel'; anchor: number }], RemoteOp[]];
      const p = mapPosThrough(at, B as LocalChange[]);
      expect(sel!.anchor).toBe(p);
      // 글자가 살아 있으면 그 글자 앞
      if (after.includes(ch)) expect(after[p], `seed ${seed}`).toBe(ch);
    }
  });
});
