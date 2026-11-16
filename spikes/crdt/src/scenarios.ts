/**
 * 동시 편집 의도 시나리오 (05 §7)
 *
 * 두 피어 A, B가 같은 기준 문서에서 시작해 동시에 편집하고 동기화한다.
 * 결과는 기대값과 비교해 분류한다.
 *   pass       기대한 결과 (허용 결과 중 하나)
 *   misplaced  글자는 모두 있으나 위치·문단 구분이 의도와 다름
 *   lost       남아야 할 글자가 사라짐
 *   duplicated 글자가 중복됨
 */
import { syncAll, send, type Model, type Replica } from './models';

export const BASE = ['가나다라', '마바사아', '자차카타', '하하하하'];

export type Verdict = 'pass' | 'misplaced' | 'lost' | 'duplicated';

export interface Scenario {
  id: string;
  title: string;
  /** 사람이 읽는 의도 설명 */
  intent: string;
  /** 기본: A와 B의 편집을 동시에 하고 동기화 */
  a?: (r: Replica) => void;
  b?: (r: Replica) => void;
  /** 동기화 순서를 직접 정하는 시나리오 */
  run?: (a: Replica, b: Replica) => void;
  /** 허용 결과 목록 (하나라도 같으면 pass) */
  expect: string[][];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'S1',
    title: '분할 ∥ 같은 문단 끝에 입력',
    intent: 'A가 "가나|다라"로 나누는 동안 B가 문단 끝에 X 입력 → X는 뒤 문단 끝',
    a: (r) => r.split(0, 2),
    b: (r) => r.insertText(0, 4, 'X'),
    expect: [['가나', '다라X', '마바사아', '자차카타', '하하하하']],
  },
  {
    id: 'S2',
    title: '분할 ∥ 나뉠 뒷부분 안에 입력',
    intent: 'A가 "가나|다라"로 나누는 동안 B가 "다X라" 입력 → X는 뒤 문단 안',
    a: (r) => r.split(0, 2),
    b: (r) => r.insertText(0, 3, 'X'),
    expect: [['가나', '다X라', '마바사아', '자차카타', '하하하하']],
  },
  {
    id: 'S3',
    title: '분할 ∥ 분할 지점을 걸친 삭제',
    intent: 'A가 "가나|다라"로 나누는 동안 B가 "나다" 삭제 → "가" / "라"',
    a: (r) => r.split(0, 2),
    b: (r) => r.deleteText(0, 1, 2),
    expect: [['가', '라', '마바사아', '자차카타', '하하하하']],
  },
  {
    id: 'S4',
    title: '병합 ∥ 뒤 문단에 입력',
    intent: 'A가 1·2문단을 합치는 동안 B가 2문단에 X 입력 → 합친 문단 안에 X',
    a: (r) => r.merge(0),
    b: (r) => r.insertText(1, 2, 'X'),
    expect: [['가나다라마바X사아', '자차카타', '하하하하']],
  },
  {
    id: 'S5',
    title: '병합 ∥ 앞 문단 끝에 입력',
    intent: 'A가 1·2문단을 합치는 동안 B가 1문단 끝에 X 입력',
    a: (r) => r.merge(0),
    b: (r) => r.insertText(0, 4, 'X'),
    expect: [['가나다라X마바사아', '자차카타', '하하하하']],
  },
  {
    id: 'S6',
    title: '병합 ∥ 병합 (연쇄)',
    intent: 'A가 1·2문단을, B가 2·3문단을 합침 → 세 문단이 하나로',
    a: (r) => r.merge(0),
    b: (r) => r.merge(1),
    expect: [['가나다라마바사아자차카타', '하하하하']],
  },
  {
    id: 'S7',
    title: '이동 ∥ 이동할 문단 편집',
    intent: 'A가 1문단을 맨 뒤로 옮기는 동안 B가 그 문단에 X 입력 → 옮겨진 문단 안에 X',
    a: (r) => r.move(0, 3),
    b: (r) => r.insertText(0, 2, 'X'),
    expect: [['마바사아', '자차카타', '하하하하', '가나X다라']],
  },
  {
    id: 'S8',
    title: '이동 ∥ 같은 문단을 다른 곳으로 이동',
    intent: 'A는 1문단을 3번째로, B는 4번째로 → 1문단은 둘 중 한 곳에 한 번만',
    a: (r) => r.move(0, 2),
    b: (r) => r.move(0, 3),
    expect: [
      ['마바사아', '자차카타', '가나다라', '하하하하'],
      ['마바사아', '자차카타', '하하하하', '가나다라'],
    ],
  },
  {
    id: 'S9',
    title: '이동 ∥ 이동할 문단 분할',
    intent: 'A가 1문단을 맨 뒤로 옮기는 동안 B가 그 문단을 "가나|다라"로 나눔 → 두 조각 모두 한 번씩',
    a: (r) => r.move(0, 3),
    b: (r) => r.split(0, 2),
    expect: [
      ['마바사아', '자차카타', '하하하하', '가나', '다라'],
      ['다라', '마바사아', '자차카타', '하하하하', '가나'],
    ],
  },
  {
    id: 'S10',
    title: '이동 ∥ 이동할 문단을 앞 문단과 병합',
    intent: 'A가 2문단을 맨 뒤로 옮기는 동안 B가 1·2문단을 합침 → 글자는 모두 한 번씩',
    a: (r) => r.move(1, 3),
    b: (r) => r.merge(0),
    expect: [
      ['가나다라마바사아', '자차카타', '하하하하'],
      ['자차카타', '하하하하', '가나다라마바사아'],
      ['가나다라', '자차카타', '하하하하', '마바사아'],
    ],
  },
  {
    id: 'S11',
    title: '문단 삭제 ∥ 그 문단 편집',
    intent: 'A가 2문단을 지우는 동안 B가 그 문단에 X 입력 → 정책: 삭제 우선(X도 사라짐) 또는 X만 남음',
    a: (r) => r.deletePara(1),
    b: (r) => r.insertText(1, 2, 'X'),
    expect: [
      ['가나다라', '자차카타', '하하하하'],
      ['가나다라', 'X', '자차카타', '하하하하'],
    ],
  },
  {
    id: 'S12',
    title: '같은 위치 동시 입력',
    intent: 'A는 "abc", B는 "XYZ"를 같은 곳에 입력 → 섞이지 않고 한 덩어리씩',
    a: (r) => r.insertText(0, 2, 'abc'),
    b: (r) => r.insertText(0, 2, 'XYZ'),
    expect: [
      ['가나abcXYZ다라', '마바사아', '자차카타', '하하하하'],
      ['가나XYZabc다라', '마바사아', '자차카타', '하하하하'],
    ],
  },
  {
    id: 'S13',
    title: '같은 지점 동시 분할',
    intent: '둘 다 "가나|다라"로 나눔 → 빈 문단이 하나 생기는 것은 허용 (Google Docs와 같음)',
    a: (r) => r.split(0, 2),
    b: (r) => r.split(0, 2),
    expect: [
      ['가나', '다라', '마바사아', '자차카타', '하하하하'],
      ['가나', '', '다라', '마바사아', '자차카타', '하하하하'],
    ],
  },
  {
    id: 'S13b',
    title: '같은 문단 다른 지점 동시 분할',
    intent: 'A는 "가|나다라", B는 "가나다|라"로 나눔 → "가" / "나다" / "라"',
    a: (r) => r.split(0, 1),
    b: (r) => r.split(0, 3),
    expect: [['가', '나다', '라', '마바사아', '자차카타', '하하하하']],
  },
  {
    id: 'S14',
    title: '실행 취소 ∥ 원격 편집',
    intent: 'A가 입력 후 실행 취소, 그 사이 B가 다른 곳에 입력 → A의 입력만 사라짐',
    run: (a, b) => {
      a.insertText(0, 4, 'AAA');
      syncAll(a, b);
      b.insertText(0, 0, 'B');
      a.undo();
      syncAll(a, b);
    },
    expect: [['B가나다라', '마바사아', '자차카타', '하하하하']],
  },
  {
    id: 'S15',
    title: '병합 실행 취소 ∥ 합쳐진 문단 편집',
    intent: 'A가 병합 후 실행 취소, 그 사이 B가 합쳐진 문단 뒷부분에 X 입력 → 원래 두 문단으로, X는 뒤 문단 안',
    run: (a, b) => {
      a.merge(0);
      syncAll(a, b);
      b.insertText(0, 6, 'X');
      a.undo();
      syncAll(a, b);
    },
    expect: [['가나다라', '마바X사아', '자차카타', '하하하하']],
  },
  {
    id: 'S16',
    title: '이동 실행 취소 ∥ 옮겨진 문단 편집',
    intent: 'A가 이동 후 실행 취소, 그 사이 B가 옮겨진 문단에 X 입력 → 제자리로, X 유지',
    run: (a, b) => {
      a.move(0, 3);
      syncAll(a, b);
      b.insertText(3, 1, 'X');
      a.undo();
      syncAll(a, b);
    },
    expect: [['가X나다라', '마바사아', '자차카타', '하하하하']],
  },
  {
    id: 'S17',
    title: '분할 실행 취소 ∥ 뒷부분 편집',
    intent: 'A가 분할 후 실행 취소, 그 사이 B가 뒤 문단에 X 입력 → 한 문단으로, X 유지',
    run: (a, b) => {
      a.split(0, 2);
      syncAll(a, b);
      b.insertText(1, 1, 'X');
      a.undo();
      syncAll(a, b);
    },
    expect: [['가나다X라', '마바사아', '자차카타', '하하하하']],
  },
  // ── 이동 경계 시나리오 (M3 검증용) ──
  {
    id: 'S18',
    title: '서로 다른 문단을 같은 자리로 이동',
    intent: 'A는 1문단을, B는 2문단을 맨 뒤로 → 둘 다 뒤로 가고 나머지 순서 유지',
    a: (r) => r.move(0, 3),
    b: (r) => r.move(1, 3),
    expect: [
      ['자차카타', '하하하하', '가나다라', '마바사아'],
      ['자차카타', '하하하하', '마바사아', '가나다라'],
    ],
  },
  {
    id: 'S18b',
    title: '서로 다른 문단을 동시에 맨 앞으로 (S18 거울)',
    intent: 'A는 4문단을, B는 3문단을 맨 앞으로 → 둘 다 앞으로 가고 나머지 순서 유지',
    a: (r) => r.move(3, 0),
    b: (r) => r.move(2, 0),
    expect: [
      ['하하하하', '자차카타', '가나다라', '마바사아'],
      ['자차카타', '하하하하', '가나다라', '마바사아'],
    ],
  },
  {
    id: 'S18c',
    title: '서로 다른 문단을 동시에 같은 중간 지점으로',
    intent: 'A는 1문단을, B는 4문단을 3문단 앞으로 → 둘 다 3문단 앞, 나머지 순서 유지',
    a: (r) => r.move(0, 1),
    b: (r) => r.move(3, 2),
    expect: [
      ['마바사아', '가나다라', '하하하하', '자차카타'],
      ['마바사아', '하하하하', '가나다라', '자차카타'],
    ],
  },
  {
    id: 'S18d',
    title: '이웃한 두 문단을 동시에 서로 반대쪽 끝으로',
    intent: 'A는 2문단을 맨 앞으로, B는 3문단을 맨 뒤로',
    a: (r) => r.move(1, 0),
    b: (r) => r.move(2, 3),
    expect: [['마바사아', '가나다라', '하하하하', '자차카타']],
  },
  {
    id: 'S19',
    title: '두 문단 맞바꾸기 (동시)',
    intent: 'A는 1문단을 맨 뒤로, B는 4문단을 맨 앞으로',
    a: (r) => r.move(0, 3),
    b: (r) => r.move(3, 0),
    expect: [['하하하하', '마바사아', '자차카타', '가나다라']],
  },
  {
    id: 'S20',
    title: '이동 ∥ 이동할 문단 바로 앞 문단 끝에 입력',
    intent: 'A가 2문단을 맨 뒤로 옮기는 동안 B가 1문단 끝에 X → X는 1문단에 남음',
    a: (r) => r.move(1, 3),
    b: (r) => r.insertText(0, 4, 'X'),
    expect: [['가나다라X', '자차카타', '하하하하', '마바사아']],
  },
  {
    id: 'S21',
    title: '이동 ∥ 이동할 문단 바로 뒤 문단 맨 앞에 입력',
    intent: 'A가 2문단을 맨 뒤로 옮기는 동안 B가 3문단 맨 앞에 X → X는 3문단에 남음',
    a: (r) => r.move(1, 3),
    b: (r) => r.insertText(2, 0, 'X'),
    expect: [['가나다라', 'X자차카타', '하하하하', '마바사아']],
  },
  {
    id: 'S22',
    title: '이동 ∥ 이동할 문단 맨 앞에 입력',
    intent: 'A가 2문단을 맨 뒤로 옮기는 동안 B가 그 문단 맨 앞에 X → X도 함께 이동',
    a: (r) => r.move(1, 3),
    b: (r) => r.insertText(1, 0, 'X'),
    expect: [['가나다라', '자차카타', '하하하하', 'X마바사아']],
  },
  {
    id: 'S23',
    title: '이동 ∥ 이동할 문단 끝에 입력',
    intent: 'A가 2문단을 맨 뒤로 옮기는 동안 B가 그 문단 끝에 X → X도 함께 이동',
    a: (r) => r.move(1, 3),
    b: (r) => r.insertText(1, 4, 'X'),
    expect: [['가나다라', '자차카타', '하하하하', '마바사아X']],
  },
  {
    id: 'S24',
    title: '이동 ∥ 이동할 문단과 다음 문단 병합',
    intent: 'A가 2문단을 맨 뒤로 옮기는 동안 B가 2·3문단을 합침 → 글자는 모두 한 번씩',
    a: (r) => r.move(1, 3),
    b: (r) => r.merge(1),
    expect: [
      ['가나다라', '하하하하', '마바사아자차카타'],
      ['가나다라', '마바사아자차카타', '하하하하'],
      ['가나다라', '자차카타', '하하하하', '마바사아'],
      ['가나다라', '하하하하', '마바사아', '자차카타'],
    ],
  },
  {
    id: 'S25',
    title: '이동 ∥ 이동 목적지 문단 삭제',
    intent: 'A가 1문단을 4문단 앞으로 옮기는 동안 B가 4문단 삭제 → 1문단은 맨 뒤 근처, 4문단은 사라짐',
    a: (r) => r.move(0, 2),
    b: (r) => r.deletePara(3),
    expect: [['마바사아', '자차카타', '가나다라']],
  },
  {
    id: 'S26',
    title: '연속 이동 ∥ 편집',
    intent: 'A가 1문단을 맨 뒤로, 다시 두 번째로 옮기는 동안 B가 그 문단 편집 → X가 따라감',
    a: (r) => {
      r.move(0, 3);
      r.move(3, 1);
    },
    b: (r) => r.insertText(0, 2, 'X'),
    expect: [['마바사아', '가나X다라', '자차카타', '하하하하']],
  },
];

