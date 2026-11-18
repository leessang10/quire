/**
 * 블록 스파이크 (11 §3, 단계 2-7) 도우미: Loro로 개체 원소와 표 레코드를 표현하고 동시 편집 뒤 화면 상태(정규화한 격자)를
 * 구한다.
 *
 * - 개체: 텍스트 'body'의 U+FFFC 글자 + 마크 `o_<키>` (expand none). 개체 글자에 붙은 마크만 읽는다.
 * - 표 레코드: 행·열 ID 목록(MovableList `<표>.rows`, `<표>.cols`), 열 너비 맵 `<표>.w`, 병합 맵 `<표>.span`. Loro 루트 컨테이너 이름에는 `/`를 쓸 수 없다
 *   (왼쪽 위 셀 키 → 덮는 행·열 ID 목록).
 * - 지운 행·열: 목록에서 빼지 않고 맵 `<표>.gone`에 표시한다. MovableList는 동시 이동 ∥ 삭제에서 이동이 이겨 지운 행이
 *   되살아난다 (스파이크 T8). 표시는 이동과 무관하게 남고, 되돌리기는 표시를 지우면 제자리로 돌아온다.
 * - 셀 스토리: 텍스트 `s:<표>|<행>|<열>`. **ID가 (표, 행, 열)에서 정해진다**: 동시에 행과 열을 넣어 생긴 교차 칸에 두 피어가
 *   처음 입력해도 같은 컨테이너라 합쳐진다 (셀 맵에 스토리 ID를 LWW로 두면 한쪽 글이 보이지 않게 된다).
 */
import { LoroDoc, type LoroText } from 'loro-crdt';

export const OBJ = '￼';
export const OBJ_KEYS = ['id', 'kind', 'w', 'h', 'alt', 'float', 'table'] as const;
export const okey = (k: string) => `o_${k}`;
export const BODY = 'body';

export function newPeer(peer: number): LoroDoc {
  const loro = new LoroDoc();
  loro.setPeerId(peer);
  const styles: Record<string, { expand: 'none' }> = {};
  for (const k of OBJ_KEYS) styles[okey(k)] = { expand: 'none' };
  loro.configTextStyle(styles);
  return loro;
}

/** 처음 상태를 가진 피어 n개 */
export function peers(n: number, init: (loro: LoroDoc) => void): LoroDoc[] {
  const first = newPeer(1);
  init(first);
  first.commit();
  const snap = first.export({ mode: 'snapshot' });
  const out = [first];
  for (let k = 1; k < n; k++) {
    const l = newPeer(k + 1);
    l.import(snap);
    out.push(l);
  }
  return out;
}

/** 모든 피어를 서로 맞춘다 */
export function syncAll(ps: LoroDoc[]): void {
  for (const p of ps) p.commit();
  for (let round = 0; round < 2; round++)
    for (const a of ps) for (const b of ps) if (a !== b) b.import(a.export({ mode: 'update', from: b.oplogVersion() }));
}

/** a의 변경을 b로 */
export function send(a: LoroDoc, b: LoroDoc): void {
  a.commit();
  b.import(a.export({ mode: 'update', from: b.oplogVersion() }));
}

// ── 개체 ────────────────────────────────────────────

export interface Obj {
  /** 본문의 UTF-16 위치 */
  at: number;
  attrs: Record<string, unknown>;
}

/** 본문의 개체들 (개체 글자에 붙은 o_ 마크만). 같은 id가 둘 이상이면 앞의 것만 (11 §3.2) */
export function objects(loro: LoroDoc): { list: Obj[]; dupes: number; leaked: number } {
  const list: Obj[] = [];
  const seen = new Set<unknown>();
  let dupes = 0;
  let leaked = 0;
  let at = 0;
  for (const op of loro.getText(BODY).toDelta()) {
    if (typeof op.insert !== 'string') continue;
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(op.attributes ?? {})) if (k.startsWith('o_') && v !== null) attrs[k.slice(2)] = v;
    for (let i = 0; i < op.insert.length; i++) {
      if (op.insert[i] !== OBJ) {
        if (Object.keys(attrs).length) leaked++;
        continue;
      }
      if (seen.has(attrs.id)) dupes++;
      else {
        seen.add(attrs.id);
        list.push({ at: at + i, attrs });
      }
    }
    at += op.insert.length;
  }
  return { list, dupes, leaked };
}

