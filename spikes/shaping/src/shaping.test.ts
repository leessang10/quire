/**
 * ADR-0002 검증 (Node): HarfBuzz 결과의 결정성, 클러스터와 grapheme 경계, 글자별 측정과 런 셰이핑의 차이, 내부 단위 반올림.
 * 글꼴은 Windows 시스템 글꼴을 읽는다 (저장소에 넣지 않음). 없으면 건너뛴다.
 * 결과 표는 console에 찍고, docs/spikes/phase0-shaping.md에 옮긴다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAMPLES } from './corpus';
import { HbMeasurer, advance, fingerprint, hbVersion, loadFont, shape, toPx, toUnit, type HbFont } from './hb';

const FONTS = { ko: 'C:/Windows/Fonts/malgun.ttf', latin: 'C:/Windows/Fonts/calibri.ttf' };
const have = existsSync(FONTS.ko) && existsSync(FONTS.latin);

const fonts: Record<'ko' | 'latin', HbFont> | null = have
  ? { ko: loadFont(readFileSync(FONTS.ko), 'Malgun Gothic'), latin: loadFont(readFileSync(FONTS.latin), 'Calibri') }
  : null;

const seg = new Intl.Segmenter('ko', { granularity: 'grapheme' });
const graphemes = (t: string) => [...seg.segment(t)].map((s) => s.segment);

describe.skipIf(!have)('HarfBuzz shaping (Node)', () => {
  it('gives the same integer result every time (fingerprint for the browser comparison)', () => {
    const rows = SAMPLES.map((s) => shape(fonts![s.font], s.text));
    const again = SAMPLES.map((s) => shape(fonts![s.font], s.text));
    for (const r of rows) for (const g of r) for (const v of [g.ax, g.dx, g.dy]) expect(Number.isInteger(v)).toBe(true);
    expect(fingerprint(again)).toBe(fingerprint(rows));
    console.log(`harfbuzz ${hbVersion()} · 말뭉치 지문 ${fingerprint(rows)} · upem ko ${fonts!.ko.upem} latin ${fonts!.latin.upem}`);
  });

  it('maps clusters onto grapheme boundaries', () => {
    const lines: string[] = ['| 표본 | grapheme | 글리프 | 클러스터 | 클러스터 안의 grapheme 경계 | 빈 글리프(.notdef) |', '|---|---|---|---|---|---|'];
    for (const s of SAMPLES) {
      const glyphs = shape(fonts![s.font], s.text);
      const starts = new Set(glyphs.map((g) => g.cl));
      // grapheme 경계(UTF-16)
      const bounds: number[] = [];
      let at = 0;
      for (const g of graphemes(s.text)) {
        bounds.push(at);
        at += g.length;
      }
      // 클러스터 시작이 아닌 grapheme 경계 = 합자 안 (캐럿을 글리프 사이에 둘 수 없음)
      const inside = bounds.filter((b) => !starts.has(b)).length;
      // 클러스터 시작이 grapheme 안 = HarfBuzz가 grapheme을 쪼갬 (캐럿 단위와 어긋남)
      const boundSet = new Set(bounds);
      const split = [...starts].filter((c) => !boundSet.has(c)).length;
      const notdef = glyphs.filter((g) => g.g === 0).length;
      lines.push(`| ${s.id} | ${bounds.length} | ${glyphs.length} | ${starts.size} | ${inside} | ${notdef} |`);
      expect(split, `${s.id}: cluster inside a grapheme`).toBe(0);
      if (s.font === 'ko' && s.id !== 'emoji') expect(inside, s.id).toBe(0);
    }
    console.log(lines.join('\n'));
  });

  it('measures how far per-grapheme widths are from shaping the whole run', () => {
    const size = 16;
    const lines: string[] = ['| 표본 | 글자별 합 (px) | 런 셰이핑, 커닝·합자 켬 (px) | 차이 (px) | 차이 (%) |', '|---|---|---|---|---|'];
    for (const s of SAMPLES) {
      const f = fonts![s.font];
      const m = new HbMeasurer(f, size);
      const per = graphemes(s.text).reduce((w, g) => w + m.width(g), 0);
      const run = toPx(f, advance(shape(f, s.text)), size);
      lines.push(`| ${s.id} | ${per.toFixed(2)} | ${run.toFixed(2)} | ${(run - per).toFixed(2)} | ${((100 * (run - per)) / per).toFixed(2)} |`);
      if (s.font === 'ko' && s.id !== 'ko-mixed' && s.id !== 'emoji') expect(Math.abs(run - per)).toBeLessThan(0.01);
    }
    console.log(lines.join('\n'));
  });

  it('turns font units into internal units with integer-only rounding', () => {
    const f = fonts!.ko;
    // 10pt = 10000 단위. 2048 upem에서 2048 → 10000, 1065 → 5200.195… → 5200
    expect(toUnit(f, 2048, 10000)).toBe(10000);
    expect(toUnit(f, 1065, 10000)).toBe(5200);
    expect(toUnit(f, 1024 + 1, 2048)).toBe(1025); // 정확히 나눠짐
    expect(toUnit({ ...f, upem: 2 }, 1, 1)).toBe(1); // 0.5 → 1
    expect(toUnit({ ...f, upem: 2 }, -1, 1)).toBe(-1);
    // 큰 값도 정수 안 (2^53)
    expect(Number.isSafeInteger(4096 * 72_000_000)).toBe(true);
  });
});
