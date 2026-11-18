/**
 * 여러 스토리를 가진 문서 (11 §2.5): 본문 + 이름 붙은 스토리들 (표 셀, 3단계에 머리말·각주·글상자) + 표 레코드.
 *
 * 스토리마다 지금의 Doc을 그대로 쓴다. 본문은 보초·자리표시가 있는 모양이고, 다른 스토리는 가벼운 모양이다
 * (빈 텍스트 = 빈 문단 하나, 끝 ¶는 Loro에 없는 유령 ¶: Doc.fromRaw(…, story = true)). 실행 취소 연산은 스토리를 감싼
 * { type: 'story', story, op }로 기록하고 Document가 그 스토리에 적용한다. 표 레코드 연산은 { type: 'tableMap' }.
 */
import { Doc, OBJ, type ObjAttrs, type Op, type RawChange, type SegState } from './doc';
import {
  DEFAULT_COL_WIDTH,
  cellKey,
  emptyTable,
  newTableId,
  tableMap,
  type TableChange,
  type TableMapName,
  type TableRecord,
} from './tables';

export type StoryId = string;

const EMPTY_STATE: SegState = { order: [], hidden: [], placeholder: [], used: [] };

/** 문서 변경 기록: 스토리의 원소 열 변경 (story = null이면 본문) 또는 표 레코드 변경 */
export type DocumentListener = (story: StoryId | null, c: RawChange | TableChange) => void;

export class Document {
  private readonly map = new Map<StoryId, Doc>();
  private readonly tableMap = new Map<string, TableRecord>();
  private listener: DocumentListener | null = null;
  /** 표 레코드가 바뀐 표 (편집기가 그 표 문단을 다시 조판한다) */
  private dirtyTables = new Set<string>();
  private seq = 0;

  /**
   * @param make 아직 없는 스토리를 만든다 (동기화 쪽은 Loro 상태에서). 기본은 빈 가벼운 스토리
   */
  constructor(
    readonly body: Doc,
    private readonly make: (id: StoryId) => Doc = (id) => Doc.fromRaw('', [], EMPTY_STATE, `${body.peer}`, true),
  ) {}

  /** 스토리 (없으면 만든다) */
  story(id: StoryId): Doc {
    let d = this.map.get(id);
    if (!d) {
      d = this.make(id);
      this.map.set(id, d);
      if (this.listener) {
        const fn = this.listener;
        d.observe((c) => fn(id, c));
      }
    }
    return d;
  }

  has(id: StoryId): boolean {
    return this.map.has(id);
  }

  /** 만든 스토리들의 ID */
  storyIds(): StoryId[] {
    return [...this.map.keys()];
  }

  /** 모든 스토리·표의 변경 기록 (본문은 story = null) */
  observe(fn: DocumentListener | null): void {
    this.listener = fn;
    this.body.observe(fn ? (c) => fn(null, c) : null);
    for (const [id, d] of this.map) d.observe(fn ? (c) => fn(id, c) : null);
  }

  /** 연산 적용 (실행 취소·다시 하기): story 연산은 그 스토리에, tableMap은 표 레코드에 */
  apply(op: Op): void {
    if (op.type === 'story') this.story(op.story).apply(op.op);
    else if (op.type === 'tableMap') this.writeTableMap(op.table, op.map, op.key, op.after);
    else this.body.apply(op);
  }

  /** 스토리 연산을 실행 취소 기록용으로 감싼다 */
  static tag(story: StoryId, ops: Op[]): Op[] {
    return ops.map((op) => ({ type: 'story', story, op }));
  }

  // ── 표 (11 §2.4) ─────────────────────────────────────

  table(id: string): TableRecord | undefined {
    return this.tableMap.get(id);
  }

  tableIds(): string[] {
    return [...this.tableMap.keys()];
  }

  /** 레코드가 바뀐 표들 (가져가면 비운다) */
  takeDirtyTables(): string[] {
    const out = [...this.dirtyTables];
    this.dirtyTables.clear();
    return out;
  }

  /** 행·열 ID (피어 이름 + 차례: 피어마다 겹치지 않는다) */
  private newId(prefix: string): string {
    return `${prefix}${this.body.peer.replace(/[^0-9a-z]/gi, '')}x${(++this.seq).toString(36)}`;
  }

  private emit(c: TableChange): void {
    this.listener?.(null, c);
  }

  /** 새 표 레코드 (행 rows × 열 cols, 열 너비 width). 실행 취소 기록은 없다: 표 원소를 지우면 표가 사라진다 */
  createTable(rows: number, cols: number, width = DEFAULT_COL_WIDTH): string {
    const id = newTableId();
    const t = emptyTable(id);
    this.tableMap.set(id, t);
    for (let k = 0; k < rows; k++) this.listInsert(t, 'rows', this.newId('r'), t.rows.at(-1) ?? null);
    for (let k = 0; k < cols; k++) {
      const c = this.newId('c');
      this.listInsert(t, 'cols', c, t.cols.at(-1) ?? null);
      this.writeTableMap(id, 'w', c, width);
    }
    return id;
  }

