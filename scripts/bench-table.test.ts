/**
 * 표 (2-11, G3): 행 1,000개 표의 셀 입력 p95 16 ms, 첫 표시 1 s (11 §8)
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-table.test.ts
 *
 * 편집기와 같은 경로: 본문 PagedLayout의 표 문단 서식이 TableLayouter로 셀을 재고 행 높이를 낸다.
 * 셀에 한 글자 넣기 → 그 셀 스토리 변경 → 표 문단 touch → 본문 레이아웃 갱신 (표 다시 재기, 뒤 문단 위치).
 */
import { it } from 'vitest';
import { Doc, Document, cellStoryId, normalizeTable, type ParagraphInfo } from '@quire/model';
import { CELL_PAD, LayoutCache, PLAIN_STYLE, PagedLayout, TableLayouter, type FormatSource, type Measurer, type PageSetup } from '@quire/layout';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const SETUP: PageSetup = { width: 794, height: 1123, margin: 96, gap: 24, lineHeight: 27, paraSpacing: 8, fontSize: 16 };
const NL = String.fromCharCode(10);
const pt = (v: number | undefined) => ((v ?? 0) / 1000) * (96 / 72);

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5)}  p95 ${q(0.95)}  max ${q(1)} ms`;
}

function scenario(rows: number, cols: number) {
  const body = Array.from({ length: 20 }, (_, i) => `${i + 1}. 표 앞뒤 문단입니다. 레이아웃이 표 높이에 따라 뒤 문단을 다시 놓는지 봅니다.`).join(NL);
  const d = new Document(Doc.fromText(body));
  const at = d.body.paragraphs()[10]!.start;
  const { id } = d.insertTable(at, rows, cols, 450000);
  const t = d.table(id)!;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) d.story(cellStoryId(id, t.rows[y]!, t.cols[x]!)).insertText(0, `${y + 1}행 ${x + 1}열 셀 내용`);
  d.takeDirtyTables();

  const tables = new TableLayouter(SETUP, measurer, new LayoutCache(20000), (s) => d.story(s), () => null);
  const format: FormatSource = (info) => {
    const p = info as ParagraphInfo;
    const o = p.objs?.get(0);
    if (o?.kind !== 'table' || !o.table) return null;
    const rec = d.table(o.table)!;
    const g = normalizeTable(rec);
    const m = tables.measure({ widths: g.widths.map(pt), cells: g.cells }, SETUP.lineHeight + CELL_PAD * 2);
    return { fmt: null, mark: 0, style: () => PLAIN_STYLE, table: { width: m.width, rows: m.rows } };
  };
  const layout = new PagedLayout(SETUP, measurer, new LayoutCache(), format);
  let t0 = performance.now();
  layout.update(d.body.paragraphs(), null, Infinity, d.body.takeParagraphChanges());
  layout.finish();
  const firstMs = performance.now() - t0;
  const ti = d.body.paragraphIndexAt(at);

  // 표 가운데 행의 셀에 입력 (가끔 줄이 넘쳐 행 높이가 바뀐다)
  const story = d.story(cellStoryId(id, t.rows[Math.floor(rows / 2)]!, t.cols[1]!));
  const times: number[] = [];
  for (let k = 0; k < 300; k++) {
    t0 = performance.now();
    story.insertText(story.maxCaret, k % 40 === 39 ? NL : '가');
    d.body.touchParagraph(ti);
    layout.update(d.body.paragraphs(), null, SETUP.height * 3, d.body.takeParagraphChanges());
    times.push(performance.now() - t0);
  }
  layout.finish();
  console.log(
    [
      `표 ${rows.toLocaleString()}행 × ${cols}열 (셀 ${(rows * cols).toLocaleString()}개), ${layout.pageCount}쪽`,
      `  첫 표시 (모든 셀 조판)  ${firstMs.toFixed(0)} ms`,
      `  셀 입력              ${stats(times)}`,
    ].join(NL),
  );
}

it('table benchmark', () => {
  scenario(100, 3);
  scenario(1000, 3);
});
