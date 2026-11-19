/**
 * 머리말·꼬리말과 필드 (3-4, 12 G3): 약 1,000쪽 문서에 머리말(홀짝·첫 쪽)과 꼬리말 "쪽 / 전체 쪽".
 *   - 본문 입력 p95: 편집기처럼 입력마다 구역 머리말 높이를 맞추고(syncSections) 화면까지 조립
 *   - 머리말 입력 p95: 높이가 그대로면 본문을 다시 놓지 않는다 (다시 놓은 문단 수도 센다). 보이는 세 쪽의 머리말·꼬리말을 그 쪽 값으로 조판
 *   - 머리말 줄 늘리기: 쪽 모양이 바뀐 구역 첫 문단부터 화면까지 다시 놓는다
 *   - 구역 200개(머리말을 앞 구역에서 이어 씀)에서 입력마다 syncSections
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-headers.test.ts
 */
import { it } from 'vitest';
import { DEFAULT_SECTION, Doc, Document, LAST_SECTION, hfStoryId, type SectionProps } from '@quire/model';
import { LayoutCache, PagedLayout, SectionFrames, type Measurer } from '@quire/layout';
import { Formatter, defaultPageSetup } from '../packages/editor/src/formatter';
import { layoutHF, pageHF } from '../packages/editor/src/headers';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const NL = String.fromCharCode(10);

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5)}  p95 ${q(0.95)}  max ${q(1)} ms`;
}

function scenario(paras: number, sections: number) {
  const text = Array.from({ length: paras }, (_, i) => `${i + 1}. 머리말과 꼬리말이 있는 긴 문서의 문단입니다. 쪽마다 꼬리말에 쪽 번호와 전체 쪽 수가 들어갑니다.`).join(NL);
  const doc = Doc.fromText(text);
  const document = new Document(doc);
  const hOdd = hfStoryId('header', 'b0', 'default');
  const hEven = hfStoryId('header', 'b0', 'even');
  const ftr = hfStoryId('footer', 'b0', 'default');
  document.story(hOdd).insertText(0, '긴 문서 · 홀수 쪽 머리말');
  document.story(hOdd).setParaAttr(0, 'align', 'right');
  document.story(hEven).insertText(0, '긴 문서 · 짝수 쪽 머리말');
  const f = document.story(ftr);
  f.insertObject(0, { kind: 'field', field: 'page' });
  f.insertText(1, ' / ');
  f.insertObject(4, { kind: 'field', field: 'pages' });
  f.setParaAttr(0, 'align', 'center');
  // 구역: 첫 구역에 머리말·꼬리말, 뒤 구역은 이어 쓴다
  const per = Math.floor(paras / sections);
  const first: SectionProps = { ...DEFAULT_SECTION, titlePage: true, oddEven: true, header: { default: hOdd, even: hEven }, footer: { default: ftr, even: ftr } };
  for (let s = 0; s < sections - 1; s++) {
    doc.setParaAttr((s + 1) * per - 1, 'section', `b${s}`);
    doc.setSection(`b${s}`, s === 0 ? first : { ...DEFAULT_SECTION });
  }
  doc.setSection(LAST_SECTION, sections === 1 ? first : { ...DEFAULT_SECTION });
  if (sections === 1) doc.setSection('b0', first);
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
  /** 편집기의 relayout과 같게: 머리말 높이 맞추기 → 바뀐 구역 첫 문단 → 화면까지 조립 */
  const relayout = (top: number) => {
    const sec = fmt.syncSections();
    if (sec >= 0) doc.touchParagraph(sec === 0 ? 0 : doc.sectionBreaks()[sec - 1]! + 1);
    layout.update(doc.paragraphs(), null, top + view, doc.takeParagraphChanges());
  };
  /** 보이는 세 쪽의 머리말·꼬리말 (그리기 전에 하는 일) */
  const drawHF = (p0: number) => {
    for (let p = p0; p < p0 + 3; p++) {
      const hf = pageHF(fmt, layout, p, '2026. 1. 1.');
      layoutHF(fmt, (id) => document.story(id), hf, 'header');
      layoutHF(fmt, (id) => document.story(id), hf, 'footer');
    }
  };
  const mid = Math.floor(paras / 2);
  const body: number[] = [];
  let at = doc.paragraphs()[mid]!.end;
  for (let k = 0; k < 300; k++) {
    t0 = performance.now();
    doc.insertText(at++, '가');
    relayout(layout.para(mid).lines[0]!.y);
    drawHF(layout.para(mid).lines[0]!.page);
    body.push(performance.now() - t0);
  }
  layout.finish();
  const hdr: number[] = [];
  let moved = 0;
  const page = layout.para(mid).lines[0]!.page;
  const hd = document.story(hOdd);
  for (let k = 0; k < 300; k++) {
    t0 = performance.now();
    // 넣고 지우기를 번갈아: 머리말이 한 줄 그대로 (높이가 그대로)
    if (k % 2 === 0) hd.insertText(1, '가');
    else hd.deleteRange(1, 2);
    relayout(layout.pageBox(page).top);
    drawHF(page);
    hdr.push(performance.now() - t0);
    moved += layout.counts.reflowed + layout.counts.repositioned;
  }
  // 머리말 줄을 늘리고 줄이기를 번갈아: 쪽 모양이 바뀌어 첫 구역 처음부터 화면까지 다시 놓는다
  const grow: number[] = [];
  for (let k = 0; k < 40; k++) {
    t0 = performance.now();
    if (k % 2 === 0) hd.insertText(hd.maxCaret, NL + '줄');
    else hd.deleteRange(hd.maxCaret - 2, hd.maxCaret);
    relayout(layout.pageBox(page).top);
    grow.push(performance.now() - t0);
  }
  layout.finish();
  console.log(
    [
      `문단 ${paras.toLocaleString()}개, 구역 ${sections}개, ${pages.toLocaleString()}쪽 (머리말 홀짝·첫 쪽, 꼬리말 쪽 번호·전체 쪽 수)`,
      `  처음 조립              ${firstMs.toFixed(0)} ms`,
      `  본문 입력 (화면까지)    ${stats(body)}`,
      `  머리말 입력            ${stats(hdr)}  (본문을 다시 놓은 문단 ${moved})`,
      `  머리말 줄 늘리기        ${stats(grow)}`,
    ].join(NL),
  );
}

it('headers benchmark', () => {
  scenario(15000, 1);
  scenario(15000, 50);
  scenario(100000, 200);
});
