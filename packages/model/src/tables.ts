/**
 * 표 레코드 (11 §2.4). 본문의 표 원소(개체 글자, kind 'table')가 표 ID로 가리킨다. 셀 내용은 스토리 `<표>|<행>|<열>`.
 *
 * - 행·열은 ID 목록이고 넣기만 한다. 지우기는 지운 표시(gone)다: 목록에서 빼면 동시 이동이 삭제를 이긴다 (스파이크 T8).
 *   넣기의 실행 취소도 지운 표시다 (넣은 ID는 목록에 남는다).
 * - 셀 스토리 ID는 (표, 행, 열)에서 정해진다 (스파이크 T9). 셀을 미리 만들지 않는다.
 * - 병합은 왼쪽 위 셀 → 덮는 행·열 ID 목록. 덮인 셀의 글은 옮기지 않는다 (스파이크: 옮기면 동시 병합에서 중복).
 */

export interface CellAttrs {
  /** 배경색 */
  fill?: string;
  valign?: 'top' | 'middle' | 'bottom';
}

export interface RowAttrs {
  /** 최소 높이 (1/1000pt) */
  minHeight?: number;
  /** 제목 행 (3단계: 쪽마다 반복) */
  header?: true;
}

export interface TableAttrs {
  align?: 'left' | 'center';
  /** 테두리 색 (없으면 기본) */
  border?: string;
}

export interface TableSpan {
  rows: string[];
  cols: string[];
}

export interface TableRecord {
  id: string;
  /** 넣은 순서가 아니라 화면 순서 (지운 행 포함) */
  rows: string[];
  cols: string[];
  gone: Record<string, true>;
  /** 열 너비 (1/1000pt) */
  widths: Record<string, number>;
  spans: Record<string, TableSpan>;
  rowAttrs: Record<string, RowAttrs>;
  cellAttrs: Record<string, CellAttrs>;
  attrs: TableAttrs;
}

/** 표 레코드의 맵 이름 (Loro 컨테이너 접미사와 같다) */
export type TableMapName = 'gone' | 'w' | 'span' | 'ra' | 'ca' | 'attrs';

/** 표 변경 기록 (동기화, 09 §4 RawChange와 같은 역할) */
export type TableChange =
  | { kind: 'tableList'; table: string; list: 'rows' | 'cols'; id: string; after: string | null }
  | { kind: 'tableMap'; table: string; map: TableMapName; key: string; value: unknown };

export const DEFAULT_COL_WIDTH = 100000;

export function cellStoryId(table: string, row: string, col: string): string {
  return `${table}|${row}|${col}`;
}

/** 셀 키 (병합·셀 속성 맵) */
export function cellKey(row: string, col: string): string {
  return `${row}|${col}`;
}

export function emptyTable(id: string): TableRecord {
  return { id, rows: [], cols: [], gone: {}, widths: {}, spans: {}, rowAttrs: {}, cellAttrs: {}, attrs: {} };
}

/** 레코드의 맵 하나 */
export function tableMap(t: TableRecord, map: TableMapName): Record<string, unknown> {
  switch (map) {
    case 'gone':
      return t.gone;
    case 'w':
      return t.widths;
    case 'span':
      return t.spans;
    case 'ra':
      return t.rowAttrs;
    case 'ca':
      return t.cellAttrs;
    case 'attrs':
      return t.attrs as Record<string, unknown>;
  }
}

/** 정규화한 셀 */
export interface GridCell {
  row: string;
  col: string;
  story: string;
  /** 병합: 행 수, 열 수 (보통 셀은 1, 1) */
  span: [number, number];
  /** 이어 그릴 덮인 셀 스토리 (비었는지는 부르는 쪽이 본다) */
  covered: string[];
}

/** 화면 격자: 보이는 행·열, 열 너비, 셀 (덮인 칸은 null) */
export interface TableGrid {
  rows: string[];
  cols: string[];
  widths: number[];
  cells: Array<Array<GridCell | null>>;
}

/**
 * 표 레코드 → 화면 격자 (11 §2.4 정규화). 병합은 덮는 행·열 목록에서 남은 것 중 가장 먼 것까지, 겹치면 행 우선 순서로 앞의 것.
 */
export function normalizeTable(t: TableRecord): TableGrid {
  const rows = t.rows.filter((r) => !t.gone[r]);
  const cols = t.cols.filter((c) => !t.gone[c]);
  const ri = new Map(rows.map((r, k) => [r, k]));
  const ci = new Map(cols.map((c, k) => [c, k]));
  const owner: Array<Array<boolean>> = rows.map(() => cols.map(() => false));
  const cells: Array<Array<GridCell | null>> = rows.map(() => cols.map(() => null));
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < cols.length; x++) {
      if (owner[y]![x]) continue;
      const r = rows[y]!;
      const c = cols[x]!;
      let h = 1;
      let w = 1;
      const sp = t.spans[cellKey(r, c)];
      if (sp) {
        const ye = Math.max(y, ...sp.rows.map((id) => ri.get(id) ?? -1));
        const xe = Math.max(x, ...sp.cols.map((id) => ci.get(id) ?? -1));
        let free = true;
        for (let yy = y; yy <= ye && free; yy++) for (let xx = x; xx <= xe && free; xx++) if (owner[yy]![xx]) free = false;
        if (free) {
          h = ye - y + 1;
          w = xe - x + 1;
        }
      }
      const covered: string[] = [];
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          owner[yy]![xx] = true;
          if (yy !== y || xx !== x) covered.push(cellStoryId(t.id, rows[yy]!, cols[xx]!));
        }
      cells[y]![x] = { row: r, col: c, story: cellStoryId(t.id, r, c), span: [h, w], covered };
    }
  return { rows, cols, widths: cols.map((c) => t.widths[c] ?? DEFAULT_COL_WIDTH), cells };
}

/** 표 ID: 루트 컨테이너 이름에 쓰므로 영숫자만 */
export function newTableId(): string {
  return `tb${Math.random().toString(36).slice(2, 10)}`;
}
