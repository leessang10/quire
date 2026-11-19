/**
 * 제안 수락·거부 (14 §4.2, 4-4, G3): 05 §5 표의 행마다 "제안 → 수락" = 직접 편집, "제안 → 거부" = 제안 전 문서.
 * 비교는 문단 런(글자·서식·문단 속성)이다. 수락·거부는 실행 취소된다.
 */
import { describe, expect, it } from 'vitest';
import { Doc, Document, History, type CommentAuthor, type Op } from './index';

const A: CommentAuthor = { id: 'ua', name: '가영', color: '#2563eb' };
const B: CommentAuthor = { id: 'ub', name: '나래', color: '#c2410c' };

const dump = (d: Document) => JSON.stringify(d.body.paragraphRuns());

function make(build: (doc: Doc) => void) {
  const doc = Doc.fromText('');
  build(doc);
  return doc;
}

/** 시작 문서: 두 문단, 둘째는 가운데 정렬, "둘" 굵게 */
const START = (doc: Doc) => {
  doc.insertText(0, '하나 가나다\n둘 라마바');
  doc.setParaAttr(1, 'align', 'center');
  doc.format(7, 8, 'bold', true);
};

type Edit = (doc: Doc) => Op[];
const ROWS: Array<[string, Edit]> = [
  ['글자 넣기', (doc) => [{ type: 'insert', ids: doc.insertText(3, '새 ') }]],
  ['글자 지우기', (doc) => doc.deleteRange(3, 5)],
  ['문단 나누기 (¶ 넣기)', (doc) => [{ type: 'insert', ids: doc.insertText(5, '\n') }]],
  ['문단 합치기 (¶ 지우기, 속성이 다른 문단)', (doc) => doc.deleteRange(6, 7)],
  ['문단 걸쳐 지우기', (doc) => doc.deleteRange(4, 9)],
  ['바꿔 쓰기', (doc) => [...doc.deleteRange(3, 6), { type: 'insert', ids: doc.insertText(3, '마') }]],
  ['글자 서식', (doc) => doc.format(1, 9, 'bold', true)],
  ['서식 두 키', (doc) => [...doc.format(0, 4, 'italic', true), ...doc.format(2, 8, 'bold', undefined)]],
  ['문단 속성', (doc) => [...doc.setParaAttr(0, 'align', 'right'), ...doc.setParaAttr(1, 'align', undefined)]],
  ['개체 넣기', (doc) => doc.insertObject(2, { id: 'img1', kind: 'image', src: 'x', w: 10000, h: 10000 } as never)],
];

/** 편집기처럼: 지우기는 직접 편집에서 앞 문단 속성을 둔다 (mergeKeepAttrs) */
function direct(edit: Edit, row: string): string {
  const doc = make(START);
  const d = new Document(doc);
  if (row.startsWith('문단 합치기') || row.startsWith('문단 걸쳐') ) {
    const keep = doc.paraAttrs(0);
    edit(doc);
    for (const k of new Set([...Object.keys(keep), ...Object.keys(doc.paraAttrs(0))])) doc.setParaAttr(0, k as never, (keep as Record<string, unknown>)[k]);
  } else edit(doc);
  return dump(d);
}

function suggested(edit: Edit) {
  const doc = make(START);
  const d = new Document(doc);
  const original = dump(d);
  d.setSuggesting({ author: A, now: () => 1 });
  const ops = edit(doc);
  d.recordSuggestions(null, doc, ops);
  d.setSuggesting(null);
  return { doc, d, original };
}

describe('accept and reject (05 §5 rows)', () => {
  for (const [row, edit] of ROWS) {
    it(`${row}: accept = direct edit, reject = original, and both undo`, () => {
      const want = direct(edit, row);
      {
        const { d, original } = suggested(edit);
        const before = dump(d);
        const h = new History();
        const pos = { anchor: d.body.positionAt(0), head: d.body.positionAt(0) };
        h.record({ ops: d.resolveAll(true), before: pos, after: pos, time: 0 });
        expect(dump(d)).toBe(want);
        expect(d.annotationRanges().filter((r) => r.type === 'suggestion')).toEqual([]);
        h.undo(d);
        expect(dump(d)).toBe(before);
        void original;
      }
      {
        const { d, original } = suggested(edit);
        d.resolveAll(false);
        expect(dump(d)).toBe(original);
        expect(d.annotationRanges().filter((r) => r.type === 'suggestion')).toEqual([]);
      }
    });
  }

  it('accepts and rejects one suggestion at a time, by author, and cleans up suggestions left without text', () => {
    const doc = make(START);
    const d = new Document(doc);
    d.setSuggesting({ author: A });
    d.recordSuggestions(null, doc, [{ type: 'insert', ids: doc.insertText(0, 'AA') }]);
    d.setSuggesting({ author: B });
    d.recordSuggestions(null, doc, doc.deleteRange(0, 2)); // A의 삽입 위 B의 삭제
    d.recordSuggestions(null, doc, [{ type: 'insert', ids: doc.insertText(4, 'BB') }]);
    d.setSuggesting(null);
    expect(d.annotationRanges().filter((r) => r.type === 'suggestion').length).toBe(3);
    // A의 것만 거부: A의 삽입 글자가 지워지고, 그 위의 B 삭제 제안은 글자가 없어 함께 없어진다
    d.resolveAll(false, 'ua');
    expect(doc.text().startsWith('하나BB')).toBe(true);
    const left = d.annotationRanges().filter((r) => r.type === 'suggestion');
    expect(left.map((r) => r.data.kind)).toEqual(['insert']);
    d.resolveSuggestion(left[0]!.id, true);
    expect(doc.text()).toBe('하나BB 가나다\n둘 라마바\n');
    expect(d.annotationRanges().filter((r) => r.type === 'suggestion')).toEqual([]);
  });

  it('works in other stories (footnote)', () => {
    const d = new Document(Doc.fromText('본문'));
    const fn = d.story('fn|n1');
    fn.insertText(0, '각주 내용');
    d.setSuggesting({ author: A });
    d.recordSuggestions('fn|n1', fn, fn.deleteRange(0, 3));
    d.setSuggesting(null);
    const h = new History();
    const pos = { anchor: d.body.positionAt(0), head: d.body.positionAt(0) };
    h.record({ ops: d.resolveAll(true), before: pos, after: pos, time: 0 });
    expect(fn.text()).toBe('내용\n');
    h.undo(d);
    expect(fn.text()).toBe('각주 내용\n');
  });
});
