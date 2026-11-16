import { describe, expect, it } from 'vitest';
import {
  LayoutCache,
  caretRect,
  hitTest,
  layoutDocument,
  layoutParagraph,
  nextStop,
  prevStop,
  type Measurer,
  type PageSetup,
} from './index';

/** 모든 grapheme 폭 10 */
const mono: Measurer = { width: () => 10 };

const lineTexts = (text: string, width: number) => {
  const pl = layoutParagraph(text, width, mono);
  return pl.lines.map((l) => pl.cps.slice(l.start, l.end).join(''));
};

describe('layoutParagraph', () => {
  it('breaks Korean text at word (space) boundaries', () => {
    // 폭 50 = 5글자
    expect(lineTexts('가나 다라마 바사', 50)).toEqual(['가나 ', '다라마 ', '바사']);
  });

  it('lets trailing spaces hang past the line width', () => {
    expect(lineTexts('가나다라마 바', 50)).toEqual(['가나다라마 ', '바']);
  });

  it('falls back to character breaking for a word longer than the line', () => {
    expect(lineTexts('가나다라마바사', 30)).toEqual(['가나다', '라마바', '사']);
  });

  it('does not start a line with closing punctuation when char-breaking', () => {
    expect(lineTexts('가나다.라', 30)).toEqual(['가나', '다.라']);
  });

  it('treats an emoji ZWJ sequence as one caret stop', () => {
    const pl = layoutParagraph('a👩‍💻b', 100, mono);
    const stopIdx = pl.stops.flatMap((s, i) => (s ? [i] : []));
    // a(0) 👩‍💻(1..3) b(4) 끝(5)
    expect(stopIdx).toEqual([0, 1, 4, 5]);
  });

  it('inserts preedit text into the display', () => {
    const pl = layoutParagraph('가다', 100, mono, { at: 1, text: '나' });
    expect(pl.cps.join('')).toBe('가나다');
    expect(pl.preedit).toEqual([1, 2]);
  });
});

const setup: PageSetup = { width: 70, height: 60, margin: 10, gap: 5, lineHeight: 10, paraSpacing: 0 };
// 본문 폭 50 (5글자), 본문 높이 40 (4줄)

describe('layoutDocument', () => {
  it('flows lines onto the next page when the page is full', () => {
    const paras = [
      { id: 'a', start: 0, text: '가나다라마바사아자차' }, // 2줄
      { id: 'b', start: 11, text: '가나다라마바사아자차카타' }, // 3줄
    ];
    const layout = layoutDocument(paras, setup, mono, new LayoutCache());
    const lines = layout.paras.flatMap((p) => p.lines);
    expect(lines.map((l) => l.page)).toEqual([0, 0, 0, 0, 1]);
    expect(layout.pageCount).toBe(2);
    expect(lines[4]!.y).toBe(5 + 65 + 10); // gap + (height+gap) + margin
  });

  it('round-trips caret offset through caretRect and hitTest', () => {
    const paras = [
      { id: 'a', start: 0, text: '가나 다라' },
      { id: 'b', start: 6, text: '마바' },
    ];
    const layout = layoutDocument(paras, setup, mono, new LayoutCache());
    for (const off of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = caretRect(layout, off);
      expect(hitTest(layout, r.x, r.y + 1)).toBe(off);
    }
  });

  it('moves over grapheme clusters and paragraph marks', () => {
    const paras = [
      { id: 'a', start: 0, text: 'a👩‍💻' }, // 코드포인트 4개
      { id: 'b', start: 5, text: 'b' },
    ];
    const layout = layoutDocument(paras, setup, mono, new LayoutCache());
    expect(nextStop(layout, 1)).toBe(4);
    expect(prevStop(layout, 4)).toBe(1);
    expect(nextStop(layout, 4)).toBe(5); // ¶ 넘어 다음 문단
    expect(prevStop(layout, 5)).toBe(4);
  });

  it('reuses cached paragraph layouts', () => {
    const cache = new LayoutCache();
    const paras = [{ id: 'a', start: 0, text: '가나다' }];
    layoutDocument(paras, setup, mono, cache);
    layoutDocument(paras, setup, mono, cache);
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(1);
  });

  it('incremental layout matches a fresh layout and reuses untouched paragraphs', () => {
    const texts = Array.from({ length: 30 }, (_, i) => `${i}번 문단 가나다라마바사`);
    const toInput = (ts: string[]) => {
      let start = 0;
      return ts.map((text, i) => {
        const p = { id: `p${i}`, start, text };
        start += Array.from(text).length + 1;
        return p;
      });
    };
    const strip = (l: ReturnType<typeof layoutDocument>) =>
      l.paras.map((p) => ({ id: p.id, start: p.start, lines: p.lines }));

    const cache = new LayoutCache();
    const before = layoutDocument(toInput(texts), setup, mono, cache);

    // 같은 높이로 바뀌는 편집: 뒤 문단은 그대로 재사용
    const edited = [...texts];
    edited[10] = edited[10]!.replace('가', '하');
    const inc = layoutDocument(toInput(edited), setup, mono, cache, null, before);
    expect(strip(inc)).toEqual(strip(layoutDocument(toInput(edited), setup, mono, new LayoutCache())));
    expect(inc.counts).toEqual({ reflowed: 1, repositioned: 0, reused: 29 });

    // 높이가 바뀌는 편집: 뒤 문단은 줄 나눔을 재사용하고 위치만 다시 놓음
    const grown = [...edited];
    grown[3] = grown[3]! + ' 더 긴 내용을 붙여서 줄 수를 늘립니다';
    const inc2 = layoutDocument(toInput(grown), setup, mono, cache, null, inc);
    expect(strip(inc2)).toEqual(strip(layoutDocument(toInput(grown), setup, mono, new LayoutCache())));
    expect(inc2.counts.reflowed).toBe(1);
    expect(inc2.counts.reused).toBe(3);
    expect(inc2.counts.repositioned).toBe(26);
  });
});
