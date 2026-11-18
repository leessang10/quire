/**
 * 표 조판 (11 §4.3, 2-11): 행을 줄처럼 놓고 쪽은 행 사이에서만 나눈다, 셀 높이 → 행 높이, 병합, 셀 원점
 */
import { describe, expect, it } from 'vitest';
import { CELL_PAD, LayoutCache, PLAIN_STYLE, PagedLayout, TableLayouter, type FormatSource, type Measurer, type PageSetup, type ParaInput, type StorySource } from './index';

const O = '￼';
const mono: Measurer = { width: () => 10 };
/** 본문 폭 200, 줄 높이 20, 문단 간격 5, 본문 높이 300 */
const SETUP: PageSetup = { width: 300, height: 400, margin: 50, gap: 10, lineHeight: 20, paraSpacing: 5, fontSize: 12 };

function tableSource(rows: Record<string, number[]>): FormatSource {
  return (info) => (rows[info.id] ? { fmt: null, mark: 0, style: () => PLAIN_STYLE, table: { width: 150, rows: rows[info.id]! } } : null);
}

/** 문단 텍스트 배열로 된 셀 스토리 */
class Story implements StorySource {
  private paras: ParaInput[];
  private changed = true;
  constructor(text: string) {
    this.paras = [];
    this.set(text);
  }
  set(text: string): void {
    let start = 0;
    this.paras = text.split('\n').map((t, k) => {
      const p = { id: `p${k}:${t}`, start, text: t };
      start += Array.from(t).length + 1;
      return p;
    });
    this.changed = true;
  }
  paragraphs(): readonly ParaInput[] {
    return this.paras;
  }
  takeParagraphChanges(): { from: number; suffix: number } {
    const r = this.changed ? { from: 0, suffix: 0 } : { from: Infinity, suffix: Infinity };
    this.changed = false;
    return r;
  }
}

describe('table rows in the page layout', () => {
  it('places rows as lines and breaks pages only between rows', () => {
    const paras: ParaInput[] = [
      { id: 'a', start: 0, text: '앞' },
      { id: 't', start: 2, text: O },
      { id: 'b', start: 4, text: '뒤' },
    ];
    const pl = new PagedLayout(SETUP, mono, new LayoutCache(), tableSource({ t: [100, 100, 100, 100] }));
    pl.update(paras);
    pl.finish();
    const rows = pl.para(1).lines;
    expect(rows.map((l) => [l.page, l.height])).toEqual([
      [0, 100],
      [0, 100],
      [1, 100], // 쪽 끝(본문 높이 300)에 걸친 행은 다음 쪽으로 (행 안에서 나누지 않는다)
      [1, 100],
    ]);
    expect(rows[0]!.y).toBe(SETUP.gap + SETUP.margin + 20 + SETUP.paraSpacing);
    expect(rows[2]!.y).toBe(SETUP.gap + SETUP.height + SETUP.gap + SETUP.margin);
    // 표 뒤 문단은 마지막 행 아래
    expect(pl.para(2).lines[0]!.y).toBe(rows[3]!.y + 100 + SETUP.paraSpacing);
    // 증분: 행 높이만 바뀌어도 (캐시 키에 행 높이) 다시 놓는다
    const pl2 = new PagedLayout(SETUP, mono, new LayoutCache(), tableSource({ t: [100, 50, 100, 100] }));
    pl2.update(paras);
    expect(pl2.para(1).lines.map((l) => l.page)).toEqual([0, 0, 0, 1]);
  });
});

describe('TableLayouter', () => {
  const make = (stories: Record<string, Story>) => {
    const fmt: FormatSource | null = null;
    return new TableLayouter(SETUP, mono, new LayoutCache(), (id) => (stories[id] ??= new Story('')), () => fmt);
  };

  it('row height = tallest single-row cell; merged cells add to their last row', () => {
    const s: Record<string, Story> = { a: new Story('가'), b: new Story('가\n나\n다'), c: new Story(''), d: new Story('') };
    const t = make(s);
    const grid = {
      widths: [100, 100],
      cells: [
        [{ story: 'a', span: [1, 1] as const, covered: [] }, { story: 'b', span: [1, 1] as const, covered: [] }],
        [{ story: 'c', span: [1, 1] as const, covered: [] }, { story: 'd', span: [1, 1] as const, covered: [] }],
      ],
    };
    const m = t.measure(grid, 0);
    // 셀 b: 3줄 (20씩) + 문단 간격 2번 (5씩) + 위아래 여백
    expect(m.rows).toEqual([20 * 3 + 5 * 2 + CELL_PAD * 2, 20 + CELL_PAD * 2]);
    expect(m.colX).toEqual([0, 100, 200]);
    // 병합 (2행): 덮인 셀 c의 글은 주인 셀 아래에 이어진다
    s.c!.set('라\n마\n바\n사');
    const merged = {
      widths: [100, 100],
      cells: [
        [{ story: 'a', span: [2, 1] as const, covered: ['c'] }, { story: 'b', span: [1, 1] as const, covered: [] }],
        [null, { story: 'd', span: [1, 1] as const, covered: [] }],
      ],
    };
    const m2 = t.measure(merged, 0);
    const need = 20 + (20 * 4 + 5 * 3) + CELL_PAD * 2;
    expect(m2.rows[0]! + m2.rows[1]!).toBe(need);
    expect(m2.rows[0]).toBe(m.rows[0]);
    // 원점: 주인 셀은 첫 행, 덮인 셀은 그 아래
    const lines = [
      { index: 0, start: 0, end: 1, page: 0, x: 50, y: 100, height: m2.rows[0]!, baseline: 0, adj: null, adjChars: false },
      { index: 1, start: 0, end: 1, page: 0, x: 50, y: 100 + m2.rows[0]!, height: m2.rows[1]!, baseline: 0, adj: null, adjChars: false },
    ];
    t.place(merged, m2, lines);
    const own = t.cells.get('a')!.layout;
    expect(own.para(0).lines[0]!.y).toBe(100 + CELL_PAD);
    expect(own.para(0).lines[0]!.x).toBe(50 + CELL_PAD);
    expect(t.cells.get('c')!.layout.para(0).lines[0]!.y).toBe(100 + CELL_PAD + 20);
    expect(t.cells.get('d')!.layout.para(0).lines[0]!.y).toBe(100 + m2.rows[0]! + CELL_PAD);
    expect(t.cells.get('d')!.layout.caretRect(0).x).toBe(50 + 100 + CELL_PAD);
  });
});
