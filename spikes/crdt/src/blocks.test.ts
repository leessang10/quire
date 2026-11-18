/**
 * 블록 스파이크 (11 §3, 단계 2-7): 표 레코드와 개체를 Loro로 표현해 두 피어 동시 편집 뒤 기대와 비교한다.
 * 결과: results/blocks.md (시나리오), results/blocks-random.md (무작위 수렴), results/blocks-size.md (O-24 크기·비용).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { BODY, OBJ, TableRec, allCellText, findObj, insertObject, normalize, objects, peers, send, setObj, syncAll, type Grid } from './blocks';

interface Row {
  id: string;
  title: string;
  expect: string;
  actual: string;
  pass: boolean;
}
const rows: Row[] = [];
const out = (name: string, text: string) => {
  mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`../results/${name}`, import.meta.url), text);
};

/** 3×3 표 t, 셀 글은 "행열" (00…22). 본문에는 표 글자 하나 (o_table = t) */
function initTable(loro: LoroDoc): void {
  const t = TableRec.create(loro, 't', 3, 3);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) t.story(`r${r}`, `c${c}`).insert(0, `${r}${c}`);
  loro.getText(BODY).insert(0, '앞\n\n뒤\n');
  loro.getText(BODY).mark({ start: 2, end: 3 }, 'o_table', 't');
}

/** 표 칸에 넣을 글: 세로 막대와 줄바꿈을 바꾼다 */
const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', '↵').replaceAll(OBJ, '■');

const gridText = (g: Grid) => `${g.cells.map((r) => r.join(' ')).join(' / ')}${g.spans.length ? ` [${g.spans.join(', ')}]` : ''}`;

/** 두 피어가 같은 상태에서 a, b를 동시에 하고 맞춘 뒤 확인. 두 순서(A = 피어 1, 피어 2)로 */
function scenario(
  id: string,
  title: string,
  init: (l: LoroDoc) => void,
  a: (l: LoroDoc) => void,
  b: (l: LoroDoc) => void,
  check: (l: LoroDoc) => { expect: string; actual: string; pass: boolean },
  after?: (ps: LoroDoc[]) => void,
) {
  it(`${id} ${title}`, () => {
    const actuals: string[] = [];
    let ok = true;
    let exp = '';
    for (const swap of [false, true]) {
      const ps = peers(2, init);
      const [pa, pb] = swap ? [ps[1]!, ps[0]!] : [ps[0]!, ps[1]!];
      a(pa);
      b(pb);
      syncAll(ps);
      after?.(swap ? [pb, pa] : [pa, pb]);
      // 두 피어가 같다
      expect(JSON.stringify(view(ps[1]!))).toBe(JSON.stringify(view(ps[0]!)));
      const r = check(ps[0]!);
      actuals.push(r.actual);
      exp = r.expect;
      ok &&= r.pass;
    }
    const actual = actuals[0] === actuals[1] ? actuals[0]! : `${actuals[0]} | 순서 바꿈: ${actuals[1]}`;
    rows.push({ id, title, expect: exp, actual, pass: ok });
    expect(ok, `${id}: ${actual}`).toBe(true);
  });
}

function view(l: LoroDoc) {
  return { grid: normalize(new TableRec(l, 't')), objs: objects(l).list, body: l.getText(BODY).toString() };
}

const T = (l: LoroDoc) => new TableRec(l, 't');

