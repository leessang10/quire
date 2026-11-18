/**
 * 쪽 나눔 제어 (12 §4): 앞에서 쪽 나눔, 문단 나누지 않음, 다음 문단과 함께, 과부·고아 줄. 증분 결과 = 처음부터 조립한 결과.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '@quire/model';
import { LayoutCache, PLAIN_STYLE, PagedLayout, type FormatSource, type Measurer, type PageSetup, type ParaBox } from './index';

/** 모든 grapheme 폭 10 → 본문 폭 160 = 16글자, 줄 높이 20, 쪽 본문 높이 200 = 10줄 */
const mono: Measurer = { width: () => 10 };
const setup = (widowControl = true): PageSetup => ({ width: 200, height: 240, margin: 20, gap: 10, lineHeight: 20, paraSpacing: 0, widowControl });

/** 문단 첫 글자로 쪽 나눔 제어: ! 앞에서 쪽 나눔, # 다음 문단과 함께, = 나누지 않음 */
const format: FormatSource = (info) => {
  const c = info.text[0];
  const keep = c === '!' ? { breakBefore: true as const } : c === '#' ? { next: true as const } : c === '=' ? { together: true as const } : null;
  if (!keep) return null;
  const box: ParaBox = { align: 'left', left: 0, right: 0, first: 0, before: 0, after: 0, line: null, keep };
  return { fmt: null, mark: 0, style: () => PLAIN_STYLE, box };
};

/** 줄 n개짜리 문단 (16글자 = 한 줄) */
const lines = (n: number, head = '가') => head + '나'.repeat(16 * n - 1);

function build(paras: string[], widow = true) {
  const doc = Doc.fromText(paras.join('\n'));
  const layout = new PagedLayout(setup(widow), mono, new LayoutCache(), format);
  layout.update(doc.paragraphs());
  doc.takeParagraphChanges();
  layout.finish();
  return { doc, layout };
}
/** 문단마다 줄별 쪽 */
const pages = (layout: PagedLayout) => layout.model.map((_, i) => layout.para(i).lines.map((l) => l.page));

describe('page break control (12 §4)', () => {
  it('starts a page-break-before paragraph at the top of the next page (not when already at the top)', () => {
    const { layout } = build([lines(2), lines(1, '!'), lines(1, '!')]);
    // 셋째 문단도 앞에서 쪽 나눔이지만 둘째 문단 뒤라 다음 쪽 → 둘째, 셋째가 각자 새 쪽
    expect(pages(layout)).toEqual([[0, 0], [1], [2]]);
    expect(layout.para(1).lines[0]!.y).toBe(10 + 240 + 10 + 20);
    const top = build([lines(1, '!')]).layout;
    expect(pages(top)).toEqual([[0]]);
  });

  it('moves a keep-together paragraph to the next page when it does not fit, and ignores it when larger than a page', () => {
    const { layout } = build([lines(7), lines(4, '=')]);
    expect(pages(layout)).toEqual([[0, 0, 0, 0, 0, 0, 0], [1, 1, 1, 1]]);
    const big = build([lines(7), lines(12, '=')], false).layout;
    expect(pages(big)[1]!.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('keeps a heading with the first two lines of the next paragraph, and follows a chain of keep-with-next', () => {
    // 8줄 + 제목 1줄 = 9줄, 다음 문단 첫 두 줄이 들어갈 자리가 없다 → 제목이 다음 쪽
    const { layout } = build([lines(8), lines(1, '#'), lines(5)]);
    expect(pages(layout)).toEqual([[0, 0, 0, 0, 0, 0, 0, 0], [1], [1, 1, 1, 1, 1]]);
    // 사슬: 제목 둘이 함께 다음 쪽으로
    const chain = build([lines(7), lines(1, '#'), lines(1, '#'), lines(5)]).layout;
    expect(pages(chain)).toEqual([[0, 0, 0, 0, 0, 0, 0], [1], [1], [1, 1, 1, 1, 1]]);
    // 두 줄이 들어가면 그대로
    const fits = build([lines(7), lines(1, '#'), lines(5)]).layout;
    expect(pages(fits)[1]).toEqual([0]);
    // 다음 문단이 앞에서 쪽 나눔이면 사슬이 끊긴다
    const cut = build([lines(8), lines(1, '#'), lines(5, '!')]).layout;
    expect(pages(cut)[1]).toEqual([0]);
  });

  it('avoids orphans and widows when splitting a paragraph', () => {
    // 고아: 9줄 뒤 4줄 문단 → 첫 줄만 남는다 → 문단 전체가 다음 쪽
    expect(pages(build([lines(9), lines(4)]).layout)[1]).toEqual([1, 1, 1, 1]);
    expect(pages(build([lines(9), lines(4)], false).layout)[1]).toEqual([0, 1, 1, 1]);
    // 과부: 5줄 뒤 6줄 문단 → 마지막 한 줄만 넘어간다 → 한 줄 더 넘긴다 (앞에 4줄)
    expect(pages(build([lines(5), lines(6)]).layout)[1]).toEqual([0, 0, 0, 0, 1, 1]);
    // 세 줄 문단이 두 줄 + 한 줄로 나뉘면 문단 전체를 다음 쪽 (둘 다 지킬 수 없다)
    expect(pages(build([lines(8), lines(3)]).layout)[1]).toEqual([1, 1, 1]);
    // 쪽보다 긴 문단: 마지막 쪽에 한 줄만 가지 않게
    expect(pages(build([lines(21)]).layout)[0]!.slice(-3)).toEqual([1, 2, 2]);
  });

  it.each([3, 11, 29])('matches a fresh layout after random edits with keep rules (seed %i)', (seed0) => {
    let seed = seed0;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const heads = ['가', '가', '가', '#', '!', '='];
    const doc = Doc.fromText(Array.from({ length: 40 }, () => lines(1 + rnd(6), heads[rnd(heads.length)])).join('\n'));
    const layout = new PagedLayout(setup(), mono, new LayoutCache(), format);
    layout.update(doc.paragraphs());
    doc.takeParagraphChanges();
    const dump = (L: PagedLayout) => {
      L.finish();
      return L.model.map((_, i) => L.para(i).lines.map((l) => [l.page, l.y]));
    };
    for (let step = 0; step < 120; step++) {
      const ps = doc.paragraphs();
      const p = ps[rnd(ps.length)]!;
      const op = rnd(4);
      if (op === 0) doc.insertText(p.start + 1, '다'.repeat(1 + rnd(40)));
      else if (op === 1 && p.end - p.start > 2) doc.deleteRange(p.start + 1, p.start + 1 + rnd(p.end - p.start - 1));
      else if (op === 2) doc.insertText(p.start, heads[rnd(heads.length)]!);
      else if (p.end > p.start) doc.deleteRange(p.start, p.start + 1);
      layout.update(doc.paragraphs(), null, rnd(2) ? Infinity : rnd(3000), doc.takeParagraphChanges());
      if (step % 3 === 2) {
        const fresh = new PagedLayout(setup(), mono, new LayoutCache(), format);
        fresh.update(doc.paragraphs());
        expect(dump(layout)).toEqual(dump(fresh));
      }
    }
  });
});
