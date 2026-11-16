/**
 * 구획 정리 규칙 시험
 *
 * R2  문단 삭제 때 숨긴 구획의 내용을 같은 커밋에서 지운다 (M5 = M4 + R2)
 * R3  이웃한 구획 사이 BRK와 order 항목을 온라인 편집 중에 물리적으로 지운다 (M4.compactPhysical)
 * 크기  무작위 편집 뒤 BRK·order·숨긴 내용이 얼마나 쌓이는지, 정리하면 얼마나 줄어드는지
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { M4, M5, send, syncAll, type Model, type Replica, type SegStats } from './models';
import { BASE, runScenario, type Result, type Scenario } from './scenarios';
import { MOVE_HEAVY, NORMAL, randomEdit, rng, type Mix } from './fuzz';

const [A, B, C, D] = BASE as [string, string, string, string];

const LABEL: Record<string, string> = {
  pass: '✅ 통과',
  misplaced: '⚠️ 위치 어긋남',
  lost: '❌ 유실',
  duplicated: '❌ 중복',
};

const cell = (r: Result) =>
  r.error
    ? `오류 ${r.error.slice(0, 80)}`
    : `${LABEL[r.verdict]}${r.verdict === 'pass' ? '' : `<br>\`${JSON.stringify(r.actual)}\``}`;

/** 첫 문단을 맨 뒤로 보냈다가 다시 맨 앞으로: 화면은 처음과 같지만 하나로 볼 수 있는 구획 둘이 남는다 */
function fragment(a: Replica, b: Replica): void {
  a.move(0, 3);
  a.move(3, 0);
  syncAll(a, b);
}

interface CompactCase {
  id: string;
  title: string;
  /** B의 동시 편집 */
  b: (r: Replica) => void;
  expect: string[][];
}

const COMPACT_CASES: CompactCase[] = [
  { id: 'C1', title: '정리 ∥ 첫 문단 삭제', b: (r) => r.deletePara(0), expect: [[B, C, D]] },
  { id: 'C2', title: '정리 ∥ 첫 문단을 맨 뒤로', b: (r) => r.move(0, 3), expect: [[B, C, D, A]] },
  { id: 'C3', title: '정리 ∥ 마지막 문단을 첫 문단 다음으로', b: (r) => r.move(3, 1), expect: [[A, D, B, C]] },
  { id: 'C4', title: '정리 ∥ 첫 문단에 입력', b: (r) => r.insertText(0, 0, 'X'), expect: [['X' + A, B, C, D]] },
];

function compactScenario(c: CompactCase, compact: boolean): Scenario {
  return {
    id: c.id,
    title: c.title,
    intent: '',
    run: (a, b) => {
      fragment(a, b);
      if (compact) a.compactPhysical!();
      c.b(b);
      syncAll(a, b);
    },
    expect: c.expect,
  };
}

const HIDE_CASES: Scenario[] = [
  {
    id: 'D1',
    title: '삭제 ∥ 같은 문단에 입력',
    intent: '삭제가 이긴다',
    a: (r) => r.deletePara(1),
    b: (r) => r.insertText(1, 2, 'X'),
    expect: [[A, C, D]],
  },
  {
    id: 'D2',
    title: '삭제 후 실행 취소',
    intent: '원래대로',
    run: (a, b) => {
      a.deletePara(1);
      a.undo();
      syncAll(a, b);
    },
    expect: [BASE],
  },
  {
    id: 'D3',
    title: '삭제 ∥ 같은 문단 이동',
    intent: '삭제가 이긴다',
    a: (r) => r.deletePara(1),
    b: (r) => r.move(1, 3),
    expect: [[A, C, D]],
  },
  {
    id: 'D4',
    title: '삭제 ∥ 앞 문단과 병합',
    intent: '앞 문단 내용은 남는다',
    a: (r) => r.deletePara(1),
    b: (r) => r.merge(0),
    expect: [[A, C, D]],
  },
  {
    id: 'D5',
    title: '삭제 ∥ 같은 문단에 입력, 그 뒤 삭제 실행 취소',
    intent: '문단과 동시 입력이 모두 돌아온다',
    run: (a, b) => {
      a.deletePara(1);
      b.insertText(1, 2, 'X');
      syncAll(a, b);
      a.undo();
      syncAll(a, b);
    },
    expect: [[A, '마바X사아', C, D]],
  },
];

interface Growth {
  steps: number;
  runs: number;
  avg: SegStats;
  /** 모든 피어가 동기화된 뒤 한 피어가 R3를 실행하고 다시 동기화했을 때 */
  afterCompact: SegStats;
  converged: number;
}

function zero(): SegStats {
  return { liveChars: 0, hiddenChars: 0, brk: 0, orderLen: 0, segs: 0, runs: 0, visibleRuns: 0 };
}

