/**
 * 쪽 나눔 제어 (3-3, 12 G2): 제목이 많은 약 1,000쪽 문서에서 다음 문단과 함께(미리 보기)·과부 고아 줄·앞에서 쪽 나눔이 있어도
 * 입력 p95 16 ms. 증분 조립은 바뀐 문단이 든 다음 문단과 함께 사슬의 첫 문단부터 다시 놓는다
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-keep.test.ts
 */
import { it } from 'vitest';
import { Doc, Document } from '@quiredoc/model';
import { LayoutCache, PagedLayout, SectionFrames, type Measurer } from '@quiredoc/layout';
import { Formatter, defaultPageSetup } from '../packages/editor/src/formatter';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const NL = String.fromCharCode(10);

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5)}  p95 ${q(0.95)}  max ${q(1)} ms`;
}

function scenario(paras: number, rules: boolean) {
  const text = Array.from({ length: paras }, (_, i) =>
    i % 6 === 0 ? `${i / 6 + 1}. 절 제목` : `${i + 1}. 제목이 많은 긴 문서의 문단입니다. 제목은 다음 문단과 함께 놓이고, 쪽을 넘는 문단은 과부·고아 줄을 막습니다.`,
  ).join(NL);
  const doc = Doc.fromText(text);
  if (rules)
    for (let i = 0; i < paras; i += 6) {
      doc.setParaAttr(i, 'style', 'h2'); // 다음 문단과 함께 (스타일)
      if (i % 120 === 0 && i > 0) doc.setParaAttr(i, 'pageBreakBefore', true);
    }
  doc.takeParagraphChanges();
  const document = new Document(doc);
  const setup = { ...defaultPageSetup(16), widowControl: rules };
  const fmt = new Formatter(() => document, setup, 16);
  fmt.reset(measurer, new LayoutCache(20000));
  const layout = new PagedLayout(setup, measurer, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  let t0 = performance.now();
  layout.update(doc.paragraphs(), null, Infinity, doc.takeParagraphChanges());
  layout.finish();
  const firstMs = performance.now() - t0;
  const view = setup.height * 3;
  // 제목 바로 다음 문단(사슬 끝)에 입력: 제목부터 다시 놓는다. 가끔 Enter
  const mid = Math.floor(paras / 12) * 6 + 1;
  const type: number[] = [];
  const enter: number[] = [];
  let at = doc.paragraphs()[mid]!.end;
  for (let k = 0; k < 400; k++) {
    const nl = k % 20 === 19;
    t0 = performance.now();
    doc.insertText(at, nl ? NL : '가');
    at += 1;
    const top = layout.para(mid).lines[0]!.y;
    layout.update(doc.paragraphs(), null, top + view, doc.takeParagraphChanges());
    (nl ? enter : type).push(performance.now() - t0);
  }
  layout.finish();
  console.log(
    [
      `문단 ${paras.toLocaleString()}개, ${rules ? '제목·쪽 나눔 제어 있음' : '쪽 나눔 제어 없음'}, ${layout.pageCount.toLocaleString()}쪽`,
      `  처음 조립            ${firstMs.toFixed(0)} ms`,
      `  입력 (화면까지)       ${stats(type)}`,
      `  Enter (화면까지)      ${stats(enter)}`,
    ].join(NL),
  );
}

it('keep benchmark', () => {
  scenario(15000, false);
  scenario(15000, true);
  scenario(100000, true);
});
