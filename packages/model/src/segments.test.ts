/**
 * 구획(문단 이동·숨김) 시험.
 * 단위 시험 + 참조 모델(화면 텍스트 문자열)과 비교하는 무작위 시험.
 */
import { describe, expect, it } from 'vitest';
import { Doc, History, type Op } from './index';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 화면 텍스트 → 문단 배열 (마지막 ¶ 뒤 빈 문자열 제외) */
const parasOf = (text: string) => text.slice(0, -1).split('\n');
const textOf = (paras: string[]) => paras.join('\n') + '\n';

function check(doc: Doc, expected: string) {
  expect(doc.text()).toBe(expected);
  expect(doc.length).toBe(Array.from(expected).length);
  expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
  expect(doc.paragraphs().map((p) => p.text)).toEqual(parasOf(expected));
  doc.checkInvariants();
}

const sel0 = (doc: Doc) => ({ anchor: doc.positionAt(0), head: doc.positionAt(0) });

describe('paragraph move', () => {
  it('moves a paragraph without moving its characters', () => {
    const doc = Doc.fromText('가\n나\n다\n라');
    const ids = doc.paragraphs().map((p) => p.id);
    doc.moveParagraphs(0, 0, 3); // 가 → 라 앞
    check(doc, '나\n다\n가\n라\n');
    // 문단 ID(= ¶ 원소)가 그대로 따라온다
    expect(doc.paragraphs().map((p) => p.id)).toEqual([ids[1], ids[2], ids[0], ids[3]]);
    expect(doc.segmentCount).toBeGreaterThan(1);
  });

  it('moves a range to the end and back with undo/redo', () => {
    const doc = Doc.fromText('가\n나\n다\n라');
    const h = new History(0);
    h.record({ ops: doc.moveParagraphs(0, 1, 4), before: sel0(doc), after: sel0(doc), time: 0 });
    check(doc, '다\n라\n가\n나\n');
    h.undo(doc);
    check(doc, '가\n나\n다\n라\n');
    h.redo(doc);
    check(doc, '다\n라\n가\n나\n');
  });

  it('keeps a position inside a moved paragraph', () => {
    const doc = Doc.fromText('가나\n다라\n마바');
    const pos = doc.positionAt(4); // 라 앞
    doc.moveParagraphs(1, 1, 0);
    expect(doc.text()).toBe('다라\n가나\n마바\n');
    expect(doc.resolve(pos)).toBe(1);
  });

  it('edits inside a moved paragraph land in the moved paragraph', () => {
    const doc = Doc.fromText('가\n나\n다');
    doc.moveParagraphs(2, 2, 0);
    doc.insertText(1, 'X'); // "다" 뒤
    check(doc, '다X\n가\n나\n');
  });

  it('ignores moves onto itself', () => {
    const doc = Doc.fromText('가\n나');
    expect(doc.moveParagraphs(0, 0, 0)).toEqual([]);
    expect(doc.moveParagraphs(0, 0, 1)).toEqual([]);
    expect(doc.segmentCount).toBe(1);
  });
});

describe('paragraph delete (hide)', () => {
  it('hides and restores with undo', () => {
    const doc = Doc.fromText('가\n나\n다');
    const h = new History(0);
    h.record({ ops: doc.hideParagraphs(1, 1), before: sel0(doc), after: sel0(doc), time: 0 });
    check(doc, '가\n다\n');
    h.undo(doc);
    check(doc, '가\n나\n다\n');
  });

  it('refuses to hide every paragraph', () => {
    const doc = Doc.fromText('가\n나');
    expect(doc.hideParagraphs(0, 1)).toEqual([]);
    check(doc, '가\n나\n');
  });

  it('a position in a hidden paragraph resolves to where it was', () => {
    const doc = Doc.fromText('가\n나\n다');
    const pos = doc.positionAt(2); // 나 앞
    doc.hideParagraphs(1, 1);
    expect(doc.resolve(pos)).toBe(2); // 다 앞
  });
});

