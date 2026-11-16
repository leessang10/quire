/**
 * 무작위 동시 편집: 피어 3개가 무작위 편집과 부분 동기화를 반복한 뒤 전체 동기화 → 모두 같은 문서인지,
 * 구조 조건을 어기는 상태가 생기는지 센다.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { M1, M2, M3, send, syncAll, type Model, type Replica } from './models';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const ALPHA = Array.from('가나다라마바사아자차');

function randomEdit(r: () => number, x: Replica): string {
  const paras = x.paragraphs();
  const n = paras.length;
  if (n === 0) return 'skip';
  const p = Math.floor(r() * n);
  const len = Array.from(paras[p]!).length;
  const roll = r();
  if (roll < 0.35) {
    x.insertText(p, Math.floor(r() * (len + 1)), ALPHA[Math.floor(r() * ALPHA.length)]!.repeat(1 + Math.floor(r() * 3)));
    return 'insert';
  }
  if (roll < 0.5 && len > 0) {
    const at = Math.floor(r() * len);
    x.deleteText(p, at, Math.min(len - at, 1 + Math.floor(r() * 3)));
    return 'delete';
  }
  if (roll < 0.65) {
    x.split(p, Math.floor(r() * (len + 1)));
    return 'split';
  }
  if (roll < 0.78 && p + 1 < n) {
    x.merge(p);
    return 'merge';
  }
  if (roll < 0.9 && n > 1) {
    x.move(p, Math.floor(r() * n));
    return 'move';
  }
  if (roll < 0.95 && n > 1) {
    x.deletePara(p);
    return 'deletePara';
  }
  if (x.undo()) return 'undo';
  return 'skip';
}

interface Stats {
  runs: number;
  converged: number;
  invariantViolations: number;
  errors: number;
  examples: string[];
}

function fuzz(model: Model, seeds: number, steps: number): Stats {
  const stats: Stats = { runs: 0, converged: 0, invariantViolations: 0, errors: 0, examples: [] };
  for (let seed = 1; seed <= seeds; seed++) {
    const r = rng(seed);
    const snap = model.createBase(['가나다라', '마바사아', '자차카타', '하하하하', '나나나나']);
    const peers = [model.replica(snap, 10), model.replica(snap, 20), model.replica(snap, 30)];
    stats.runs++;
    try {
      for (let step = 0; step < steps; step++) {
        const x = peers[Math.floor(r() * peers.length)]!;
        randomEdit(r, x);
        if (r() < 0.25) {
          const a = peers[Math.floor(r() * peers.length)]!;
          const b = peers[Math.floor(r() * peers.length)]!;
          if (a !== b) send(a, b);
        }
      }
      syncAll(...peers);
      const views = peers.map((p) => JSON.stringify(p.paragraphs()));
      if (views.every((v) => v === views[0])) stats.converged++;
      const bad = peers.map((p) => p.invariantViolation()).find((v) => v);
      if (bad) {
        stats.invariantViolations++;
        if (stats.examples.length < 3) stats.examples.push(`seed ${seed}: ${bad}`);
      }
    } catch (e) {
      stats.errors++;
      if (stats.examples.length < 3) stats.examples.push(`seed ${seed}: 오류 ${String(e).slice(0, 200)}`);
    }
  }
  return stats;
}

describe('V4 randomized convergence (3 peers)', () => {
  const out: string[] = [];
  for (const model of [M1, M2, M3]) {
    it(model.name, () => {
      const s = fuzz(model, 200, 150);
      out.push(
        `- ${model.name}: 실행 ${s.runs}, 수렴 ${s.converged}, 구조 위반 ${s.invariantViolations}, 오류 ${s.errors}` +
          (s.examples.length ? `\n  - 예: ${s.examples.join(' / ')}` : ''),
      );
      expect(s.errors).toBe(0);
      expect(s.converged).toBe(s.runs);
    }, 600_000);
  }
  it('writes summary', () => {
    mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../results/random.md', import.meta.url), out.join('\n') + '\n');
    console.log(out.join('\n'));
  });
});
