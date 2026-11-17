/**
 * 무작위 동시 편집: 피어 3개가 무작위 편집과 부분 동기화를 반복한 뒤 전체 동기화 → 모두 같은 문서인지,
 * 구조 조건을 어기는 상태가 생기는지 센다.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { M1, M2, M3, M4, M5, send, syncAll, type Model } from './models';
import { MOVE_HEAVY, NORMAL, randomEdit, rng, type Mix } from './fuzz';
import { Q } from './quire-model';

interface Stats {
  runs: number;
  converged: number;
  invariantViolations: number;
  errors: number;
  examples: string[];
}

function fuzz(model: Model, seeds: number, steps: number, mix: Mix = NORMAL): Stats {
  const stats: Stats = { runs: 0, converged: 0, invariantViolations: 0, errors: 0, examples: [] };
  for (let seed = 1; seed <= seeds; seed++) {
    const r = rng(seed);
    const snap = model.createBase(['가나다라', '마바사아', '자차카타', '하하하하', '나나나나']);
    const peers = [model.replica(snap, 10), model.replica(snap, 20), model.replica(snap, 30)];
    stats.runs++;
    try {
      for (let step = 0; step < steps; step++) {
        const x = peers[Math.floor(r() * peers.length)]!;
        randomEdit(r, x, mix);
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
  for (const model of [M1, M2, M3, M4, M5, Q]) {
    it(model.name, () => {
      const s = fuzz(model, 200, 150);
      out.push(
        `- ${model.name}: 실행 ${s.runs}, 수렴 ${s.converged}, 구조 위반 ${s.invariantViolations}, 오류 ${s.errors}` +
          (s.examples.length ? `\n  - 예: ${s.examples.join(' / ')}` : ''),
      );
      expect(s.errors).toBe(0);
      expect(s.converged).toBe(s.runs);
    }, 1_800_000);
  }
  for (const model of [M3, M4, Q]) {
    it(`${model.name} (이동 위주)`, () => {
      const s = fuzz(model, 200, 150, MOVE_HEAVY);
      out.push(
        `- ${model.name} (이동 35%): 실행 ${s.runs}, 수렴 ${s.converged}, 구조 위반 ${s.invariantViolations}, 오류 ${s.errors}` +
          (s.examples.length ? `
  - 예: ${s.examples.join(' / ')}` : ''),
      );
      expect(s.errors).toBe(0);
      expect(s.converged).toBe(s.runs);
      // 시험 구현은 연산마다 화면 순서를 처음부터 다시 계산하고, 이동이 많으면 BRK가 쌓여 회당 20분 가까이 걸린다
    }, 1_800_000);
  }
  it('writes summary', () => {
    mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../results/random.md', import.meta.url), out.join('\n') + '\n');
    console.log(out.join('\n'));
  });
});
