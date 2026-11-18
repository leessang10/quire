/**
 * 서식 있는 문단 레이아웃 (10 §4, 2-3): 얼굴·크기 배율, 서식 경계에서 조각 나누기, 줄마다 높이, 기준선
 */
import { describe, expect, it } from 'vitest';
import {
  LayoutCache,
  PLAIN_STYLE,
  PagedLayout,
  charFormats,
  baselineOffset,
  layoutParagraph,
  type Measurer,
  type PageSetup,
  type ParaFormat,
  type ParaInput,
  type RunStyle,
} from './index';

/** 보통 10, 굵게 12 */
const mono: Measurer = { width: (_g, face = 0) => (face === 1 ? 12 : 10) };

/** 조각 셰이퍼 흉내: 조각마다 호출을 기록, 진행폭 보통 10·굵게 12 */
function chunkMeasurer(): Measurer & { calls: Array<[string, number]> } {
  const calls: Array<[string, number]> = [];
  return {
    calls,
    width: (_g, face = 0) => (face === 1 ? 12 : 10),
    advances(chunk, face = 0) {
      calls.push([chunk, face]);
      return new Float32Array(Array.from(chunk).length).fill(face === 1 ? 12 : 10);
    },
  };
}

const STYLES: Record<number, RunStyle> = {
  0: PLAIN_STYLE,
  1: { face: 1, scale: 1, line: 1 }, // 굵게
  2: { face: 0, scale: 2, line: 2 }, // 두 배 크기
  3: { face: 0, scale: 0.65, line: 1 }, // 위 첨자 (바탕 크기 1)
};
const style = (id: number) => STYLES[id]!;
const fmtOf = (ids: number[]): ParaFormat => ({ fmt: Uint16Array.from(ids), mark: 0, style });

describe('formatted paragraph layout', () => {
  it('measures each character with its face and size scale', () => {
    // 가(보통) 나(굵게) 다(2배) 라(첨자)
    const pl = layoutParagraph('가나다라', 1000, mono, null, fmtOf([0, 1, 2, 3]));
    expect(Array.from(pl.xs)).toEqual([0, 10, 22, 42, 48.5]);
    expect(pl.fmt).toEqual(Uint16Array.from([0, 1, 2, 3]));
  });

  it('is the same as the plain path when no format is given', () => {
    const a = layoutParagraph('가나 다라', 1000, mono);
    const b = layoutParagraph('가나 다라', 1000, mono, null, { fmt: null, mark: 0, style });
    expect(b.xs).toEqual(a.xs);
    expect(b.lines).toEqual(a.lines);
    expect(b.fmt).toBeNull();
  });

  it('splits shaping chunks where the format id changes, and shapes bold with face 1', () => {
    const m = chunkMeasurer();
    const pl = layoutParagraph('가나다 라마', 1000, m, null, fmtOf([0, 1, 1, 0, 0, 0]));
    expect(m.calls).toEqual([
      ['가', 0],
      ['나다', 1],
      ['라마', 0],
    ]);
    expect(pl.xs[3]).toBe(34); // 10 + 12 + 12
  });

  it('scales shaped advances by the size scale', () => {
    const m = chunkMeasurer();
    const pl = layoutParagraph('가나', 1000, m, null, fmtOf([2, 2]));
    expect(Array.from(pl.xs)).toEqual([0, 20, 40]);
    expect(m.calls).toEqual([['가나', 0]]); // 크기는 셰이핑하지 않고 곱한다
  });

  it('gives each line the largest line scale of its characters; superscripts use the base size', () => {
    // 폭 50: "가나 " / "다라 " / "마바" — 둘째 줄에만 2배 글자, 셋째 줄에는 첨자
    const pl = layoutParagraph('가나 다라 마바', 50, mono, null, fmtOf([0, 0, 0, 2, 0, 0, 3, 0]));
    expect(pl.lines.map((l) => l.scale)).toEqual([1, 2, 1]);
  });

  it('uses the paragraph mark for an empty line and counts it on the last line', () => {
    const empty = layoutParagraph('', 100, mono, null, { fmt: null, mark: 2, style });
    expect(empty.lines).toEqual([{ start: 0, end: 0, scale: 2 }]);
    const pl = layoutParagraph('가나 다라', 30, mono, null, { fmt: null, mark: 2, style });
    expect(pl.lines.map((l) => l.scale)).toEqual([1, 2]);
  });

  it('shows the preedit with the previous character format, or the pending format', () => {
    const pl = layoutParagraph('가나', 1000, mono, { at: 1, text: '다' }, fmtOf([1, 0]));
    expect(Array.from(pl.fmt!)).toEqual([1, 1, 0]);
    const pend = layoutParagraph('가나', 1000, mono, { at: 2, text: '다', fmt: 2 }, null);
    expect(Array.from(pend.fmt!)).toEqual([0, 0, 2]);
  });
});

