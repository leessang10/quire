/**
 * 문단 스타일 (10 §2.3, 2-4): 사슬 풀이, 실제 문단 속성, 정의 바꾸기·실행 취소, 바뀐 문단만 알림
 */
import { describe, expect, it } from 'vitest';
import { Doc } from './doc';
import { History } from './history';
import { DEFAULT_STYLES, mergeParaAttrs, resolveStyle, type Style } from './styles';

const byName = (list: Style[]) => (n: string) => list.find((s) => s.name === n);

describe('style resolution', () => {
  it('resolves a basedOn chain, later styles winning, indent and space merged per key', () => {
    const list: Style[] = [
      { name: 'body', para: { space: { before: 1000, after: 2000 }, indent: { left: 10 } }, marks: { size: 11000 } },
      { name: 'h', basedOn: 'body', para: { space: { before: 5000 } }, marks: { bold: true, size: 20000 } },
      { name: 'h-sub', basedOn: 'h', para: { indent: { first: 7 } }, marks: { italic: true } },
    ];
    const r = resolveStyle('h-sub', byName(list));
    expect(r.chain).toEqual(['h-sub', 'h', 'body']);
    expect(r.para).toEqual({ space: { before: 5000, after: 2000 }, indent: { left: 10, first: 7 } });
    expect(r.marks).toEqual({ size: 20000, bold: true, italic: true });
  });

  it('falls back to body for unknown names and stops at cycles', () => {
    const list: Style[] = [
      { name: 'body', marks: { size: 1 } },
      { name: 'a', basedOn: 'b', marks: { bold: true } },
      { name: 'b', basedOn: 'a', marks: { italic: true } },
    ];
    expect(resolveStyle('nope', byName(list)).chain).toEqual(['body']);
    expect(resolveStyle('a', byName(list)).chain).toEqual(['a', 'b']);
  });

  it('merges direct paragraph attributes over the style', () => {
    expect(mergeParaAttrs({ align: 'center', indent: { left: 1, right: 2 } }, { indent: { right: 5 }, align: undefined })).toEqual({
      align: 'center',
      indent: { left: 1, right: 5 },
    });
  });
});

describe('Doc styles', () => {
  it('starts with the default styles and gives each paragraph its effective attributes', () => {
    const doc = Doc.fromText('제목\n본문');
    expect(doc.styles().map((s) => s.name)).toEqual(DEFAULT_STYLES.map((s) => s.name));
    doc.setParaAttr(0, 'style', 'h1');
    doc.setParaAttr(0, 'align', 'center');
    expect(doc.paraStyle(0).marks).toEqual({ bold: true, size: 24000 });
    expect(doc.effectiveParaAttrs(0)).toEqual({ space: { before: 18000, after: 6000 }, keepWithNext: true, style: 'h1', align: 'center' });
    expect(doc.effectiveParaAttrs(1)).toEqual({});
  });

  it('changes only the paragraphs that use the style (directly or through basedOn) when its definition changes', () => {
    const doc = Doc.fromText('a\nb\nc\nd\ne');
    doc.setParaAttr(1, 'style', 'h1');
    doc.setParaAttr(3, 'style', 'h2');
    doc.takeParagraphChanges();
    const before = [...doc.paragraphs()];
    const v = doc.stylesVersion;
    const ops = doc.setStyle('h1', { ...doc.style('h1')!, marks: { bold: true, size: 30000 } });
    expect(doc.stylesVersion).toBe(v + 1);
    const after = [...doc.paragraphs()];
    expect(after.map((p, i) => p !== before[i])).toEqual([false, true, false, false, false]);
    expect(doc.takeParagraphChanges()).toEqual({ from: 1, suffix: 3 });
    expect(doc.paraStyle(1).marks.size).toBe(30000);
    // body는 모든 스타일의 바탕: 본문을 바꾸면 모든 문단
    doc.setStyle('body', { name: 'body', marks: { size: 10000 } });
    expect(doc.paragraphs().every((p, i) => p !== after[i])).toBe(true);
    expect(doc.paraStyle(3).marks).toEqual({ size: 18000, bold: true });
    // 실행 취소
    const h = new History();
    h.record({ ops, before: { anchor: doc.positionAt(0), head: doc.positionAt(0) }, after: { anchor: doc.positionAt(0), head: doc.positionAt(0) }, time: 0 });
    h.undo(doc);
    expect(doc.style('h1')!.marks).toEqual({ bold: true, size: 24000 });
    h.redo(doc);
    expect(doc.style('h1')!.marks).toEqual({ bold: true, size: 30000 });
  });

  it('can delete and re-add a style; paragraphs naming a missing style read as body', () => {
    const doc = Doc.fromText('a\nb');
    doc.setParaAttr(0, 'style', 'quote');
    const ops = doc.setStyle('quote', undefined);
    expect(doc.style('quote')).toBeUndefined();
    expect(doc.paraStyle(0).chain).toEqual(['body']);
    expect(ops).toHaveLength(1);
    expect(doc.setStyle('quote', undefined)).toEqual([]);
  });
});