describe('blocks spike: table scenarios (11 §3.3)', () => {
  scenario('T1', '행 삭제 ∥ 그 행 셀에 입력', initTable, (l) => T(l).deleteRow('r1'), (l) => T(l).story('r1', 'c1').insert(2, 'B'), (l) => {
    const g = normalize(T(l));
    const kept = allCellText(l, 't').includes('11B');
    return { expect: '행 없음, B의 글은 셀 스토리에 남음', actual: `${gridText(g)}; 남은 글 ${kept}`, pass: !g.rows.includes('r1') && kept };
  });

  it('T1b 행 삭제를 되돌리면 그사이 들어온 입력까지 보인다', () => {
    const [a, b] = peers(2, initTable) as [LoroDoc, LoroDoc];
    T(a).deleteRow('r1');
    T(b).story('r1', 'c1').insert(2, 'B');
    syncAll([a, b]);
    // A의 실행 취소: 지운 표시를 지운다 → 제자리로, 결정적 스토리 ID라 B의 글까지
    T(a).restore('r1');
    syncAll([a, b]);
    const g = normalize(T(b));
    rows.push({ id: 'T1b', title: '행 삭제 되돌리기', expect: '제자리에 11B 보임', actual: gridText(g), pass: g.cells[1]![1] === '11B' });
    expect(g.cells[1]![1]).toBe('11B');
  });

  scenario('T2', '같은 행 뒤에 동시에 행 추가', initTable, (l) => T(l).addRow('r0', 'ra'), (l) => T(l).addRow('r0', 'rb'), (l) => {
    const r = T(l).rowIds();
    return { expect: '행 둘 다 (피어 순서)', actual: r.join(','), pass: r.length === 5 && r.includes('ra') && r.includes('rb') };
  });

  scenario('T3', '병합 ∥ 덮이는 셀에 입력', initTable, (l) => T(l).merge('r0', 'c0', 'r0', 'c1'), (l) => T(l).story('r0', 'c1').insert(2, 'B'), (l) => {
    const g = normalize(T(l));
    return { expect: '병합, B의 글은 왼쪽 위 셀 뒤에 이어 보임', actual: gridText(g), pass: g.cells[0]![0]!.includes('B') && g.cells[0]![1] === '·' };
  });

  scenario('T4', '열 삭제 ∥ 그 열을 지나는 병합', initTable, (l) => T(l).deleteCol('c1'), (l) => T(l).merge('r0', 'c0', 'r0', 'c2'), (l) => {
    const g = normalize(T(l));
    return { expect: '병합이 남은 두 열로 줄어듦', actual: gridText(g), pass: g.spans.join() === 'r0|c0=1x2' };
  });

  scenario('T6', '표 삭제(표 글자) ∥ 셀에 입력', initTable, (l) => l.getText(BODY).delete(2, 2), (l) => T(l).story('r2', 'c2').insert(2, 'B'), (l) => {
    const gone = !l.getText(BODY).toString().includes('');
    // 되돌리기: 같은 표 ID를 가리키는 표 글자를 다시 넣는다
    l.getText(BODY).insert(2, '\n');
    l.getText(BODY).mark({ start: 2, end: 3 }, 'o_table', 't');
    const g = normalize(T(l));
    return { expect: '표 없음, 되돌리면 B의 입력까지', actual: `삭제됨 ${gone}; 되돌림 → ${g.cells[2]![2]}`, pass: gone && g.cells[2]![2] === '22B' };
  });

  scenario('T7', '열 너비 ∥ 열 추가', initTable, (l) => T(l).setWidth('c0', 150000), (l) => T(l).addCol('c2', 'cb'), (l) => {
    const g = normalize(T(l));
    return { expect: '둘 다 반영, 새 열은 기본 너비', actual: `${g.cols.join(',')} ${g.widths.join(',')}`, pass: g.widths[0] === 150000 && g.cols.at(-1) === 'cb' && g.widths.at(-1) === 100000 };
  });

  scenario('T8', '행 이동 ∥ 그 행 삭제', initTable, (l) => T(l).moveRow('r0', null), (l) => T(l).deleteRow('r0'), (l) => {
    const r = T(l).rowIds();
    return { expect: '삭제', actual: r.join(','), pass: !r.includes('r0') && r.length === 2 };
  });

  it('T9 행 추가 ∥ 열 추가, 교차 칸에 동시에 처음 입력', () => {
    const [a, b] = peers(2, initTable) as [LoroDoc, LoroDoc];
    T(a).addRow('r2', 'ra');
    T(b).addCol('c2', 'cb');
    syncAll([a, b]);
    const empty = normalize(T(a)).cells[3]![3];
    T(a).story('ra', 'cb').insert(0, 'A');
    T(b).story('ra', 'cb').insert(0, 'B');
    syncAll([a, b]);
    const ga = normalize(T(a));
    const cell = ga.cells[3]![3]!;
    const pass = empty === '' && (cell === 'AB' || cell === 'BA') && JSON.stringify(ga) === JSON.stringify(normalize(T(b)));
    rows.push({ id: 'T9', title: '행 추가 ∥ 열 추가, 교차 칸에 동시 입력', expect: '교차 칸은 빈 셀, 동시 입력은 둘 다 (같은 스토리)', actual: `처음 '${empty}', 입력 뒤 '${cell}'`, pass });
    expect(pass).toBe(true);
  });

  scenario(
    'T10',
    '셀 나누기 ∥ 덮인 셀에 입력',
    (l) => {
      initTable(l);
      T(l).merge('r0', 'c0', 'r0', 'c1');
    },
    (l) => T(l).unmerge('r0', 'c0'),
    (l) => T(l).story('r0', 'c1').insert(0, 'B'),
    (l) => {
      const g = normalize(T(l));
      return { expect: '병합 없음, 덮였던 셀의 글(B 포함)은 원래 셀에', actual: gridText(g), pass: g.spans.length === 0 && g.cells[0]![1] === 'B01' };
    },
  );

  scenario('T11', '같은 셀들을 동시에 다르게 병합 (겹침)', initTable, (l) => T(l).merge('r0', 'c0', 'r1', 'c1'), (l) => T(l).merge('r1', 'c1', 'r2', 'c2'), (l) => {
    const g = normalize(T(l));
    return { expect: '행 우선 순서로 앞의 병합만 (겹치는 뒤 병합은 무시)', actual: gridText(g), pass: g.spans.join() === 'r0|c0=2x2' };
  });
});

