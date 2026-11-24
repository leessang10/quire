/**
 * 편집 모델(Doc) ↔ Loro 브리지 (09)
 *
 * - Doc이 화면의 원본이다. 로컬 편집은 Doc에 먼저 반영되고, Doc의 변경 기록(UTF-16 위치)을 받아
 *   같은 변경을 Loro에 바로 적용한다 (Loro 로컬 입력 + 커밋은 0.1 ms 미만).
 * - 업데이트 내보내기·가져오기는 batchMs마다 한 번으로 묶는다 (큰 문서에서 1회 고정 비용이 크다).
 * - 원격 업데이트를 가져오면 텍스트 델타를 Doc에 적용하고, 구획 상태(순서·숨김·자리표시)를 Loro에서 읽어 맞춘다.
 *
 * Loro 표현 (V4 M4)
 * - 텍스트 'body': Doc의 살아 있는 원소 열. 구획 표식은 U+E000이고 그 글자에 마크 seg=<구획 키>를 붙인다
 *   (원격 델타에 키가 함께 실려 오므로 ID 대응표가 필요 없다).
 * - 이동 리스트 'order': 구획 키의 화면 순서 + 끝 고정 항목 END. 목록에 없는 구획은 저장 순서상 다음 구획 앞.
 * - 맵 'hidden', 'placeholder', 'used': 구획 키 → true.
 * - 처음 문서: [사용자 문단들 BRK(t)][¶ BRK(p)][¶ 보초]. t는 순서 목록에, p는 자리표시.
 */
import { Cursor, LoroDoc, type LoroEventBatch, type LoroText, type VersionVector } from 'loro-crdt';
import { Document, type AnnotationChange, type CommentChange, type Doc, type RawChange, type TableChange, type TextDelta } from '@quiredoc/model';
import { COMMENTS, readCmt, readCmts, writeCmt } from './comments';
import { ANNOTATIONS, annFromWire, annIdsInLoro, annIdsOf, annRangeToU16, readAnn, writeAnnKey, writeAnnRange } from './annotations';
import {
  LISTS,
  SECTIONS,
  LoroWriter,
  SEG_MARK,
  STYLES,
  TABLE_CONTAINER,
  TEXT,
  docFromLoro,
  initLoro,
  newLoro,
  readDefs,
  readState,
  readTable,
  readTail,
  storyNames,
  tableIdsOf,
  writeTable,
  type Names,
  type PeerId,
} from './shape';

const LOCAL_ORIGIN = 'quire-local';
/** 스토리 컨테이너의 ID (storyNames의 접두사) */
const STORY_CONTAINER = /^cid:root-(s|so|sh|sp|su|tp):/;

export interface SyncOptions {
  /** 이 피어의 ID (피어마다 달라야 한다) */
  peer: PeerId;
  /** 내보낼 업데이트가 생기면 호출된다 (묶음 단위) */
  onUpdate?: (update: Uint8Array) => void;
  /** 원격 업데이트를 Doc에 반영한 뒤 호출된다 (화면 갱신용) */
  onRemoteChange?: () => void;
  /** 내보내기·가져오기 묶음 간격 (ms). null이면 자동으로 하지 않고 flush()를 직접 부른다 */
  batchMs?: number | null;
}

/** 스토리 하나의 동기화 상태: 컨테이너 ID별 역할 */
interface StoryLink {
  doc: Doc;
  names: Names;
  writer: LoroWriter;
}

