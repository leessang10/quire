/**
 * 서식 의미론 스파이크 (10 §3, 단계 2-1): Loro 텍스트 마크로 글자 서식·문단 속성을 걸고, 두 피어 동시 편집 뒤 동기화해 기대와
 * 비교한다. 결과 표는 results/format.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compactLoro, displayText, readState } from '@quire/sync';
import { configure, masked, newPeer, Peer, peers, sync, view, PARA_KEYS, pkey, EXPAND, type View } from './format';

const START = '가나다라마\n바사아자차';

interface Row {
  id: string;
  title: string;
  expect: string;
  actual: string;
  pass: boolean;
  note?: string;
}
const rows: Row[] = [];

function converged(ps: Peer[]): View {
  const v = view(ps[0]!.loro);
  for (const p of ps.slice(1)) expect(view(p.loro)).toEqual(v);
  return v;
}

/** 시나리오: 두 피어가 같은 상태에서 a, b를 동시에 하고 동기화 */
/** 두 순서(A = 피어 1, A = 피어 2)로 돌린다: 동시 연산의 결과가 피어 번호에 따라 갈리는지 보기 위해 */
function scenario(id: string, title: string, a: (p: Peer) => void, b: (p: Peer) => void, check: (v: View) => { expect: string; actual: string; note?: string }, pre?: (ps: Peer[]) => void) {
  it(`${id} ${title}`, () => {
    const results: string[] = [];
    let first: ReturnType<typeof check> | null = null;
    for (const swap of [false, true]) {
      const ps = peers(2, START);
      pre?.(ps);
      const [pa, pb] = swap ? [ps[1]!, ps[0]!] : [ps[0]!, ps[1]!];
      a(pa);
      b(pb);
      sync(ps);
      const r = check(converged(ps));
      first ??= r;
      results.push(r.actual);
    }
    const same = results[0] === results[1];
    const actual = same ? results[0]! : `A=피어1: ${results[0]} · A=피어2: ${results[1]}`;
    rows.push({ id, title, expect: first!.expect, actual, note: first!.note, pass: same && first!.expect === results[0] });
  });
}

const paraAttr = (v: View, key: string) => v.paras.map((p) => `${p.text}:${p.attrs[key] ?? '-'}`).join(' / ');

