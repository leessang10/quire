/**
 * 문단 상자 (10 §4, 2-4): 들여쓰기·정렬·양쪽 맞춤·문단 간격·줄 간격
 */
import { describe, expect, it } from 'vitest';
import {
  LayoutCache,
  PLAIN_STYLE,
  PagedLayout,
  baselineOffset,
  layoutParagraph,
  lineX,
  type FormatSource,
  type Measurer,
  type PageSetup,
  type ParaBox,
  type ParaInput,
} from './index';

/** 모든 grapheme 폭 10 */
const mono: Measurer = { width: () => 10 };
const style = () => PLAIN_STYLE;
const BOX: ParaBox = { align: 'left', left: 0, right: 0, first: 0, before: 5, after: 0, line: null };
const box = (b: Partial<ParaBox>): ParaBox => ({ ...BOX, ...b });

/** 본문 폭 200 (= 20글자), 줄 높이 20, 문단 간격 5 */
const SETUP: PageSetup = { width: 300, height: 1000, margin: 50, gap: 10, lineHeight: 20, paraSpacing: 5, fontSize: 12 };

/** info.id → 상자 */
function boxes(map: Record<string, ParaBox>): FormatSource {
  return (info) => (map[info.id] ? { fmt: null, mark: 0, style, box: map[info.id] } : null);
}

function place(paras: ParaInput[], map: Record<string, ParaBox>) {
  const pl = new PagedLayout(SETUP, mono, new LayoutCache(), boxes(map));
  pl.update(paras);
  pl.finish();
  return pl;
}

