/**
 * ADR-0002 검증 (브라우저). 같은 글꼴 파일을 HarfBuzz와 캔버스(FontFace)에 함께 넣고 비교한다.
 *
 * B1 지문: 브라우저의 HarfBuzz 결과 = Node의 결과 (같은 WASM, 같은 글꼴 → 같은 정수)
 * B2 글자 폭: 캔버스 measureText(커닝 끔) vs HarfBuzz 글자별
 * B3 런 폭: 캔버스로 문자열 통째 측정 vs 글자별 합 vs HarfBuzz 런 (커닝·합자): 줄 단위 fillText가 글자별 위치와 맞는가 (04 O-12)
 * B4 줄바꿈: 같은 문서를 캔버스 측정기와 HarfBuzz 측정기로 조판 → 문단마다 줄 나눔이 같은가, 시간
 * B5 셰이핑 속도 (WASM, 브라우저)
 */
import { PagedLayout, layoutParagraph, type Measurer, type PageSetup } from '@quiredoc/layout';
import { Doc } from '@quiredoc/model';
import { HbMeasurer, advance, fingerprint, hbVersion, loadFont, shape, toPx, type HbFont } from '../../../spikes/shaping/src/hb';
import { LOREM, SAMPLES } from '../../../spikes/shaping/src/corpus';

/** Node 시험(shaping.test.ts)이 찍은 지문 */
const NODE_FINGERPRINT = '8845f937';
const SIZE = 16;
const setup: PageSetup = { width: 794, height: 1123, margin: 96, gap: 24, lineHeight: 27, paraSpacing: 8 };

const out = document.getElementById('out')!;
const status = document.getElementById('status')!;
const results: Record<string, unknown> = {};
Object.assign(window, { results });

function table(title: string, head: string[], rows: Array<Array<string | number>>, note?: string): void {
  const h = document.createElement('h2');
  h.textContent = title;
  const t = document.createElement('table');
  t.className = 'sh-table';
  t.innerHTML = `<thead><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr></thead>`;
  const tb = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const c of r) {
      const td = document.createElement('td');
      td.textContent = String(c);
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  out.append(h, t);
  if (note) {
    const p = document.createElement('p');
    p.className = 'ck-muted';
    p.textContent = note;
    out.append(p);
  }
}

class CanvasMeasurer implements Measurer {
  private cache = new Map<string, number>();
  constructor(private readonly ctx: CanvasRenderingContext2D) {}
  width(g: string): number {
    let w = this.cache.get(g);
    if (w === undefined) {
      w = this.ctx.measureText(g === '\t' ? '    ' : g).width;
      this.cache.set(g, w);
    }
    return w;
  }
}

const seg = new Intl.Segmenter('ko', { granularity: 'grapheme' });
const graphemes = (t: string) => [...seg.segment(t)].map((s) => s.segment);