export class SyncBridge {
  readonly doc: Doc;
  /** 본문 + 스토리들 (11 §2.5). 스토리는 처음 열 때 Loro 상태에서 만든다 */
  readonly document: Document;
  readonly loro: LoroDoc;
  private readonly stories = new Map<string, StoryLink>();
  /** 컨테이너 ID → (스토리, 역할) */
  private readonly routes = new Map<string, { story: string; role: 'text' | 'seg' | 'tail' }>();
  private readonly text: LoroText;
  private readonly writer: LoroWriter;
  private readonly opts: SyncOptions;
  private readonly stylesId: string;
  private readonly listsId: string;
  private readonly sectionsId: string;
  private readonly annotationsId: string;
  private readonly commentsId: string;
  /** 커서가 지운 글자에 붙어 있던 주석: 가져오기가 끝난 뒤 살아 있는 글자로 다시 쓴다 */
  private rewrites = new Set<string>();
  /** 마지막으로 내보낸 시점의 버전 (그 사이 가져온 원격 연산 포함) */
  private exported: VersionVector;
  private inbox: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribe: () => void;
  private destroyed = false;
  private readonly flushListeners = new Set<() => void>();

  /** 새 문서를 만든다 (처음 만드는 피어) */
  static create(text: string, opts: SyncOptions): SyncBridge {
    const loro = newLoro(opts.peer);
    initLoro(loro, text, opts.peer);
    return SyncBridge.fromLoro(loro, opts);
  }

  /** 다른 피어가 내보낸 스냅샷에서 시작한다 */
  static fromSnapshot(snapshot: Uint8Array, opts: SyncOptions): SyncBridge {
    const loro = newLoro(opts.peer);
    loro.import(snapshot);
    return SyncBridge.fromLoro(loro, opts);
  }

  private static fromLoro(loro: LoroDoc, opts: SyncOptions): SyncBridge {
    return new SyncBridge(docFromLoro(loro, String(opts.peer)), loro, opts);
  }

  /** 스토리 (없으면 Loro 상태에서 만든다: 가벼운 모양) */
  story(id: string): Doc {
    return this.document.story(id);
  }

  private openStory(id: string): Doc {
    const names = storyNames(id);
    const doc = docFromLoro(this.loro, String(this.opts.peer), id);
    const writer = new LoroWriter(this.loro, () => doc.segmentOrder(), names);
    this.stories.set(id, { doc, names, writer });
    this.routes.set(this.loro.getText(names.text).id, { story: id, role: 'text' });
    for (const n of [names.order]) this.routes.set(this.loro.getMovableList(n).id, { story: id, role: 'seg' });
    for (const n of [names.hidden, names.placeholder, names.used]) this.routes.set(this.loro.getMap(n).id, { story: id, role: 'seg' });
    this.routes.set(this.loro.getMap(names.tail!).id, { story: id, role: 'tail' });
    return doc;
  }

  private constructor(doc: Doc, loro: LoroDoc, opts: SyncOptions) {
    this.doc = doc;
    this.loro = loro;
    this.opts = opts;
    this.document = new Document(doc, (id) => this.openStory(id));
    for (const id of tableIdsOf(loro)) this.document.putTable(readTable(loro, id));
    this.document.takeDirtyTables();
    this.text = loro.getText(TEXT);
    this.stylesId = loro.getMap(STYLES).id;
    this.listsId = loro.getMap(LISTS).id;
    this.sectionsId = loro.getMap(SECTIONS).id;
    this.annotationsId = loro.getMap(ANNOTATIONS).id;
    this.commentsId = loro.getMap(COMMENTS).id;
    for (const [k, v] of Object.entries(readCmts(loro))) this.document.applyRemoteComment(k, v);
    // 주석 (14 §2): Loro 상태에서 (스토리는 필요하면 연다)
    for (const id of annIdsInLoro(loro)) {
      const w = readAnn(loro, id);
      if (w) this.document.applyRemoteAnnotation(id, annFromWire(this.document, id, w));
    }
    this.writer = new LoroWriter(loro, () => doc.segmentOrder());
    this.exported = loro.oplogVersion();
    this.document.observe((story, c) => this.onLocal(story, c));
    this.unsubscribe = loro.subscribe((e) => this.onEvent(e));
  }

  /** 전체 스냅샷 (새 피어가 참여할 때) */
  snapshot(): Uint8Array {
    return this.loro.export({ mode: 'snapshot' });
  }