describe('blocks spike: objects (11 §3.2)', () => {
  const initObj = (l: LoroDoc) => {
    l.getText(BODY).insert(0, '가나\n다라\n');
    insertObject(l, 1, { id: 'img1', kind: 'image', w: 100000, h: 50000 });
  };
  scenario('O1', '같은 이미지 크기를 동시에', initObj, (l) => setObj(l, 1, 'w', 200000), (l) => setObj(l, 1, 'w', 300000), (l) => {
    const o = objects(l).list;
    return { expect: '하나만 남음 (나중 것)', actual: `w=${o[0]?.attrs.w}`, pass: o.length === 1 && (o[0]!.attrs.w === 200000 || o[0]!.attrs.w === 300000) };
  });

  const moveTo = (l: LoroDoc, to: number) => {
    const o = findObj(l, 'img1')!;
    l.getText(BODY).delete(o.at, 1);
    insertObject(l, to > o.at ? to - 1 : to, o.attrs);
  };
  scenario('O2', '앵커 문단 삭제 ∥ 그 이미지를 다른 문단으로', initObj, (l) => l.getText(BODY).delete(0, 4), (l) => moveTo(l, 6), (l) => {
    const o = objects(l);
    return { expect: '옮긴 자리에 하나', actual: `${l.getText(BODY).toString().replace(OBJ, '■')} (개체 ${o.list.length}, 중복 ${o.dupes})`, pass: o.list.length === 1 && o.dupes === 0 };
  });

  scenario('O3', '같은 이미지를 동시에 다른 곳으로', initObj, (l) => moveTo(l, 0), (l) => moveTo(l, 6), (l) => {
    const o = objects(l);
    return { expect: '개체 글자 둘이 생기지만 같은 id라 앞의 하나만 보임 (두 피어 같음)', actual: `${l.getText(BODY).toString().replace(/￼/g, '■')} (보임 ${o.list.length}, 중복 ${o.dupes})`, pass: o.list.length === 1 && o.dupes === 1 };
  });

  scenario('O4', '크기 바꾸기 ∥ 개체 바로 앞뒤에 입력', initObj, (l) => setObj(l, 1, 'w', 200000), (l) => {
    l.getText(BODY).insert(2, 'x');
    l.getText(BODY).insert(1, 'y');
  }, (l) => {
    const o = objects(l);
    return { expect: '개체 하나, 크기 반영. 옆 글자로 번진 마크는 읽지 않음', actual: `${l.getText(BODY).toString().replace(OBJ, '■')} w=${o.list[0]?.attrs.w}, 번진 글자 ${o.leaked}`, pass: o.list.length === 1 && o.list[0]!.attrs.w === 200000 };
  });

  it('writes the scenario table', () => {
    const md = [
      '# 블록 스파이크 시나리오 (11 §3.3, 단계 2-7)',
      '',
      '두 피어가 같은 상태에서 A, B를 동시에 하고 동기화. 두 순서(A = 피어 1 / 피어 2)로 돌렸다. 셀 글은 "행열"(00…22).',
      '',
      '| # | 시나리오 | 기대 | 결과 | 통과 |',
      '|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.expect} | ${cell(r.actual)} | ${r.pass ? '✅' : '❌'} |`),
      '',
      `통과 ${rows.filter((r) => r.pass).length} / ${rows.length}`,
      '',
    ].join('\n');
    out('blocks.md', md);
    expect(rows.every((r) => r.pass)).toBe(true);
  });
});

