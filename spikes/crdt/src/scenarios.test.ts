import { writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { M1, M2 } from './models';
import { SCENARIOS, runScenario, type Result } from './scenarios';

const LABEL: Record<string, string> = {
  pass: '✅ 통과',
  misplaced: '⚠️ 위치 어긋남',
  lost: '❌ 유실',
  duplicated: '❌ 중복',
};

describe('V4 intent scenarios', () => {
  const results: Result[] = [];

  for (const model of [M1, M2]) {
    for (const s of SCENARIOS) {
      it(`${model.name} ${s.id} ${s.title}`, () => {
        const r = runScenario(model, s);
        results.push(r);
        expect(r.error).toBeUndefined();
        // 의도 보존은 결과로 기록만 하고, 수렴은 반드시 보장되어야 한다
        expect(r.converged).toBe(true);
      });
    }
  }

  it('writes the comparison table', () => {
    const rows = SCENARIOS.map((s) => {
      const r1 = results.find((r) => r.scenario === s && r.model === M1.name)!;
      const r2 = results.find((r) => r.scenario === s && r.model === M2.name)!;
      const cell = (r: Result) =>
        `${LABEL[r.verdict]}${r.verdict === 'pass' ? '' : `<br>\`${JSON.stringify(r.actual)}\``}${r.invariant ? `<br>구조 위반: ${r.invariant}` : ''}`;
      return `| ${s.id} | ${s.title} | ${cell(r1)} | ${cell(r2)} |`;
    });
    const count = (m: string, v: string) => results.filter((r) => r.model === m && r.verdict === v).length;
    const summary = [M1, M2].map(
      (m) =>
        `- ${m.name}: 통과 ${count(m.name, 'pass')}, 위치 어긋남 ${count(m.name, 'misplaced')}, 유실 ${count(m.name, 'lost')}, 중복 ${count(m.name, 'duplicated')} / ${SCENARIOS.length}`,
    );
    const md = [
      '| # | 시나리오 | M1 평평한 텍스트 | M2 문단 리스트 |',
      '|---|---|---|---|',
      ...rows,
      '',
      ...summary,
      '',
    ].join('\n');
    mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../results/scenarios.md', import.meta.url), md);
    console.log(md);
  });
});