describe('deleting across segment boundaries', () => {
  it('joining the paragraph before a moved one keeps the paragraph whole', () => {
    // 다를 맨 앞으로: [다][가 나] — 다의 ¶를 지우면 "다가"가 한 문단
    const doc = Doc.fromText('가\n나\n다');
    doc.moveParagraphs(2, 2, 0);
    const h = new History(0);
    const ops: Op[] = doc.deleteRange(1, 2);
    h.record({ ops, before: sel0(doc), after: sel0(doc), time: 0 });
    check(doc, '다가\n나\n');
    // 이어서 그 문단을 옮겨도 한 덩어리로 움직인다
    doc.moveParagraphs(0, 0, 2);
    check(doc, '나\n다가\n');
    doc.moveParagraphs(1, 1, 0);
    h.undo(doc); // 기록한 것은 삭제뿐이지만, 되돌린 뒤에도 구조가 맞아야 한다
    doc.checkInvariants();
    expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
  });

  it('a selection spanning moved paragraphs deletes in display order', () => {
    const doc = Doc.fromText('가나\n다라\n마바');
    doc.moveParagraphs(2, 2, 0); // 마바 / 가나 / 다라
    const h = new History(0);
    h.record({ ops: doc.deleteRange(1, 5), before: sel0(doc), after: sel0(doc), time: 0 }); // "바\n가나" 삭제
    check(doc, '마\n다라\n');
    h.undo(doc);
    check(doc, '마바\n가나\n다라\n');
  });
});

describe('Doc with segments, randomized against a reference', () => {
  const ALPHA = Array.from('가나다 ab\n😀');
  const randomText = (r: () => number, max: number) => {
    let s = '';
    const n = 1 + Math.floor(r() * max);
    for (let i = 0; i < n; i++) s += ALPHA[Math.floor(r() * ALPHA.length)];
    return s;
  };
  const cpSplice = (s: string, at: number, del: number, ins: string) => {
    const cps = Array.from(s);
    cps.splice(at, del, ...Array.from(ins));
    return cps.join('');
  };

  const seen = { joins: 0, maxSegments: 0, hiddenUndo: 0 };
  for (const seed of [1, 2, 3, 7, 42, 99, 1234, 2024]) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const doc = Doc.fromText(randomText(r, 400));
      const h = new History(0);
      let expected = doc.text();
      const snapshots: string[] = [expected];

      for (let step = 0; step < 400; step++) {
        doc.takeParagraphChanges();
        const beforeParas = [...doc.paragraphs()];
        const len = doc.length;
        const n = doc.paragraphs().length;
        const roll = r();
        let ops: Op[] = [];
        if (roll < 0.3) {
          const at = Math.floor(r() * len);
          const text = randomText(r, r() < 0.05 ? 1500 : 6);
          ops = [{ type: 'insert', ids: doc.insertText(at, text) }];
          expected = cpSplice(expected, at, 0, text);
        } else if (roll < 0.55) {
          const from = Math.floor(r() * len);
          const to = Math.min(len - 1, from + Math.floor(r() * 30));
          if (from >= to) continue;
          ops = doc.deleteRange(from, to);
          if (ops.length > 1) seen.joins++;
          expected = cpSplice(expected, from, to - from, '');
        } else if (roll < 0.75) {
          const i = Math.floor(r() * n);
          const j = Math.min(n - 1, i + Math.floor(r() * 3));
          const to = Math.floor(r() * (n + 1));
          ops = doc.moveParagraphs(i, j, to);
          if (ops.length) {
            const ps = parasOf(expected);
            const moved = ps.slice(i, j + 1);
            const rest = [...ps.slice(0, i), ...ps.slice(j + 1)];
            const at = to > j ? to - moved.length : to;
            rest.splice(at, 0, ...moved);
            expected = textOf(rest);
          }
        } else if (roll < 0.83) {
          const i = Math.floor(r() * n);
          const j = Math.min(n - 1, i + Math.floor(r() * 2));
          ops = doc.hideParagraphs(i, j);
          if (ops.length) {
            const ps = parasOf(expected);
            ps.splice(i, j - i + 1);
            expected = textOf(ps);
          }
        } else if (roll < 0.95) {
          if (!h.canUndo) continue;
          h.undo(doc);
          snapshots.pop();
          expected = snapshots[snapshots.length - 1]!;
        } else {
          if (!h.canRedo) continue;
          h.redo(doc);
          expected = doc.text();
          snapshots.push(expected);
        }
        if (ops.length) {
          h.record({ ops, before: sel0(doc), after: sel0(doc), time: step });
          snapshots.push(expected);
        }
        check(doc, expected);
        seen.maxSegments = Math.max(seen.maxSegments, doc.segmentCount);

        // 바뀐 구간 힌트: 앞뒤 그대로인 문단은 같은 객체
        const { from, suffix } = doc.takeParagraphChanges();
        const after = doc.paragraphs();
        const f = Math.min(from, beforeParas.length, after.length);
        for (let k = 0; k < f; k++) expect(after[k]).toBe(beforeParas[k]);
        const s = Math.min(suffix, beforeParas.length - f, after.length - f);
        for (let k = 1; k <= s; k++) expect(after[after.length - k]).toBe(beforeParas[beforeParas.length - k]);

        // 위치 왕복
        const off = Math.floor(r() * doc.length);
        expect(doc.resolve(doc.positionAt(off))).toBe(off);
      }
    }, 20000); // 무작위 시험: 부하가 큰 기계에서 5초를 넘기도 한다
  }
  it('exercised the segment paths', () => {
    // 위 무작위 시험이 구획 경로(여러 구획, 경계를 넘는 삭제의 꼬리 옮기기)를 실제로 거쳤는지
    expect(seen.maxSegments).toBeGreaterThan(10);
    expect(seen.joins).toBeGreaterThan(5);
  });
});

