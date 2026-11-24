/**
 * 굵은 얼굴 (10 §4, 2-3): 저장소 글꼴 Pretendard Regular·Bold로 얼굴별 셰이핑·캐시·지연 불러오기·치수를 확인한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Measurer } from '@quiredoc/layout';
import { FALLBACK_FONT, HbShaper, loadShapingFont, slotOf, type FontSlot } from './shaper';

const root = join(__dirname, '../../..');
const regularBytes = readFileSync(join(root, 'fonts/pretendard/Pretendard-Regular.otf'));
const boldBytes = readFileSync(join(root, 'fonts/pretendard/Pretendard-Bold.otf'));
const regular = loadShapingFont(regularBytes, 'Pretendard');
const bold = loadShapingFont(boldBytes, 'Pretendard Bold');

const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);

describe('bold face', () => {
  it('shapes face 1 with the bold font of the slot, and caches faces apart', () => {
    const slot: FontSlot = { ...slotOf(regular), bold: slotOf(bold) };
    const s = new HbShaper([slot], { size: 16 });
    const r = sum(s.advances('Wave굵게'));
    const b = sum(s.advances('Wave굵게', 1));
    expect(b).toBeGreaterThan(r);
    // 같은 조각을 다시 물으면 캐시 (얼굴별로)
    const runs = s.shapedRuns;
    expect(sum(s.advances('Wave굵게', 1))).toBe(b);
    expect(sum(s.advances('Wave굵게'))).toBe(r);
    expect(s.shapedRuns).toBe(runs);
    expect(s.width(' ', 1)).toBeGreaterThan(0);
  });

  it('falls back to the regular font for face 1 when the slot has no bold face (synthetic bold)', () => {
    const s = new HbShaper([regular], { size: 16 });
    expect(Array.from(s.advances('굵게', 1))).toEqual(Array.from(s.advances('굵게')));
  });

  it('requests an unloaded bold face once, measures with the fallback meanwhile, then uses it', () => {
    const lazyBold: FontSlot = { name: 'Pretendard Bold', covers: (cp) => regular.has(cp), font: null };
    const slot: FontSlot = { ...slotOf(regular), bold: lazyBold };
    const missing: Array<[number, number]> = [];
    const fallback: Measurer = { width: (_g, face = 0) => (face === 1 ? 30 : 20) };
    const s = new HbShaper([slot], { size: 16, fallback, onMissing: (i, face) => missing.push([i, face]) });
    expect(Array.from(s.advances('가나', 1))).toEqual([30, 30]);
    expect(s.fontsOf('가나', 1)).toEqual(Uint8Array.from([FALLBACK_FONT, FALLBACK_FONT]));
    s.advances('다', 1);
    expect(missing).toEqual([[0, 1]]);
    expect(s.waiting).toEqual([256]);
    s.loaded(0, bold, 1);
    expect(s.waiting).toEqual([]);
    expect(sum(s.advances('가나', 1))).toBeCloseTo(sum(new HbShaper([slotOf(bold)], { size: 16 }).advances('가나')), 6);
    expect(s.fontsOf('가나', 1)).toBeNull();
  });

  it('reads ascent, descent, underline and strikeout metrics from the font tables', () => {
    const m = regular.metrics;
    expect(m.ascent).toBeGreaterThan(0.8);
    expect(m.descent).toBeGreaterThan(0.1);
    expect(m.underlinePosition).toBeLessThan(0);
    expect(m.underlineThickness).toBeGreaterThan(0);
    expect(m.strikePosition).toBeGreaterThan(0);
    expect(m.strikeThickness).toBeGreaterThan(0);
  });
});
