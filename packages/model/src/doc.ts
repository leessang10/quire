/**
 * 0단계 문서 모델: 단일 스토리, 평평한 원소 열 + 문단 표식(¶).
 * 설계: docs/design/01-document-model.md
 *
 * - 원소 1개 = 유니코드 코드포인트 1개 또는 문단 표식 1개
 * - 삭제는 묘비(tombstone) 처리 → ID 기반 위치가 삭제 후에도 해석됨
 * - 스토리는 항상 살아 있는 ¶로 끝난다
 *
 * 0단계 한계: 오프셋 ↔ 배열 인덱스 변환이 O(n) 선형 탐색. (06 V5 성능 검증 대상)
 */

export type ElementId = string;
export type Side = 'before' | 'after';

/** 원소 사이의 틈을 원소 ID 기준으로 가리키는 안정적 위치 (01 §3.2) */
export interface Position {
  anchor: ElementId;
  side: Side;
}

/** 문서 텍스트에서 문단 표식을 나타내는 문자 */
export const PARA = '\n';

interface Elem {
  id: ElementId;
  /** 코드포인트 1개. 문단 표식이면 PARA */
  ch: string;
  deleted: boolean;
}

export interface ParagraphInfo {
  /** 문단 ID = 문단을 끝내는 ¶ 원소의 ID */
  id: ElementId;
  /** 문단 첫 원소의 오프셋 */
  start: number;
  /** 문단 ¶의 오프셋 (문단 텍스트는 [start, end)) */
  end: number;
  text: string;
}

export class Doc {
  private elems: Elem[] = [];
  private byId = new Map<ElementId, Elem>();
  private counter = 0;
  private visible = 0;
  private _version = 0;
  private paraCache: { version: number; paras: ParagraphInfo[] } | null = null;

  constructor(readonly peer = 'local') {}

  static fromText(text: string, peer?: string): Doc {
    const doc = new Doc(peer);
    const cps = Array.from(normalizeNewlines(text));
    for (const ch of cps) doc.pushElem(ch);
    doc.pushElem(PARA); // 스토리는 항상 ¶로 끝난다
    doc._version++;
    return doc;
  }

  /** 변경될 때마다 증가 */
  get version(): number {
    return this._version;
  }

  /** 살아 있는 원소 수 (마지막 ¶ 포함) */
  get length(): number {
    return this.visible;
  }

  /** 커서가 놓일 수 있는 최대 오프셋 (마지막 ¶ 앞) */
  get maxCaret(): number {
    return this.visible - 1;
  }

  text(): string {
    let s = '';
    for (const e of this.elems) if (!e.deleted) s += e.ch;
    return s;
  }

  slice(from: number, to: number): string {
    let s = '';
    let off = 0;
    for (const e of this.elems) {
      if (e.deleted) continue;
      if (off >= to) break;
      if (off >= from) s += e.ch;
      off++;
    }
    return s;
  }

  paragraphs(): ParagraphInfo[] {
    if (this.paraCache && this.paraCache.version === this._version) return this.paraCache.paras;
    const paras: ParagraphInfo[] = [];
    let off = 0;
    let start = 0;
    let buf = '';
    for (const e of this.elems) {
      if (e.deleted) continue;
      if (e.ch === PARA) {
        paras.push({ id: e.id, start, end: off, text: buf });
        start = off + 1;
        buf = '';
      } else {
        buf += e.ch;
      }
      off++;
    }
    this.paraCache = { version: this._version, paras };
    return paras;
  }

  /**
   * offset 위치(틈)에 텍스트를 삽입한다. '\n'은 문단 표식이 된다.
   * @returns 새로 만든 원소 ID 목록 (실행 취소용)
   */
  insertText(offset: number, text: string): ElementId[] {
    const cps = Array.from(normalizeNewlines(text));
    if (cps.length === 0) return [];
    offset = clamp(offset, 0, this.maxCaret);
    const index = this.indexOfVisible(offset);
    const created: Elem[] = cps.map((ch) => this.makeElem(ch));
    this.elems.splice(index, 0, ...created);
    this.visible += created.length;
    this._version++;
    return created.map((e) => e.id);
  }

  /**
   * [from, to) 구간을 삭제(묘비 처리)한다. 마지막 ¶는 지울 수 없다.
   * @returns 삭제된 원소 ID 목록 (실행 취소용)
   */
  deleteRange(from: number, to: number): ElementId[] {
    from = clamp(from, 0, this.maxCaret);
    to = clamp(to, from, this.maxCaret);
    if (from === to) return [];
    const ids: ElementId[] = [];
    let off = 0;
    for (const e of this.elems) {
      if (e.deleted) continue;
      if (off >= to) break;
      if (off >= from) {
        e.deleted = true;
        ids.push(e.id);
      }
      off++;
    }
    this.visible -= ids.length;
    this._version++;
    return ids;
  }

  /** 묘비가 된 원소들을 되살린다 (실행 취소·다시 실행) */
  revive(ids: ElementId[]): void {
    this.setDeleted(ids, false);
  }

  /** 원소들을 묘비로 만든다 (실행 취소·다시 실행) */
  hide(ids: ElementId[]): void {
    this.setDeleted(ids, true);
  }

  /** 오프셋 → 안정적 위치 */
  positionAt(offset: number): Position {
    offset = clamp(offset, 0, this.visible);
    if (offset < this.visible) {
      const e = this.elems[this.indexOfVisible(offset)]!;
      return { anchor: e.id, side: 'before' };
    }
    const last = this.lastVisible();
    return { anchor: last.id, side: 'after' };
  }

  /** 안정적 위치 → 현재 오프셋. 기준 원소가 삭제되었으면 그 자리의 오프셋 */
  resolve(pos: Position): number {
    const target = this.byId.get(pos.anchor);
    if (!target) throw new Error(`unknown element ${pos.anchor}`);
    let off = 0;
    for (const e of this.elems) {
      if (e === target) {
        return !e.deleted && pos.side === 'after' ? off + 1 : off;
      }
      if (!e.deleted) off++;
    }
    throw new Error('unreachable');
  }

  // ── 내부 ──────────────────────────────────────────────

  private makeElem(ch: string): Elem {
    const e: Elem = { id: `${this.peer}:${this.counter++}`, ch, deleted: false };
    this.byId.set(e.id, e);
    return e;
  }

  private pushElem(ch: string): void {
    this.elems.push(this.makeElem(ch));
    this.visible++;
  }

  /** 살아 있는 offset번째 원소의 배열 인덱스. offset === length면 배열 끝 */
  private indexOfVisible(offset: number): number {
    let off = 0;
    for (let i = 0; i < this.elems.length; i++) {
      if (this.elems[i]!.deleted) continue;
      if (off === offset) return i;
      off++;
    }
    return this.elems.length;
  }

  private lastVisible(): Elem {
    for (let i = this.elems.length - 1; i >= 0; i--) {
      if (!this.elems[i]!.deleted) return this.elems[i]!;
    }
    throw new Error('document has no visible elements');
  }

  private setDeleted(ids: ElementId[], deleted: boolean): void {
    let changed = 0;
    for (const id of ids) {
      const e = this.byId.get(id);
      if (!e || e.deleted === deleted) continue;
      e.deleted = deleted;
      changed++;
    }
    if (changed === 0) return;
    this.visible += deleted ? -changed : changed;
    this._version++;
  }
}

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