describe('paragraph box', () => {
  it('breaks the first line at width − left − right − first and the rest at width − left − right', () => {
    const pl = layoutParagraph('가나다라마바사아자차카', 100, mono, null, { fmt: null, mark: 0, style, box: box({ left: 20, first: 30 }) });
    // 첫 줄 50 = 5글자, 나머지 80 = 8글자
    expect(pl.lines.map((l) => l.end - l.start)).toEqual([5, 6]);
    expect(pl.widths).toEqual([50, 80]);
    // 내어쓰기(first < 0)는 첫 줄이 더 넓다
    const hang = layoutParagraph('가나다라마바사아자차카', 100, mono, null, { fmt: null, mark: 0, style, box: box({ left: 40, first: -20 }) });
    expect(hang.widths).toEqual([80, 60]);
    expect(hang.lines.map((l) => l.end - l.start)).toEqual([8, 3]);
  });

  it('shifts line x by the indent, and by the free width for center and right (trailing spaces ignored)', () => {
    const paras: ParaInput[] = [
      { id: 'l', start: 0, text: '가나다' },
      { id: 'c', start: 4, text: '가나다 ' },
      { id: 'r', start: 9, text: '가나다' },
    ];
    const pl = place(paras, { l: box({ left: 10, first: 5 }), c: box({ align: 'center' }), r: box({ align: 'right', right: 20 }) });
    expect(pl.para(0).lines[0]!.x).toBe(50 + 15);
    expect(pl.para(1).lines[0]!.x).toBe(50 + (200 - 30) / 2);
    expect(pl.para(2).lines[0]!.x).toBe(50 + (180 - 30));
  });

  it('justifies every line but the last by widening spaces, without touching xs; caret positions follow', () => {
    // 줄 1: "가나 다라 마바 " (공백 2개 사이), 폭 100
    const paras: ParaInput[] = [{ id: 'j', start: 0, text: '가나 다라 마바 사아자' }];
    const setup = { ...SETUP, width: 200 }; // 본문 폭 100
    const pl = new PagedLayout(setup, mono, new LayoutCache(), boxes({ j: box({ align: 'justify' }) }));
    pl.update(paras);
    const para = pl.para(0);
    const [l0, l1] = para.lines;
    expect([l0!.start, l0!.end]).toEqual([0, 9]);
    // 내용 폭 80 (끝 공백 제외) → 남는 20을 공백 2개에 10씩
    expect(lineX(para.layout, l0!, 8)).toBe(50 + 100);
    expect(lineX(para.layout, l0!, 3)).toBe(50 + 40); // "다" 앞: 공백 하나 지남
    expect(para.layout.xs[3]).toBe(30); // xs는 그대로
    expect(l1!.adj).toBeNull(); // 마지막 줄은 맞추지 않음
    expect(pl.caretRect(3).x).toBe(90);
    expect(pl.hitTest(91, l0!.y + 1)).toBe(3);
  });

  it('justifies a line without spaces between characters, with a per-character cap', () => {
    const paras: ParaInput[] = [{ id: 'j', start: 0, text: '가나다라마바사아자차카타파하' }];
    const setup = { ...SETUP, width: 225 }; // 본문 폭 125 → 12글자 120, 남는 5
    const pl = new PagedLayout(setup, mono, new LayoutCache(), boxes({ j: box({ align: 'justify' }) }));
    pl.update(paras);
    const l0 = pl.para(0).lines[0]!;
    expect(l0.adjChars).toBe(true);
    expect(lineX(pl.para(0).layout, l0, 12)).toBeCloseTo(50 + 125, 4);
    // 상한: 넓은 글자(W = 50)가 다음 줄로 넘어가 남는 폭(30)이 크면 글자 사이마다 0.3em(12 × 0.3 = 3.6)까지만
    const wideM: Measurer = { width: (g) => (g === 'W' ? 50 : 10) };
    const wide = new PagedLayout({ ...SETUP, width: 200 }, wideM, new LayoutCache(), boxes({ j: box({ align: 'justify' }) }));
    wide.update([{ id: 'j', start: 0, text: '가나다라마바사WW' }]);
    const w0 = wide.para(0).lines[0]!;
    expect(w0.end).toBe(7);
    expect(lineX(wide.para(0).layout, w0, 7) - lineX(wide.para(0).layout, w0, 0)).toBeCloseTo(70 + 6 * 3.6, 4);
  });

  it('adds space before (not at the top of a page or for the first paragraph) and space after', () => {
    const paras: ParaInput[] = [
      { id: 'a', start: 0, text: '가' },
      { id: 'b', start: 2, text: '나' },
      { id: 'c', start: 4, text: '다' },
    ];
    const pl = place(paras, { b: box({ before: 30, after: 7 }) });
    const y = (i: number) => pl.para(i).lines[0]!.y;
    expect(y(1) - y(0)).toBe(20 + 30);
    expect(y(2) - y(1)).toBe(20 + 7 + 5); // b의 뒤 간격 + c의 기본 앞 간격
    const first = place([{ id: 'b', start: 0, text: '가' }], { b: box({ before: 30 }) });
    expect(first.para(0).lines[0]!.y).toBe(10 + 50);
  });

  it('sets line heights by rule: multiple, exact, at least', () => {
    const paras: ParaInput[] = [
      { id: 'm', start: 0, text: '가' },
      { id: 'e', start: 2, text: '나' },
      { id: 'a', start: 4, text: '다' },
      { id: 'b', start: 6, text: '라' },
    ];
    const pl = place(paras, {
      m: box({ line: { rule: 'multiple', value: 1.5 } }),
      e: box({ line: { rule: 'exact', value: 12 } }),
      a: box({ line: { rule: 'atLeast', value: 12 } }),
      b: box({ line: { rule: 'atLeast', value: 33 } }),
    });
    expect([0, 1, 2, 3].map((i) => pl.para(i).lines[0]!.height)).toEqual([30, 12, 20, 33]);
  });

  it('keys the layout cache on the box, so the same text with another indent is laid out again', () => {
    const cache = new LayoutCache();
    const f = (b: ParaBox) => ({ fmt: null, mark: 0, style, box: b });
    const a = cache.get('가나다라', 1000, mono, null, f(box({ left: 10 })));
    const b = cache.get('가나다라', 1000, mono, null, f(box({ left: 20 })));
    expect(a).not.toBe(b);
    expect(cache.get('가나다라', 1000, mono, null, f(box({ left: 20 })))).toBe(b);
  });
});