export interface Result {
  scenario: Scenario;
  model: string;
  converged: boolean;
  verdict: Verdict;
  actual: string[];
  invariant: string | null;
  error?: string;
}

function chars(paras: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const ch of paras.join('')) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

function classify(actual: string[], expected: string[][]): Verdict {
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  if (expected.some((e) => same(actual, e))) return 'pass';
  const got = chars(actual);
  const sameChars = (w: Map<string, number>) =>
    w.size === got.size && [...w].every(([ch, n]) => got.get(ch) === n);
  // 허용 결과 중 하나와 글자 구성이 같으면 위치만 어긋난 것
  if (expected.some((e) => sameChars(chars(e)))) return 'misplaced';
  // 아니면 첫 번째 기대값과 비교해 유실·중복 판정
  const want = chars(expected[0]!);
  let lost = false;
  let dup = false;
  for (const [ch, n] of want) {
    const g = got.get(ch) ?? 0;
    if (g < n) lost = true;
    if (g > n) dup = true;
  }
  for (const [ch, n] of got) if (!want.has(ch) && n > 0) dup = true;
  if (lost) return 'lost';
  if (dup) return 'duplicated';
  return 'misplaced';
}

export function runScenario(model: Model, s: Scenario): Result {
  const snap = model.createBase(BASE);
  const a = model.replica(snap, 10);
  const b = model.replica(snap, 20);
  try {
    if (s.run) {
      s.run(a, b);
    } else {
      s.a?.(a);
      s.b?.(b);
      syncAll(a, b);
    }
    const pa = a.paragraphs();
    const pb = b.paragraphs();
    const converged = JSON.stringify(pa) === JSON.stringify(pb);
    return {
      scenario: s,
      model: model.name,
      converged,
      verdict: classify(pa, s.expect),
      actual: pa,
      invariant: a.invariantViolation(),
    };
  } catch (e) {
    return {
      scenario: s,
      model: model.name,
      converged: false,
      verdict: 'lost',
      actual: [],
      invariant: null,
      error: String(e),
    };
  }
}

export { send };
