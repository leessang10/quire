/**
 * 표 쪽 분할 (12 §8): 행 쪼개기(줄 단위), 제목 행 반복, 행 나누지 않음, 쪽보다 큰 행, 증분 = 처음부터
 */
import { describe, expect, it } from 'vitest';
import { Doc, Document, cellStoryId } from '@quiredoc/model';
import { LayoutCache, PagedLayout, SectionFrames, cellGroups, rowParts, type Measurer, type PlacedLine } from '@quiredoc/layout';
import { Formatter, defaultPageSetup } from './formatter';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const NL = '\n';

/** 앞 문단 before개 + 표 (행 rows × 열 2) + 뒤 문단 하나 */
function make(before: number, rows: number) {
  const doc = Doc.fromText([...Array.from({ length: before }, (_, i) => `${i + 1}. 앞 문단입니다.`), '뒤 문단'].join(NL));
  const document = new Document(doc);
  const at = doc.paragraphs()[before]!.start;
  const { id } = document.insertTable(at, rows, 2, 200000);
  doc.takeParagraphChanges();
  const t = document.table(id)!;
  const cell = (r: number, c: number) => document.story(cellStoryId(id, t.rows[r]!, t.cols[c]!));
  for (let r = 0; r < rows; r++) for (let c = 0; c < 2; c++) cell(r, c).insertText(0, `${r}-${c}`);
  return { document, id, t, cell, tableIndex: before };
}

