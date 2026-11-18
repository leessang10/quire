import { describe, expect, it } from 'vitest';
import { DEFAULT_SECTION, Doc, History, LAST_SECTION, fullSection, type Op, type SectionProps } from './index';

const NL = String.fromCharCode(10);
const LANDSCAPE: SectionProps = { page: { width: 841890, height: 595276, margin: [36000, 36000, 36000, 36000] }, start: 'nextPage' };

/** 문단 텍스트 5개, 둘째 문단(1) 끝에 구역 나눔 */
function doc2() {
  const d = Doc.fromText(['가', '나', '다', '라', '마'].join(NL));
  d.setSection('s1', fullSection(undefined));
  d.setParaAttr(1, 'section', 's1');
  d.setSection(LAST_SECTION, LANDSCAPE);
  d.takeParagraphChanges();
  return d;
}

describe('sections in the model (12 §3.1)', () => {
  it('finds the section of each paragraph from the section breaks, and follows paragraph inserts', () => {
    const d = doc2();
    expect(d.sectionBreaks()).toEqual([1]);
    expect([0, 1, 2, 4].map((i) => d.sectionOf(i))).toEqual([
      { index: 0, id: 's1' },
      { index: 0, id: 's1' },
      { index: 1, id: LAST_SECTION },
      { index: 1, id: LAST_SECTION },
    ]);
    // 첫 구역에 문단을 넣으면 구역 나눔이 밀린다
    d.insertText(0, `새${NL}`);
    expect(d.sectionBreaks()).toEqual([2]);
    expect(d.sectionOf(2).id).toBe('s1');
    expect(d.sectionOf(3).id).toBe(LAST_SECTION);
  });

  it('keeps one break at the end when Enter splits the break paragraph (the new ¶ does not inherit the section)', () => {
    const d = doc2();
    const p = d.paragraphs()[1]!;
    d.setParaAttr(1, 'align', 'center');
    d.insertText(p.start + 1, NL);
    expect(d.sectionBreaks()).toEqual([2]);
    // 다른 문단 속성은 이어받는다
    expect(d.paraAttrs(1)).toEqual({ align: 'center' });
    expect(d.paraAttrs(2)).toEqual({ align: 'center', section: 's1' });
  });

  it('merges a section into the next when its break ¶ is deleted, and relayouts the merged section from its start', () => {
    const d = doc2();
    const p = d.paragraphs()[1]!;
    d.deleteRange(p.end, p.end + 1); // 나 + 다 → 나다 (구역 나눔 ¶가 사라진다)
    expect(d.sectionBreaks()).toEqual([]);
    expect(d.sectionOf(0).id).toBe(LAST_SECTION);
    // 첫 문단도 구역 설정(줄 폭)이 바뀌었으므로 바뀐 구간이 0부터
    expect(d.takeParagraphChanges()!.from).toBe(0);
  });

  it('reports the whole section as changed when a break is set or the section props change', () => {
    const d = Doc.fromText(['가', '나', '다', '라', '마'].join(NL));
    d.takeParagraphChanges();
    d.setParaAttr(3, 'section', 's2');
    expect(d.takeParagraphChanges()!.from).toBe(0);
    d.setParaAttr(1, 'section', 's1');
    d.takeParagraphChanges();
    d.setSection('s2', LANDSCAPE); // 구역 s2 = 문단 2–3
    expect(d.takeParagraphChanges()).toEqual({ from: 2, suffix: 1 });
    d.setSection(LAST_SECTION, LANDSCAPE); // 마지막 구역 = 문단 4
    expect(d.takeParagraphChanges()).toEqual({ from: 4, suffix: 0 });
  });

  it('undoes and redoes section settings, and emits one change per key (LWW per key in Loro)', () => {
    const d = doc2();
    const changes: unknown[] = [];
    d.observe((c) => changes.push(c));
    const ops: Op[] = d.setSection('s1', { ...fullSection(undefined), start: 'oddPage' });
    expect(changes).toEqual([{ kind: 'sectionDef', id: 's1', key: 'start', value: 'oddPage' }]);
    const h = new History(0);
    const at = { anchor: d.positionAt(0), head: d.positionAt(0) };
    h.record({ ops, before: at, after: at, time: 0 });
    h.undo(d);
    expect(d.sectionDef('s1')!.start).toBe('nextPage');
    h.redo(d);
    expect(d.sectionDef('s1')!.start).toBe('oddPage');
    h.undo(d);
    expect(d.sectionDef('s1')).toEqual(fullSection(undefined));
    expect(fullSection(undefined)).toEqual({ ...DEFAULT_SECTION });
  });

  it('is not a plain document once it has a section setting', () => {
    const d = Doc.fromText('가');
    expect(d.plain).toBe(true);
    d.setSection(LAST_SECTION, LANDSCAPE);
    expect(d.plain).toBe(false);
  });
});
