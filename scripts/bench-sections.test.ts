/**
 * 구역 (3-2, 12 G1): 1,000쪽 문서에서 구역이 있어도 입력 p95 16 ms 그대로, 구역 설정을 바꾸면 그 구역부터 수렴까지만 다시 조립
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-sections.test.ts
 *
 * 편집기와 같은 경로: Formatter(서식·구역 → 쪽 모양) + SectionFrames. 문단 1만 5천 개(약 1,000쪽)와 10만 개, 구역 50·200개 (세로·가로·여백 다름·이어서).
 */
import { it } from 'vitest';
import { Doc, Document, LAST_SECTION, fullSection, type SectionProps } from '@quiredoc/model';
import { LayoutCache, PagedLayout, SectionFrames, type Measurer } from '@quiredoc/layout';
import { Formatter, defaultPageSetup } from '../packages/editor/src/formatter';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const NL = String.fromCharCode(10);
const A4 = [595276, 841890] as const;

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5)}  p95 ${q(0.95)}  max ${q(1)} ms`;
}

const KINDS: SectionProps[] = [
  fullSection(undefined),
  { page: { width: A4[1], height: A4[0], margin: [42520, 42520, 42520, 42520] }, start: 'nextPage' },
  { page: { width: A4[0], height: A4[1], margin: [70866, 70866, 70866, 113386] }, start: 'oddPage' },
  { page: { width: A4[0], height: A4[1], margin: [72000, 56693, 72000, 56693] }, start: 'continuous' },
];

function build(paras: number, sections: number) {
  const text = Array.from({ length: paras }, (_, i) => `${i + 1}. 구역이 많은 긴 문서의 문단입니다. 구역마다 용지와 여백이 달라 줄 폭이 다르고, 쪽 크기도 다릅니다. 입력은 그대로 빨라야 합니다.`).join(NL);
  const doc = Doc.fromText(text);
  const per = Math.floor(paras / sections);
  for (let s = 0; s < sections - 1; s++) {
    const id = `s${s}`;
    doc.setSection(id, KINDS[s % KINDS.length]!);
    doc.setParaAttr((s + 1) * per - 1, 'section', id);
  }
  doc.setSection(LAST_SECTION, KINDS[(sections - 1) % KINDS.length]!);
  doc.takeParagraphChanges();
  return { doc, per };
}

function scenario(paras: number, sections: number) {
  const { doc, per } = build(paras, sections);
  const document = new Document(doc);
  const setup = defaultPageSetup(16);
  const fmt = new Formatter(() => document, setup, 16);
  fmt.reset(measurer, new LayoutCache(20000));
  const frames = sections > 1 ? new SectionFrames(setup, fmt.sections) : undefined;
  const layout = new PagedLayout(setup, measurer, new LayoutCache(), fmt.formatOf, frames);
  let t0 = performance.now();
  layout.update(doc.paragraphs(), null, Infinity, doc.takeParagraphChanges());
  layout.finish();
  const firstMs = performance.now() - t0;
  const view = setup.height * 3;

  // 가운데 구역 가운데 문단에 입력 (가끔 Enter: 문단 수가 바뀌어 구역 나눔 번호가 밀린다)
  const mid = Math.floor(sections / 2) * per + Math.floor(per / 2);
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

  // 가운데 구역의 여백 바꾸기: 그 구역 문단만 다시 나누고, 다음 구역 시작이 같으면 거기서 수렴
  const sec = doc.sectionOf(mid).id;
  const change: number[] = [];
  const work: string[] = [];
  for (let k = 0; k < 6; k++) {
    const cur = fullSection(doc.sectionDef(sec));
    const m = cur.page.margin;
    const next: SectionProps = { ...cur, page: { ...cur.page, margin: [m[0], m[1] + (k % 2 ? -2000 : 2000), m[2], m[3]] } };
    t0 = performance.now();
    doc.setSection(sec, next);
    layout.update(doc.paragraphs(), null, Infinity, doc.takeParagraphChanges());
    change.push(performance.now() - t0);
    const c = layout.counts;
    work.push(`${c.reflowed}/${c.repositioned}/${c.reused}`);
  }
  console.log(
    [
      `문단 ${paras.toLocaleString()}개, 구역 ${sections}개, ${layout.pageCount.toLocaleString()}쪽`,
      `  처음 조립            ${firstMs.toFixed(0)} ms`,
      `  입력 (화면까지)       ${stats(type)}`,
      `  Enter (화면까지)      ${stats(enter)}`,
      sections > 1 ? `  구역 여백 바꾸기 (끝까지) ${stats(change)}  재계산/재배치/재사용 ${work.join(' ')}` : '',
    ].join(NL),
  );
}

it('sections benchmark', () => {
  scenario(15000, 1);
  scenario(15000, 50);
  scenario(100000, 200);
});
