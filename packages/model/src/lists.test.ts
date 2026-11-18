/**
 * 목록 (10 §2.4, 2-5): 번호 형식, 수준별 번호, 화면 순서, 번호 캐시 무효화, 실행 취소
 */
import { describe, expect, it } from 'vitest';
import { Doc } from './doc';
import { History } from './history';
import { defaultListDef, formatNumber, numberLists, type ListDef } from './lists';
import type { Op } from './index';

/** 문서의 목록 번호 (목록 문단만, 화면 순서) */
const labels = (doc: Doc) => doc.paragraphs().flatMap((p) => (p.attrs.list ? [doc.listLabel(p)?.text ?? '?'] : []));

/** 목록 문단 만들기: [수준, 글] 목록 → 문서 (목록 id 'n') */
function listDoc(items: Array<[number, string] | string>, kind: 'number' | 'bullet' = 'number'): Doc {
  const doc = Doc.fromText(items.map((x) => (typeof x === 'string' ? x : x[1])).join('\n'));
  doc.setList('n', defaultListDef('n', kind));
  items.forEach((x, i) => {
    if (typeof x !== 'string') doc.setParaAttr(i, 'list', { id: 'n', level: x[0] });
  });
  doc.takeParagraphChanges();
  return doc;
}

describe('number formats', () => {
  it('formats decimal, hangul, circled, roman, alpha', () => {
    expect([1, 2, 14, 15].map((n) => formatNumber(n, 'hangul'))).toEqual(['가', '나', '하', '가가']);
    expect([1, 3, 20].map((n) => formatNumber(n, 'circled'))).toEqual(['①', '③', '⑳']);
    expect(formatNumber(21, 'circled')).toBe('21');
    expect([4, 9, 14, 1994].map((n) => formatNumber(n, 'lowerRoman'))).toEqual(['iv', 'ix', 'xiv', 'mcmxciv']);
    expect([1, 26, 27].map((n) => formatNumber(n, 'upperAlpha'))).toEqual(['A', 'Z', 'AA']);
    expect(formatNumber(2, 'hangulJamo')).toBe('㉯');
  });
});

