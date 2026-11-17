/**
 * HarfBuzz 셰이퍼 시험 (Node). 글꼴: Windows 맑은 고딕·Calibri (없으면 건너뜀, 저장소에 넣지 않음).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as hb from 'harfbuzzjs';
import { layoutParagraph, type Measurer } from '@quire/layout';
import { FALLBACK_FONT, HbShaper, loadShapingFont } from './shaper';

const KO = 'C:/Windows/Fonts/malgun.ttf';
const LATIN = 'C:/Windows/Fonts/calibri.ttf';
const have = existsSync(KO) && existsSync(LATIN);

const ko = have ? loadShapingFont(readFileSync(KO), 'Malgun Gothic') : null!;
const latin = have ? loadShapingFont(readFileSync(LATIN), 'Calibri') : null!;

/** HarfBuzz로 런 하나를 통째로 셰이핑한 폭 (px) */
function runWidth(f: typeof ko, text: string, size: number): number {
  const b = new hb.Buffer();
  b.addText(text);
  b.guessSegmentProperties();
  hb.shape(f.hb, b);
  return (b.getGlyphPositions().reduce((s, g) => s + g.xAdvance, 0) * size) / f.upem;
}

const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);
const fixedFallback: Measurer = { width: () => 20 };

describe.skipIf(!have)('HbShaper', () => {
  it('gives one advance per code point that adds up to the run width (kerning on)', () => {
    const s = new HbShaper([latin], { size: 16 });
    for (const w of ['AVATAR', 'Wave', 'To.', 'office']) {
      const a = s.advances(w);
      expect(a.length).toBe(Array.from(w).length);
      expect(sum(a)).toBeCloseTo(runWidth(latin, w, 16), 4);
    }
    // 커닝: AV는 글자별 합보다 좁다
    expect(sum(s.advances('AV'))).toBeLessThan(s.width('A') + s.width('V'));
  });

  it('splits a ligature evenly across its graphemes so the caret has a place inside', () => {
    const s = new HbShaper([latin], { size: 16 });
    const a = s.advances('office'); // o ffi ce (ffi는 글리프 하나)
    expect(a[1]).toBeGreaterThan(0);
    expect(a[1]).toBeCloseTo(a[2]!, 5);
    expect(a[2]).toBeCloseTo(a[3]!, 5);
    expect(sum(a)).toBeCloseTo(runWidth(latin, 'office', 16), 4);
  });

  it('shapes mixed Hangul/Latin words as separate script runs', () => {
    const s = new HbShaper([ko], { size: 16 });
    const w = 'AVA는';
    const a = s.advances(w);
    // 라틴 부분은 라틴 런 'AVA'만 셰이핑한 폭과 같다 (한 런으로 하면 스크립트가 한글로 잡혀 커닝이 빠질 수 있음)
    expect(a[0]! + a[1]! + a[2]!).toBeCloseTo(sum(s.advances('AVA')), 4);
    expect(a[3]).toBeCloseTo(sum(s.advances('는')), 4);
  });

  it("applies the legacy 'kern' table of fonts without GPOS kerning, like the browser", () => {
    expect(ko.legacyKern).not.toBeNull(); // 맑은 고딕: GPOS 없음, kern 표만
    expect(latin.legacyKern).toBeNull(); // Calibri: GPOS kern
    const s = new HbShaper([ko], { size: 16 });
    // 브라우저(Chromium) 캔버스가 같은 글꼴 파일로 잰 값 (커닝 켬)
    expect(sum(s.advances('r,'))).toBeCloseTo(7.82, 2);
    expect(sum(s.advances('Enter,'))).toBeCloseTo(39.289, 2);
    expect(sum(s.advances('Enter,'))).toBeLessThan(runWidth(ko, 'Enter,', 16));
  });

  it('keeps Old Hangul syllables (conjoining jamo) as one advance on the first code point', () => {
    const s = new HbShaper([ko], { size: 16 });
    const a = s.advances('ᄒᆞᆫ글');
    expect(a.length).toBe(4);
    expect(a[0]).toBeGreaterThan(0);
    expect(a[1]).toBe(0);
    expect(a[2]).toBe(0);
    expect(sum(a)).toBeCloseTo(runWidth(ko, 'ᄒᆞᆫ글', 16), 4);
  });

  it('falls back to the next font, then to the fallback measurer', () => {
    const s = new HbShaper([ko, latin], { size: 16, fallback: fixedFallback });
    const w = '한글😀';
    const a = s.advances(w);
    const f = s.fontsOf(w)!;
    expect(Array.from(f)).toEqual([0, 0, FALLBACK_FONT]);
    expect(a[2]).toBe(20);
    // 맑은 고딕에 없는 결합 문자 조합은 둘 다 가진 글꼴(Calibri)로 간다
    const v = 'e\u0302\u0301';
    expect(Array.from(s.fontsOf(v) ?? [0, 0, 0])).toEqual(ko.has(0x302) ? [0, 0, 0] : [1, 1, 1]);
    expect(s.fontsOf('한글')).toBeNull();
  });

  it('caches by chunk and measures spaces and tabs', () => {
    const s = new HbShaper([ko], { size: 16 });
    s.advances('대한민국');
    const runs = s.shapedRuns;
    s.advances('대한민국');
    expect(s.shapedRuns).toBe(runs);
    expect(s.cacheHits).toBe(1);
    expect(s.width('\t')).toBeCloseTo(s.width(' ') * 4, 5);
  });

  it('drives the paragraph layout: x positions follow the shaped words', () => {
    const s = new HbShaper([latin], { size: 16 });
    const pl = layoutParagraph('AVATAR office', 10_000, s);
    const word1 = sum(s.advances('AVATAR'));
    expect(pl.xs[6]).toBeCloseTo(word1, 3); // 공백 앞
    expect(pl.xs[7]).toBeCloseTo(word1 + s.width(' '), 3);
    expect(pl.xs[13]).toBeCloseTo(word1 + s.width(' ') + sum(s.advances('office')), 3);
    expect(pl.fonts).toBeNull();
    // 줄바꿈도 셰이핑 폭으로
    const narrow = layoutParagraph('AVATAR office AVATAR office', word1 + 5, s);
    expect(narrow.lines.map((l) => l.start)).toEqual([0, 7, 14, 21]);
  });
});
