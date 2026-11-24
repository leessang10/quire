/**
 * 표 쪽 분할 (3-7, 12 G6): 쪽을 넘는 1,000행 표(제목 행 반복, 쪽 끝마다 행이 쪼개짐)의 셀 입력 p95 16 ms.
 * 편집기처럼 셀 입력마다 표 문단을 다시 조판한다 (표 레코드 → 격자 → 바뀐 셀만 다시 → 행 높이 → 행 조각 흐름, 쪽 끝 행 쪼개기)
 * 그리고 셀 자리(place)를 정한다.
 *   - 셀 입력 (높이 그대로), 셀 Enter (그 행이 한 줄 늘어 뒤 행이 밀린다: 쪽 끝마다 쪼개기를 다시)
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-table-split.test.ts
 */
import { it } from 'vitest';
import { Doc, Document, cellStoryId } from '@quiredoc/model';
import { LayoutCache, PagedLayout, SectionFrames, type Measurer } from '@quiredoc/layout';
import { Formatter, defaultPageSetup } from '../packages/editor/src/formatter';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const NL = String.fromCharCode(10);

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5)}  p95 ${q(0.95)}  max ${q(1)} ms`;
}

function scenario(nrows: number, lines: number) {
  const doc = Doc.fromText(['앞 문단', '뒤 문단'].join(NL));
  const document = new Document(doc);
  const { id } = document.insertTable(doc.paragraphs()[1]!.start, nrows, 3, 451000);
  const t = document.table(id)!;
  document.setRowAttrs(id, t.rows[0]!, { header: true });
  const cell = (r: number, c: number) => document.story(cellStoryId(id, t.rows[r]!, t.cols[c]!));
  for (let r = 0; r < nrows; r++) {
    cell(r, 0).insertText(0, String(r));
    cell(r, 1).insertText(0, `항목 ${r}`);
    cell(r, 2).insertText(0, Array.from({ length: 1 + ((r * 7) % lines) }, (_, k) => `설명 ${r}의 ${k + 1}번째 줄`).join(NL));
  }
  doc.takeParagraphChanges();
  const ti = doc.paragraphs().findIndex((p) => p.objs?.get(0)?.kind === 'table');
  const setup = defaultPageSetup(16);
  const fmt = new Formatter(() => document, setup, 16);
  fmt.reset(measurer, new LayoutCache(20000));
  const layout = new PagedLayout(setup, measurer, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  let t0 = performance.now();
  layout.update(doc.paragraphs(), null, Infinity, doc.takeParagraphChanges());
  layout.finish();
  const firstMs = performance.now() - t0;
  const pp = layout.para(ti);
  const pages = new Set(pp.lines.map((l) => l.page)).size;
  const splitRows = pp.lines.filter((l) => (l.part ?? 0) > 0).length;
  const parts = { spec: 0, flow: 0, place: 0 };
  const origSpec = fmt.tableSpec.bind(fmt);
  (fmt as any).tableSpec = (a: string, b: number) => { const t1 = performance.now(); const r = origSpec(a, b); parts.spec += performance.now() - t1; return r; };
  const relayout = () => {
    doc.touchParagraph(ti);
    const t1 = performance.now();
    layout.update(doc.paragraphs(), null, Infinity, doc.takeParagraphChanges());
    parts.flow += performance.now() - t1;
    const v = fmt.tableViews.get(id)!;
    const t2 = performance.now();
    fmt.tables.place(v.input, v.measure, layout.para(ti).lines);
    parts.place += performance.now() - t2;
  };
  const s = cell(Math.floor(nrows / 2), 2);
  const type: number[] = [];
  const enter: number[] = [];
  for (let k = 0; k < 300; k++) {
    const nl = k % 20 === 19;
    t0 = performance.now();
    if (nl) s.insertText(s.maxCaret, NL + '줄');
    else if (k % 2 === 0) s.insertText(1, '가');
    else s.deleteRange(1, 2);
    relayout();
    (nl ? enter : type).push(performance.now() - t0);
  }
  console.log(
    [
      `표 ${nrows.toLocaleString()}행 × 3열, ${pages}쪽에 걸침 (쪼갠 행 조각 ${splitRows}, 제목 행 반복)`,
      `  처음 조립            ${firstMs.toFixed(0)} ms`,
      `  셀 입력              ${stats(type)}`,
      `  셀 Enter             ${stats(enter)}`,
      `  합계 ms: spec ${parts.spec.toFixed(0)} flow(spec 포함) ${parts.flow.toFixed(0)} place ${parts.place.toFixed(0)}`,
    ].join(NL),
  );
}

it('table split benchmark', () => {
  scenario(1000, 6);
  scenario(3000, 6);
});