describe('list marker', () => {
  const fmt = (text: string, hanging: number) => ({ fmt: null, mark: 0, style, box: box({ left: 40 }), marker: { text, id: 0, hanging } });

  it('puts the marker in the hanging space left of the text and keeps the first line aligned with the rest', () => {
    const pl = layoutParagraph('가나다라마바사아자차카', 100, mono, null, fmt('1.', 30));
    expect(pl.marker).toMatchObject({ text: '1.', width: 20, x: -30, shift: 0 });
    expect(pl.widths).toEqual([60, 60]);
  });

  it('pushes the first line right when the marker (+ one space) is wider than the hanging space', () => {
    const pl = layoutParagraph('가나다라마바사아자차카', 100, mono, null, fmt('(10)', 30));
    // 폭 40 + 공백 10 − 내어쓰기 30 = 20만큼
    expect(pl.marker!.shift).toBe(20);
    expect(pl.widths).toEqual([40, 60]);
    const placed = new PagedLayout(SETUP, mono, new LayoutCache(), () => fmt('(10)', 30));
    placed.update([{ id: 'a', start: 0, text: '가나다' }]);
    expect(placed.para(0).lines[0]!.x).toBe(50 + 40 + 20);
  });

  it('keys the cache on the marker text (numbers change without text changes)', () => {
    const cache = new LayoutCache();
    const a = cache.get('가나', 1000, mono, null, fmt('1.', 30));
    const b = cache.get('가나', 1000, mono, null, fmt('2.', 30));
    expect(a).not.toBe(b);
    expect(b.marker!.text).toBe('2.');
  });
});

describe('inline objects (11 §4.1)', () => {
  const O = '\uFFFC';
  const withObjs = (objs: Array<[number, number, number]>) => ({ fmt: null, mark: 0, style, objs: new Map(objs.map(([k, w, h]) => [k, { w, h }])) });

  it('gives an object its width as advance and breaks lines on both sides of it', () => {
    // 폭 100: "가나" 20 + 개체 70 = 90, 다음 "다라" 20이 넘친다 → 개체 뒤에서 줄바꿈
    const pl = layoutParagraph(`가나${O}다라`, 100, mono, null, withObjs([[2, 70, 40]]));
    expect(pl.xs[3]).toBe(90);
    expect(pl.lines.map((l) => [l.start, l.end])).toEqual([[0, 3], [3, 5]]);
    // 개체가 들어가지 않으면 개체 앞에서 줄바꿈 (공백이 없어도)
    const pl2 = layoutParagraph(`가나다${O}`, 100, mono, null, withObjs([[3, 80, 40]]));
    expect(pl2.lines.map((l) => [l.start, l.end])).toEqual([[0, 3], [3, 4]]);
  });

  it('shrinks an object wider than the line to the line width, keeping its ratio', () => {
    const pl = layoutParagraph(`가${O}`, 100, mono, null, withObjs([[1, 400, 200]]));
    expect(pl.objs!.get(1)).toEqual({ w: 100, h: 50 });
  });

  it('raises the line for an object taller than the text ascent, and puts it on the baseline', () => {
    // fontSize 12, ascent 0.8 → 글자 ascent 9.6. 개체 높이 40 → 줄이 round(40 − 9.6) = 30 늘어난다
    const setup: PageSetup = { ...SETUP, ascent: 0.8, descent: 0.2 };
    const pl = new PagedLayout(setup, mono, new LayoutCache(), (info) => (info.id === 'o' ? withObjs([[1, 30, 40]]) : null));
    pl.update([
      { id: 'o', start: 0, text: `가${O}나` },
      { id: 'p', start: 4, text: '다' },
    ]);
    const ln = pl.para(0).lines[0]!;
    expect(ln.height).toBe(20 + 30);
    expect(ln.baseline - ln.y).toBeCloseTo(baselineOffset(setup, 20, 1) + 30, 9);
    expect(pl.para(1).lines[0]!.y - ln.y).toBe(50 + 5);
  });

  it('keys the cache on object sizes', () => {
    const cache = new LayoutCache();
    const a = cache.get(`가${O}`, 1000, mono, null, withObjs([[1, 30, 40]]));
    const b = cache.get(`가${O}`, 1000, mono, null, withObjs([[1, 60, 40]]));
    expect(a).not.toBe(b);
    expect(b.xs[2]).toBe(70);
  });
});
