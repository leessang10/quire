/**
 * 다중 커서 (2-12, G4): 캐럿 100개 입력 p95 16 ms (11 §8)
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-multicursor.test.ts
 *
 * 편집기 editAll과 같은 경로: 뒤 캐럿부터 insertText (Doc.batch: 문단 시작 옮기기는 끝에 한 번), 캐럿은 원소 위치(positionAt)로 들고 다닌다,
 * 그다음 본문 레이아웃을 바뀐 문단만 다시 조판 (화면 아래 두 화면까지 즉시, 나머지는 백그라운드).
 */
import { it } from 'vitest';
import { Doc, type Position } from '@quire/model';
import { LayoutCache, PagedLayout, type Measurer, type PageSetup } from '@quire/layout';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const SETUP: PageSetup = { width: 794, height: 1123, margin: 96, gap: 24, lineHeight: 27, paraSpacing: 8, fontSize: 16 };
const NL = String.fromCharCode(10);
const LOREM = '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다. 다중 커서 성능 측정 문단입니다.';

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5)}  p95 ${q(0.95)}  max ${q(1)} ms`;
}

function scenario(paragraphs: number, carets: number, spread: number) {
  const doc = Doc.fromText(Array.from({ length: paragraphs }, (_, i) => `${i + 1}. ${LOREM}`).join(NL));
  const layout = new PagedLayout(SETUP, measurer, new LayoutCache());
  layout.update(doc.paragraphs(), null, Infinity, doc.takeParagraphChanges());
  layout.finish();
  // 캐럿: spread 문단마다 하나, 문단 가운데
  let pos: Position[] = Array.from({ length: carets }, (_, k) => {
    const p = doc.paragraphs()[k * spread]!;
    return doc.positionAt(p.start + 10);
  });
  const times: number[] = [];
  for (let n = 0; n < 200; n++) {
    const t0 = performance.now();
    const offs = pos.map((p) => doc.resolve(p));
    const order = offs.map((o, k) => [o, k] as const).sort((a, b) => b[0] - a[0]);
    const next: Position[] = [];
    doc.batch(() => {
      for (const [o, k] of order) {
        doc.insertText(o, n % 30 === 29 ? NL : '가');
        next[k] = doc.positionAt(o + 1);
      }
    });
    pos = next;
    layout.update(doc.paragraphs(), null, SETUP.height * 2, doc.takeParagraphChanges());
    times.push(performance.now() - t0);
    layout.step(8); // 유휴 시간 쪽 조립 (측정 밖)
  }
  console.log(`문단 ${paragraphs.toLocaleString()}개, 캐럿 ${carets}개 (${spread}문단마다)  입력 ${stats(times)}`);
}

it('multi-cursor benchmark', () => {
  scenario(10_000, 100, 1); // 한 화면 근처에 몰린 캐럿
  scenario(10_000, 100, 97); // 문서 전체에 흩어진 캐럿
  scenario(100_000, 100, 997);
});
