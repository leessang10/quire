/**
 * 조각난 엔진 글꼴 시험 (02 §4 부분 로드). 저장소의 OFL 글꼴(fonts/)을 scripts/build-fonts.mjs로 잘라 쓴다.
 * - 조각으로 셰이핑한 결과 = 원본 글꼴로 셰이핑한 결과 (레이아웃 기능 보존)
 * - 불러오지 않은 조각의 글자는 대체 측정기로 재고 불러오기를 요청, 불러오면 원본과 같다
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Measurer } from '@quiredoc/layout';
import { HbShaper, loadShapingFont, FALLBACK_FONT } from './shaper';
import { decodeCover, slotsFromManifest, type FontManifest } from './manifest';

const root = join(__dirname, '../../..');
const out = mkdtempSync(join(tmpdir(), 'quire-fonts-'));
execFileSync(process.execPath, [join(root, 'scripts/build-fonts.mjs'), out], { stdio: 'pipe' });
afterAll(() => rmSync(out, { recursive: true, force: true }));

const manifest = (id: string) => JSON.parse(readFileSync(join(out, id, 'manifest.json'), 'utf8')) as FontManifest;
const chunkBytes = (id: string, file: string) => readFileSync(join(out, id, file));
const full = {
  pretendard: loadShapingFont(readFileSync(join(root, 'fonts/pretendard/Pretendard-Regular.otf')), 'Pretendard'),
  noto: loadShapingFont(readFileSync(join(root, 'fonts/noto-sans-kr/NotoSansKR-Regular.otf')), 'Noto Sans KR'),
};
const fallback: Measurer = { width: () => 10 };
const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);

/** 매니페스트 둘(Pretendard, Noto)로 만든 셰이퍼 */
function lazyShaper(missing: number[]) {
  const pm = manifest('pretendard');
  const nm = manifest('noto-sans-kr');
  const slots = [...slotsFromManifest(pm, `file:///${out}/pretendard/`), ...slotsFromManifest(nm, `file:///${out}/noto-sans-kr/`)];
  const files = [...pm.chunks.map((c) => ['pretendard', c.file] as const), ...nm.chunks.map((c) => ['noto-sans-kr', c.file] as const)];
  const shaper = new HbShaper(slots, { size: 16, fallback, onMissing: (i) => missing.push(i) });
  const load = (i: number) => {
    const [id, file] = files[i]!;
    shaper.loaded(i, loadShapingFont(chunkBytes(id, file), slots[i]!.name));
  };
  return { shaper, slots, load };
}

describe('font chunks', () => {
  it('cover every code point of the source fonts exactly once per font', () => {
    for (const [id, f] of [
      ['pretendard', full.pretendard],
      ['noto-sans-kr', full.noto],
    ] as const) {
      const m = manifest(id);
      let n = 0;
      for (const c of m.chunks) for (const [a, b] of decodeCover(c.cover)) n += b - a + 1;
      if (id === 'pretendard') expect(n).toBe(14_336);
      else {
        // 대체 글꼴 조각에는 Pretendard에 없는 글자만, 모두 Noto에 있는 글자
        expect(n).toBe(10_740);
        for (const c of m.chunks)
          for (const [a, b] of decodeCover(c.cover))
            for (let cp = a; cp <= b; cp++) {
              if (full.pretendard.has(cp) || !f.has(cp)) throw new Error(`${c.name}: U+${cp.toString(16)}`);
            }
      }
    }
  });

  it('shape like the full font (kerning, ligatures, Hangul, Hanja, Old Hangul)', () => {
    const missing: number[] = [];
    const { shaper, slots, load } = lazyShaper(missing);
    const solo = (f: typeof full.pretendard) => new HbShaper([f], { size: 16 });
    const fullP = solo(full.pretendard);
    const fullN = solo(full.noto);
    for (let i = 0; i < slots.length; i++) load(i);
    for (const w of ['한글', '입력합니다.', 'AVATAR', 'office', 'Wave,', '(괄호)', '₩1,234']) {
      expect(sum(shaper.advances(w)), w).toBeCloseTo(sum(fullP.advances(w)), 4);
    }
    // 한자·옛한글은 Pretendard에 없어 Noto 조각으로
    for (const w of ['大韓民國', '憲法', 'ᄒᆞᆫ글']) {
      expect(sum(shaper.advances(w)), w).toBeCloseTo(sum(fullN.advances(w.replace('글', ''))) + (w.endsWith('글') ? sum(fullP.advances('글')) : 0), 3);
    }
    expect(missing.length).toBe(0); // 다 불러온 뒤에는 요청이 없다
  });

  it('measures with the fallback until a chunk is loaded, without caching, and asks for it once', () => {
    const missing: number[] = [];
    const { shaper, slots, load } = lazyShaper(missing);
    const a1 = shaper.advances('韓國');
    expect(Array.from(shaper.fontsOf('韓國')!)).toEqual([FALLBACK_FONT, FALLBACK_FONT]);
    expect(sum(a1)).toBe(20);
    shaper.advances('韓國');
    shaper.advances('國');
    const hanja = slots.findIndex((s) => s.covers(0x97d3));
    expect(slots[hanja]!.name).toMatch(/Noto Sans KR hanja/);
    expect(missing).toEqual([hanja, ...missing.slice(1)]);
    expect(new Set(missing).size).toBe(missing.length); // 자리마다 한 번
    for (const i of missing) load(i);
    const fullN = new HbShaper([full.noto], { size: 16 });
    expect(sum(shaper.advances('韓國'))).toBeCloseTo(sum(fullN.advances('韓國')), 4);
    expect(shaper.fontsOf('韓國')![0]).toBe(hanja);
  });

  it('keeps the base chunk small enough for the first paint', () => {
    const base = manifest('pretendard').chunks.find((c) => c.name === 'base')!;
    expect(base.bytes).toBeLessThan(600_000);
    const all = [...manifest('pretendard').chunks, ...manifest('noto-sans-kr').chunks];
    for (const c of all) expect(c.bytes, c.name).toBeLessThan(600_000);
  });
});
