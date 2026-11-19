/**
 * 여러 스토리를 가진 문서 (11 §2.5): 본문 + 이름 붙은 스토리들 (표 셀, 3단계에 머리말·각주·글상자) + 표 레코드.
 *
 * 스토리마다 지금의 Doc을 그대로 쓴다. 본문은 보초·자리표시가 있는 모양이고, 다른 스토리는 가벼운 모양이다
 * (빈 텍스트 = 빈 문단 하나, 끝 ¶는 Loro에 없는 유령 ¶: Doc.fromRaw(…, story = true)). 실행 취소 연산은 스토리를 감싼
 * { type: 'story', story, op }로 기록하고 Document가 그 스토리에 적용한다. 표 레코드 연산은 { type: 'tableMap' }.
 */
import { Doc, OBJ, type ElementId, type ObjAttrs, type Op, type Position, type RawChange, type SegState } from './doc';
import type { Annotation, AnnotationChange, AnnotationRange } from './annotations';
import { threadsFromKeys, type CommentAuthor, type CommentChange, type CommentThread } from './comments';
import { newAnnotationId } from './annotations';
import { subtractIntervals, unionIntervals, type Suggester, type SuggestionData, type SuggestionKind } from './suggestions';
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
export type DocumentListener = (story: StoryId | null, c: RawChange | TableChange | AnnotationChange | CommentChange) => void;

