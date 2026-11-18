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
type TextOp = Extract<RemoteOp, { kind: "insert" | "delete" }>;
function randomOps(r: () => number, s: string, n: number, tag: string): TextOp[] {
  const ops: TextOp[] = [];
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

describe('transform with formats (2-6)', () => {
  type Cell = { c: string; a: Record<string, unknown> };
  const KEYS = ['bold', 'color', 'p_align'];
  const VALS: Record<string, unknown[]> = { bold: [true, null], color: ['#f00', '#00f', null], p_align: ['center', null] };
  const set = (a: Record<string, unknown>, k: string, v: unknown) => {
    const o = { ...a };
    if (v === null || v === undefined) delete o[k];
    else o[k] = v;
    return o;
  };
  const applyLocal = (s: Cell[], cs: LocalChange[]) => {
    const out = s.map((x) => ({ ...x }));
    for (const c of cs) {
      if (c.kind === 'insert') out.splice(c.at, 0, ...Array.from(c.text, (ch) => ({ c: ch, a: { ...(c.marks ?? {}) } as Record<string, unknown> })));
      else if (c.kind === 'delete') out.splice(c.at, c.len);
      else if (c.kind === 'mark') for (let i = c.at; i < c.at + c.len; i++) out[i]!.a = set(out[i]!.a, c.key, c.value);
      else if (c.kind === 'para') out[c.at]!.a = set(out[c.at]!.a, `p_${c.key}`, c.value);
    }
    return out;
  };
  const applyRemote = (s: Cell[], ops: RemoteOp[]) => {
    const out = s.map((x) => ({ ...x }));
    for (const o of ops) {
      if (o.kind === 'insert') out.splice(o.at, 0, ...Array.from(o.text, (ch) => ({ c: ch, a: { ...(o.attributes ?? {}) } })));
      else if (o.kind === 'delete') out.splice(o.at, o.len);
      else for (let i = o.at; i < o.at + o.len; i++) for (const [k, v] of Object.entries(o.attributes)) out[i]!.a = set(out[i]!.a, k, v);
    }
    return out;
  };
  const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

  it('converges for random local edits/marks/paragraph attributes against remote edits/formats (local wins on the same key)', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const r = rng(seed);
      const base: Cell[] = Array.from('abcdefgh'.slice(0, 1 + Math.floor(r() * 8)), (c) => ({ c, a: r() < 0.3 ? { bold: true } : {} }));
      let len = base.length;
      const A: LocalChange[] = [];
      for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) {
        const roll = r();
        if (roll < 0.35 || len === 0) {
          const at = Math.floor(r() * (len + 1));
          A.push(r() < 0.5 ? { kind: 'insert', at, text: 'L' } : { kind: 'insert', at, text: 'L', marks: { color: '#0f0' } });
          len++;
        } else if (roll < 0.55) {
          const at = Math.floor(r() * len);
          const n2 = 1 + Math.floor(r() * Math.min(2, len - at));
          A.push({ kind: 'delete', at, len: n2 });
          len -= n2;
        } else if (roll < 0.85) {
          const at = Math.floor(r() * len);
          const key = pick(r, ['bold', 'color'] as const);
          A.push({ kind: 'mark', at, len: 1 + Math.floor(r() * (len - at)), key, value: pick(r, VALS[key]!) ?? undefined });
        } else A.push({ kind: 'para', at: Math.floor(r() * len), key: 'align', value: pick(r, VALS['p_align']!) ?? undefined });
      }
      len = base.length;
      const B: RemoteOp[] = [];
      for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) {
        const roll = r();
        if (roll < 0.3 || len === 0) {
          const at = Math.floor(r() * (len + 1));
          B.push({ kind: 'insert', at, text: 'R', attributes: r() < 0.5 ? { bold: true } : undefined });
          len++;
        } else if (roll < 0.5) {
          const at = Math.floor(r() * len);
          const n2 = 1 + Math.floor(r() * Math.min(2, len - at));
          B.push({ kind: 'delete', at, len: n2 });
          len -= n2;
        } else {
          const at = Math.floor(r() * len);
          const attributes: Record<string, unknown> = {};
          for (const key of KEYS) if (r() < 0.5) attributes[key] = pick(r, VALS[key]!);
          if (Object.keys(attributes).length === 0) attributes['bold'] = true;
          B.push({ kind: 'format', at, len: 1 + Math.floor(r() * (len - at)), attributes });
        }
      }
      const [A2, B2] = transform(A, B);
      const viaA = applyRemote(applyLocal(base, A), B2);
      const viaB = applyLocal(applyRemote(base, B), A2);
      expect(viaA, `seed ${seed}`).toEqual(viaB);
    }
  });
});