  /**
   * 본문 offset(캐럿)에 표 문단 `[표][¶]`을 넣는다 (표는 문단 하나를 혼자 차지한다). Word·Google Docs처럼 캐럿 자리에:
   * 문단 첫머리면 그 문단 앞, 아니면 캐럿에서 문단을 나누고 그 사이 (문단 끝이면 표 뒤에 빈 문단). 표 문단은 문단 속성을 갖지 않는다
   * (목록 항목에서 넣어도 번호가 붙지 않는다). 실행 취소 연산을 돌려준다.
   * width: 본문 폭 (1/1000pt), 열마다 똑같이 나눈다
   */
  insertTable(offset: number, rows: number, cols: number, width: number): { id: string; ops: Op[] } {
    const id = this.createTable(rows, cols, Math.floor(width / cols));
    const body = this.body;
    const p = body.paragraphs()[body.paragraphIndexAt(offset)]!;
    const ops: Op[] = [];
    let at = p.start;
    if (offset > p.start) {
      // 캐럿에서 나눈다 (Enter와 같다: 뒤 문단도 같은 문단 속성)
      ops.push({ type: 'insert', ids: body.insertText(offset, '\n') });
      at = offset + 1;
    }
    const attrs: ObjAttrs = { id, kind: 'table', table: id };
    ops.push(...body.insertObject(at, attrs));
    ops.push({ type: 'insert', ids: body.insertText(at + 1, '\n') });
    const ti = body.paragraphIndexAt(at);
    for (const key of Object.keys(body.paraAttrs(ti)) as Array<keyof ReturnType<Doc['paraAttrs']>>) ops.push(...body.setParaAttr(ti, key, undefined));
    return { id, ops };
  }

  private listInsert(t: TableRecord, list: 'rows' | 'cols', id: string, after: string | null): void {
    const arr = t[list];
    arr.splice(after === null ? 0 : arr.indexOf(after) + 1, 0, id);
    this.dirtyTables.add(t.id);
    this.emit({ kind: 'tableList', table: t.id, list, id, after });
  }

  private writeTableMap(table: string, map: TableMapName, key: string, value: unknown): void {
    const t = this.tableMap.get(table);
    if (!t) return;
    const m = tableMap(t, map);
    if (value === undefined || value === null) delete m[key];
    else m[key] = value;
    this.dirtyTables.add(table);
    this.emit({ kind: 'tableMap', table, map, key, value: value ?? undefined });
  }

  private setMap(table: string, map: TableMapName, key: string, value: unknown): Op[] {
    const t = this.tableMap.get(table);
    if (!t) return [];
    const before = tableMap(t, map)[key];
    if (JSON.stringify(before) === JSON.stringify(value)) return [];
    this.writeTableMap(table, map, key, value);
    return [{ type: 'tableMap', table, map, key, before, after: value }];
  }

  /** after 뒤(없으면 맨 앞)에 행 넣기. 실행 취소는 지운 표시 */
  addRow(table: string, after: string | null): { id: string; ops: Op[] } {
    const t = this.tableMap.get(table)!;
    const id = this.newId('r');
    this.listInsert(t, 'rows', id, after);
    return { id, ops: [{ type: 'tableMap', table, map: 'gone', key: id, before: true, after: undefined }] };
  }

  addCol(table: string, after: string | null, width = DEFAULT_COL_WIDTH): { id: string; ops: Op[] } {
    const t = this.tableMap.get(table)!;
    const id = this.newId('c');
    this.listInsert(t, 'cols', id, after);
    this.writeTableMap(table, 'w', id, width);
    return { id, ops: [{ type: 'tableMap', table, map: 'gone', key: id, before: true, after: undefined }] };
  }

  /** 행·열 지우기 = 지운 표시 (셀 스토리는 남는다: 되돌리면 그사이 입력까지) */
  deleteRowOrCol(table: string, id: string): Op[] {
    return this.setMap(table, 'gone', id, true);
  }

  setColWidth(table: string, col: string, width: number): Op[] {
    return this.setMap(table, 'w', col, Math.max(1000, Math.round(width)));
  }

  /** 병합: (r0, c0)가 왼쪽 위, 덮는 행·열 ID 목록. 덮인 셀의 글은 옮기지 않는다 */
  mergeCells(table: string, r0: string, c0: string, rows: string[], cols: string[]): Op[] {
    return this.setMap(table, 'span', cellKey(r0, c0), { rows, cols });
  }

  unmergeCell(table: string, r0: string, c0: string): Op[] {
    return this.setMap(table, 'span', cellKey(r0, c0), undefined);
  }

  setCellAttrs(table: string, row: string, col: string, attrs: Record<string, unknown> | undefined): Op[] {
    return this.setMap(table, 'ca', cellKey(row, col), attrs);
  }

  setRowAttrs(table: string, row: string, attrs: Record<string, unknown> | undefined): Op[] {
    return this.setMap(table, 'ra', row, attrs);
  }

  /** 원격: 표 레코드를 통째로 (기록 없음) */
  applyRemoteTable(record: TableRecord): void {
    const cur = this.tableMap.get(record.id);
    if (cur && JSON.stringify(cur) === JSON.stringify(record)) return;
    this.tableMap.set(record.id, structuredClone(record));
    this.dirtyTables.add(record.id);
  }

  /** 시험·저장용: 표 레코드를 그대로 넣는다 (기록 없음) */
  putTable(record: TableRecord): void {
    this.tableMap.set(record.id, structuredClone(record));
    this.dirtyTables.add(record.id);
  }
}

export { OBJ };