const SETUP: PageSetup = {
  width: 300,
  height: 400,
  margin: 50,
  gap: 10,
  lineHeight: 20,
  paraSpacing: 5,
  fontSize: 12,
  ascent: 0.9,
  descent: 0.3,
};

describe('paged layout with formats', () => {
  it('stacks lines with their own heights and puts every run of a line on one baseline', () => {
    const paras: ParaInput[] = [
      { id: 'a', start: 0, text: '가나 다라 마바', fmt: Uint16Array.from([0, 0, 0, 2, 0, 0, 0, 0]) },
      { id: 'b', start: 9, text: '사아' },
    ];
    const pl = new PagedLayout(SETUP, mono, new LayoutCache(), charFormats(style));
    pl.update(paras);
    pl.finish();
    const lines = pl.para(0).lines;
    // 폭 200 = 20글자 → 한 줄, 2배 글자가 있어 40
    expect(lines.map((l) => l.height)).toEqual([40]);
    expect(lines[0]!.baseline - lines[0]!.y).toBeCloseTo(baselineOffset(SETUP, 40, 2), 9);
    // 다음 문단은 40 + 문단 간격 아래
    expect(pl.para(1).lines[0]!.y - lines[0]!.y).toBe(45);
    expect(pl.para(1).lines[0]!.height).toBe(20);
  });

  it('ignores formats when no style function is given (plain engine)', () => {
    const paras: ParaInput[] = [{ id: 'a', start: 0, text: '가나', fmt: Uint16Array.from([2, 2]) }];
    const pl = new PagedLayout(SETUP, mono);
    pl.update(paras);
    expect(pl.para(0).lines[0]!.height).toBe(20);
    expect(pl.para(0).layout.xs[2]).toBe(20);
  });

  it('does not share a cache entry between the same text with different formats', () => {
    const cache = new LayoutCache();
    const a = cache.get('가나', 1000, mono, null, fmtOf([0, 0]));
    const b = cache.get('가나', 1000, mono, null, fmtOf([1, 1]));
    const c = cache.get('가나', 1000, mono, null, fmtOf([1, 1]));
    expect(a).not.toBe(b);
    expect(c).toBe(b);
    expect(b.xs[2]).toBe(24);
  });

  it('reflows only the formatted paragraph when its format changes', () => {
    const fmt0 = Uint16Array.from([0, 0]);
    const paras: ParaInput[] = [
      { id: 'a', start: 0, text: '가나', fmt: fmt0 },
      { id: 'b', start: 3, text: '다라' },
      { id: 'c', start: 6, text: '마바' },
    ];
    const pl = new PagedLayout(SETUP, mono, new LayoutCache(), charFormats(style));
    pl.update(paras);
    pl.finish();
    const next = [{ ...paras[0]!, fmt: Uint16Array.from([2, 2]) }, paras[1]!, paras[2]!];
    pl.update(next);
    pl.finish();
    expect(pl.counts.reflowed).toBe(1);
    expect(pl.para(0).lines[0]!.height).toBe(40);
    expect(pl.para(2).lines[0]!.y - pl.para(1).lines[0]!.y).toBe(25);
  });
});