void send;

describe('blocks spike: random concurrent table and object edits (3 peers)', () => {
  function rng(seed: number) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 2 ** 32;
    };
  }
  const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

  const lines: string[] = [];
  for (const move of [true, false])
  it(`converges for 40 seeds × 200 steps; counts lost and duplicated cell text (merge moves text: ${move})`, () => {
    let ops = 0;
    let lost = 0;
    let dup = 0;
    let dupSeeds = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed * 2654435761);
      const ps = peers(3, (l) => {
        initTable(l);
        insertObject(l, 0, { id: 'o1', kind: 'image', w: 1, h: 1 });
      });
      const tokens: string[] = [];
      let n = 0;
      for (let step = 0; step < 200; step++) {
        const k = Math.floor(r() * 3);
        const l = ps[k]!;
        const t = T(l);
        const rowsV = t.rowIds();
        const colsV = t.colIds();
        const roll = r();
        ops++;
        if (roll < 0.3 && rowsV.length && colsV.length) {
          const tok = `[${k}.${n++}]`;
          tokens.push(tok);
          const s = t.story(pick(r, rowsV), pick(r, colsV));
          s.insert(Math.floor(r() * (s.length + 1)) === s.length ? s.length : 0, tok);
        } else if (roll < 0.38) t.addRow(rowsV.length ? pick(r, rowsV) : null, `p${k}r${n++}`);
        else if (roll < 0.44) t.addCol(colsV.length ? pick(r, colsV) : null, `p${k}c${n++}`);
        else if (roll < 0.49 && rowsV.length > 1) t.deleteRow(pick(r, rowsV));
        else if (roll < 0.53 && colsV.length > 1) t.deleteCol(pick(r, colsV));
        else if (roll < 0.56) {
          const g = t.gone.keys();
          if (g.length) t.restore(pick(r, g));
        } else if (roll < 0.6 && rowsV.length > 1) t.moveRow(pick(r, rowsV), r() < 0.2 ? null : pick(r, rowsV));
        else if (roll < 0.63 && colsV.length) t.setWidth(pick(r, colsV), pick(r, [80000, 120000]));
        else if (roll < 0.68 && rowsV.length > 1 && colsV.length > 1) {
          const y = Math.floor(r() * (rowsV.length - 1));
          const x = Math.floor(r() * (colsV.length - 1));
          t.merge(rowsV[y]!, colsV[x]!, rowsV[y + 1 + Math.floor(r() * (rowsV.length - y - 1))]!, colsV[x + Math.floor(r() * (colsV.length - x))]!, move);
        } else if (roll < 0.7) {
          const sp = t.spans.keys();
          if (sp.length) t.spans.delete(pick(r, sp));
        } else if (roll < 0.74) {
          const o = findObj(l, 'o1');
          if (o) setObj(l, o.at, 'w', Math.floor(r() * 100));
        } else if (roll < 0.76) {
          const o = findObj(l, 'o1');
          if (o) {
            l.getText(BODY).delete(o.at, 1);
            insertObject(l, Math.floor(r() * l.getText(BODY).length), o.attrs);
          }
        } else if (roll < 0.9) {
          const a = ps[Math.floor(r() * 3)]!;
          const b = ps[Math.floor(r() * 3)]!;
          if (a !== b) send(a, b);
        } else l.commit();
      }
      syncAll(ps);
      const v0 = JSON.stringify(view(ps[0]!));
      for (const p of ps.slice(1)) expect(JSON.stringify(view(p)), `seed ${seed}`).toBe(v0);
      // 글이 사라지거나 둘이 되지 않았는가 (지우기 연산은 없다: 병합의 옮기기만 글을 지운다)
      const all = allCellText(ps[0]!, 't');
      let seedDup = 0;
      for (const tok of tokens) {
        const c = all.split(tok).length - 1;
        if (c === 0) lost++;
        if (c > 1) seedDup++;
      }
      dup += seedDup;
      if (seedDup) dupSeeds++;
      expect(objects(ps[0]!).list.length).toBe(1);
    }
    lines.push(
      `- 병합할 때 글을 ${move ? '옮김' : '옮기지 않음 (채택)'}: 40시드 × 200단계 (3피어, 연산 ${ops}개), 수렴 40/40, 셀 글 유실 ${lost}, 중복 ${dup} (중복이 생긴 시드 ${dupSeeds}), 개체는 늘 하나`,
    );
    out('blocks-random.md', `${lines.join('\n')}\n`);
    expect(lost).toBe(0);
    if (!move) expect(dup).toBe(0);
  }, 60_000);
});

