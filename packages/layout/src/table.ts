/**
 * 표 조판 (11 §4.3): 셀마다 쪽 하나(높이 무한)로 조판한 PagedLayout, 행 높이, 셀 자리.
 *
 * - 셀 내용은 스토리다 (모델의 가벼운 스토리). 셀 레이아웃은 셀 안쪽 폭으로 만들고, 폭이 바뀌면 새로 만든다.
 * - 행 높이 = 그 행에서 시작하는 한 행짜리 셀의 (내용 + 안쪽 여백) 가운데 가장 큰 것, 최소 높이 이상. 여러 행을 덮는 병합 셀은
 *   덮는 행 높이 합이 모자라면 마지막 행에 더한다.
 * - 병합으로 덮인 셀의 글은 옮기지 않으므로 (스파이크 2-7) 주인 셀 내용 아래에 이어 그린다 (비지 않은 것만).
 * - 셀 자리(원점)는 본문 레이아웃이 표 문단의 행을 놓은 뒤 place()로 정한다. 셀 레이아웃의 좌표는 본문과 같은 문서 좌표다.
 *
 * 모델에 의존하지 않도록 격자는 구조 타입으로 받는다 (편집기가 normalizeTable 결과를 px로 바꿔 준다).
 */
import { LayoutCache, PagedLayout, type FormatSource, type PageSetup, type ParaInput, type PlacedLine } from './document';
import type { Measurer } from './paragraph';

/** 셀 안쪽 여백 (px) */
export const CELL_PAD = 5;

export interface TableCellInput {
  /** 셀 스토리 ID */
  story: string;
  /** 병합: 행 수, 열 수 */
  span: readonly [number, number];
  /** 이어 그릴 덮인 셀 스토리 */
  covered: readonly string[];
}

export interface TableGridInput {
  /** 열 너비 (px) */
  widths: readonly number[];
  /** 행마다 최소 높이 (px, 없으면 0) */
  minHeights?: readonly number[];
  /** [행][열] 셀 (덮인 칸은 null) */
  cells: ReadonlyArray<ReadonlyArray<TableCellInput | null>>;
}

/** 셀 스토리 (모델의 Doc이 맞춘다) */
export interface StorySource {
  paragraphs(): readonly ParaInput[];
  takeParagraphChanges(): { from: number; suffix: number };
  /** 내용이 바뀔 때마다 커지는 판 (있으면 바뀌지 않은 셀은 다시 보지 않는다: 행 1,000개 표의 셀 입력) */
  readonly version?: number;
}

export interface CellBox {
  story: string;
  layout: PagedLayout;
  /** 안쪽 폭 */
  width: number;
  /** 마지막으로 갱신한 스토리 판과 그때의 내용 높이 (조합 문자열이 있었으면 판 -1) */
  version: number;
  height: number;
}

/** 조판 결과: 행 높이, 열 x (표 왼쪽 기준), 표 폭 */
export interface TableMeasure {
  rows: number[];
  colX: number[];
  width: number;
}

export class TableLayouter {
  /** 스토리 ID → 셀 레이아웃 */
  readonly cells = new Map<string, CellBox>();

  constructor(
    private readonly base: PageSetup,
    private readonly measurer: Measurer,
    private readonly cache: LayoutCache,
    private readonly source: (story: string) => StorySource,
    private readonly format: (story: string) => FormatSource | null,
  ) {}

  /** 셀 레이아웃 (없거나 폭이 바뀌었으면 만든다). 내용 변경을 반영한다 */
  cell(story: string, width: number, preedit: { offset: number; text: string; fmt?: number } | null = null): CellBox {
    let c = this.cells.get(story);
    const src = this.source(story);
    if (!c || c.width !== width) {
      const setup: PageSetup = { ...this.base, width, height: 1e9, margin: 0, gap: 0, originX: 0, originY: 0 };
      c = { story, width, layout: new PagedLayout(setup, this.measurer, this.cache, this.format(story)), version: -1, height: 0 };
      this.cells.set(story, c);
      src.takeParagraphChanges(); // 새 레이아웃은 처음부터 다 놓는다
      c.layout.update(src.paragraphs(), preedit, Infinity, null);
    } else {
      const v = src.version;
      if (v !== undefined && !preedit && c.version === v) return c; // 그대로
      c.layout.update(src.paragraphs(), preedit, Infinity, src.takeParagraphChanges());
    }
    c.version = preedit || src.version === undefined ? -1 : src.version;
    c.height = c.layout.contentBottom;
    return c;
  }

