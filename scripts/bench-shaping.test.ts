/**
 * HarfBuzz 셰이핑 비용 (ADR-0002, Node)
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-shaping.test.ts --silent=false
 *
 * - 글꼴 불러오기 (맑은 고딕 13 MB)
 * - 지금 레이아웃(글자별 폭)에 HarfBuzz 측정기를 꽂은 전체 조판 vs 고정 폭 측정기
 * - 문단 통째 셰이핑, 어절 단위 셰이핑 + 캐시 (02 §4의 셰이핑 캐시 키 = 텍스트)
 */
import { existsSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Doc } from '@quire/model';
import { PagedLayout, type Measurer, type PageSetup } from '@quire/layout';
import { HbMeasurer, loadFont, shape } from '../spikes/shaping/src/hb';
import { LOREM } from '../spikes/shaping/src/corpus';

const FONT = 'C:/Windows/Fonts/malgun.ttf';
const setup: PageSetup = { width: 794, height: 1123, margin: 96, gap: 24, lineHeight: 27, paraSpacing: 8 };
const fixed: Measurer = { width: (g) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) };
const NL = String.fromCharCode(10);

function fullLayout(doc: Doc, m: Measurer) {
  const t = performance.now();
  const layout = new PagedLayout(setup, m);
  layout.update(doc.paragraphs(), null, 1800);
  while (layout.step(1000)) {
    /* 끝까지 */
  }
  return { ms: performance.now() - t, pages: layout.pageCount };
}

it.skipIf(!existsSync(FONT))('shaping cost', () => {
  let t = performance.now();
  const bytes = readFileSync(FONT);
  const readMs = performance.now() - t;
  t = performance.now();
  const f = loadFont(bytes, 'Malgun Gothic');
  shape(f, '가'); // 첫 셰이핑 (테이블 지연 적재)
  const loadMs = performance.now() - t;
  const out: string[] = [`글꼴 ${(bytes.length / 1e6).toFixed(1)} MB: 파일 읽기 ${readMs.toFixed(0)} ms, Face·Font + 첫 셰이핑 ${loadMs.toFixed(1)} ms`];

  for (const n of [10_000, 100_000]) {
    const paras = Array.from({ length: n }, (_, i) => `${i + 1}. ${LOREM}`);
    const doc = Doc.fromText(paras.join(NL));
    const chars = paras.reduce((s, p) => s + p.length, 0);
    const base = fullLayout(doc, fixed);
    const m = new HbMeasurer(f, 16);
    const hbLayout = fullLayout(doc, m);
    // 문단 통째 셰이핑
    t = performance.now();
    for (const p of paras) shape(f, p);
    const paraMs = performance.now() - t;
    // 어절 단위 + 캐시
    t = performance.now();
    const cache = new Map<string, number>();
    let hits = 0;
    for (const p of paras)
      for (const w of p.split(' ')) {
        if (cache.has(w)) hits++;
        else cache.set(w, shape(f, w).length);
      }
    const wordMs = performance.now() - t;
    out.push(
      `── ${n.toLocaleString()}문단 (${(chars / 1e6).toFixed(1)}M 글자) ──`,
      `  전체 조판: 고정 폭 ${base.ms.toFixed(0)} ms (${base.pages}쪽) · HarfBuzz 글자별 ${hbLayout.ms.toFixed(0)} ms (${hbLayout.pages}쪽, 셰이핑 ${m.shaped}회)`,
      `  문단 통째 셰이핑 ${paraMs.toFixed(0)} ms (${((paraMs * 1000) / n).toFixed(1)} µs/문단, ${(chars / paraMs / 1000).toFixed(1)}M 글자/s)`,
      `  어절 + 캐시 ${wordMs.toFixed(0)} ms (어절 ${(hits + cache.size).toLocaleString()}개, 서로 다른 어절 ${cache.size.toLocaleString()}개, 적중 ${((100 * hits) / (hits + cache.size)).toFixed(1)}%)`,
    );
  }
  console.log(out.join(NL));
}, 600_000);