describe('blocks spike: cost of per-cell stories (O-24)', () => {
  it('compares one text per cell with one text per table (cells as marked segments)', () => {
    const R = 1000;
    const C = 5;
    const cellText = (r: number, c: number) => `셀 ${r}-${c} 내용 가나다`;
    const time = (f: () => void) => {
      const t0 = performance.now();
      f();
      return performance.now() - t0;
    };
    const measure = (name: string, build: (l: LoroDoc) => void, edit: (l: LoroDoc) => void, read: (l: LoroDoc) => number) => {
      const a = new LoroDoc();
      a.setPeerId(1);
      a.configTextStyle({ cell: { expand: 'none' } });
      const buildMs = time(() => {
        build(a);
        a.commit();
      });
      const snap = a.export({ mode: 'snapshot' });
      const b = new LoroDoc();
      b.configTextStyle({ cell: { expand: 'none' } });
      const importMs = time(() => b.import(snap));
      let chars = 0;
      const readMs = time(() => {
        chars = read(b);
      });
      // 한 글자씩 20번: 입력+커밋, 받는 쪽 적용의 중앙값 (첫 가져오기는 따로)
      const edits: number[] = [];
      const applies: number[] = [];
      let upd: Uint8Array = new Uint8Array();
      let firstApply = 0;
      for (let k = 0; k < 21; k++) {
        const v = a.oplogVersion();
        edits.push(time(() => {
          edit(a);
          a.commit();
        }));
        upd = a.export({ mode: 'update', from: v });
        const u = upd;
        const ms = time(() => b.import(u));
        if (k === 0) firstApply = ms;
        else applies.push(ms);
      }
      const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
      const editMs = med(edits);
      const applyMs = med(applies);
      return `| ${name} | ${(snap.length / 1024).toFixed(0)} KB | ${buildMs.toFixed(0)} ms | ${importMs.toFixed(0)} ms | ${readMs.toFixed(0)} ms (${chars.toLocaleString()}자) | ${upd.length} B | ${editMs.toFixed(2)} / ${applyMs.toFixed(2)} ms (첫 적용 ${firstApply.toFixed(1)} ms) |`;
    };
    const perCell = measure(
      '셀마다 텍스트 (`s:<표>.<행>.<열>`)',
      (l) => {
        const t = TableRec.create(l, 't', R, C);
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) t.story(`r${r}`, `c${c}`).insert(0, cellText(r, c));
      },
      (l) => new TableRec(l, 't').story('r500', 'c2').insert(3, '가'),
      (l) => {
        let n = 0;
        const t = new TableRec(l, 't');
        for (const r of t.rowIds()) for (const c of t.colIds()) n += t.story(r, c).length;
        return n;
      },
    );
    const oneText = measure(
      '표 하나에 텍스트 하나 (셀 = 표식으로 끝나는 구간)',
      (l) => {
        TableRec.create(l, 't', R, C);
        const text = l.getText('t.cells');
        let s = '';
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) s += `${cellText(r, c)}\uE000`;
        text.insert(0, s);
        let at = 0;
        for (let r = 0; r < R; r++)
          for (let c = 0; c < C; c++) {
            at += cellText(r, c).length;
            text.mark({ start: at, end: at + 1 }, 'cell', `r${r}|c${c}`);
            at++;
          }
      },
      (l) => l.getText('t.cells').insert(500 * C * 20 + 3, '가'),
      (l) => {
        let n = 0;
        for (const op of l.getText('t.cells').toDelta()) if (typeof op.insert === 'string') n += op.insert.length;
        return n;
      },
    );
    out(
      'blocks-size.md',
      [
        `# 셀 스토리 비용 (O-24): ${R.toLocaleString()}행 × ${C}열 표, 셀마다 ${cellText(0, 0).length}자 안팎`,
        '',
        '| 표현 | 스냅샷 | 만들기 | 스냅샷 가져오기 | 모든 셀 읽기 | 한 글자 입력 업데이트 | 입력+커밋 / 받는 쪽 적용 (중앙값, 20번) |',
        '|---|---|---|---|---|---|---|',
        perCell,
        oneText,
        '',
      ].join('\n'),
    );
  }, 120_000);
});