describe('formatting semantics (Loro marks)', () => {
  scenario(
    'F1',
    '굵게 ∥ 굵게 구간 끝에 입력',
    (a) => a.format(0, 3, 'bold', true),
    (b) => b.insert(3, 'X'),
    (v) => ({ expect: '가나다X··/·····/', actual: masked(v, 'bold') }),
  );
  scenario(
    'F2',
    '굵게 ∥ 굵게 구간 앞에 입력',
    (a) => a.format(1, 3, 'bold', true),
    (b) => b.insert(1, 'X'),
    (v) => ({ expect: '··나다··/·····/', actual: masked(v, 'bold') }),
  );
  scenario(
    'F3',
    '링크 ∥ 링크 끝에 입력',
    (a) => a.format(0, 3, 'link', 'https://a'),
    (b) => b.insert(3, 'X'),
    (v) => ({ expect: '가나다···/·····/', actual: masked(v, 'link') }),
  );
  scenario(
    'F4',
    '1–5 굵게 ∥ 3–8 굵게 해제',
    (a) => a.format(0, 5, 'bold', true),
    (b) => b.format(2, 8, 'bold', null),
    (v) => ({ expect: '가나···/·····/ 또는 가나다라마/·····/', actual: ['가나···/·····/', '가나다라마/·····/'].includes(masked(v, 'bold')) ? '가나···/·····/ 또는 가나다라마/·····/' : masked(v, 'bold'), note: '겹친 구간은 어느 한 연산 (두 피어 같음)' }),
  );
  scenario(
    'F5',
    '가운데 정렬 ∥ 같은 문단 중간에서 Enter',
    (a) => a.setPara(0, 'align', 'center'),
    (b) => b.split(2),
    (v) => ({ expect: '가나:center / 다라마:center / 바사아자차:-', actual: paraAttr(v, 'align') }),
  );
  scenario(
    'F6',
    '가운데 정렬 ∥ 그 문단을 앞 문단과 합치기',
    (a) => a.setPara(1, 'align', 'center'),
    (b) => b.merge(0),
    (v) => ({ expect: '가나다라마바사아자차:center', actual: paraAttr(v, 'align'), note: '합치는 쪽은 앞 문단 속성(없음)을 복사할 키가 없어 아무것도 안 함 → A의 정렬이 남음' }),
  );
  scenario(
    'F7',
    '목록으로 ∥ 같은 문단 옮기기',
    (a) => a.setPara(0, 'list', 'L1:0'),
    (b) => b.move(0, 0, 2),
    (v) => ({ expect: '바사아자차:- / 가나다라마:L1:0', actual: paraAttr(v, 'list') }),
  );
  scenario(
    'F8',
    '굵게 + 문단 옮기기 ∥ 같은 범위 기울임',
    (a) => {
      a.format(0, 3, 'bold', true);
      a.move(0, 0, 2);
    },
    (b) => b.format(0, 3, 'italic', true),
    (v) => ({ expect: '·····/가나다··/ = ·····/가나다··/', actual: `${masked(v, 'bold')} = ${masked(v, 'italic')}`, note: '옮긴 글자에 두 서식 모두' }),
  );
  scenario(
    'F9',
    '문단 삭제(숨김) ∥ 그 문단에 굵게',
    (a) => a.hide(0, 0),
    (b) => b.format(0, 3, 'bold', true),
    (v) => ({ expect: '·····/', actual: masked(v, 'bold'), note: '숨겨진 문단의 서식은 F9b(되살리기)에서 확인' }),
  );
  scenario(
    'F10',
    '굵게 되돌리기 ∥ 같은 글자에 색',
    (a) => a.format(0, 5, 'bold', null),
    (b) => b.format(0, 5, 'color', '#f00'),
    (v) => ({ expect: '·····/·····/ | 가나다라마/·····/', actual: `${masked(v, 'bold')} | ${masked(v, 'color')}` }),
    (ps) => {
      ps[0]!.format(0, 5, 'bold', true);
      sync(ps);
    },
  );
  scenario(
    'F11',
    '같은 문단에 서로 다른 정렬',
    (a) => a.setPara(0, 'align', 'center'),
    (b) => b.setPara(0, 'align', 'right'),
    (v) => ({ expect: 'center 또는 right (두 피어 같음)', actual: String(v.paras[0]!.attrs.align === 'center' || v.paras[0]!.attrs.align === 'right' ? 'center 또는 right (두 피어 같음)' : v.paras[0]!.attrs.align) }),
  );
  scenario(
    'F12',
    '굵게 ∥ 굵게 범위 안의 글자를 바꿔 씀',
    (a) => a.format(0, 3, 'bold', true),
    (b) => {
      b.delete(1, 2);
      b.insert(1, 'Y');
    },
    (v) => ({ expect: '가Y다··/·····/', actual: masked(v, 'bold'), note: '구간 안에 들어간 글자는 서식을 받는다' }),
  );

  it('F13 한 피어: 굵게 끝에 입력하면 굵게 (로컬 확장)', () => {
    const [a] = peers(1, START);
    a!.format(0, 3, 'bold', true);
    a!.insert(3, 'Z');
    a!.refresh();
    const r = masked(view(a!.loro), 'bold');
    rows.push({ id: 'F13', title: '한 피어: 굵게 끝에 입력', expect: '가나다Z··/·····/', actual: r, pass: r === '가나다Z··/·····/' });
  });

  it('F14 한 피어: 굵은 문단 끝에서 Enter 후 입력', () => {
    const [a] = peers(1, START);
    a!.format(0, 5, 'bold', true);
    a!.split(5);
    a!.refresh();
    a!.insert(6, 'Q');
    a!.refresh();
    const r = masked(view(a!.loro), 'bold');
    rows.push({ id: 'F14', title: '한 피어: 굵은 문단 끝 Enter 후 입력', expect: '가나다라마/Q/·····/', actual: r, pass: r === '가나다라마/Q/·····/', note: '¶도 굵게를 받는다 (Word와 같이 다음 문단에서 서식이 이어짐)' });
  });

  it('F15 문단 속성 마크가 글자로 번지지 않는다', () => {
    const ps = peers(2, START);
    ps[0]!.setPara(0, 'align', 'center');
    ps[1]!.insert(5, 'E'); // 문단 끝(¶ 앞)
    ps[1]!.insert(6, 'S'); // 다음 문단 시작(¶ 뒤)
    sync(ps);
    // 원본 델타에서 ¶가 아닌 글자에 p: 키가 있는지
    const leaked: string[] = [];
    for (const op of ps[0]!.loro.getText('body').toDelta())
      if (typeof op.insert === 'string' && op.attributes && Object.keys(op.attributes).some((k) => k.startsWith('p_')))
        for (const ch of op.insert) if (ch !== '\n') leaked.push(ch);
    rows.push({ id: 'F15', title: '문단 속성 마크 ∥ ¶ 바로 앞(E)·뒤(S)에 입력', expect: '번진 글자 없음', actual: leaked.length ? `${leaked.join('')}에 번짐` : '번진 글자 없음', pass: leaked.length === 0, note: '번진 글자는 ¶가 아니므로 읽을 때 무시할 수 있다' });
  });

  it('writes the table', () => {
    // F8 기대 문자열은 시나리오 안에서 만든 것을 고정값으로 바꾼다
    const md = [
      '| # | 시나리오 | 기대 | 결과 | 판정 |',
      '|---|---|---|---|---|',
      ...rows
        .sort((x, y) => Number(x.id.slice(1)) - Number(y.id.slice(1)))
        .map((r) => `| ${r.id} | ${r.title}${r.note ? `<br><small>${r.note}</small>` : ''} | \`${r.expect}\` | \`${r.actual}\` | ${r.pass ? '✅' : '❌'} |`),
      '',
      `통과 ${rows.filter((r) => r.pass).length} / ${rows.length}`,
      '',
    ].join('\n');
    mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../results/format.md', import.meta.url), md);
    console.log(md);
  });
});