describe('undo after paragraph moves (regression)', () => {
  // 문단을 옮긴 뒤 입력·삭제를 모두 되돌리면, 실행 취소가 구획 끝 ¶나 화면 마지막 ¶를 지울 수 있다.
  // 예전에는 문단 목록이 어긋나 예외가 났다 (ID 순서 ≠ 화면 순서, 로컬 문서에 가상 ¶ 없음)
  function rng(seed: number) {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }
  it('keeps the paragraph index consistent for 30 seeds', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = rng(seed);
      const doc = Doc.fromText('하나 둘 셋\n넷 다섯\n여섯');
      const h = new History(0);
      const sel = { anchor: doc.positionAt(0), head: doc.positionAt(0) };
      for (let step = 0; step < 200; step++) {
        const at = Math.floor(r() * doc.length);
        const pick = r();
        let ops: Op[] = [];
        if (pick < 0.5) ops = [{ type: 'insert', ids: doc.insertText(Math.min(at, doc.maxCaret), ['가', '\n', 'ab'][Math.floor(r() * 3)]!) }];
        else if (pick < 0.75 && doc.maxCaret > 0) ops = doc.deleteRange(Math.min(at, doc.maxCaret - 1), Math.min(doc.maxCaret, at + 1 + Math.floor(r() * 5)));
        else if (doc.paragraphs().length > 1) {
          const k = doc.paragraphs().length;
          const i = Math.floor(r() * k);
          ops = doc.moveParagraphs(i, i, Math.floor(r() * (k + 1)));
        }
        h.record({ ops, before: sel, after: sel, time: step });
      }
      while (h.canUndo) {
        h.undo(doc);
        expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
      }
      doc.checkInvariants();
      while (h.canRedo) h.redo(doc);
      expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
      doc.checkInvariants();
    }
  });
});