  /** 원격 업데이트를 받는다. 다음 묶음 때 적용한다 */
  receive(update: Uint8Array): void {
    this.inbox.push(update);
    this.schedule();
  }

  /**
   * 묶음 처리: 지난번 이후의 로컬 변경을 내보내고, 받아 둔 원격 업데이트를 가져와 Doc에 적용한다.
   * 내보내기를 먼저 해야 이번에 가져온 원격 연산이 다음 내보내기에 섞이지 않는다.
   */
  flush(): void {
    if (this.destroyed) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const now = this.loro.oplogVersion();
    if (now.compare(this.exported) !== 0) {
      const update = this.loro.export({ mode: 'update', from: this.exported });
      this.opts.onUpdate?.(update);
    }
    if (this.inbox.length > 0) {
      const batch = this.inbox;
      this.inbox = [];
      this.loro.importBatch(batch);
      this.exported = this.loro.oplogVersion();
      // 지운 글자에 붙은 주석 커서는 살아 있는 글자로 (모든 피어가 같은 글자를 고른다). 이 로컬 변경은 다음 묶음에 내보낸다
      if (this.rewrites.size) {
        const ids = [...this.rewrites];
        this.rewrites.clear();
        for (const id of ids) this.document.rewriteRange(id);
      }
      this.opts.onRemoteChange?.();
    } else this.exported = this.loro.oplogVersion();
    for (const fn of this.flushListeners) fn();
  }

  /** 아직 내보내지 않은 로컬 변경이 있는가 */
  get pendingExport(): boolean {
    return this.loro.oplogVersion().compare(this.exported) !== 0;
  }

  /** 묶음 처리(flush)가 끝날 때마다 호출된다. 해제 함수를 돌려준다 */
  onFlush(fn: () => void): () => void {
    this.flushListeners.add(fn);
    return () => this.flushListeners.delete(fn);
  }

  // ── 공유 위치 (09 §7) ─────────────────────────────────

  /**
   * 화면 오프셋 → 공유 위치 (인코딩한 Loro 커서). 그 자리 원소(캐럿 바로 뒤 글자)에 붙으므로,
   * 그 앞에 누가 입력해도 캐럿은 그 글자 앞에 남는다.
   */
  cursorAt(offset: number): Uint8Array {
    const c = this.text.getCursor(this.doc.u16OfOffset(offset), 0);
    if (!c) throw new Error(`no cursor at ${offset}`);
    return c.encode();
  }

  /**
   * 공유 위치 → 현재 화면 오프셋. 아직 받지 못한 연산을 가리키면 null.
   * 기준 글자가 지워졌으면 그 글자가 있던 자리, 숨긴 구획에 있으면 그 구획이 놓였을 자리.
   */
  resolveCursor(bytes: Uint8Array): number | null {
    let pos: ReturnType<LoroDoc['getCursorPos']>;
    try {
      pos = this.loro.getCursorPos(Cursor.decode(bytes));
    } catch {
      return null;
    }
    return pos ? this.doc.offsetOfU16(pos.offset) : null;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.unsubscribe();
    this.document.observe(null);
  }

  // ── 로컬 → Loro ───────────────────────────────────────

  private onLocal(story: string | null, c: RawChange | TableChange | AnnotationChange | CommentChange): void {
    if (c.kind === 'cmt') writeCmt(this.loro, c.key, c.value);
    else if (c.kind === 'annKey') writeAnnKey(this.loro, c.id, c.key, c.value);
    else if (c.kind === 'annRange') writeAnnRange(this.loro, c.id, c.story, annRangeToU16(this.document, c));
    else if (c.kind === 'tableList' || c.kind === 'tableMap') writeTable(this.loro, c);
    else (story === null ? this.writer : this.stories.get(story)!.writer).apply(c);
    this.loro.commit({ origin: LOCAL_ORIGIN });
    this.schedule();
  }

  // ── Loro → Doc ────────────────────────────────────────

