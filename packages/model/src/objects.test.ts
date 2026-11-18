/**
 * 개체 원소 (11 §2.1, 2-8): 넣기, 속성, 실행 취소, 지웠다 되살리기, 변경 기록, 문단 정보
 */
import { describe, expect, it } from 'vitest';
import { Doc, OBJ, type RawChange } from './doc';
import { History } from './history';
import type { Op } from './index';

const img = { id: 'i1', kind: 'image' as const, asset: 'a'.repeat(32), w: 72000, h: 36000 };
const sel = (doc: Doc) => ({ anchor: doc.positionAt(0), head: doc.positionAt(0) });

describe('object elements', () => {
  it('inserts an object as one element with attributes, visible in paragraph info', () => {
    const doc = Doc.fromText('가나\n다라');
    doc.insertObject(1, img);
    expect(doc.text()).toBe(`가${OBJ}나\n다라\n`);
    expect(doc.objAt(1)).toEqual(img);
    expect(doc.objAt(0)).toBeNull();
    const p = doc.paragraphs()[0]!;
    expect([...p.objs!]).toEqual([[1, img]]);
    expect(doc.paragraphs()[1]!.objs).toBeNull();
    expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
  });

  it('changes an attribute with undo, and re-lays out only that paragraph', () => {
    const doc = Doc.fromText('가나\n다라');
    doc.insertObject(0, img);
    doc.takeParagraphChanges();
    const before = [...doc.paragraphs()];
    const h = new History();
    h.record({ ops: doc.setObjAttr(0, 'w', 144000), before: sel(doc), after: sel(doc), time: 0 });
    expect(doc.objAt(0)!.w).toBe(144000);
    expect(doc.paragraphs()[0]).not.toBe(before[0]);
    expect(doc.paragraphs()[1]).toBe(before[1]);
    h.undo(doc);
    expect(doc.objAt(0)!.w).toBe(72000);
    h.redo(doc);
    expect(doc.objAt(0)!.w).toBe(144000);
    expect(doc.setObjAttr(1, 'w', 1)).toEqual([]); // 개체가 아닌 글자
  });

  it('remembers attributes of a deleted object and brings them back with undo', () => {
    const doc = Doc.fromText('가나다');
    const h = new History();
    h.record({ ops: doc.insertObject(1, img), before: sel(doc), after: sel(doc), time: 0 });
    h.record({ ops: doc.deleteRange(1, 2), before: sel(doc), after: sel(doc), time: 10_000 });
    expect(doc.text()).toBe('가나다\n');
    h.undo(doc);
    expect(doc.objAt(1)).toEqual(img);
  });

  it('records insert + obj changes, and sends them again when the object is revived', () => {
    const doc = Doc.fromText('가나다');
    const log: RawChange[] = [];
    doc.observe((c) => log.push(c));
    const ops: Op[] = doc.insertObject(1, { ...img, alt: '그림' });
    expect(log.map((c) => c.kind)).toEqual(['insert', 'obj', 'obj', 'obj', 'obj', 'obj', 'obj']);
    expect(log[1]).toEqual({ kind: 'obj', at: 1, key: 'id', value: 'i1' });
    log.length = 0;
    const del = doc.deleteRange(1, 2);
    const h = new History();
    h.record({ ops: [...ops], before: sel(doc), after: sel(doc), time: 0 });
    h.record({ ops: del, before: sel(doc), after: sel(doc), time: 10_000 });
    log.length = 0;
    h.undo(doc);
    expect(log[0]).toMatchObject({ kind: 'insert', at: 1, text: OBJ });
    expect(log.filter((c) => c.kind === 'obj').map((c) => (c as { key: string }).key).sort()).toEqual(['alt', 'asset', 'h', 'id', 'kind', 'w']);
  });

  it('round-trips through paragraph runs (an object is a run of its own)', () => {
    const doc = Doc.fromText('가나다');
    doc.insertObject(1, img);
    doc.format(0, 4, 'bold', true);
    const runs = doc.paragraphRuns();
    expect(runs[0]!.runs.map((r) => (r.obj ? 'OBJ' : r.text))).toEqual(['가', 'OBJ', '나다']);
    const back = Doc.fromParagraphRuns(runs);
    expect(back.paragraphRuns()).toEqual(runs);
    expect(back.objAt(1)).toEqual(img);
    expect(back.plain).toBe(false);
  });
});