// F9 뒤의 "삭제 되돌리기": 숨김을 풀어 서식이 남아 있는지 따로 본다
describe('formatting survives hide/unhide', () => {
  it('F9b 되살린 문단에 동시에 건 굵게가 남는다', () => {
    const ps = peers(2, START);
    ps[0]!.hide(0, 0);
    ps[1]!.format(0, 3, 'bold', true);
    sync(ps);
    const hidden = ps[0]!.loro.getMap('hidden');
    for (const k of readState(ps[0]!.loro).hidden) hidden.delete(k);
    ps[0]!.loro.commit();
    sync(ps);
    expect(masked(converged(ps), 'bold')).toBe('가나다··/·····/');
  });
});

// ── 무작위 동시 편집: 서식·문단 속성·구조 연산을 섞어 수렴 ──
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

describe('random concurrent formatting (3 peers)', () => {
  const SEEDS = 40;
  const STEPS = 150;
  it(`converges for ${SEEDS} seeds × ${STEPS} steps, no paragraph attribute leaks onto characters`, () => {
    let ops = 0;
    let virtualPara = 0;
    let leaks = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed);
      const ps = peers(3, '하나 둘 셋\n넷 다섯\n여섯 일곱 여덟\n아홉');
      for (let step = 0; step < STEPS; step++) {
        const p = ps[Math.floor(r() * 3)]!;
        const n = p.doc.maxCaret;
        const at = Math.floor(r() * (n + 1));
        const len = Math.floor(r() * 6);
        const paras = p.doc.paragraphs().length;
        const pick = r();
        try {
          if (pick < 0.25) p.insert(at, ['가', 'ab', ' ', '다라'][Math.floor(r() * 4)]!);
          else if (pick < 0.35 && n > 0) p.delete(Math.min(at, n - 1), Math.min(n, at + 1 + len));
          else if (pick < 0.55) {
            const keys = Object.keys(EXPAND);
            const key = keys[Math.floor(r() * keys.length)]!;
            const b = Math.min(n, at + 1 + len);
            if (at < b) p.format(at, b, key, r() < 0.3 ? null : key === 'link' ? `u${seed}` : key === 'color' ? '#0a0' : true);
          } else if (pick < 0.7) {
            const key = PARA_KEYS[Math.floor(r() * PARA_KEYS.length)]!;
            if (!p.setPara(Math.floor(r() * paras), key, r() < 0.3 ? null : `${key}${Math.floor(r() * 3)}`)) virtualPara++;
          } else if (pick < 0.78) p.split(at);
          else if (pick < 0.84 && paras > 1) p.merge(Math.floor(r() * (paras - 1)));
          else if (pick < 0.92 && paras > 1) {
            const i = Math.floor(r() * paras);
            p.move(i, i, Math.floor(r() * (paras + 1)));
          } else if (pick < 0.95 && paras > 1) {
            const i = Math.floor(r() * paras);
            p.hide(i, i);
          }
          ops++;
        } catch (e) {
          // 모델이 거부하는 연산(예: 마지막 문단 숨김)은 건너뛴다
          if (!(e instanceof Error) || !/cannot|refuse|last/i.test(e.message)) throw e;
        }
        if (r() < 0.2) {
          // 일부만 동기화
          const a = ps[Math.floor(r() * 3)]!;
          const b = ps[Math.floor(r() * 3)]!;
          if (a !== b) {
            b.loro.import(a.loro.export({ mode: 'update', from: b.loro.oplogVersion() }));
            b.refresh();
          }
        }
      }
      sync(ps);
      const v = converged(ps);
      // 문단 속성 마크가 ¶ 아닌 글자(구획 표식 포함)로 번진 수: 읽을 때 무시하므로 결과에는 영향이 없다 (F15)
      for (const op of ps[0]!.loro.getText('body').toDelta())
        if (typeof op.insert === 'string' && op.attributes && Object.keys(op.attributes).some((k) => k.startsWith('p_')))
          for (const ch of op.insert) if (ch !== '\n') leaks++;
      expect(v.text).toBe(displayText(ps[0]!.loro));
    }
    expect(ops).toBeGreaterThan(SEEDS * STEPS * 0.8);
    const line = `무작위 (피어 3개 × ${STEPS}단계 × ${SEEDS}개): 연산 ${ops.toLocaleString()}개 모두 수렴. 가상 ¶ 문단에 속성을 걸지 못한 경우 ${virtualPara}번, 문단 속성이 ¶ 아닌 글자로 번진 글자 ${leaks}개`;
    writeFileSync(new URL('../results/format-random.md', import.meta.url), `${line}\n`);
    console.log(line);
  }, 60_000);
});

