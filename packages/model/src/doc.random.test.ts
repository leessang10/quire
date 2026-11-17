/**
 * 무작위 편집 후 증분 상태(문단 목록, 청크, 위치)가 처음부터 계산한 결과와 같은지 확인한다.
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

const ALPHABET = Array.from('가나다라 abc\n😀');

function randomText(r: () => number, max: number): string {
  const n = 1 + Math.floor(r() * max);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(r() * ALPHABET.length)];
  return s;
}

/** 코드포인트 단위 참조 모델 */
function cpSplice(s: string, at: number, del: number, ins: string): string {
  const cps = Array.from(s);
  cps.splice(at, del, ...Array.from(ins));
  return cps.join('');
}

function check(doc: Doc, expected: string) {
  expect(doc.text()).toBe(expected);
  expect(doc.length).toBe(Array.from(expected).length);
  expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
  doc.checkInvariants();
}

describe('Doc randomized consistency', () => {
  for (const seed of [1, 2, 3, 42, 1234]) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const doc = Doc.fromText(randomText(r, 3000));
      const h = new History(0);
      let expected = doc.text();
      const snapshots: string[] = [];

      for (let step = 0; step < 400; step++) {
        const len = doc.length;
        const roll = r();
        if (roll < 0.4) {
          const at = Math.floor(r() * len); // 0..maxCaret
          // 가끔 청크 분할이 일어날 만큼 큰 붙여넣기
          const text = randomText(r, r() < 0.05 ? 3000 : 8);
          const sel = { anchor: doc.positionAt(at), head: doc.positionAt(at) };
          const ids = doc.insertText(at, text);
          expected = cpSplice(expected, at, 0, text);
          h.record({ ops: [{ type: 'insert', ids }], before: sel, after: sel, time: step });
          snapshots.push(expected);
        } else if (roll < 0.75) {
          const from = Math.floor(r() * len);
          const to = Math.min(len - 1, from + Math.floor(r() * 40));
          if (from >= to) continue;
          const sel = { anchor: doc.positionAt(from), head: doc.positionAt(from) };
          const ops: Op[] = doc.deleteRange(from, to);
          expected = cpSplice(expected, from, to - from, '');
          h.record({ ops, before: sel, after: sel, time: step });
          snapshots.push(expected);
        } else if (roll < 0.9) {
          if (!h.canUndo) continue;
          h.undo(doc);
          snapshots.pop();
          expected = snapshots[snapshots.length - 1] ?? expected;
          // 실행 취소 후의 기대값은 직전 스냅샷 → 처음 상태까지 가면 문서 자체와 비교
          if (snapshots.length === 0) expected = doc.text();
        } else {
          if (!h.canRedo) continue;
          h.redo(doc);
          expected = doc.text();
          snapshots.push(expected);
        }
        check(doc, expected);

        // 위치 왕복
        const off = Math.floor(r() * doc.length);
        expect(doc.resolve(doc.positionAt(off))).toBe(off);
      }
    });
  }
});

describe('Doc paragraph change hints', () => {
  it('paragraphs outside the reported range are the same objects as before', () => {
    const r = rng(77);
    const doc = Doc.fromText(randomText(r, 2000));
    const h = new History(0);
    for (let step = 0; step < 500; step++) {
      doc.takeParagraphChanges();
      const before = [...doc.paragraphs()];
      // 한 번 갱신 사이에 여러 편집이 있을 수 있다
      const edits = 1 + Math.floor(r() * 3);
      for (let e = 0; e < edits; e++) {
        const roll = r();
        const len = doc.length;
        if (roll < 0.45) {
          const at = Math.floor(r() * len);
          const sel = { anchor: doc.positionAt(at), head: doc.positionAt(at) };
          h.record({ ops: [{ type: 'insert', ids: doc.insertText(at, randomText(r, 6)) }], before: sel, after: sel, time: step });
        } else if (roll < 0.85) {
          const from = Math.floor(r() * len);
          const sel = { anchor: doc.positionAt(from), head: doc.positionAt(from) };
          h.record({ ops: doc.deleteRange(from, from + Math.floor(r() * 20)), before: sel, after: sel, time: step });
        } else if (h.canUndo) {
          h.undo(doc);
        }
      }
      const { from, suffix } = doc.takeParagraphChanges();
      const after = doc.paragraphs();
      const f = Math.min(from, before.length, after.length);
      for (let k = 0; k < f; k++) expect(after[k]).toBe(before[k]);
      const s = Math.min(suffix, before.length - f, after.length - f);
      for (let k = 1; k <= s; k++) expect(after[after.length - k]).toBe(before[before.length - k]);
    }
  });
});
