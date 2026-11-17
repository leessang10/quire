/**
 * 서식 (10, 단계 2-2): 서식 묶음 저장, 입력 서식 이어받기, 문단 속성, 실행 취소, 변경 기록.
 */
import { describe, expect, it } from 'vitest';
import { Doc, History, type MarkSet, type Op, type RawChange } from './index';

const marksOf = (doc: Doc) => Array.from(doc.text()).map((_, k) => doc.marksAt(k));
/** key 서식이 걸린 글자만 남긴다 (¶는 /) */
function masked(doc: Doc, key: keyof MarkSet): string {
  return Array.from(doc.text())
    .map((ch, k) => (ch === '\n' ? '/' : doc.marksAt(k)[key] !== undefined ? ch : '·'))
    .join('');
}

describe('character formats', () => {
  it('formats a range and shares one mark set per distinct format', () => {
    const doc = Doc.fromText('가나다라마\n바사');
    doc.format(1, 3, 'bold', true);
    doc.format(2, 4, 'color', '#f00');
    expect(masked(doc, 'bold')).toBe('·나다··/··/');
    expect(masked(doc, 'color')).toBe('··다라·/··/');
    expect(doc.marksAt(2)).toEqual({ bold: true, color: '#f00' });
    expect(doc.marksAt(2)).toBe(doc.marksAt(2)); // 같은 객체 (묶음 공유)
    expect(doc.markRuns(0, 5).map((r) => [r.from, r.to, r.marks])).toEqual([
      [0, 1, {}],
      [1, 2, { bold: true }],
      [2, 3, { bold: true, color: '#f00' }],
      [3, 4, { color: '#f00' }],
      [4, 5, {}],
    ]);
    const p = doc.paragraphs()[0]!;
    expect(p.fmt && Array.from(p.fmt).map((f) => doc.markSet(f))).toEqual(marksOf(doc).slice(0, 5));
    expect(doc.paragraphs()[1]!.fmt).toBeNull();
    // 해제
    doc.format(0, 5, 'bold', undefined);
    expect(masked(doc, 'bold')).toBe('·····/··/');
  });

  it('inherits formats when typing (10 §2.6): from the previous character, links excluded', () => {
    const doc = Doc.fromText('가나다\n라마');
    doc.format(0, 3, 'bold', true);
    doc.format(1, 3, 'link', 'https://q');
    doc.insertText(3, 'X'); // 굵은 글자 끝
    expect(doc.marksAt(3)).toEqual({ bold: true }); // 링크는 이어받지 않는다
    doc.insertText(0, 'Y'); // 문단 첫머리: 그 자리 글자(가)의 서식
    expect(doc.marksAt(0)).toEqual({ bold: true });
    doc.insertText(doc.paragraphs()[1]!.start, 'Z'); // 다음 문단 첫머리: 라(서식 없음)
    expect(doc.marksAt(doc.paragraphs()[1]!.start)).toEqual({});
    // 편집기의 보류 서식을 주면 그것
    doc.insertText(1, 'W', { italic: true });
    expect(doc.marksAt(1)).toEqual({ italic: true });
  });

  it('formats an empty paragraph through its mark and types in that format', () => {
    const doc = Doc.fromText('가\n\n나');
    doc.format(2, 3, 'bold', true); // 빈 문단의 ¶
    doc.insertText(2, '다');
    expect(doc.marksAt(2)).toEqual({ bold: true });
  });
});

describe('paragraph attributes', () => {
  it('sets attributes and copies them to new paragraphs on Enter (10 §2.2)', () => {
    const doc = Doc.fromText('가나다라\n마바');
    doc.setParaAttr(0, 'align', 'center');
    doc.setParaAttr(0, 'list', { id: 'L1', level: 0 });
    expect(doc.paraAttrs(0)).toEqual({ align: 'center', list: { id: 'L1', level: 0 } });
    expect(doc.paraAttrs(1)).toEqual({});
    doc.takeParagraphChanges();
    doc.insertText(2, '\n'); // 가나 / 다라
    expect(doc.paragraphs().map((p) => p.attrs.align ?? '-')).toEqual(['center', 'center', '-']);
    doc.setParaAttr(1, 'align', undefined);
    expect(doc.paraAttrs(1)).toEqual({ list: { id: 'L1', level: 0 } });
    const ch = doc.takeParagraphChanges();
    expect(ch.from).toBe(0);
    expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
  });

  it('keeps attributes with the paragraph mark through moves and hides', () => {
    const doc = Doc.fromText('하나\n둘\n셋');
    doc.setParaAttr(0, 'align', 'right');
    doc.moveParagraphs(0, 0, 3);
    expect(doc.paragraphs().map((p) => `${p.text}:${p.attrs.align ?? '-'}`)).toEqual(['둘:-', '셋:-', '하나:right']);
    expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
  });
});