  private onEvent(e: LoroEventBatch): void {
    // 로컬 커밋은 이미 Doc에 반영되어 있다. 가져오기는 'import', 여러 업데이트를 한꺼번에 가져오면
    // (importBatch) 'checkout'으로 온다 → 로컬이 아닌 것은 모두 적용한다.
    if (e.by === 'local') return;
    let segDirty = false;
    let defsDirty = false;
    const storySeg = new Set<string>();
    const tables = new Set<string>();
    const anns = new Set<string>();
    /** 원격 삭제가 있던 스토리 (null = 본문) */
    const textDeleted = new Set<string | null>();
    for (const ev of e.events) {
      if (ev.target === this.annotationsId) {
        if (ev.diff.type === 'map') for (const id of annIdsOf(Object.keys(ev.diff.updated))) anns.add(id);
        continue;
      }
      if (ev.target === this.commentsId) {
        if (ev.diff.type === 'map') for (const k of Object.keys(ev.diff.updated)) this.document.applyRemoteComment(k, readCmt(this.loro, k));
        continue;
      }
      const tm = TABLE_CONTAINER.exec(String(ev.target));
      if (tm) {
        tables.add(tm[1]!);
        continue;
      }
      if (ev.target === this.stylesId || ev.target === this.listsId || ev.target === this.sectionsId) {
        defsDirty = true;
        continue;
      }
      // 스토리 (11 §2.5): 연 스토리만 적용한다 (열지 않은 스토리는 열 때 Loro 상태에서 읽는다)
      const route = this.routes.get(ev.target);
      if (route) {
        const link = this.stories.get(route.story)!;
        if (route.role === 'text' && ev.diff.type === 'text') {
          const delta = ev.diff.diff as TextDelta;
          link.doc.applyDelta(delta);
          if (delta.some((d) => d.delete)) textDeleted.add(route.story);
          if (delta.some((d) => d.attributes?.[SEG_MARK] !== undefined)) storySeg.add(route.story);
        } else if (route.role === 'tail') link.doc.applyTailAll(readTail(this.loro, link.names));
        else storySeg.add(route.story);
        continue;
      }
      // 아직 열지 않은 스토리의 컨테이너 (cid:root-s:…:Text 등): 무시
      if (STORY_CONTAINER.test(String(ev.target))) continue;
      if (ev.target === this.text.id && ev.diff.type === 'text') {
        const delta = ev.diff.diff as TextDelta;
        this.doc.applyDelta(delta);
        if (delta.some((d) => d.delete)) textDeleted.add(null);
        if (delta.some((d) => d.attributes?.[SEG_MARK] !== undefined)) segDirty = true;
      } else {
        segDirty = true;
      }
    }
    // 텍스트(새 구획 표식)를 먼저 적용한 뒤 구획 상태를 맞춘다
    if (segDirty) this.doc.applySegState(readState(this.loro));
    for (const id of storySeg) {
      const link = this.stories.get(id)!;
      link.doc.applySegState(readState(this.loro, link.names));
    }
    for (const id of tables) this.document.applyRemoteTable(readTable(this.loro, id));
    if (defsDirty) {
      const d = readDefs(this.loro);
      this.doc.applyRemoteDefs(d.styles ?? {}, d.lists ?? {}, d.sections ?? {});
    }
    // 원격 삭제로 기준 원소가 지워진 주석은 Loro 커서에서 다시 푼다 (모든 피어가 같은 Loro로 같은 자리를 얻는다)
    if (textDeleted.size) for (const s of textDeleted) for (const id of this.document.deadAnchored(s)) anns.add(id);
    // 주석: 텍스트를 다 적용한 뒤 커서를 푼다
    for (const id of anns) {
      const w = readAnn(this.loro, id);
      this.document.applyRemoteAnnotation(id, w ? annFromWire(this.document, id, w) : null);
      if (w?.dead) this.rewrites.add(id);
    }
  }

  private schedule(): void {
    const ms = this.opts.batchMs === undefined ? 50 : this.opts.batchMs;
    if (ms === null || this.timer !== null || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, ms);
  }
}