export class Document {
  private readonly map = new Map<StoryId, Doc>();
  private readonly tableMap = new Map<string, TableRecord>();
  /** 주석 (14 §2) */
  private readonly annMap = new Map<string, Annotation>();
  /** 주석이 바뀔 때마다 (범위 목록 캐시) */
  private annVersion = 0;
  private annCache: { key: string; list: AnnotationRange[] } | null = null;
  /** 댓글 키 표 (14 §3) */
  private readonly cmtMap = new Map<string, unknown>();
  private cmtCache: CommentThread[] | null = null;
  private cmtIndex: Map<string, CommentThread> | null = null;
  private cmtIndexOf: readonly CommentThread[] | null = null;
  /** 제안 모드 (14 §4): 켠 편집기의 작성자 */
  private suggester: Suggester | null = null;
  /** 제안 삭제가 돌려준 연산 (기록할 때 삽입으로 보지 않는다: 꼬리 옮기기의 다시 넣기) */
  private suggestSkip = new WeakSet<Op>();
  /** 마지막 제안 삭제 뒤 원래 범위의 끝 (앞으로 지우기의 캐럿) */
  suggestDeleteEnd = 0;
  /** 댓글이 바뀔 때마다 (창 다시 그리기) */
  commentVersion = 0;
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
  ) {
    this.hook(body, null);
  }

  /** 주석 위치를 따라가게 Doc 고리를 건다 (꼬리 옮기기, 되살리기) */
  private hook(d: Doc, story: StoryId | null): void {
    d.onRemap = (pairs) => this.remapAnnotations(story, pairs);
    d.onRevive = (ids) => this.reviveAnnotations(story, ids);
    d.onDelete = (ids) => this.unanchorDeleted(story, ids);
    d.deleteHook = this.suggester ? (from, to) => this.suggestDelete(story, d, from, to) : null;
  }

  // ── 제안 모드 (14 §4) ─────────────────────────────────

  /** 제안 모드 켜기·끄기 (편집기 상태: 이 문서를 편집하는 쪽의 작성자) */
  setSuggesting(s: Suggester | null): void {
    this.suggester = s;
    this.hook(this.body, null);
    for (const [id, d] of this.map) this.hook(d, id);
  }

  get suggesting(): Suggester | null {
    return this.suggester;
  }

  private now(): number {
    return this.suggester?.now?.() ?? Date.now();
  }

  /** 스토리의 제안 범위들 (고아 빼고) */
  private suggestionRanges(story: StoryId | null, kind: SuggestionKind): AnnotationRange[] {
    const s = story ?? '';
    return this.annotationRanges().filter((r) => r.type === 'suggestion' && (r.story ?? '') === s && !r.orphan && r.to > r.from && r.data.kind === kind);
  }

  private mine(r: AnnotationRange): boolean {
    return (r.data.author as CommentAuthor | undefined)?.id === this.suggester?.author.id;
  }

  /** 내 삽입 제안 구간들 */
  private ownInserts(story: StoryId | null): Array<[number, number]> {
    return this.suggestionRanges(story, 'insert').filter((r) => this.mine(r)).map((r) => [r.from, r.to] as [number, number]);
  }

  /**
   * 삽입·삭제 제안 표시: 붙어 있거나 겹치는 내 같은 종류 제안이 있으면 넓힌다 (여럿이면 하나로 합친다)
   */
  private markRange(story: StoryId | null, kind: 'insert' | 'delete', a: number, b: number): Op[] {
    const near = this.suggestionRanges(story, kind).filter((r) => this.mine(r) && r.from <= b && r.to >= a);
    if (!near.length) {
      const data: SuggestionData = { kind, author: this.suggester!.author, time: this.now() };
      return this.annotate({ id: newAnnotationId(), type: 'suggestion', story, from: a, to: b, data: data as unknown as Record<string, unknown> });
    }
    const lo = Math.min(a, ...near.map((r) => r.from));
    const hi = Math.max(b, ...near.map((r) => r.to));
    const [keep, ...rest] = near.sort((x, y) => (x.id < y.id ? -1 : 1));
    const cur = this.annMap.get(keep!.id)!;
    const ops = this.setAnnotation(keep!.id, { ...cur, ...this.rangePositions(story, lo, hi) });
    for (const r of rest) ops.push(...this.unannotate(r.id));
    return ops;
  }

  /**
   * 제안 모드의 지우기 (Doc.deleteRange 대신): 내 삽입 제안 부분은 실제로 지우고, 나머지는 삭제 제안으로 표시한다 (이미 삭제 제안인
   * 글자는 그대로). suggestDeleteEnd = 원래 범위 끝이 지금 있는 자리 (앞으로 지우기의 캐럿)
   */
  private suggestDelete(story: StoryId | null, d: Doc, from: number, to: number): Op[] {
    const real = this.ownInserts(story)
      .map(([x, y]) => [Math.max(x, from), Math.min(y, to)] as [number, number])
      .filter(([x, y]) => y > x);
    const dels = this.suggestionRanges(story, 'delete').map((r) => [r.from, r.to] as [number, number]);
    const ops: Op[] = [];
    for (const [a, b] of subtractIntervals(from, to, real))
      for (const [x, y] of subtractIntervals(a, b, dels)) ops.push(...this.markRange(story, 'delete', x, y));
    // 실제로 지우기: 뒤에서부터 (앞 구간의 오프셋이 그대로)
    const hook = d.deleteHook;
    d.deleteHook = null;
    let removed = 0;
    try {
      for (const [a, b] of unionIntervals(real).reverse()) {
        ops.push(...d.deleteRange(a, b));
        removed += b - a;
      }
    } finally {
      d.deleteHook = hook;
    }
    for (const op of ops) this.suggestSkip.add(op);
    this.suggestDeleteEnd = to - removed;
    return ops;
  }

  /**
   * 편집 명령이 만든 연산(스토리 Doc d의 것)을 보고 삽입·서식·문단 제안을 더한다 (제안 모드일 때 편집기가 부른다). 돌려준 연산은 같은
   * 트랜잭션에 넣는다
   */
  recordSuggestions(story: StoryId | null, d: Doc, ops: readonly Op[]): Op[] {
    if (!this.suggester) return [];
    const out: Op[] = [];
    const id = (ctr: number) => `${d.peer}:${ctr}`;
    // 삽입: 넣은 원소의 연속 구간마다
    for (const op of ops) {
      if (op.type !== 'insert' || this.suggestSkip.has(op)) continue;
      const offs = op.ids.filter((x) => d.isAlive(x)).map((x) => d.resolve({ anchor: x, side: 'before' })).sort((x, y) => x - y);
      for (const [a, b] of runsOf(offs)) {
        // 삭제 제안 안에 넣었으면 그 자리에서 나눈다
        for (const r of this.suggestionRanges(story, 'delete')) {
          if (!(r.from < a && r.to > b)) continue;
          const cur = this.annMap.get(r.id)!;
          out.push(...this.setAnnotation(r.id, { ...cur, ...this.rangePositions(story, r.from, a) }));
          out.push(...this.annotate({ id: newAnnotationId(), type: 'suggestion', story, from: b, to: r.to, data: structuredClone(cur.data) }));
        }
        if (this.ownInserts(story).some(([x, y]) => x <= a && y >= b)) continue;
        out.push(...this.markRange(story, 'insert', a, b));
      }
    }
    // 서식: 이전 값이 같은 연속 구간마다
    for (const op of ops) {
      if (op.type !== 'format' || this.suggestSkip.has(op)) continue;
      const items: Array<[number, unknown]> = [];
      for (let i = 0; i < op.ctrs.length; i++) {
        const x = id(op.ctrs[i]!);
        if (!d.isAlive(x)) continue;
        items.push([d.resolve({ anchor: x, side: 'before' }), d.markSet(op.before[i]!)[op.key] ?? null]);
      }
      items.sort((p, q) => p[0] - q[0]);
      for (const [a, b, v] of valueRuns(items)) out.push(...this.markBefore(story, 'format', a, b, op.key, v));
    }
    // 문단 속성: ¶ 하나
    for (const op of ops) {
      if (op.type !== 'para' || this.suggestSkip.has(op)) continue;
      const x = id(op.ctr);
      if (!d.isAlive(x)) continue;
      const p = d.resolve({ anchor: x, side: 'before' });
      out.push(...this.markBefore(story, 'para', p, p + 1, op.key, op.before ?? null));
    }
    return out;
  }

  /** 서식·문단 제안: 내 삽입 제안 안은 빼고, 그 키의 이전 값이 이미 있는 곳도 뺀다 (처음 값을 둔다). 같은 구간의 내 제안이면 키를 더한다 */
  private markBefore(story: StoryId | null, kind: 'format' | 'para', a: number, b: number, key: string, value: unknown): Op[] {
    const ops: Op[] = [];
    const same = this.suggestionRanges(story, kind);
    const has = same.filter((r) => (r.data.before as Record<string, unknown> | undefined)?.[key] !== undefined).map((r) => [r.from, r.to] as [number, number]);
    for (const [x0, y0] of subtractIntervals(a, b, this.ownInserts(story)))
      for (const [x, y] of subtractIntervals(x0, y0, has)) {
        const exact = same.find((r) => r.from === x && r.to === y && this.mine(r));
        if (exact) {
          const cur = this.annMap.get(exact.id)!;
          ops.push(...this.setAnnotation(exact.id, { ...cur, data: { ...cur.data, before: { ...(cur.data.before as Record<string, unknown>), [key]: value } } }));
        } else {
          const data: SuggestionData = { kind, author: this.suggester!.author, time: this.now(), before: { [key]: value } };
          ops.push(...this.annotate({ id: newAnnotationId(), type: 'suggestion', story, from: x, to: y, data: data as unknown as Record<string, unknown> }));
        }
      }
    return ops;
  }

  /** 지운 원소에 걸린 주석 위치를 살아 있는 옆 원소로 (실행 취소 연산: 되돌리면 위치도 돌아온다). 범위 안이 다 지워졌으면 고아 */
  private unanchorDeleted(story: StoryId | null, ids: readonly ElementId[]): Op[] {
    if (this.annMap.size === 0) return [];
    const set = new Set(ids);
    const ops: Op[] = [];
    for (const a of [...this.annMap.values()]) {
      if (a.story !== story) continue;
      if (!(a.start && set.has(a.start.anchor)) && !(a.end && set.has(a.end.anchor))) continue;
      ops.push(...this.setAnnotation(a.id, this.reanchored(a)));
    }
    return ops;
  }

  /** 지금 풀리는 범위를 살아 있는 원소로 다시 건 주석 (고아면 시작만) */
  private reanchored(a: Annotation): Annotation {
    const r = this.resolveRange(a);
    if (!r) return a;
    const d = this.docOf(a.story);
    if (r.orphan) return { ...a, start: d.positionAt(r.from), end: null };
    return { ...a, ...this.rangePositions(a.story, r.from, r.to) };
  }

  /**
   * 주석 위치를 지금 범위의 살아 있는 원소로 다시 걸고 동기화에 다시 쓴다 (기록 없음). 원격에서 받은 커서가 지운 글자에 남아 있을 때:
   * 모든 피어가 같은 살아 있는 글자로 옮기므로 같은 값이 된다
   */
  rewriteRange(id: string): void {
    const a = this.annMap.get(id);
    if (!a) return;
    const next = this.reanchored(a);
    this.annMap.set(id, next);
    this.annVersion++;
    this.annCache = null;
    const r = this.resolveRange(next);
    this.listener?.(null, { kind: 'annRange', id, story: next.story, start: r && !r.orphan ? r.from : null, end: r && !r.orphan ? r.to : null });
  }

  /** 꼬리 옮기기로 원소가 새 ID를 받았다: 그 원소에 걸린 주석 위치를 새 원소로 (실행 취소 연산) */
  private remapAnnotations(story: StoryId | null, pairs: Array<[ElementId, ElementId]>): Op[] {
    if (this.annMap.size === 0) return [];
    const map = new Map(pairs);
    const ops: Op[] = [];
    for (const a of [...this.annMap.values()]) {
      if (a.story !== story) continue;
      const s = a.start && map.get(a.start.anchor);
      const e = a.end && map.get(a.end.anchor);
      if (!s && !e) continue;
      ops.push(...this.setAnnotation(a.id, { ...a, start: s ? { ...a.start!, anchor: s } : a.start, end: e ? { ...a.end!, anchor: e } : a.end }));
    }
    return ops;
  }

  /** 되살린 원소에 걸린 주석: 동기화에는 새 글자로 가므로 범위(커서)를 다시 쓴다 */
  private reviveAnnotations(story: StoryId | null, ids: readonly ElementId[]): void {
    if (this.annMap.size === 0 || !this.listener) return;
    const set = new Set(ids);
    for (const a of this.annMap.values()) {
      if (a.story !== story) continue;
      if ((a.start && set.has(a.start.anchor)) || (a.end && set.has(a.end.anchor))) {
        const r = this.resolveRange(a);
        this.listener(null, { kind: 'annRange', id: a.id, story: a.story, start: r && !r.orphan ? r.from : null, end: r && !r.orphan ? r.to : null });
      }
    }
  }

  /** 스토리 (없으면 만든다) */
  story(id: StoryId): Doc {
    let d = this.map.get(id);
    if (!d) {
      d = this.make(id);
      this.map.set(id, d);
      this.hook(d, id);
      if (this.listener) {
        const fn = this.listener;
        d.observe((c) => fn(id, c));
      }
    }
    return d;
  }

  /** 스토리 Doc → ID (본문이면 null, 이 문서의 것이 아니면 undefined) */
  storyIdOf(doc: Doc): StoryId | null | undefined {
    if (doc === this.body) return null;
    for (const [id, d] of this.map) if (d === doc) return id;
    return undefined;
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
    if (op.type === 'story') {
      // 스토리 Doc의 삭제가 돌려준 주석 연산은 Document 것이다
      if (op.op.type === 'annotation' || op.op.type === 'comment') this.apply(op.op);
      else this.story(op.story).apply(op.op);
    }
    else if (op.type === 'tableMap') this.writeTableMap(op.table, op.map, op.key, op.after);
    else if (op.type === 'annotation') this.writeAnnotation(op.id, op.after, true);
    else if (op.type === 'comment') this.writeComment(op.key, op.after, true);
    else this.body.apply(op);
  }

  // ── 댓글 (14 §3) ─────────────────────────────────────

  /** 댓글 키 하나 쓰기 (실행 취소 연산). value undefined = 지움 */
  setComment(key: string, value: unknown): Op[] {
    const before = this.cmtMap.get(key);
    if (before === value || (before !== undefined && value !== undefined && JSON.stringify(before) === JSON.stringify(value))) return [];
    this.writeComment(key, value, true);
    return [{ type: 'comment', key, before, after: value }];
  }

  private writeComment(key: string, value: unknown, local: boolean): void {
    if (value === undefined) this.cmtMap.delete(key);
    else this.cmtMap.set(key, value);
    this.cmtCache = null;
    this.commentVersion++;
    if (local) this.listener?.(null, { kind: 'cmt', key, value });
  }

  /** 원격 댓글 키 (기록 없음, 알리지 않음). null·undefined = 지움 */
  applyRemoteComment(key: string, value: unknown): void {
    const v = value === null ? undefined : value;
    const cur = this.cmtMap.get(key);
    if (cur === v || (cur !== undefined && v !== undefined && JSON.stringify(cur) === JSON.stringify(v))) return;
    this.writeComment(key, v, false);
  }

  commentValue(key: string): unknown {
    return this.cmtMap.get(key);
  }

  /** 모든 댓글 키 (정본·새 판) */
  commentKeys(): ReadonlyMap<string, unknown> {
    return this.cmtMap;
  }

  /** 스레드들 (ID 순, 지운 것 포함). 키가 바뀔 때까지 캐시 */
  threads(): readonly CommentThread[] {
    return (this.cmtCache ??= threadsFromKeys(this.cmtMap));
  }

  thread(id: string): CommentThread | undefined {
    if (!this.cmtIndex || this.cmtIndexOf !== this.threads()) {
      this.cmtIndexOf = this.threads();
      this.cmtIndex = new Map(this.cmtIndexOf.map((t) => [t.id, t]));
    }
    return this.cmtIndex.get(id);
  }

  /** 새 스레드: 범위에 댓글 주석을 걸고 첫 메시지를 쓴다 (실행 취소 연산) */
  addThread(a: { thread: string; annotation: string; story: StoryId | null; from: number; to: number; message: string; author: CommentAuthor; text: string; time: number }): Op[] {
    const ops = this.annotate({ id: a.annotation, type: 'comment', story: a.story, from: a.from, to: a.to, data: { thread: a.thread } });
    ops.push(...this.setComment(`${a.thread}|anchor`, a.annotation));
    ops.push(...this.addMessage(a.thread, { id: a.message, author: a.author, time: a.time, text: a.text }));
    return ops;
  }

  /** 메시지 넣기 (답글) */
  addMessage(thread: string, m: { id: string; author: CommentAuthor; time: number; text: string }): Op[] {
    const p = `${thread}|m|${m.id}|`;
    return [...this.setComment(p + 'author', m.author), ...this.setComment(p + 'time', m.time), ...this.setComment(p + 'text', m.text)];
  }

  /** 메시지 고치기 */
  editMessage(thread: string, message: string, text: string, time: number): Op[] {
    const p = `${thread}|m|${message}|`;
    return [...this.setComment(p + 'text', text), ...this.setComment(p + 'edited', time)];
  }

  /** 메시지 지우기 (표시만: 차례·이력을 지킨다) */
  deleteMessage(thread: string, message: string): Op[] {
    return this.setComment(`${thread}|m|${message}|deleted`, true);
  }

  /** 해결 / 다시 열기 */
  resolveThread(thread: string, on: boolean): Op[] {
    return this.setComment(`${thread}|resolved`, on ? true : undefined);
  }

  /** 스레드 지우기: 댓글 주석을 지우고 스레드는 지운 표시만 한다 */
  deleteThread(thread: string): Op[] {
    const t = this.thread(thread);
    const ops: Op[] = [];
    if (t?.anchor) ops.push(...this.unannotate(t.anchor));
    ops.push(...this.setComment(`${thread}|deleted`, true));
    return ops;
  }

  // ── 주석 (14 §2) ─────────────────────────────────────

  /** 스토리 Doc (null이면 본문) */
  docOf(story: StoryId | null): Doc {
    return story === null ? this.body : this.story(story);
  }

  /** 화면 범위 [from, to) → 위치 (시작 = 첫 원소 앞, 끝 = 마지막 원소 뒤). 빈 범위면 둘 다 그 자리 */
  rangePositions(story: StoryId | null, from: number, to: number): { start: Position; end: Position } {
    const d = this.docOf(story);
    const start = d.positionAt(from);
    if (to <= from) return { start, end: start };
    return { start, end: { anchor: d.positionAt(to - 1).anchor, side: 'after' } };
  }

  /** 주석을 건다 (실행 취소 연산). 범위는 그 스토리의 화면 오프셋 */
  annotate(a: { id: string; type: string; story: StoryId | null; from: number; to: number; data?: Record<string, unknown> }): Op[] {
    const { start, end } = this.rangePositions(a.story, a.from, a.to);
    const after: Annotation = { id: a.id, type: a.type, story: a.story, start, end, data: a.data ?? {} };
    return this.setAnnotation(a.id, after);
  }

  /** 주석 데이터 바꾸기 (일부 키만, undefined는 지움) */
  updateAnnotation(id: string, data: Record<string, unknown>): Op[] {
    const cur = this.annMap.get(id);
    if (!cur) return [];
    const next: Record<string, unknown> = { ...cur.data };
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    return this.setAnnotation(id, { ...cur, data: next });
  }

  /** 주석 지우기 */
  unannotate(id: string): Op[] {
    return this.setAnnotation(id, undefined);
  }

  private setAnnotation(id: string, after: Annotation | undefined): Op[] {
    const before = this.annMap.get(id);
    if (before === after || (before && after && JSON.stringify(before) === JSON.stringify(after))) return [];
    this.writeAnnotation(id, after, true);
    return [{ type: 'annotation', id, before, after }];
  }

  /** 주석 표에 쓰고 (local이면) 바뀐 키를 알린다 */
  private writeAnnotation(id: string, after: Annotation | undefined, local: boolean): void {
    const before = this.annMap.get(id);
    if (after) this.annMap.set(id, after);
    else this.annMap.delete(id);
    this.annVersion++;
    this.annCache = null;
    if (!local || !this.listener) return;
    const emit = (c: AnnotationChange) => this.listener!(null, c);
    if (!after) {
      if (before) emit({ kind: 'annKey', id, key: 'type', value: undefined });
      return;
    }
    if (before?.type !== after.type) emit({ kind: 'annKey', id, key: 'type', value: after.type });
    if (!before || before.story !== after.story) emit({ kind: 'annKey', id, key: 'story', value: after.story });
    if (!before || JSON.stringify(before.data) !== JSON.stringify(after.data)) emit({ kind: 'annKey', id, key: 'data', value: after.data });
    if (!before || JSON.stringify([before.start, before.end]) !== JSON.stringify([after.start, after.end])) {
      const r = this.resolveRange(after);
      emit({ kind: 'annRange', id, story: after.story, start: r ? r.from : null, end: r ? r.to : null });
    }
  }

  /** 원격 주석 (기록 없음, 알리지 않음). null이면 지움 */
  applyRemoteAnnotation(id: string, a: Annotation | null): void {
    const cur = this.annMap.get(id);
    if (a === null) {
      if (cur) this.writeAnnotation(id, undefined, false);
      return;
    }
    if (cur && JSON.stringify(cur) === JSON.stringify(a)) return;
    this.writeAnnotation(id, a, false);
  }

  /**
   * 기준 원소가 지워진 주석 (스토리 story, 지금 Doc 기준). 원격 삭제 뒤 동기화 쪽이 Loro 커서에서 다시 풀 대상이다:
   * 지운 원소의 "있던 자리"는 Doc과 Loro가 다르게 볼 수 있다 (꼬리 옮기기 등)
   */
  deadAnchored(story: StoryId | null): string[] {
    const out: string[] = [];
    if (this.annMap.size === 0) return out;
    const d = story === null ? this.body : this.map.get(story);
    if (!d) return out;
    for (const a of this.annMap.values()) {
      if (a.story !== story) continue;
      if ((a.start && !d.isAlive(a.start.anchor)) || (a.end && !d.isAlive(a.end.anchor))) out.push(a.id);
    }
    return out;
  }

  annotation(id: string): Annotation | undefined {
    return this.annMap.get(id);
  }

  annotationIds(): string[] {
    return [...this.annMap.keys()];
  }

  /** 주석 범위 (화면 오프셋). 시작이 끝을 넘으면(범위 안 원소가 모두 지워짐) 고아 */
  resolveRange(a: Annotation): { from: number; to: number; orphan: boolean } | null {
    if (!a.start) return null;
    if (a.story !== null && !this.map.has(a.story)) return null;
    const d = this.docOf(a.story);
    // 끝이 없으면 고아 (원격에서 범위 안이 모두 지워진 채로 받음)
    if (!a.end) {
      const at = d.resolve(a.start);
      return { from: at, to: at, orphan: true };
    }
    const from = d.resolve(a.start);
    const to = Math.max(from, d.resolve(a.end));
    const empty = a.start.anchor === a.end.anchor && a.start.side === a.end.side;
    return { from, to, orphan: to <= from && !empty };
  }

  /**
   * 모든 주석의 범위 (스토리별 시작 오프셋 순). 문서 판(스토리 판들)·주석 판이 같으면 캐시. 그리기는 보이는 문단 범위로 이분 탐색한다
   */
  annotationRanges(): readonly AnnotationRange[] {
    let key = `${this.annVersion}:${this.body.version}`;
    for (const [id, d] of this.map) key += `|${id}:${d.version}`;
    if (this.annCache?.key === key) return this.annCache.list;
    const list: AnnotationRange[] = [];
    for (const a of this.annMap.values()) {
      const r = this.resolveRange(a);
      if (!r) continue;
      list.push({ id: a.id, type: a.type, story: a.story, from: r.from, to: r.to, orphan: r.orphan, data: a.data });
    }
    list.sort((x, y) => (x.story ?? '').localeCompare(y.story ?? '') || x.from - y.from || x.to - y.to || (x.id < y.id ? -1 : 1));
    this.annCache = { key, list };
    return list;
  }

  /** 스토리 story의 [from, to)에 걸친 주석 범위 (고아 빼고) */
  annotationsIn(story: StoryId | null, from: number, to: number): AnnotationRange[] {
    const s = story ?? '';
    return this.annotationRanges().filter((r) => (r.story ?? '') === s && !r.orphan && r.from < to && r.to > from);
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

/** 정렬한 오프셋들 → 연속 구간 [a, b) */
function runsOf(offs: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const o of offs) {
    const last = out[out.length - 1];
    if (last && o === last[1]) last[1]++;
    else if (!last || o > last[1]) out.push([o, o + 1]);
  }
  return out;
}

/** (오프셋, 값) 정렬 목록 → 값이 같은 연속 구간 [a, b, 값] */
function valueRuns(items: ReadonlyArray<[number, unknown]>): Array<[number, number, unknown]> {
  const out: Array<[number, number, unknown, string]> = [];
  for (const [o, v] of items) {
    const k = JSON.stringify(v);
    const last = out[out.length - 1];
    if (last && o === last[1] && k === last[3]) last[1]++;
    else out.push([o, o + 1, v, k]);
  }
  return out.map(([a, b, v]) => [a, b, v]);
}

export { OBJ };