// ── 크기 (10 O-18) ──
describe('size of heavily formatted documents', () => {
  it('measures snapshot growth from marks and how much a new epoch removes', () => {
    const text = Array.from({ length: 200 }, (_, i) => `${i + 1}. 대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다.`).join('\n');
    const [p] = peers(1, text);
    const base = p!.loro.export({ mode: 'snapshot' }).length;
    const r = rng(7);
    const n = p!.doc.maxCaret;
    for (let k = 0; k < 2000; k++) {
      const a = Math.floor(r() * n);
      const b = Math.min(n, a + 1 + Math.floor(r() * 40));
      const key = ['bold', 'italic', 'color'][k % 3]!;
      p!.format(a, b, key, r() < 0.4 ? null : key === 'color' ? '#123456' : true);
    }
    const formatted = p!.loro.export({ mode: 'snapshot' }).length;
    // 새 판: 화면 상태만 남긴다 (텍스트 + 마크를 연속 구간으로 다시 건다)
    const v = view(p!.loro);
    const fresh = compactLoro(v.text, 'e1', 99);
    configure(fresh);
    const freshP = new Peer(fresh);
    let k = 0;
    while (k < v.marks.length) {
      const m = v.marks[k]!;
      let j = k + 1;
      while (j < v.marks.length && JSON.stringify(v.marks[j]) === JSON.stringify(m)) j++;
      for (const [key, val] of Object.entries(m)) freshP.format(k, j, key, val);
      k = j;
    }
    const compacted = fresh.export({ mode: 'snapshot' }).length;
    expect(view(fresh).marks).toEqual(v.marks);
    const line = `글자 ${n.toLocaleString()}개 문서: 서식 없음 ${(base / 1024).toFixed(1)} KB → 서식 2,000번 ${(formatted / 1024).toFixed(1)} KB → 새 판 ${(compacted / 1024).toFixed(1)} KB`;
    writeFileSync(new URL('../results/format-size.md', import.meta.url), `${line}\n`);
    console.log(line);
  });
});

void newPeer;
void pkey;
