import { writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { M1, M2, M3, M4, M5 } from './models';
import { Q } from './quire-model';
import { SCENARIOS, runScenario, type Result } from './scenarios';

const MODELS = [M1, M2, M3, M4, M5, Q];

const LABEL: Record<string, string> = {
  pass: '✅ 통과',
  misplaced: '⚠️ 위치 어긋남',
  lost: '❌ 유실',
  duplicated: '❌ 중복',
};

describe('V4 intent scenarios', () => {
  const results: Result[] = [];

  for (const model of MODELS) {
    for (const s of SCENARIOS) {
      it(`${model.name} ${s.id} ${s.title}`, () => {
        const r = runScenario(model, s);
        results.push(r);
        // 의도 보존은 결과로 기록만 하고, 수렴은 반드시 보장되어야 한다.
        // 예외는 기각한 모델(M2: 문단이 0개인 문서에 입력할 수 없음)만 허용하고 표에 기록한다.
        if (r.error && model === M2) return;
        expect(r.error).toBeUndefined();
        expect(r.converged).toBe(true);
      });
    }
  }

  it('writes the comparison table', () => {
    const cell = (r: Result) =>
      r.error
        ? `💥 예외<br>\`${r.error.slice(0, 60)}\``
        : `${LABEL[r.verdict]}${r.verdict === 'pass' ? '' : `<br>\`${JSON.stringify(r.actual)}\``}${r.invariant ? `<br>구조 위반: ${r.invariant}` : ''}`;
    const rows = SCENARIOS.map((s) => {
      const cells = MODELS.map((m) => cell(results.find((r) => r.scenario === s && r.model === m.name)!));
      return `| ${s.id} | ${s.title} | ${cells.join(' | ')} |`;
    });
    const count = (m: string, v: string) => results.filter((r) => r.model === m && r.verdict === v).length;
    const summary = MODELS.map(
      (m) =>
        `- ${m.name}: 통과 ${count(m.name, 'pass')}, 위치 어긋남 ${count(m.name, 'misplaced')}, 유실 ${count(m.name, 'lost')}, 중복 ${count(m.name, 'duplicated')} / ${SCENARIOS.length}`,
    );
    const md = [
      `| # | 시나리오 | ${MODELS.map((m) => m.name).join(' | ')} |`,
      `|---|---|${MODELS.map(() => '---').join('|')}|`,
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