export function insertObject(loro: LoroDoc, at: number, attrs: Record<string, unknown>): void {
  const t = loro.getText(BODY);
  t.insert(at, OBJ);
  for (const [k, v] of Object.entries(attrs)) t.mark({ start: at, end: at + 1 }, okey(k), v);
}

export function setObj(loro: LoroDoc, at: number, key: string, value: unknown): void {
  loro.getText(BODY).mark({ start: at, end: at + 1 }, okey(key), value);
}

/** id로 개체 위치 */
export function findObj(loro: LoroDoc, id: string): Obj | undefined {
  return objects(loro).list.find((o) => o.attrs.id === id);
}

// ── 표 ──────────────────────────────────────────────

export type Span = { rows: string[]; cols: string[] };

export class TableRec {
  constructor(
    readonly loro: LoroDoc,
    readonly id: string,
  ) {}

  get rows() {
    return this.loro.getMovableList(`${this.id}.rows`);
  }
  get cols() {
    return this.loro.getMovableList(`${this.id}.cols`);
  }
  get widths() {
    return this.loro.getMap(`${this.id}.w`);
  }
  get spans() {
    return this.loro.getMap(`${this.id}.span`);
  }
  get gone() {
    return this.loro.getMap(`${this.id}.gone`);
  }

  static create(loro: LoroDoc, id: string, nr: number, nc: number): TableRec {
    const t = new TableRec(loro, id);
    for (let r = 0; r < nr; r++) t.rows.push(`r${r}`);
    for (let c = 0; c < nc; c++) {
      t.cols.push(`c${c}`);
      t.widths.set(`c${c}`, 100000);
    }
    return t;
  }

  /** 셀 스토리 (ID는 표·행·열에서 정해진다) */
  story(r: string, c: string): LoroText {
    return this.loro.getText(`s:${this.id}|${r}|${c}`);
  }

  /** 보이는 행 (지운 표시 제외) */
  rowIds(): string[] {
    const gone = this.gone.toJSON() as Record<string, unknown>;
    return (this.rows.toArray() as string[]).filter((r) => !gone[r]);
  }
  colIds(): string[] {
    const gone = this.gone.toJSON() as Record<string, unknown>;
    return (this.cols.toArray() as string[]).filter((c) => !gone[c]);
  }

  /** after 뒤(없으면 맨 앞)에 행 */
  addRow(after: string | null, id: string): void {
    const ids = this.rows.toArray() as string[];
    this.rows.insert(after === null ? 0 : ids.indexOf(after) + 1, id);
  }
  /** 행 지우기 = 지운 표시. 되돌리기는 restore */
  deleteRow(id: string): void {
    this.gone.set(id, true);
  }
  restore(id: string): void {
    this.gone.delete(id);
  }
  /** id를 before 앞으로 (null이면 맨 끝) */
  moveRow(id: string, before: string | null): void {
    const ids = this.rows.toArray() as string[];
    const from = ids.indexOf(id);
    if (from < 0) return;
    let to = before === null ? ids.length - 1 : ids.indexOf(before);
    if (to < 0) return;
    if (before !== null && from < to) to -= 1;
    if (from !== to) this.rows.move(from, to);
  }
  addCol(after: string | null, id: string, width = 100000): void {
    const ids = this.cols.toArray() as string[];
    this.cols.insert(after === null ? 0 : ids.indexOf(after) + 1, id);
    this.widths.set(id, width);
  }
  deleteCol(id: string): void {
    this.gone.set(id, true);
  }
  setWidth(id: string, w: number): void {
    this.widths.set(id, w);
  }

