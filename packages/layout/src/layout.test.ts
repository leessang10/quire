import { describe, expect, it } from 'vitest';
import { Doc } from '@quire/model';
import {
  LayoutCache,
  PagedLayout,
  cpSlice,
  layoutParagraph,
  type Measurer,
  type PageSetup,
  type ParaInput,
} from './index';

/** 모든 grapheme 폭 10 */
const mono: Measurer = { width: () => 10 };

const lineTexts = (text: string, width: number) => {
  const pl = layoutParagraph(text, width, mono);
  return pl.lines.map((l) => cpSlice(pl, l.start, l.end));
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

  it('treats an emoji ZWJ sequence as one caret stop and maps code points to UTF-16', () => {
    const pl = layoutParagraph('a👩‍💻b', 100, mono);
    const stopIdx = Array.from(pl.stops).flatMap((s, i) => (s ? [i] : []));
    // a(0) 👩‍💻(1..3) b(4) 끝(5)
    expect(stopIdx).toEqual([0, 1, 4, 5]);
    expect(cpSlice(pl, 1, 4)).toBe('👩‍💻');
    expect(cpSlice(pl, 4, 5)).toBe('b');
  });

  it('uses no UTF-16 map for BMP-only text', () => {
    expect(layoutParagraph('가나다', 100, mono).u16).toBeNull();
  });

  it('inserts preedit text into the display', () => {
    const pl = layoutParagraph('가다', 100, mono, { at: 1, text: '나' });
    expect(pl.text).toBe('가나다');
    expect(pl.preedit).toEqual([1, 2]);
  });
});

const setup: PageSetup = { width: 70, height: 60, margin: 10, gap: 5, lineHeight: 10, paraSpacing: 0 };
// 본문 폭 50 (5글자), 본문 높이 40 (4줄)

function inputs(texts: string[]): ParaInput[] {
  let start = 0;
  return texts.map((text, i) => {
    const p = { id: `p${i}`, start, text };
    start += Array.from(text).length + 1;
    return p;
  });
}

function fresh(model: readonly ParaInput[], s: PageSetup = setup, pre: { offset: number; text: string } | null = null) {
  const l = new PagedLayout(s, mono);
  l.update(model, pre);
  return l;
}

/** 비교용: 모든 줄의 위치 */
function snapshot(l: PagedLayout) {
  l.finish();
  return l.paras.map((p) => ({
    id: p!.info.id,
    start: p!.info.start,
    lines: p!.lines.map((ln) => [ln.start, ln.end, ln.page, ln.y]),
  }));
}

describe('PagedLayout', () => {
  it('flows lines onto the next page when the page is full', () => {
    const l = fresh(inputs(['가나다라마바사아자차', '가나다라마바사아자차카타']));
    const lines = l.paras.flatMap((p) => p!.lines);
    expect(lines.map((ln) => ln.page)).toEqual([0, 0, 0, 0, 1]);
    expect(l.pageCount).toBe(2);
    expect(lines[4]!.y).toBe(5 + 65 + 10); // gap + (height+gap) + margin
  });

  it('round-trips caret offset through caretRect and hitTest', () => {
    const l = fresh(inputs(['가나 다라', '마바']));
    for (const off of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = l.caretRect(off);
      expect(l.hitTest(r.x, r.y + 1)).toBe(off);
    }
  });

  it('moves over grapheme clusters and paragraph marks', () => {
    const l = fresh(inputs(['a👩‍💻', 'b'])); // 첫 문단 코드포인트 4개
    expect(l.nextStop(1)).toBe(4);
    expect(l.prevStop(4)).toBe(1);
    expect(l.nextStop(4)).toBe(5); // ¶ 넘어 다음 문단
    expect(l.prevStop(5)).toBe(4);
  });

  it('reflows only the changed paragraph when its height is unchanged', () => {
    const texts = Array.from({ length: 30 }, (_, i) => `${i}번 문단 가나다라마바사`);
    const model = inputs(texts);
    const l = fresh(model);
    const edited = [...model];
    edited[10] = { ...model[10]!, text: model[10]!.text.replace('가', '하') };
    l.update(edited);
    expect(l.counts).toEqual({ reflowed: 1, repositioned: 0, reused: 19 });
    expect(snapshot(l)).toEqual(snapshot(fresh(edited)));
  });

  it('defers repositioning past syncUntilY and finishes in steps', () => {
    const texts = Array.from({ length: 200 }, (_, i) => `${i}번 문단 가나다라마바사`);
    const model = inputs(texts);
    const l = fresh(model);
    const grown = [...model];
    grown[3] = { ...model[3]!, text: model[3]!.text + ' 더 긴 내용을 붙여 줄 수를 늘립니다' };
    // 뒤 문단 start도 바뀌어야 하지만 이 테스트는 위치만 본다
    l.update(grown, null, 200);
    expect(l.complete).toBe(false);
    expect(l.validCount).toBeLessThan(50);
    while (l.step(0.01)) {
      /* 남은 배치 진행 */
    }
    expect(snapshot(l)).toEqual(snapshot(fresh(grown)));
  });

  it('answers queries beyond the valid region by laying out on demand', () => {
    const texts = Array.from({ length: 500 }, (_, i) => `${i}번 문단 가나다라마바사`);
    const model = inputs(texts);
    const l = new PagedLayout(setup, mono);
    l.update(model, null, 0); // 거의 아무것도 배치하지 않음
    expect(l.complete).toBe(false);
    const lastStart = model[499]!.start;
    const expected = fresh(model).caretRect(lastStart);
    expect(l.caretRect(lastStart)).toEqual(expected);
  });
});

// ── 실제 모델과 함께 무작위 편집 ──────────────────────────────

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const ALPHABET = Array.from('가나다라마 abc\n.😀');

describe('PagedLayout randomized against fresh layout', () => {
  for (const seed of [7, 8, 9, 10]) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const randomText = (max: number) => {
        let s = '';
        const n = 1 + Math.floor(r() * max);
        for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(r() * ALPHABET.length)];
        return s;
      };
      const doc = Doc.fromText(randomText(600));
      const cache = new LayoutCache();
      const l = new PagedLayout(setup, mono, cache);
      l.update(doc.paragraphs(), null, 100);
      let pre: { offset: number; text: string } | null = null;

      for (let step = 0; step < 150; step++) {
        const roll = r();
        pre = null;
        if (roll < 0.45) {
          doc.insertText(Math.floor(r() * doc.length), randomText(r() < 0.1 ? 80 : 4));
        } else if (roll < 0.8) {
          const from = Math.floor(r() * doc.length);
          doc.deleteRange(from, from + Math.floor(r() * 15));
        } else {
          pre = { offset: Math.floor(r() * doc.length), text: '한' };
        }
        // 일부만 즉시 배치하고, 가끔 백그라운드 진행·질의를 섞는다
        l.update(doc.paragraphs(), pre, r() * 400);
        if (r() < 0.3) l.step(0.01);
        if (r() < 0.3) l.caretRect(Math.floor(r() * doc.length));
        if (r() < 0.2) {
          expect(snapshot(l)).toEqual(snapshot(fresh(doc.paragraphs(), setup, pre)));
        }
      }
      // 마지막 단계가 조합 중이었을 수 있으므로 같은 preedit으로 비교
      expect(snapshot(l)).toEqual(snapshot(fresh(doc.paragraphs(), setup, pre)));
    });
  }
});