describe('undo and redo', () => {
  it('undoes and redoes formats and attributes', () => {
    const doc = Doc.fromText('가나다라마\n바사');
    const h = new History(0);
    const sel = { anchor: doc.positionAt(0), head: doc.positionAt(0) };
    const rec = (ops: Op[]) => h.record({ ops, before: sel, after: sel, time: Date.now() });
    rec(doc.format(0, 5, 'bold', true));
    rec(doc.setParaAttr(1, 'align', 'center'));
    h.undo(doc);
    expect(doc.paraAttrs(1)).toEqual({});
    h.undo(doc);
    expect(masked(doc, 'bold')).toBe('·····/··/');
    h.redo(doc);
    h.redo(doc);
    expect(masked(doc, 'bold')).toBe('가나다라마/··/');
    expect(doc.paraAttrs(1)).toEqual({ align: 'center' });
  });

  it('does not undo a key someone else has changed since (05 §4)', () => {
    const doc = Doc.fromText('가나다라마');
    const h = new History(0);
    const sel = { anchor: doc.positionAt(0), head: doc.positionAt(0) };
    h.record({ ops: doc.format(0, 5, 'color', '#f00'), before: sel, after: sel, time: 0 });
    // 다른 사용자: 나다를 파랑으로 (기록 안 함)
    doc.format(1, 3, 'color', '#00f');
    h.undo(doc);
    expect(marksOf(doc).slice(0, 5).map((m) => m.color ?? '-')).toEqual(['-', '#00f', '#00f', '-', '-']);
  });

  it('brings formatting back with undone deletions', () => {
    const doc = Doc.fromText('가나다라마');
    const h = new History(0);
    const sel = { anchor: doc.positionAt(0), head: doc.positionAt(0) };
    doc.format(1, 4, 'italic', true);
    h.record({ ops: doc.deleteRange(0, 5), before: sel, after: sel, time: 0 });
    expect(doc.text()).toBe('\n');
    h.undo(doc);
    expect(masked(doc, 'italic')).toBe('·나다라·/');
  });
});

describe('change records (for sync, 09)', () => {
  it('carries marks on inserts and emits mark/para changes in UTF-16 positions', () => {
    const doc = Doc.fromText('a😀b\ncd');
    const log: RawChange[] = [];
    doc.observe((c) => log.push(c));
    doc.format(1, 3, 'bold', true); // 😀b
    doc.insertText(3, 'X'); // b 뒤: 굵게 이어받음
    doc.setParaAttr(1, 'align', 'center');
    expect(log).toEqual([
      { kind: 'mark', at: 1, len: 3, key: 'bold', value: true },
      { kind: 'insert', at: 4, text: 'X', marks: { bold: true } },
      { kind: 'para', at: 8, key: 'align', value: 'center' },
    ]);
  });

  it('splits mark changes where the display order jumps between segments', () => {
    const doc = Doc.fromText('하나\n둘\n셋');
    doc.moveParagraphs(2, 2, 0); // 셋 / 하나 / 둘
    const log: RawChange[] = [];
    doc.observe((c) => log.push(c));
    doc.format(0, doc.length, 'italic', true);
    const marks = log.filter((c) => c.kind === 'mark');
    expect(marks.length).toBeGreaterThan(1);
    // 모두 합치면 보이는 글자 수(구획 표식 제외)를 덮는다
    expect(marks.reduce((s, m) => s + (m.kind === 'mark' ? m.len : 0), 0)).toBe(doc.length);
  });

  it('copies formatting with the segment tail when a moved paragraph loses its mark', () => {
    const doc = Doc.fromText('하나\n둘\n셋');
    doc.moveParagraphs(2, 2, 0); // 셋 / 하나 / 둘 (셋은 구획 끝 ¶)
    doc.format(0, 1, 'bold', true); // 셋
    const end = doc.paragraphs()[0]!.end;
    doc.deleteRange(end, end + 1); // 셋의 ¶ 삭제 → 꼬리 "셋"을 다음 구획으로 복사
    expect(doc.text()).toBe('셋하나\n둘\n');
    expect(masked(doc, 'bold')).toBe('셋··/·/');
  });
});

describe('canonical runs', () => {
  it('round-trips paragraphs, runs and attributes', () => {
    const doc = Doc.fromText('제목\n본문 굵게 끝\n');
    doc.setParaAttr(0, 'style', 'Heading1');
    doc.format(5, 7, 'bold', true); // " 굵"
    doc.format(6, 7, 'size', 14000); // "굵"
    const runs = doc.paragraphRuns();
    expect(runs[1]!.runs.map((r) => [r.text, r.marks])).toEqual([
      ['본문', {}],
      [' ', { bold: true }],
      ['굵', { bold: true, size: 14000 }],
      ['게 끝', {}],
    ]);
    const back = Doc.fromParagraphRuns(runs);
    expect(back.paragraphRuns()).toEqual(runs);
    expect(back.text()).toBe(doc.text());
  });
});