function compose(document: Document) {
  const setup = defaultPageSetup(16);
  const fmt = new Formatter(() => document, setup, 16);
  fmt.reset(measurer, new LayoutCache(5000));
  const layout = new PagedLayout(setup, measurer, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  document.body.takeParagraphChanges();
  layout.update(document.body.paragraphs(), null, Infinity, null);
  layout.finish();
  return { fmt, layout };
}

/** 표 문단의 행 조각들 */
function frags(c: ReturnType<typeof compose>, i: number): PlacedLine[] {
  return c.layout.para(i).lines;
}

/** 조각 요약 (쪽:행.조각, 다시 그린 제목 행은 h) */
const sum = (ls: PlacedLine[]) => ls.map((l) => `${l.page}:${l.repeat ? 'h' : ''}${l.row}.${l.part}`);

/** 셀 줄이 모두 그 셀의 조각 사각형 안에 있다 (편집기가 place로 정한 그리기 레이아웃) */
function cellLinesInside(c: ReturnType<typeof compose>, document: Document, id: string, i: number) {
  const v = c.fmt.tableViews.get(id)!;
  const lines = frags(c, i);
  c.fmt.tables.place(v.input, v.measure, lines);
  const parts = rowParts(v.grid.cells.length, lines);
  let total = 0;
  v.grid.cells.forEach((row, y) =>
    row.forEach((cell) => {
      if (!cell) return;
      const groups = cellGroups(parts.slice(y, y + cell.span[0]).flat());
      const L = c.fmt.tables.cells.get(cell.story)!.view;
      for (const pp of L.paras)
        for (const ln of pp!.lines) {
          total++;
          const g = groups.find((gg) => ln.y >= gg.top - 0.5 && ln.y + ln.height <= gg.top + gg.height + 0.5);
          expect(g, `${cell.story} line at ${ln.y}`).toBeTruthy();
        }
      void document;
    }),
  );
  return total;
}

describe('table page splitting (12 §8)', () => {
  it('repeats the header rows at the top of each page the table continues on', () => {
    const { document, id, t, tableIndex } = make(2, 120);
    document.setRowAttrs(id, t.rows[0]!, { header: true });
    document.body.touchParagraph(tableIndex);
    const c = compose(document);
    const s = sum(frags(c, tableIndex));
    const pages = [...new Set(frags(c, tableIndex).map((l) => l.page))];
    expect(pages.length).toBeGreaterThan(2);
    for (const p of pages.slice(1)) expect(s.find((x) => x.startsWith(`${p}:`))).toBe(`${p}:h0.0`);
    expect(s.filter((x) => x.includes(':0.0')).length).toBe(1); // 원래 제목 행은 한 번
  });

  it('splits a tall row at line boundaries across pages, and a row taller than a page into several pieces', () => {
    const { document, id, tableIndex, cell } = make(20, 3);
    const long = Array.from({ length: 30 }, (_, k) => `${k + 1}번째 줄의 글입니다.`).join(NL);
    cell(1, 0).insertText(0, long + NL);
    cell(2, 1).insertText(0, Array.from({ length: 90 }, (_, k) => `아주 긴 셀 ${k + 1}`).join(NL) + NL);
    document.body.touchParagraph(tableIndex);
    const c = compose(document);
    const s = sum(frags(c, tableIndex));
    expect(s.some((x) => x.endsWith(':1.1'))).toBe(true); // 1행이 쪽 사이에서 쪼개짐
    expect(s.filter((x) => /:2\.\d+$/.test(x)).length).toBeGreaterThanOrEqual(3); // 쪽보다 큰 행
    // 셀 줄이 빠짐없이 조각 안에 보인다
    expect(cellLinesInside(c, document, id, tableIndex)).toBeGreaterThan(120);
    // 조각은 프레임 아래로 넘치지 않는다
    for (const l of frags(c, tableIndex)) {
      const pb = c.layout.pageBox(l.page);
      expect(l.y + l.height).toBeLessThanOrEqual(pb.top + pb.height - 96 + 0.5);
    }
  });

  it('moves a row that may not split, unless it is taller than an empty page', () => {
    const { document, id, t, tableIndex, cell } = make(22, 3);
    cell(1, 0).insertText(0, Array.from({ length: 12 }, (_, k) => `줄 ${k}`).join(NL) + NL);
    document.body.touchParagraph(tableIndex);
    const split = sum(frags(compose(document), tableIndex));
    expect(split.some((x) => x.endsWith(':1.1'))).toBe(true);
    document.setRowAttrs(id, t.rows[1]!, { cantSplit: true });
    document.body.touchParagraph(tableIndex);
    const kept = sum(frags(compose(document), tableIndex));
    expect(kept.filter((x) => /:1\.\d$/.test(x))).toEqual([`${Number(kept.find((x) => x.endsWith(':1.0'))!.split(':')[0])}:1.0`]);
    expect(Number(kept.find((x) => x.endsWith(':1.0'))!.split(':')[0])).toBe(Number(kept.find((x) => x.endsWith(':0.0'))!.split(':')[0]) + 1);
    // 쪽보다 큰 나누지 않는 행은 쪼갠다
    cell(1, 0).insertText(0, Array.from({ length: 60 }, (_, k) => `더 ${k}`).join(NL) + NL);
    document.body.touchParagraph(tableIndex);
    expect(sum(frags(compose(document), tableIndex)).some((x) => x.endsWith(':1.1'))).toBe(true);
  });

  it('incremental relayout after cell edits equals a fresh layout', () => {
    const { document, id, t, tableIndex, cell } = make(25, 40);
    document.setRowAttrs(id, t.rows[0]!, { header: true });
    document.body.touchParagraph(tableIndex);
    const c = compose(document);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 0x100000000);
    for (let step = 0; step < 25; step++) {
      const r = Math.floor(rnd() * 40);
      const s = cell(r, Math.floor(rnd() * 2));
      if (rnd() < 0.7) s.insertText(s.maxCaret, NL + `덧붙인 줄 ${step}`.repeat(1 + Math.floor(rnd() * 3)));
      else if (s.maxCaret > 3) s.deleteRange(1, Math.min(s.maxCaret, 1 + Math.floor(rnd() * 20)));
      document.body.touchParagraph(tableIndex);
      c.layout.update(document.body.paragraphs(), null, rnd() < 0.5 ? Infinity : 800, document.body.takeParagraphChanges());
      c.layout.finish();
      const fresh = compose(document);
      expect(sum(frags(c, tableIndex))).toEqual(sum(frags(fresh, tableIndex)));
      expect(frags(c, tableIndex).map((l) => [l.y, l.height])).toEqual(frags(fresh, tableIndex).map((l) => [l.y, l.height]));
      expect(c.layout.para(tableIndex + 1).lines[0]!.y).toBe(fresh.layout.para(tableIndex + 1).lines[0]!.y);
    }
    cellLinesInside(c, document, id, tableIndex);
  });
});