describe('list numbering', () => {
  it('numbers by level in display order and restarts deeper levels', () => {
    const doc = listDoc([[0, 'a'], [1, 'b'], [1, 'c'], [2, 'd'], [0, 'e'], [1, 'f'], 'plain', [0, 'g']]);
    // 목록 사이의 보통 문단은 번호를 끊지 않는다 (같은 목록)
    expect(labels(doc)).toEqual(['1.', '가.', '나.', '1)', '2.', '가.', '3.']);
  });

  it('supports multi-level templates and a start number', () => {
    const def: ListDef = defaultListDef('m', 'number');
    def.levels[0] = { ...def.levels[0]!, start: 5 };
    def.levels[1] = { ...def.levels[1]!, format: 'decimal', text: '%1.%2.' };
    const doc = Doc.fromText('a\nb\nc\nd');
    doc.setList('m', def);
    [[0], [1], [1], [0]].forEach(([l], i) => doc.setParaAttr(i, 'list', { id: 'm', level: l! }));
    expect(labels(doc)).toEqual(['5.', '5.1.', '5.2.', '6.']);
  });

  it('uses bullets per level, counts separate lists separately, skips lists without a definition', () => {
    const doc = Doc.fromText('a\nb\nc\nd\ne');
    doc.setList('b', defaultListDef('b', 'bullet'));
    doc.setList('n', defaultListDef('n', 'number'));
    doc.setParaAttr(0, 'list', { id: 'n', level: 0 });
    doc.setParaAttr(1, 'list', { id: 'b', level: 0 });
    doc.setParaAttr(2, 'list', { id: 'b', level: 1 });
    doc.setParaAttr(3, 'list', { id: 'n', level: 0 });
    doc.setParaAttr(4, 'list', { id: 'gone', level: 0 });
    expect(labels(doc)).toEqual(['1.', '•', '◦', '2.', '?']);
  });

  it('joins separately numbered lists that touch (1, 2, 3 — not 1, 1, 1), and when they come to touch by deleting', () => {
    // 셋을 따로 번호 매김 (사이에 보통 문단): 따로 시작하는 목록 셋
    const doc = Doc.fromText(['가', '사이', '나', '사이', '다'].join('\n'));
    for (const i of [0, 2, 4]) {
      const [id, ] = doc.createList('number');
      doc.setParaAttr(i, 'list', { id, level: 0 });
    }
    expect(labels(doc)).toEqual(['1.', '1.', '1.']);
    // 사이 문단을 지워 셋이 붙으면 한 목록처럼 1, 2, 3 (번호 캐시도 다시 센다)
    const del = (i: number) => {
      const q = doc.paragraphs()[i]!;
      doc.deleteRange(q.start, q.end + 1);
    };
    del(3);
    expect(labels(doc)).toEqual(['1.', '1.', '2.']);
    del(1);
    expect(labels(doc)).toEqual(['1.', '2.', '3.']);
    // 다시 끼우면 다시 끊긴다
    doc.insertText(doc.paragraphs()[1]!.start, '사이\n');
    doc.setParaAttr(1, 'list', undefined);
    expect(labels(doc)).toEqual(['1.', '1.', '2.']);
  });

  it('continues a joined list after a break (an item of the joined list after a table keeps counting)', () => {
    // 동시 편집으로 붙은 두 목록 (문서에서는 다른 id) + 표(보통 문단) 뒤에 두 번째 목록의 항목
    const doc = Doc.fromText('a\nb\n표\nc');
    const [x] = doc.createList('number');
    const [y] = doc.createList('number');
    doc.setParaAttr(0, 'list', { id: x, level: 0 });
    doc.setParaAttr(1, 'list', { id: y, level: 0 });
    doc.setParaAttr(3, 'list', { id: y, level: 0 });
    expect(labels(doc)).toEqual(['1.', '2.', '3.']);
  });

  it('keeps numbering across a nested bullet list of another kind, and keeps bullets and numbers apart', () => {
    const doc = Doc.fromText('a\nb\nc\nd');
    const [n1] = doc.createList('number');
    const [b1] = doc.createList('bullet');
    const [n2] = doc.createList('number');
    doc.setParaAttr(0, 'list', { id: n1, level: 0 });
    doc.setParaAttr(1, 'list', { id: b1, level: 1 });
    doc.setParaAttr(2, 'list', { id: n2, level: 0 }); // 다른 번호 목록이지만 붙어 있으므로 잇는다
    doc.setParaAttr(3, 'list', { id: b1, level: 1 });
    expect(labels(doc)).toEqual(['1.', '◦', '2.', '◦']);
  });

  it('follows paragraph moves and hiding (segments)', () => {
    const doc = listDoc([[0, 'a'], [0, 'b'], [0, 'c'], [0, 'd']]);
    doc.moveParagraphs(3, 3, 0); // d를 맨 앞으로
    expect(doc.paragraphs().map((p) => p.text)).toEqual(['d', 'a', 'b', 'c']);
    expect(labels(doc)).toEqual(['1.', '2.', '3.', '4.']);
    expect(doc.listLabel(doc.paragraphs()[0]!)!.text).toBe('1.');
    doc.hideParagraphs(1, 1); // a 숨김
    expect(doc.paragraphs().map((p) => p.text)).toEqual(['d', 'b', 'c']);
    expect(labels(doc)).toEqual(['1.', '2.', '3.']);
  });

  it('replaces the paragraph objects whose number changed, so the layout redraws them', () => {
    const doc = listDoc([[0, 'a'], [0, 'b'], 'x', [0, 'c']]);
    labels(doc);
    doc.takeParagraphChanges();
    const before = [...doc.paragraphs()];
    // b 끝에서 Enter: 새 ¶가 b의 속성(목록)을 복사 → 새 항목, 아래 c의 번호가 3 → 4
    doc.insertText(doc.paragraphs()[1]!.end, '\n');
    const ch = doc.takeParagraphChanges();
    const after = doc.paragraphs();
    expect(labels(doc)).toEqual(['1.', '2.', '3.', '4.']);
    expect(after[0]).toBe(before[0]);
    expect(after[3]).toBe(before[2]); // 보통 문단 x는 그대로
    expect(after[4]).not.toBe(before[3]); // c는 번호가 바뀌어 새 객체
    expect(ch.from).toBe(1);
    expect(ch.suffix).toBe(0);
  });

  it('does not renumber while typing inside a list item (epoch unchanged)', () => {
    const doc = listDoc([[0, 'a'], [0, 'b']]);
    labels(doc);
    const e = doc.listEpoch;
    doc.insertText(1, '가나다');
    doc.deleteRange(1, 2);
    expect(doc.listEpoch).toBe(e);
    doc.insertText(1, '\n');
    expect(doc.listEpoch).toBeGreaterThan(e);
  });

  it('undoes list definitions and list attributes', () => {
    const doc = Doc.fromText('a\nb');
    const h = new History();
    const sel = { anchor: doc.positionAt(0), head: doc.positionAt(0) };
    const [id, created] = doc.createList('number');
    const ops: Op[] = [...created, ...doc.setParaAttr(0, 'list', { id, level: 0 }), ...doc.setParaAttr(1, 'list', { id, level: 0 })];
    h.record({ ops, before: sel, after: sel, time: 0 });
    expect(labels(doc)).toEqual(['1.', '2.']);
    h.undo(doc);
    expect(doc.lists()).toEqual([]);
    expect(labels(doc)).toEqual([]);
    h.redo(doc);
    expect(labels(doc)).toEqual(['1.', '2.']);
    expect(doc.listDef(id)!.kind).toBe('number');
  });

  it('keeps cached numbers equal to a fresh count through random edits (with moves, hiding, remote edits)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = seed * 7919;
      const rnd = (n: number) => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s % n;
      };
      const doc = listDoc([[0, 'a'], [1, 'b'], 'c', [0, 'd'], [2, 'e'], [0, 'f']]);
      doc.setList('m', defaultListDef('m', 'bullet'));
      for (let step = 0; step < 200; step++) {
        const n = doc.paragraphs().length;
        const r = rnd(10);
        const p = doc.paragraphs()[rnd(n)]!;
        if (r === 0) doc.insertText(p.start + rnd(p.end - p.start + 1), '\n');
        else if (r === 1) doc.insertText(p.start, 'x');
        else if (r === 2 && doc.length > 4) {
          const a = rnd(doc.length - 2);
          doc.deleteRange(a, a + 1 + rnd(3));
        } else if (r === 3 && n > 2 && seed % 2 === 0) doc.moveParagraphs(rnd(n), rnd(n), rnd(n + 1));
        else if (r === 4 && n > 3 && seed % 3 === 0) {
          const i = rnd(n);
          doc.hideParagraphs(i, i);
        } else if (r === 5 || r === 6) {
          const i = rnd(n);
          doc.setParaAttr(i, 'list', rnd(4) === 0 ? undefined : { id: rnd(2) ? 'n' : 'm', level: rnd(4) });
        } else if (r === 7 && doc.segmentCount === 1) {
          // 원격 입력 (구획 표식이 없으면 화면 위치 = 원소 위치)
          doc.applyDelta([{ retain: rnd(doc.length) }, { insert: rnd(2) ? '원격\n' : '원격' }]);
        } else if (r === 8) doc.setList('n', rnd(2) ? defaultListDef('n', 'number') : { ...defaultListDef('n', 'number'), levels: defaultListDef('n', 'number').levels.map((l) => ({ ...l, start: 3 })) });
        // 번호 캐시 = 처음부터 센 값
        if (rnd(3) === 0) doc.takeParagraphChanges();
        const fresh = numberLists(doc.paragraphs(), new Map(doc.lists().map((l) => [l.id, l])));
        for (const q of doc.paragraphs()) expect(doc.listLabel(q)?.text, `seed ${seed} step ${step}`).toBe(fresh.get(q.id)?.text);
      }
    }
  });
});
