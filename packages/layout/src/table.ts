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
import { LayoutCache, PagedLayout, type Frame, type FormatSource, type FrameSource, type PageBox, type PageSetup, type ParaInput, type PlacedLine } from './document';
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
  /** 잴 때 쓰는 레이아웃 (쪽 하나, 높이 무한) */
  layout: PagedLayout;
  /**
   * 그리기·편집 레이아웃 (12 §8): 셀이 한 프레임 안이면 layout (원점만 옮김), 행 조각이나 쪽 사이에 걸치면 조각마다 프레임을 둔
   * 레이아웃 (줄이 조각 경계에서 다음 조각으로 간다)
   */
  view: PagedLayout;
  viewKey: string;
  /** 마지막으로 잰 조합 문자열 (조각 레이아웃에도 넣는다) */
  preedit: { offset: number; text: string; fmt?: number } | null;
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
  /** 행 쪼개기 결과 (셀 스토리 판·폭·용량 → 조각 높이) */
  private readonly splits = new Map<string, number[] | null>();

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
      const layout = new PagedLayout(setup, this.measurer, this.cache, this.format(story));
      c = { story, width, layout, view: layout, viewKey: '', preedit: null, version: -1, height: 0 };
      this.cells.set(story, c);
      src.takeParagraphChanges(); // 새 레이아웃은 처음부터 다 놓는다
      c.layout.update(src.paragraphs(), preedit, Infinity, null);
    } else {
      const v = src.version;
      if (v !== undefined && !preedit && c.version === v) return c; // 그대로
      c.layout.update(src.paragraphs(), preedit, Infinity, src.takeParagraphChanges());
    }
    c.version = preedit || src.version === undefined ? -1 : src.version;
    c.preedit = preedit;
    c.height = c.layout.contentBottom;
    return c;
  }

  /** 셀 스토리를 주어진 프레임들에 흘린 레이아웃 */
  private framed(story: string, width: number, frames: Array<{ x: number; top: number; height: number }>, preedit: CellBox['preedit']): PagedLayout {
    const setup: PageSetup = { ...this.base, width, height: 1e9, margin: 0, gap: 0, originX: 0, originY: 0 };
    const L = new PagedLayout(setup, this.measurer, this.cache, this.format(story), new ListFrames(frames.map((f) => ({ ...f, width }))));
    L.update(this.source(story).paragraphs(), preedit, Infinity, null);
    L.finish();
    return L;
  }

  /**
   * 행 쪼개기 (12 §8, TableSpec.split): 행 r의 셀마다 내용을 조각 용량들(caps)에 줄 단위로 흘려 조각마다 쓴 높이 (셀마다 가장 큰 것).
   * 내용이 있는 셀의 첫 줄이 첫 조각에 들어가지 않거나 덮인 셀 글이 있으면 null
   */
  splitRow(grid: TableGridInput, m: TableMeasure, r: number, caps: readonly number[]): number[] | null {
    const row = grid.cells[r];
    if (!row) return null;
    // 같은 셀 내용(스토리 판)·폭·용량이면 지난 결과 (입력마다 쪽 끝 행들을 다시 흘리지 않는다)
    let key = caps.join(',');
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (!cell) continue;
      const v = this.source(cell.story).version;
      if (v === undefined) {
        key = '';
        break;
      }
      key += `|${cell.story}@${v}:${m.colX[x + cell.span[1]]! - m.colX[x]!}`;
      for (const s of cell.covered) key += `+${s}@${this.source(s).version}`;
    }
    const memo = key ? this.splits.get(key) : undefined;
    if (memo !== undefined) return memo;
    const out = this.splitRowFresh(row, m, caps);
    if (key) {
      if (this.splits.size > 4000) this.splits.clear();
      this.splits.set(key, out);
    }
    return out;
  }

  private splitRowFresh(row: ReadonlyArray<TableCellInput | null>, m: TableMeasure, caps: readonly number[]): number[] | null {
    const frames = caps.map((h, j) => ({ x: 0, top: j * 1e7, height: Math.max(1, h) }));
    const used: number[] = [];
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (!cell) continue;
      if (cell.covered.some((s) => !isEmpty(this.source(s)))) return null;
      if (isEmpty(this.source(cell.story))) continue;
      const w = Math.max(1, m.colX[x + cell.span[1]]! - m.colX[x]! - CELL_PAD * 2);
      const L = this.framed(cell.story, w, frames, null);
      for (let i = 0; i < L.paras.length; i++)
        for (const ln of L.paras[i]!.lines) {
          if (i === 0 && ln.index === 0 && ln.page !== 0) return null;
          used[ln.page] = Math.max(used[ln.page] ?? 0, ln.y + ln.height - frames[ln.page]!.top);
        }
    }
    for (let j = 0; j < used.length; j++) used[j] ??= 0;
    return used.length ? used : null;
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
    const parts = rowParts(grid.cells.length, lines);
    for (let y = 0; y < grid.cells.length; y++) {
      const row = grid.cells[y]!;
      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (!cell) continue;
        const w = Math.max(1, m.colX[x + cell.span[1]]! - m.colX[x]! - CELL_PAD * 2);
        // 빠른 길: 한 행짜리 셀이 조각 하나 (거의 모든 셀)
        const only = cell.span[0] === 1 && parts[y]!.length === 1 ? parts[y]![0]! : null;
        if (only && !cell.covered.length) {
          const own = this.existing(cell.story, w);
          own.layout.setOrigin(only.x + m.colX[x]! + CELL_PAD, only.y + CELL_PAD);
          own.view = own.layout;
          own.viewKey = '';
          continue;
        }
        const mine: PlacedLine[] = [];
        for (let k = y; k < y + cell.span[0]; k++) mine.push(...(parts[k] ?? []));
        if (!mine.length) continue;
        const ox = mine[0]!.x + m.colX[x]! + CELL_PAD;
        // 이미 잰 셀 레이아웃 (조합 문자열이 든 셀을 다시 갱신하지 않게)
        const own = this.existing(cell.story, w);
        const groups = cellGroups(mine);
        if (groups.length === 1) {
          let oy = mine[0]!.y + CELL_PAD;
          own.layout.setOrigin(ox, oy);
          own.view = own.layout;
          own.viewKey = '';
          oy += own.height;
          for (const s of cell.covered) {
            if (isEmpty(this.source(s))) continue;
            const c = this.existing(s, w);
            c.layout.setOrigin(ox, oy);
            c.view = c.layout;
            oy += c.height;
          }
          continue;
        }
        // 행 조각·쪽에 걸친 셀: 조각마다 프레임 (덮인 셀 글은 이 경우 그리지 않는다)
        const frames = groups.map((g) => ({ x: g.x + m.colX[x]! + CELL_PAD, top: g.top + CELL_PAD, height: Math.max(1, g.height - CELL_PAD * 2) }));
        const key = `${JSON.stringify(frames)}:${own.version}:${own.preedit ? JSON.stringify(own.preedit) : ''}`;
        if (own.viewKey !== key || own.view === own.layout) {
          own.view = this.framed(cell.story, w, frames, own.preedit);
          own.viewKey = key;
        }
        for (const s of cell.covered) {
          const c = this.existing(s, w);
          c.layout.setOrigin(ox, -1e9);
          c.view = c.layout;
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

/** 행마다 그 행의 조각들 (다시 그린 제목 행 빼고). 행 번호가 없는 줄(옛 모양)은 줄 = 행 */
export function rowParts(rows: number, lines: readonly PlacedLine[]): PlacedLine[][] {
  const out: PlacedLine[][] = Array.from({ length: rows }, () => []);
  lines.forEach((ln, k) => {
    if (ln.repeat) return;
    out[ln.row ?? k]?.push(ln);
  });
  return out;
}

/** 셀의 조각들을 이어진 것끼리 묶는다 (같은 쪽에서 바로 이어지면 하나): 그리기 사각형, 셀 프레임 */
export function cellGroups(parts: readonly PlacedLine[]): Array<{ page: number; x: number; top: number; height: number }> {
  const out: Array<{ page: number; x: number; top: number; height: number }> = [];
  for (const p of parts) {
    const g = out[out.length - 1];
    if (g && g.page === p.page && g.x === p.x && Math.abs(g.top + g.height - p.y) < 0.5 && !(p.part && p.part > 0)) g.height = p.y + p.height - g.top;
    else out.push({ page: p.page, x: p.x, top: p.y, height: p.height });
  }
  return out;
}

/** 주어진 사각형들을 차례로 프레임으로 (셀 조각, 12 §8). 다 쓰면 마지막 아래로 같은 크기를 잇는다 */
class ListFrames implements FrameSource {
  constructor(private readonly list: ReadonlyArray<{ x: number; top: number; width: number; height: number }>) {}

  frame(k: number): Frame {
    const n = this.list.length;
    const f = this.list[Math.min(k, n - 1)]!;
    if (k < n) return { page: k, column: 0, x: f.x, top: f.top, width: f.width, height: f.height };
    return { page: k, column: 0, x: f.x, top: f.top + (k - n + 1) * (f.height + 1), width: f.width, height: f.height };
  }

  page(p: number): PageBox {
    const f = this.frame(p);
    return { x: f.x, top: f.top, width: f.width, height: f.height };
  }

  pageAt(y: number): number {
    let k = 0;
    while (k + 1 < this.list.length && this.list[k + 1]!.top <= y) k++;
    return k;
  }

  height(pages: number): number {
    const f = this.frame(Math.max(0, pages - 1));
    return f.top + f.height;
  }
}

/** 빈 스토리 (빈 문단 하나) */
function isEmpty(s: StorySource): boolean {
  const ps = s.paragraphs();
  return ps.length === 1 && ps[0]!.text === '';
}
