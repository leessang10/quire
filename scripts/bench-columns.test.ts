/**
 * 다단 (3-6, 12 G5): 약 1,000쪽 2단 문서와, 1단·2단 구역이 같은 쪽에서 번갈아 이어지는 문서(다단 구역 끝마다 단 균형).
 * 편집기 relayout과 같게 입력마다 머리말·각주 맞추기와 화면까지 조립.
 *   - 입력, Enter (화면까지)
 *   - 균형 띠 안의 입력: 띠의 줄 수가 바뀌면 뒤 구역 앞에서 균형을 다시 맞춘다 (띠 문단 × 이분 탐색)
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-columns.test.ts
 */
import { it } from 'vitest';
import { DEFAULT_SECTION, Doc, Document, LAST_SECTION, type SectionProps } from '@quire/model';
import { LayoutCache, PagedLayout, SectionFrames, type Measurer } from '@quire/layout';
import { Formatter, defaultPageSetup } from '../packages/editor/src/formatter';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const NL = String.fromCharCode(10);

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5)}  p95 ${q(0.95)}  max ${q(1)} ms`;
}

const TWO: SectionProps = { ...DEFAULT_SECTION, columns: { count: 2, gap: 18000, separator: true } } as SectionProps;

function scenario(paras: number, bands: number) {
  const text = Array.from({ length: paras }, (_, i) => `${i + 1}. 다단 문서의 문단입니다. 글이 첫 단을 채우면 다음 단으로, 마지막 단을 채우면 다음 쪽으로 흐릅니다.`).join(NL);
  const doc = Doc.fromText(text);
  const document = new Document(doc);
  if (bands === 0) doc.setSection(LAST_SECTION, TWO);
  else {
    // 1단 띠(제목 한 문단) → 2단 띠(per − 1 문단, 같은 쪽에서) … 다단 구역 끝마다 균형
    const per = Math.floor(paras / bands);
    for (let b = 0; b < bands; b++) {
      const s0 = b * per;
      doc.setParaAttr(s0, 'section', `h${b}`);
      doc.setSection(`h${b}`, { ...DEFAULT_SECTION, start: b === 0 ? 'nextPage' : 'continuous' } as SectionProps);
      if (b < bands - 1) {
        doc.setParaAttr(s0 + per - 1, 'section', `c${b}`);
        doc.setSection(`c${b}`, { ...TWO, start: 'continuous' } as SectionProps);
      }
    }
    doc.setSection(LAST_SECTION, { ...TWO, start: 'continuous' } as SectionProps);
  }
  doc.takeParagraphChanges();
  const setup = defaultPageSetup(16);
  const fmt = new Formatter(() => document, setup, 16);
  fmt.reset(measurer, new LayoutCache(20000));
  const layout = new PagedLayout(setup, measurer, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  let t0 = performance.now();
  layout.update(doc.paragraphs(), null, Infinity, doc.takeParagraphChanges());
  layout.finish();
  const firstMs = performance.now() - t0;
  const pages = layout.pageCount;
  const view = setup.height * 3;
  const relayout = (top: number) => {
    const sec = fmt.syncSections();
    if (sec >= 0) doc.touchParagraph(sec === 0 ? 0 : doc.sectionBreaks()[sec - 1]! + 1);
    for (const i of fmt.syncNotes()) doc.touchParagraph(i);
    layout.update(doc.paragraphs(), null, top + view, doc.takeParagraphChanges());
  };
  // 문서 가운데 (띠가 있으면 가운데 띠의 마지막 문단: 그 띠의 균형 쪽)
  const per = bands ? Math.floor(paras / bands) : 0;
  const mid = bands ? Math.floor(bands / 2) * per + per - 2 : Math.floor(paras / 2);
  const top = () => layout.pageBox(layout.para(mid).lines[0]!.page).top;
  const type: number[] = [];
  const enter: number[] = [];
  let at = doc.paragraphs()[mid]!.end;
  for (let k = 0; k < 300; k++) {
    const nl = k % 20 === 19;
    t0 = performance.now();
    doc.insertText(at++, nl ? NL : '가');
    relayout(top());
    (nl ? enter : type).push(performance.now() - t0);
  }
  layout.finish();
  console.log(
    [
      `문단 ${paras.toLocaleString()}개, ${bands ? `1단·2단 띠 ${bands}쌍 (균형 ${bands - 1}곳)` : '2단'}, ${pages.toLocaleString()}쪽`,
      `  처음 조립            ${firstMs.toFixed(0)} ms`,
      `  입력 (화면까지)       ${stats(type)}`,
      `  Enter (화면까지)      ${stats(enter)}`,
    ].join(NL),
  );
}

it('columns benchmark', () => {
  scenario(15000, 0);
  scenario(15000, 300);
  scenario(100000, 0);
});