// ── 무작위: 증분 = 처음부터, 모두 되돌리면 처음, 모두 다시 하면 마지막 ──
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('randomized formatting', () => {
  // 문단 이동이 섞이면 실행 취소는 정확히 처음으로 돌아가지 않는다 (구획을 근사 자리로 되돌림, 마지막 ¶ 남김).
  // 그때는 매 단계 증분 = 처음부터와 "모두 되돌리면 서식이 없다"만 본다
  for (const [seed, moves] of [[1, false], [2, false], [3, false], [7, true], [42, true], [99, true], [5, true], [11, true]] as const) {
    it(`seed ${seed}${moves ? ' (moves)' : ''}`, () => {
      const r = rng(seed);
      const doc = Doc.fromText('하나 둘 셋\n넷 다섯\n여섯');
      const start = doc.paragraphRuns();
      const h = new History(0);
      const sel = { anchor: doc.positionAt(0), head: doc.positionAt(0) };
      const keys = ['bold', 'italic', 'color', 'link'] as const;
      for (let step = 0; step < 300; step++) {
        const n = doc.length;
        const at = Math.floor(r() * n);
        const len = 1 + Math.floor(r() * 6);
        const pick = r();
        let ops: Op[] = [];
        if (pick < 0.3) ops = [{ type: 'insert', ids: doc.insertText(Math.min(at, doc.maxCaret), ['가', 'ab', '\n', ' 다'][Math.floor(r() * 4)]!) }];
        else if (pick < 0.45 && doc.maxCaret > 0) ops = doc.deleteRange(Math.min(at, doc.maxCaret - 1), Math.min(doc.maxCaret, at + len));
        else if (pick < 0.75) {
          const key = keys[Math.floor(r() * keys.length)]!;
          ops = doc.format(at, Math.min(n, at + len), key, r() < 0.3 ? undefined : key === 'color' ? '#0a0' : key === 'link' ? 'u' : true);
        } else if (pick < 0.88) {
          const i = Math.floor(r() * doc.paragraphs().length);
          ops = doc.setParaAttr(i, r() < 0.5 ? 'align' : 'style', r() < 0.3 ? undefined : ['center', 'right', 'H1'][Math.floor(r() * 3)]);
        } else if (moves && pick < 0.95 && doc.paragraphs().length > 1) {
          const k = doc.paragraphs().length;
          const i = Math.floor(r() * k);
          ops = doc.moveParagraphs(i, i, Math.floor(r() * (k + 1)));
        }
        h.record({ ops, before: sel, after: sel, time: step });
        if (step % 25 === 0) {
          expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
          doc.checkInvariants();
        }
      }
      const end = doc.paragraphRuns();
      const endText = doc.text();
      while (h.canUndo) {
        h.undo(doc);
        expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
      }
      doc.checkInvariants();
      if (!moves) expect(doc.paragraphRuns()).toEqual(start);
      // 처음에는 서식·속성이 없었다
      for (const p of doc.paragraphRuns()) {
        expect(p.attrs).toEqual({});
        for (const run of p.runs) expect(run.marks).toEqual({});
      }
      while (h.canRedo) {
        h.redo(doc);
        expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
      }
      doc.checkInvariants();
      if (!moves) {
        expect(doc.text()).toBe(endText);
        expect(doc.paragraphRuns()).toEqual(end);
      }
    });
  }
});

describe('cost', () => {
  it('formats and undoes a whole large document quickly', () => {
    const para = '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다.';
    const doc = Doc.fromText(Array.from({ length: 10_000 }, (_, i) => `${i}. ${para}`).join('\n'));
    const h = new History(0);
    const sel = { anchor: doc.positionAt(0), head: doc.positionAt(0) };
    let t = performance.now();
    h.record({ ops: doc.format(0, doc.length, 'bold', true), before: sel, after: sel, time: 0 });
    const formatMs = performance.now() - t;
    t = performance.now();
    h.undo(doc);
    const undoMs = performance.now() - t;
    t = performance.now();
    doc.insertText(500, '가');
    const typeMs = performance.now() - t;
    console.log(`글자 ${doc.length.toLocaleString()}개: 전체 굵게 ${formatMs.toFixed(0)} ms, 되돌리기 ${undoMs.toFixed(0)} ms, 그 뒤 입력 ${typeMs.toFixed(2)} ms`);
    expect(formatMs).toBeLessThan(2000);
    expect(undoMs).toBeLessThan(2000);
    expect(doc.marksAt(0)).toEqual({});
  });
});