  /** 셀 내용 높이 (덮인 셀 포함) */
  private contentHeight(cell: TableCellInput, width: number, pre: PreeditAt | null): number {
    let h = this.cell(cell.story, width, pre && pre.story === cell.story ? pre.preedit : null).height;
    for (const s of cell.covered) {
      const c = this.cell(s, width);
      if (!isEmpty(this.source(s))) h += c.height;
    }
    return h;
  }

  /** 행 높이·열 자리를 구한다 (셀 레이아웃을 갱신한다) */
  measure(grid: TableGridInput, minRow: number, pre: PreeditAt | null = null): TableMeasure {
    const colX = [0];
    for (const w of grid.widths) colX.push(colX[colX.length - 1]! + w);
    const nr = grid.cells.length;
    const rows = Array.from({ length: nr }, (_, y) => Math.max(minRow, grid.minHeights?.[y] ?? 0));
    const tall: Array<[number, number, number]> = [];
    for (let y = 0; y < nr; y++) {
      const row = grid.cells[y]!;
      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (!cell) continue;
        const w = colX[x + cell.span[1]]! - colX[x]! - CELL_PAD * 2;
        const h = this.contentHeight(cell, Math.max(1, w), pre) + CELL_PAD * 2;
        if (cell.span[0] === 1) rows[y] = Math.max(rows[y]!, h);
        else tall.push([y, cell.span[0], h]);
      }
    }
    for (const [y, n, h] of tall) {
      let sum = 0;
      for (let k = y; k < y + n; k++) sum += rows[k]!;
      if (sum < h) rows[y + n - 1]! += h - sum;
    }
    return { rows, colX, width: colX[colX.length - 1]! };
  }

  /**
   * 셀 원점을 정한다: lines는 본문 레이아웃이 놓은 표 문단의 행 (PlacedPara.lines). 여러 행 병합 셀은 첫 행 자리에 놓는다
   * (쪽을 넘으면 넘쳐 그린다)
   */
  place(grid: TableGridInput, m: TableMeasure, lines: readonly PlacedLine[]): void {
    for (let y = 0; y < grid.cells.length; y++) {
      const ln = lines[y];
      if (!ln) continue;
      const row = grid.cells[y]!;
      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (!cell) continue;
        const w = Math.max(1, m.colX[x + cell.span[1]]! - m.colX[x]! - CELL_PAD * 2);
        const ox = ln.x + m.colX[x]! + CELL_PAD;
        let oy = ln.y + CELL_PAD;
        // 이미 잰 셀 레이아웃 (조합 문자열이 든 셀을 다시 갱신하지 않게)
        const own = this.existing(cell.story, w);
        own.layout.setOrigin(ox, oy);
        oy += own.height;
        for (const s of cell.covered) {
          if (isEmpty(this.source(s))) continue;
          const c = this.existing(s, w);
          c.layout.setOrigin(ox, oy);
          oy += c.height;
        }
      }
    }
  }

  private existing(story: string, width: number): CellBox {
    const c = this.cells.get(story);
    return c && c.width === width ? c : this.cell(story, width);
  }

  /** 더 쓰지 않는 셀 레이아웃을 버린다 (keep에 없는 스토리) */
  prune(keep: Set<string>): void {
    for (const id of this.cells.keys()) if (!keep.has(id)) this.cells.delete(id);
  }
}

export interface PreeditAt {
  story: string;
  preedit: { offset: number; text: string; fmt?: number };
}

/** 빈 스토리 (빈 문단 하나) */
function isEmpty(s: StorySource): boolean {
  const ps = s.paragraphs();
  return ps.length === 1 && ps[0]!.text === '';
}