function add(t: SegStats, s: SegStats): void {
  for (const k of Object.keys(t) as Array<keyof SegStats>) t[k] += s[k];
}

function div(t: SegStats, n: number): SegStats {
  const o = zero();
  for (const k of Object.keys(t) as Array<keyof SegStats>) o[k] = Math.round((t[k] / n) * 10) / 10;
  return o;
}

function growth(model: Model, mix: Mix, seeds: number, steps: number): Growth {
  const sum = zero();
  const sumAfter = zero();
  let converged = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = rng(seed);
    const snap = model.createBase(['가나다라', '마바사아', '자차카타', '하하하하', '나나나나']);
    const peers = [model.replica(snap, 10), model.replica(snap, 20), model.replica(snap, 30)];
    for (let step = 0; step < steps; step++) {
      randomEdit(r, peers[Math.floor(r() * peers.length)]!, mix);
      if (r() < 0.25) {
        const a = peers[Math.floor(r() * peers.length)]!;
        const b = peers[Math.floor(r() * peers.length)]!;
        if (a !== b) send(a, b);
      }
    }
    syncAll(...peers);
    add(sum, peers[0]!.stats!());
    const before = JSON.stringify(peers[0]!.paragraphs());
    // 동시 편집이 없는 시점의 정리: 화면이 바뀌면 안 된다
    peers[0]!.compactPhysical!();
    syncAll(...peers);
    add(sumAfter, peers[0]!.stats!());
    const views = peers.map((p) => JSON.stringify(p.paragraphs()));
    if (views.every((v) => v === before)) converged++;
  }
  return { steps, runs: seeds, avg: div(sum, seeds), afterCompact: div(sumAfter, seeds), converged };
}

describe('segment cleanup', () => {
  const out: string[] = [];

  it('R3: physical compaction during concurrent edits', () => {
    const rows: string[] = [];
    for (const c of COMPACT_CASES) {
      const plain = runScenario(M4, compactScenario(c, false));
      const comp = runScenario(M4, compactScenario(c, true));
      expect(plain.converged).toBe(true);
      expect(comp.converged).toBe(true);
      rows.push(`| ${c.id} | ${c.title} | ${cell(plain)} | ${cell(comp)} |`);
    }
    out.push(
      '## R3: 편집 중 물리적 정리 (M4, 첫 문단을 뒤로 보냈다가 되돌려 이웃 구획 둘을 만든 뒤)',
      '',
      '| # | 시나리오 | 정리 안 함 | A가 정리 |',
      '|---|---|---|---|',
      ...rows,
      '',
    );
  });

  it('R2: clear hidden content on paragraph delete', () => {
    const rows: string[] = [];
    for (const s of HIDE_CASES) {
      const r4 = runScenario(M4, s);
      const r5 = runScenario(M5, s);
      expect(r4.converged).toBe(true);
      expect(r5.converged).toBe(true);
      rows.push(`| ${s.id} | ${s.title} | ${cell(r4)} | ${cell(r5)} |`);
    }
    out.push('## R2: 문단 삭제 때 숨긴 내용 지우기', '', '| # | 시나리오 | M4 | M5 (M4 + R2) |', '|---|---|---|---|', ...rows, '');
  });

  it('growth', () => {
    const rows: string[] = [];
    const fmt = (s: SegStats) =>
      `${s.liveChars} | ${s.hiddenChars} | ${s.brk} | ${s.orderLen} | ${s.segs} | ${s.runs} | ${s.visibleRuns}`;
    for (const [mixName, mix] of [
      ['일반', NORMAL],
      ['이동 35%', MOVE_HEAVY],
    ] as const) {
      for (const model of [M4, M5]) {
        const g = growth(model, mix, 20, 150);
        expect(g.converged).toBe(g.runs);
        rows.push(`| ${model.name} | ${mixName} | 편집 직후 | ${fmt(g.avg)} |`);
        rows.push(`| ${model.name} | ${mixName} | 동기화 후 R3 | ${fmt(g.afterCompact)} |`);
      }
    }
    out.push(
      '## 크기 (피어 3개 × 150 편집, 20회 평균, 시작 문서 25글자 + ¶ 5개)',
      '',
      '| 모델 | 편집 비율 | 시점 | 내용 글자 | 그중 숨긴 글자 | BRK | order 항목 | 구획 | 하나로 본 구획 | 숨긴 구획 건너뛰고 하나로 본 구획 |',
      '|---|---|---|---|---|---|---|---|---|---|',
      ...rows,
      '',
    );
  }, 1_800_000);

  it('writes summary', () => {
    mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../results/cleanup.md', import.meta.url), out.join('\n'));
    console.log(out.join('\n'));
  });
});