  /**
   * (r0,c0)–(r1,c1) 병합 (화면 순서 기준). move면 덮인 셀의 글을 왼쪽 위 셀로 옮긴다 (지우고 넣기). 옮기지 않으면 덮인 셀의 글은
   * 제자리에 남고 정규화가 왼쪽 위 셀 뒤에 이어 보인다. 무작위 시험: 옮기기는 동시 병합에서 글을 둘로 만든다 → 옮기지 않는다.
   */
  merge(r0: string, c0: string, r1: string, c1: string, move = false): void {
    const rows = this.rowIds();
    const cols = this.colIds();
    const rs = rows.slice(rows.indexOf(r0), rows.indexOf(r1) + 1);
    const cs = cols.slice(cols.indexOf(c0), cols.indexOf(c1) + 1);
    const anchor = this.story(r0, c0);
    if (move)
    for (const r of rs)
      for (const c of cs) {
        if (r === r0 && c === c0) continue;
        const s = this.story(r, c);
        const t = s.toString();
        if (!t) continue;
        anchor.insert(anchor.length, t);
        s.delete(0, s.length);
      }
    this.spans.set(`${r0}|${c0}`, { rows: rs, cols: cs } satisfies Span);
  }

  unmerge(r0: string, c0: string): void {
    this.spans.delete(`${r0}|${c0}`);
  }
}

export interface Grid {
  rows: string[];
  cols: string[];
  widths: number[];
  /** 셀마다: 왼쪽 위·보통 셀은 보이는 글(덮인 셀 글을 이어 붙임), 덮인 셀은 '·' */
  cells: string[][];
  /** 병합: "r|c=행수x열수" */
  spans: string[];
}

/**
 * 표 레코드 → 화면 격자 (11 §2.4 정규화). 병합은 덮는 행·열 ID 목록에서 지금 남은 것 중 가장 먼 것까지.
 * 겹치는 병합은 행 우선 순서로 앞의 것이 이긴다. 덮인 셀 중 비지 않은 것의 글은 왼쪽 위 셀 뒤에 이어 보인다.
 */
export function normalize(t: TableRec): Grid {
  const rows = t.rowIds();
  const cols = t.colIds();
  const ri = new Map(rows.map((r, k) => [r, k]));
  const ci = new Map(cols.map((c, k) => [c, k]));
  const owner: Array<Array<[number, number] | null>> = rows.map(() => cols.map(() => null));
  const spanOf = new Map<string, [number, number]>();
  const spanMap = t.spans.toJSON() as Record<string, Span>;
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < cols.length; c++) {
      if (owner[r]![c]) continue;
      const sp = spanMap[`${rows[r]}|${cols[c]}`];
      if (!sp) continue;
      const re = Math.max(r, ...sp.rows.map((x) => ri.get(x) ?? -1));
      const ce = Math.max(c, ...sp.cols.map((x) => ci.get(x) ?? -1));
      if (re === r && ce === c) continue;
      let free = true;
      for (let y = r; y <= re && free; y++) for (let x = c; x <= ce && free; x++) if (owner[y]![x]) free = false;
      if (!free) continue;
      for (let y = r; y <= re; y++) for (let x = c; x <= ce; x++) owner[y]![x] = [r, c];
      spanOf.set(`${r}|${c}`, [re - r + 1, ce - c + 1]);
    }
  const cells = rows.map((r, y) =>
    cols.map((c, x) => {
      const o = owner[y]![x];
      if (o && (o[0] !== y || o[1] !== x)) return '·';
      let text = t.story(r, c).toString();
      const sp = spanOf.get(`${y}|${x}`);
      if (sp)
        for (let yy = y; yy < y + sp[0]; yy++)
          for (let xx = x; xx < x + sp[1]; xx++) {
            if (yy === y && xx === x) continue;
            const extra = t.story(rows[yy]!, cols[xx]!).toString();
            if (extra) text += `+${extra}`;
          }
      return text;
    }),
  );
  const w = t.widths.toJSON() as Record<string, number>;
  return {
    rows,
    cols,
    widths: cols.map((c) => w[c] ?? 100000),
    cells,
    spans: [...spanOf].map(([k, [h, wd]]) => `${rows[Number(k.split('|')[0])]}|${cols[Number(k.split('|')[1])]}=${h}x${wd}`),
  };
}

/** 표에 쓰인 모든 셀 스토리의 글 (보이지 않는 것 포함): 글이 사라지지 않았는지 보기 위해 */
export function allCellText(loro: LoroDoc, tableId: string): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(loro.toJSON() as Record<string, unknown>))
    if (k.startsWith(`s:${tableId}|`) && typeof v === 'string' && v) out.push(v);
  return out.sort().join('/');
}
