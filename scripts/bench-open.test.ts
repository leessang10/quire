/** 문서 열기 벤치마크: Doc.fromText + 첫 화면 레이아웃 */
import { it } from 'vitest';
import { Doc } from '@quiredoc/model';
import { PagedLayout, type Measurer, type PageSetup } from '@quiredoc/layout';

const measurer: Measurer = { width: (g) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) };
const setup: PageSetup = { width: 794, height: 1123, margin: 96, gap: 24, lineHeight: 27, paraSpacing: 8 };
const NL = String.fromCharCode(10);
const LOREM =
  '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다. 이 문단은 대형 문서 성능 측정을 위해 반복해서 생성된 문단입니다. 레이아웃 캐시가 동작하면 편집할 때 바뀐 문단만 다시 줄을 나눕니다.';

it('open benchmark', () => {
  for (const n of [10_000, 100_000]) {
    const text = Array.from({ length: n }, (_, i) => `${i + 1}. ${LOREM}`).join(NL);
    const runs: number[] = [];
    let first = 0;
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      const doc = Doc.fromText(text);
      const t1 = performance.now();
      const layout = new PagedLayout(setup, measurer);
      layout.update(doc.paragraphs(), null, 1800);
      first = performance.now() - t1;
      runs.push(t1 - t0);
    }
    runs.sort((a, b) => a - b);
    console.log(`■ ${n.toLocaleString()} 문단 (${text.length.toLocaleString()} 글자): Doc.fromText ${runs[1]!.toFixed(0)} ms, 첫 화면 레이아웃 ${first.toFixed(1)} ms`);
  }
}, 600_000);
