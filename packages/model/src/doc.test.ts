import { describe, expect, it } from 'vitest';
import { Doc, History, type Transaction } from './index';

describe('Doc', () => {
  it('builds paragraphs from text and always ends with a paragraph mark', () => {
    const doc = Doc.fromText('가나\n다');
    expect(doc.text()).toBe('가나\n다\n');
    expect(doc.length).toBe(5);
    expect(doc.maxCaret).toBe(4);
    expect(doc.paragraphs().map((p) => [p.start, p.end, p.text])).toEqual([
      [0, 2, '가나'],
      [3, 4, '다'],
    ]);
  });

  it('empty document has one empty paragraph', () => {
    const doc = Doc.fromText('');
    expect(doc.paragraphs()).toEqual([{ id: expect.any(String), start: 0, end: 0, text: '', attrs: {}, fmt: null, mark: 0 }]);
  });

  it('counts code points, not UTF-16 units', () => {
    const doc = Doc.fromText('a😀b');
    expect(doc.length).toBe(4);
    expect(doc.slice(1, 2)).toBe('😀');
  });

  it('splits a paragraph by inserting a paragraph mark', () => {
    const doc = Doc.fromText('가나다');
    doc.insertText(1, '\n');
    expect(doc.paragraphs().map((p) => p.text)).toEqual(['가', '나다']);
  });

  it('merges paragraphs by deleting the paragraph mark', () => {
    const doc = Doc.fromText('가\n나');
    doc.deleteRange(1, 2);
    expect(doc.paragraphs().map((p) => p.text)).toEqual(['가나']);
  });

  it('never deletes the final paragraph mark', () => {
    const doc = Doc.fromText('가');
    doc.deleteRange(0, 99);
    expect(doc.text()).toBe('\n');
  });

  it('keeps the original paragraph id on the second half after a split', () => {
    const doc = Doc.fromText('가나');
    const id = doc.paragraphs()[0]!.id;
    doc.insertText(1, '\n');
    expect(doc.paragraphs()[1]!.id).toBe(id);
  });
});

describe('Position', () => {
  it('stays attached to its element when text is inserted before it', () => {
    const doc = Doc.fromText('가나다');
    const pos = doc.positionAt(2); // 다 앞
    doc.insertText(0, 'XYZ');
    expect(doc.resolve(pos)).toBe(5);
  });

  it('resolves to the gap when its anchor element is deleted', () => {
    const doc = Doc.fromText('가나다라');
    const pos = doc.positionAt(2); // 다 앞
    doc.deleteRange(1, 3); // 나다 삭제
    expect(doc.text()).toBe('가라\n');
    expect(doc.resolve(pos)).toBe(1);
  });

  it('after-side position moves past its anchor', () => {
    const doc = Doc.fromText('가나');
    const pos = { anchor: doc.positionAt(0).anchor, side: 'after' as const };
    expect(doc.resolve(pos)).toBe(1);
  });
});

describe('History', () => {
  function typeAt(doc: Doc, h: History, offset: number, text: string, time: number) {
    const before = { anchor: doc.positionAt(offset), head: doc.positionAt(offset) };
    const ids = doc.insertText(offset, text);
    const after = { anchor: doc.positionAt(offset + text.length), head: doc.positionAt(offset + text.length) };
    const tr: Transaction = { ops: [{ type: 'insert', ids }], before, after, mergeKey: 'type', time };
    h.record(tr);
  }

  it('undoes and redoes an insert', () => {
    const doc = Doc.fromText('가');
    const h = new History();
    typeAt(doc, h, 1, '나', 0);
    expect(doc.text()).toBe('가나\n');
    h.undo(doc);
    expect(doc.text()).toBe('가\n');
    h.redo(doc);
    expect(doc.text()).toBe('가나\n');
  });

  it('merges consecutive typing within the merge window', () => {
    const doc = Doc.fromText('');
    const h = new History(1000);
    typeAt(doc, h, 0, '가', 0);
    typeAt(doc, h, 1, '나', 500);
    typeAt(doc, h, 2, '다', 3000); // 창 밖 → 별도 단위
    h.undo(doc);
    expect(doc.text()).toBe('가나\n');
    h.undo(doc);
    expect(doc.text()).toBe('\n');
  });

  it('undo of a delete restores elements with their original ids', () => {
    const doc = Doc.fromText('가나다');
    const h = new History();
    const pos = doc.positionAt(1); // 나 앞
    const sel = { anchor: pos, head: pos };
    const ops = doc.deleteRange(1, 2);
    h.record({ ops, before: sel, after: sel, time: 0 });
    const restored = h.undo(doc)!;
    expect(doc.text()).toBe('가나다\n');
    expect(doc.resolve(restored.head)).toBe(1);
  });
});

describe('Doc.fromText', () => {
  it('matches paragraphs computed from scratch, including astral characters and CRLF', () => {
    const doc = Doc.fromText('가😀나\r\n\n다라\r마\n');
    expect(doc.text()).toBe('가😀나\n\n다라\n마\n\n');
    expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
    doc.checkInvariants();
  });

  it('fills more than one chunk', () => {
    const doc = Doc.fromText('가'.repeat(3000) + '\n' + '나'.repeat(10));
    expect(doc.length).toBe(3012);
    expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
    doc.checkInvariants();
    doc.insertText(1500, '다');
    expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
  });
});