async function main(): Promise<void> {
  const [ko, latin] = await Promise.all(
    ['malgun.ttf', 'calibri.ttf'].map(async (f) => {
      const r = await fetch(`/spike-fonts/${f}`);
      if (!r.ok) throw new Error(`/spike-fonts/${f} 없음: node spikes/shaping/prepare-fonts.mjs`);
      return new Uint8Array(await r.arrayBuffer());
    }),
  );
  const hbFonts: Record<'ko' | 'latin', HbFont> = { ko: loadFont(ko!, 'Malgun Gothic'), latin: loadFont(latin!, 'Calibri') };
  const faces = { ko: new FontFace('QuireKo', ko!.slice().buffer), latin: new FontFace('QuireLatin', latin!.slice().buffer) };
  for (const f of Object.values(faces)) document.fonts.add(await f.load());
  const ctxOf = (font: 'ko' | 'latin', kerning: CanvasFontKerning) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${SIZE}px ${font === 'ko' ? 'QuireKo' : 'QuireLatin'}`;
    ctx.fontKerning = kerning;
    return ctx;
  };

  // B1
  const fp = fingerprint(SAMPLES.map((s) => shape(hbFonts[s.font], s.text)));
  results.fingerprint = { browser: fp, node: NODE_FINGERPRINT, same: fp === NODE_FINGERPRINT };
  table('B1 결정성: HarfBuzz 결과 지문', ['HarfBuzz', 'Node', '브라우저', '같음'], [[hbVersion(), NODE_FINGERPRINT, fp, fp === NODE_FINGERPRINT ? '예' : '아니오']]);

  // B2, B3
  const b2: Array<Array<string | number>> = [];
  const b3: Array<Array<string | number>> = [];
  for (const s of SAMPLES) {
    const f = hbFonts[s.font];
    const none = ctxOf(s.font, 'none');
    const normal = ctxOf(s.font, 'normal');
    const hbm = new HbMeasurer(f, SIZE);
    let maxDiff = 0;
    let differ = 0;
    let sumCanvas = 0;
    let sumHb = 0;
    for (const g of graphemes(s.text)) {
      const c = none.measureText(g).width;
      const h = hbm.width(g);
      sumCanvas += c;
      sumHb += h;
      const d = Math.abs(c - h);
      maxDiff = Math.max(maxDiff, d);
      if (d > 0.01) differ++;
    }
    b2.push([s.id, graphemes(s.text).length, differ, maxDiff.toFixed(3)]);
    const runNone = none.measureText(s.text).width;
    const runNormal = normal.measureText(s.text).width;
    const hbRun = toPx(f, advance(shape(f, s.text)), SIZE);
    b3.push([s.id, sumHb.toFixed(2), sumCanvas.toFixed(2), runNone.toFixed(2), runNormal.toFixed(2), hbRun.toFixed(2), (runNone - sumCanvas).toFixed(2), (runNormal - hbRun).toFixed(2)]);
  }
  results.b2 = b2;
  results.b3 = b3;
  table('B2 글자 폭: 캔버스 vs HarfBuzz (글자별, 커닝 끔)', ['표본', 'grapheme', '0.01px 넘게 다른 글자', '최대 차이 (px)'], b2);
  table(
    'B3 런 폭 (px)',
    ['표본', 'HB 글자별 합', '캔버스 글자별 합', '캔버스 통째(커닝 끔)', '캔버스 통째(커닝 켬)', 'HB 런(커닝·합자)', '통째−글자별 (캔버스, 끔)', '캔버스 켬 − HB 런'],
    b3,
    '"통째−글자별"이 0이 아니면, 지금처럼 줄을 fillText 한 번으로 그릴 때 글자별 측정 위치(캐럿·선택)와 그려진 글자가 어긋난다.',
  );

  // B4 줄바꿈 비교
  const paras = Array.from({ length: 10_000 }, (_, i) => `${i + 1}. ${LOREM}`);
  const mixed = [...SAMPLES.map((s) => s.text.repeat(4)), ...paras.slice(0, 200)];
  const width = setup.width - setup.margin * 2;
  const canvasM = new CanvasMeasurer(ctxOf('ko', 'none'));
  const hbM = new HbMeasurer(hbFonts.ko, SIZE);
  let sameParas = 0;
  let diffParas = 0;
  const examples: string[] = [];
  for (const p of mixed) {
    const a = layoutParagraph(p, width, canvasM).lines.map((l) => l.start).join(',');
    const b = layoutParagraph(p, width, hbM).lines.map((l) => l.start).join(',');
    if (a === b) sameParas++;
    else {
      diffParas++;
      if (examples.length < 3) examples.push(p.slice(0, 20));
    }
  }
  const doc = Doc.fromText(paras.join('\n'));
  const timeLayout = (m: Measurer) => {
    const t = performance.now();
    const l = new PagedLayout(setup, m);
    l.update(doc.paragraphs(), null, 1800);
    while (l.step(1000)) {
      /* 끝까지 */
    }
    return { ms: performance.now() - t, pages: l.pageCount };
  };
  const lc = timeLayout(new CanvasMeasurer(ctxOf('ko', 'none')));
  const lh = timeLayout(new HbMeasurer(hbFonts.ko, SIZE));
  results.b4 = { sameParas, diffParas, examples, canvas: lc, hb: lh };
  table(
    'B4 줄바꿈 (맑은 고딕 16px, 본문 폭 602px)',
    ['', '캔버스 측정기', 'HarfBuzz 측정기'],
    [
      ['같은 줄 나눔 문단 / 다른 문단', `${sameParas} / ${diffParas}`, examples.join(' · ') || '-'],
      ['1만 문단 전체 조판', `${lc.ms.toFixed(0)} ms, ${lc.pages}쪽`, `${lh.ms.toFixed(0)} ms, ${lh.pages}쪽`],
    ],
  );

  // B5 셰이핑 속도
  let t = performance.now();
  for (const p of paras) shape(hbFonts.ko, p);
  const paraMs = performance.now() - t;
  t = performance.now();
  const cache = new Map<string, number>();
  for (const p of paras) for (const w of p.split(' ')) if (!cache.has(w)) cache.set(w, shape(hbFonts.ko, w).length);
  const wordMs = performance.now() - t;
  t = performance.now();
  for (const p of paras.slice(0, 2000)) ctxOf('ko', 'normal').measureText(p);
  const canvasRunMs = ((performance.now() - t) / 2000) * 10_000;
  results.b5 = { paraMs, wordMs, canvasRunMs };
  table('B5 속도 (1만 문단, 130만 글자)', ['방식', '시간'], [
    ['HarfBuzz 문단 통째', `${paraMs.toFixed(0)} ms`],
    ['HarfBuzz 어절 + 캐시', `${wordMs.toFixed(0)} ms (서로 다른 어절 ${cache.size.toLocaleString()}개)`],
    ['캔버스 measureText 문단 통째 (참고)', `${canvasRunMs.toFixed(0)} ms (2,000문단에서 환산)`],
  ]);

  // 그리기 비교: 위 = fillText 한 줄, 아래 = HarfBuzz 위치에 글자 하나씩
  const cv = document.getElementById('draw') as HTMLCanvasElement;
  const g = cv.getContext('2d')!;
  const line = SAMPLES.find((s) => s.id === 'latin-kern')!;
  g.font = `28px QuireLatin`;
  g.fontKerning = 'normal';
  g.fillStyle = '#1d1d1f';
  g.fillText(line.text, 10, 40);
  const glyphs = shape(hbFonts.latin, line.text);
  let x = 10;
  g.fillStyle = '#c2410c';
  for (let i = 0; i < glyphs.length; i++) {
    const gl = glyphs[i]!;
    const end = glyphs[i + 1]?.cl ?? line.text.length;
    g.fillText(line.text.slice(gl.cl, end), x + toPx(hbFonts.latin, gl.dx, 28), 80);
    x += toPx(hbFonts.latin, gl.ax, 28);
  }
  g.fillStyle = '#6e6e73';
  g.font = '13px system-ui';
  g.fillText('위: fillText 한 번 (브라우저 셰이핑) · 아래: HarfBuzz 위치에 클러스터마다 fillText', 10, 110);
  status.textContent = '끝';
  results.done = true;
}

main().catch((e) => {
  status.textContent = `오류: ${e instanceof Error ? e.message : String(e)}`;
  results.error = String(e);
});
