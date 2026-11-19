/**
 * Worker 쪽 동기화 코어 (09 §8): Loro 문서, 내보내기·가져오기 묶음, 프레즌스, 네트워크.
 * 메인 스레드의 Doc과는 protocol.ts 메시지로만 이야기한다. Worker가 아닌 곳(시험)에서도 그대로 쓸 수 있다.
 */
import { Cursor, LoroDoc, type LoroEventBatch, type LoroText, type VersionVector } from 'loro-crdt';
import { type RemoteOp, type LocalChange, deltaToOps, transform } from './ot';
import {
  LISTS,
  SECTIONS,
  LoroWriter,
  SEG_MARK,
  STYLES,
  TEXT,
  displayOrderFromLoro,
  initLoro,
  newLoro,
  readDefs,
  readFormats,
  readRaw,
  readState,
  readTail,
  storyIdsOf,
  storyNames,
  TABLE_CONTAINER,
  readTable,
  tableIdsOf,
  writeTable,
  type PeerId,
} from './shape';
import type { TableRecord } from '@quire/model';
import { PresenceStore } from './presence-store';
import { COMMENTS, readCmt, readCmts, writeCmt } from './comments';
import { ANNOTATIONS, annIdsInLoro, annIdsOf, readAnn, writeAnnKey, writeAnnRange, type AnnWire } from './annotations';
import type { RemoteSel, StoryDelta, StoryInit, ToMain, ToWorker } from './protocol';

/** 스토리 컨테이너 ID → (역할, 스토리 ID) (storyNames의 접두사) */
const STORY_CONTAINER = /^cid:root-(s|so|sh|sp|su|tp):(.*):(Text|Map|MovableList)$/;

/** Loro의 스토리 하나 → 처음 상태 */
export function storyInit(loro: LoroDoc, id: string): StoryInit {
  const names = storyNames(id);
  const { raw, keys } = readRaw(loro, names);
  return { raw, keys, state: readState(loro, names), formats: readFormats(loro, names), tail: readTail(loro, names) };
}
import type { PresenceUser } from './presence';

const LOCAL_ORIGIN = 'quire-local';
const SEG_KINDS = new Set(['order', 'list', 'hidden', 'flag']);

/** 네트워크로 내보내는 길 (중계 모드: 메인으로 넘김, WebSocket 모드: WsLink) */
export interface NetOut {
  sendDoc(bytes: Uint8Array): void;
  sendPresence(bytes: Uint8Array): void;
}

export interface CoreOptions {
  user: PresenceUser;
  /** 메인 스레드로 메시지를 보낸다 */
  post: (msg: ToMain) => void;
  net: NetOut;
  /** 내보내기·가져오기 묶음 간격 (ms). null이면 flush()를 직접 부른다. 기본 50 */
  batchMs?: number | null;
  presenceTimeoutMs?: number;
  /** 새 판으로 바꾼 코어: init 대신 reset을 보낸다 (09 §9) */
  reset?: { lost: boolean };
}

export class SyncCore {
  readonly loro: LoroDoc;
  private readonly text: LoroText;
  private readonly writer: LoroWriter;
  private readonly opts: CoreOptions;
  private readonly store: PresenceStore;
  /** H 항목 수 */
  private len = 0;
  /** 아직 메인이 보낸 묶음에 반영되지 않았을 수 있는 원격 H 항목 (인덱스 → 연산) */
  private readonly log = new Map<number, RemoteOp[]>();
  private exported: VersionVector;
  private inbox: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private presenceHeld = false;
  /** 가져오기 중 모은 원격 텍스트 연산과 구획 상태 변경 여부 */
  private incoming: RemoteOp[] = [];
  private segDirty = false;
  private defsDirty = false;
  /** 스토리별 쓰기 (11 §2.5) */
  private readonly storyWriters = new Map<string, LoroWriter>();
  /** 가져오기 중 바뀐 스토리 상태 */
  private storySeg = new Set<string>();
  private storyTail = new Set<string>();
  private tablesDirty = new Set<string>();
  /** 원격 변경이 있던 주석 (14 §2.2) */
  private annsDirty = new Set<string>();
  /** 원격 변경이 있던 댓글 키 (14 §3) */
  private cmtsDirty = new Set<string>();
  private readonly commentsId: string;
  /**
   * 원격 텍스트 변경 자리 근처의 주석: 다시 풀어 보낸다. 메인은 원격 연산을 변환해 적용하므로 같은 글자가 이어질 때 Loro와 다른
   * (같은 모양의) 원소를 지울 수 있다: 메인은 범위가 Loro와 다른 주석만 다시 건다
   */
  private annsResync = new Set<string>();
  /**
   * 주석 위치 캐시 (Loro 텍스트 u16, 스토리 '' = 본문): 텍스트 변경 근처의 주석만 골라 다시 풀려고. Loro 커서 풀기는 한 덩어리로
   * 들어간 긴 텍스트 안에서 오프셋에 비례해 비싸므로 입력마다 모든 주석을 풀 수 없다. 변경마다 위치를 옮기고, 다시 푼 주석은 정확한 값으로
   */
  private annPos = new Map<string, { story: string; start: number; end: number }>();
  private readonly annotationsId: string;
  private readonly defIds: Set<string>;
  private readonly unsubscribe: () => void;
  private closed = false;

  static create(text: string, peer: PeerId, opts: CoreOptions): SyncCore {
    const loro = newLoro(peer);
    initLoro(loro, text, peer);
    return new SyncCore(loro, opts);
  }

  static fromSnapshot(snapshot: Uint8Array, peer: PeerId, opts: CoreOptions): SyncCore {
    const loro = newLoro(peer);
    loro.import(snapshot);
    return new SyncCore(loro, opts);
  }

  /** 이미 내용을 가져온 Loro 문서로 시작한다 (WebSocket 모드: 서버와 처음 맞춘 뒤) */
  constructor(loro: LoroDoc, opts: CoreOptions) {
    this.loro = loro;
    this.opts = opts;
    this.text = loro.getText(TEXT);
    this.defIds = new Set([loro.getMap(STYLES).id, loro.getMap(LISTS).id, loro.getMap(SECTIONS).id]);
    this.annotationsId = loro.getMap(ANNOTATIONS).id;
    this.commentsId = loro.getMap(COMMENTS).id;
    this.writer = new LoroWriter(loro, () => displayOrderFromLoro(loro));
    this.store = new PresenceStore(loro.peerIdStr, opts.presenceTimeoutMs ?? 30000);
    this.exported = loro.oplogVersion();
    this.unsubscribe = loro.subscribe((e) => this.onEvent(e));
    const { raw, keys } = readRaw(loro);
    const stories: Record<string, StoryInit> = {};
    for (const id of storyIdsOf(loro)) stories[id] = storyInit(loro, id);
    const tables: Record<string, TableRecord> = {};
    for (const id of tableIdsOf(loro)) tables[id] = readTable(loro, id);
    const anns: Record<string, AnnWire | null> = {};
    for (const id of annIdsInLoro(loro)) anns[id] = this.readAnn(id);
    const init = { raw, keys, state: readState(loro), peer: loro.peerIdStr, formats: readFormats(loro), stories, tables, anns, cmts: readCmts(loro) };
    opts.post(opts.reset ? { t: 'reset', ...init, lost: opts.reset.lost } : { t: 'init', ...init });
    this.heartbeat = setInterval(() => this.tick(), (opts.presenceTimeoutMs ?? 30000) / 2);
  }

  /** 메인 스레드에서 온 메시지 */
  handle(msg: ToWorker): void {
    if (this.closed) return;
    switch (msg.t) {
      case 'ops':
        this.onOps(msg.rev, msg.changes, msg.wantState);
        break;
      case 'flush':
        this.flush();
        break;
      case 'net':
        if (msg.kind === 'doc') this.receiveDoc(msg.bytes);
        else this.receivePresence(msg.bytes);
        break;
      case 'close':
        this.close();
        break;
    }
  }

  /** 네트워크에서 받은 문서 업데이트. 다음 묶음 때 가져온다 */
  receiveDoc(bytes: Uint8Array): void {
    this.inbox.push(bytes);
    this.schedule();
  }

  receivePresence(bytes: Uint8Array): void {
    if (this.store.receive(bytes)) this.postRemotes();
  }

  /** 중계 서버가 알려 온, 연결이 끊긴 피어 */
  forgetPeer(key: string): void {
    if (this.store.forget(key)) this.postRemotes();
  }

  /** 새로 연결되었을 때: 자기 프레즌스를 다시 알린다 */
  announce(): void {
    if (this.store.hasLocal) this.opts.net.sendPresence(this.store.refresh());
  }

  /** 아직 내보내지 않은 로컬 변경이 있는가 */
  get pendingExport(): boolean {
    return this.loro.oplogVersion().compare(this.exported) !== 0;
  }

  /**
   * 묶음 처리: 지난번 이후의 로컬 변경을 내보내고(그 뒤에 보류한 프레즌스), 받아 둔 원격 업데이트를 가져와
   * 메인으로 보낸다.
   */
  flush(): void {
    if (this.closed) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingExport) {
      this.opts.net.sendDoc(this.loro.export({ mode: 'update', from: this.exported }));
    }
    if (this.presenceHeld) {
      this.presenceHeld = false;
      this.opts.net.sendPresence(this.store.encodeLocal());
    }
    if (this.inbox.length > 0) {
      const batch = this.inbox;
      this.inbox = [];
      this.loro.importBatch(batch);
      this.emitRemote();
    }
    this.exported = this.loro.oplogVersion();
  }

  close(): void {
    if (this.closed) return;
    this.opts.net.sendPresence(this.store.setLocal(null));
    this.closed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    this.unsubscribe();
  }

  // ── 메인 → Loro ───────────────────────────────────────

  private onOps(rev: number, changes: LocalChange[], wantState: boolean): void {
    // 메인이 이 묶음을 만들 때 받지 못했던 원격 항목들에 대해 변환한다
    let cs = changes;
    for (let i = rev; i < this.len; i++) {
      const ops = this.log.get(i);
      if (!ops) throw new Error(`sync core: H entry ${i} is not a remote entry (more than one batch in flight?)`);
      cs = transform(cs, ops)[0];
    }
    let sel: { anchor: number; head: number } | null = null;
    for (const c of cs) {
      if (c.kind === 'sel') sel = { anchor: c.anchor, head: c.head };
      else if (c.kind === 'annKey') writeAnnKey(this.loro, c.id, c.key, c.value);
      else if (c.kind === 'cmt') writeCmt(this.loro, c.key, c.value);
      else if (c.kind === 'annRange') writeAnnRange(this.loro, c.id, c.story, { start: c.start, last: c.last });
      else if (c.kind === 'tableList' || c.kind === 'tableMap') writeTable(this.loro, c);
      else if (c.story !== undefined) this.writerFor(c.story).apply(c);
      else this.writer.apply(c);
    }
    if (cs.some((c) => c.kind !== 'sel')) this.loro.commit({ origin: LOCAL_ORIGIN });
    this.len++;
    // 로컬로 바꾼 주석: 적용한 뒤의 상태 (메인이 미뤄 둔 원격 값 대신 쓴다)
    let anns: Record<string, AnnWire | null> | undefined;
    for (const c of cs) if (c.kind === 'annKey' || c.kind === 'annRange') (anns ??= {})[c.id] = this.readAnn(c.id);
    // 로컬로 바꾼 댓글 키: 적용한 뒤의 값 (메인이 미뤄 둔 원격 값 대신 쓴다)
    let cmts: Record<string, unknown> | undefined;
    for (const c of cs) if (c.kind === 'cmt') (cmts ??= {})[c.key] = readCmt(this.loro, c.key);
    // 로컬 텍스트 변경 자리 근처의 주석: 메인과 다른 원소를 지웠거나 넣었을 수 있다 (같은 글자가 이어질 때)
    let resync: Record<string, AnnWire> | undefined;
    if (this.annPos.size) {
      const near = new Set<string>();
      for (const c of cs) if (c.kind === 'insert' || c.kind === 'delete') this.shiftAnns(c, near);
      for (const id of near) {
        if (anns && id in anns) continue;
        const w = this.readAnn(id);
        if (w && w.start !== null && w.end !== null) (resync ??= {})[id] = w;
      }
    }
    // 메인의 다음 묶음은 이 ack까지 받은 뒤에 만든 것이므로 지금까지의 항목은 다시 쓰지 않는다
    this.log.clear();
    if (wantState) {
      // 로컬 구획 변경이 있던 스토리의 상태도
      const stories: Record<string, StoryDelta> = {};
      // 로컬 구획·끝 ¶ 변경이 있던 스토리의 상태 (메인이 미뤄 둔 원격 상태 대신 쓴다)
      for (const c of cs)
        if (c.story !== undefined && (SEG_KINDS.has(c.kind) || c.kind === 'tail'))
          stories[c.story] = { state: readState(this.loro, storyNames(c.story)), tail: readTail(this.loro, storyNames(c.story)) };
      // 로컬 표 변경이 있던 표의 레코드 (메인이 미뤄 둔 원격 레코드 대신 쓴다)
      const tables: Record<string, TableRecord> = {};
      for (const c of cs) if (c.kind === 'tableList' || c.kind === 'tableMap') tables[c.table] = readTable(this.loro, c.table);
      this.opts.post({
        t: 'ack',
        state: readState(this.loro),
        defs: readDefs(this.loro),
        ...(Object.keys(stories).length ? { stories } : {}),
        ...(Object.keys(tables).length ? { tables } : {}),
        ...(anns ? { anns } : {}),
        ...(resync ? { annsResync: resync } : {}),
        ...(cmts ? { cmts } : {}),
      });
    } else this.opts.post({ t: 'ack', ...(anns ? { anns } : {}), ...(resync ? { annsResync: resync } : {}), ...(cmts ? { cmts } : {}) });
    if (sel) this.setSelection(sel.anchor, sel.head);
    if (this.pendingExport) this.schedule();
  }

  private writerFor(id: string): LoroWriter {
    let w = this.storyWriters.get(id);
    if (!w) {
      const names = storyNames(id);
      w = new LoroWriter(this.loro, () => displayOrderFromLoro(this.loro, names), names);
      this.storyWriters.set(id, w);
    }
    return w;
  }

  private setSelection(anchor: number, head: number): void {
    const a = this.cursorBytes(anchor);
    const h = anchor === head ? a : this.cursorBytes(head);
    if (!a || !h) return;
    const { name, color } = this.opts.user;
    const bytes = this.store.setLocal({ name, color, anchor: a, head: h });
    // 캐럿이 가리키는 글자가 담긴 문서 업데이트보다 먼저 가지 않게 한다
    if (this.pendingExport) {
      this.presenceHeld = true;
      this.schedule();
    } else {
      this.opts.net.sendPresence(bytes);
    }
  }

  private cursorBytes(u16: number): Uint8Array | null {
    const c = this.text.getCursor(Math.min(u16, this.text.length), 0);
    return c ? c.encode() : null;
  }

  // ── Loro → 메인 ───────────────────────────────────────

  private onEvent(e: LoroEventBatch): void {
    if (e.by === 'local') return;
    for (const ev of e.events) {
      if (ev.target === this.annotationsId) {
        if (ev.diff.type === 'map') for (const id of annIdsOf(Object.keys(ev.diff.updated))) this.annsDirty.add(id);
        continue;
      }
      if (ev.target === this.commentsId) {
        if (ev.diff.type === 'map') for (const k of Object.keys(ev.diff.updated)) this.cmtsDirty.add(k);
        continue;
      }
      if (this.defIds.has(ev.target)) {
        this.defsDirty = true;
        continue;
      }
      // 표 레코드 (11 §2.4): 통째로 다시 읽어 보낸다
      const tm = TABLE_CONTAINER.exec(String(ev.target));
      if (tm) {
        this.tablesDirty.add(tm[1]!);
        continue;
      }
      // 스토리 (11 §2.5): 텍스트는 연산으로, 구획·끝 ¶ 속성은 상태로
      const sm = STORY_CONTAINER.exec(String(ev.target));
      if (sm) {
        const [, role, id] = sm as unknown as [string, string, string];
        if (role === 's' && ev.diff.type === 'text') {
          const delta = ev.diff.diff;
          const n0 = this.incoming.length;
          deltaToOps(delta, this.incoming, id);
          this.shiftAnnsBy(n0);
          if (delta.some((d) => d.attributes?.[SEG_MARK] !== undefined)) this.storySeg.add(id);
        } else if (role === 'tp') this.storyTail.add(id);
        else this.storySeg.add(id);
        continue;
      }
      if (ev.target === this.text.id && ev.diff.type === 'text') {
        const delta = ev.diff.diff;
        const n0 = this.incoming.length;
        deltaToOps(delta, this.incoming);
        this.shiftAnnsBy(n0);
        if (delta.some((d) => d.attributes?.[SEG_MARK] !== undefined)) this.segDirty = true;
      } else {
        this.segDirty = true;
      }
    }
  }

  private emitRemote(): void {
    const ops = this.incoming;
    const dirty = this.segDirty;
    const defs = this.defsDirty;
    const stories: Record<string, StoryDelta> = {};
    for (const id of this.storySeg) stories[id] = { state: readState(this.loro, storyNames(id)) };
    for (const id of this.storyTail) stories[id] = { ...stories[id], tail: readTail(this.loro, storyNames(id)) };
    this.incoming = [];
    this.segDirty = false;
    this.defsDirty = false;
    this.storySeg = new Set();
    this.storyTail = new Set();
    const anyStory = Object.keys(stories).length > 0;
    const tables: Record<string, TableRecord> = {};
    for (const id of this.tablesDirty) tables[id] = readTable(this.loro, id);
    this.tablesDirty = new Set();
    const anyTable = Object.keys(tables).length > 0;
    // 주석: 이 항목의 텍스트까지 적용한 Loro 상태로 커서를 푼다 (메인은 같은 항목의 연산을 먼저 적용한다)
    const anns: Record<string, AnnWire | null> = {};
    for (const id of this.annsDirty) anns[id] = this.readAnn(id);
    this.annsDirty = new Set();
    let resync: Record<string, AnnWire> | undefined;
    for (const id of this.annsResync) {
      if (id in anns) continue;
      const w = this.readAnn(id);
      if (w && w.start !== null && w.end !== null) (resync ??= {})[id] = w;
    }
    this.annsResync = new Set();
    let cmts: Record<string, unknown> | undefined;
    for (const k of this.cmtsDirty) (cmts ??= {})[k] = readCmt(this.loro, k);
    this.cmtsDirty = new Set();
    const anyAnn = Object.keys(anns).length > 0 || !!resync || !!cmts;
    if (ops.length > 0 || dirty || defs || anyStory || anyTable || anyAnn) {
      this.log.set(this.len, ops);
      this.len++;
      this.opts.post({
        t: 'remote',
        ops,
        ...(dirty ? { state: readState(this.loro) } : {}),
        ...(defs ? { defs: readDefs(this.loro) } : {}),
        ...(anyStory ? { stories } : {}),
        ...(anyTable ? { tables } : {}),
        ...(Object.keys(anns).length ? { anns } : {}),
        ...(resync ? { annsResync: resync } : {}),
        ...(cmts ? { cmts } : {}),
      });
    }
    if (this.store.states.size > 0) this.postRemotes();
  }

  /** 주석 하나를 지금 Loro 상태로 풀고 위치 캐시를 맞춘다 */
  private readAnn(id: string): AnnWire | null {
    const w = readAnn(this.loro, id);
    if (w && w.start !== null) this.annPos.set(id, { story: w.story ?? '', start: w.start, end: w.end ?? w.start });
    else this.annPos.delete(id);
    return w;
  }

  /**
   * 텍스트 변경 하나 (그 앞 변경까지 적용한 위치)를 지난다: 바뀐 자리에 닿거나 붙은 주석을 near에 모으고 캐시 위치를 옮긴다.
   * 붙은 경우(경계에서 넣기)는 커서 쪽에 따라 달라지므로 다시 풀어 맞춘다
   */
  private shiftAnns(c: { kind: string; at: number; story?: string; text?: string; len?: number }, near: Set<string>): void {
    const story = c.story ?? '';
    const ins = c.kind === 'insert';
    const len = ins ? c.text!.length : c.len!;
    const hi = ins ? c.at : c.at + len;
    for (const [id, p] of this.annPos) {
      if (p.story !== story) continue;
      if (p.start <= hi + 1 && p.end >= c.at - 1) near.add(id);
      if (ins) {
        if (p.start >= c.at) p.start += len;
        if (p.end > c.at) p.end += len;
      } else {
        const f = (x: number) => (x >= hi ? x - len : x > c.at ? c.at : x);
        p.start = f(p.start);
        p.end = f(p.end);
      }
    }
  }

  /** 원격 연산 incoming[n0..]으로 주석 캐시를 옮기고, 근처 주석을 다시 풀 목록에 */
  private shiftAnnsBy(n0: number): void {
    if (!this.annPos.size) return;
    for (let i = n0; i < this.incoming.length; i++) {
      const op = this.incoming[i]!;
      if (op.kind === 'insert' || op.kind === 'delete') this.shiftAnns(op, this.annsResync);
    }
  }

  private postRemotes(): void {
    const list: RemoteSel[] = [];
    for (const [key, s] of this.store.states) {
      const anchor = this.resolve(s.anchor);
      const head = s.head === s.anchor ? anchor : this.resolve(s.head);
      list.push({ key, name: s.name, color: s.color, anchor, head });
    }
    list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    this.opts.post({ t: 'remotes', list });
  }

  private resolve(bytes: Uint8Array): number | null {
    try {
      return this.loro.getCursorPos(Cursor.decode(bytes))?.offset ?? null;
    } catch {
      return null;
    }
  }

  private tick(): void {
    if (this.store.hasLocal && !this.presenceHeld) this.opts.net.sendPresence(this.store.refresh());
    if (this.store.expire().length) this.postRemotes();
  }

  private schedule(): void {
    const ms = this.opts.batchMs === undefined ? 50 : this.opts.batchMs;
    if (ms === null || this.timer !== null || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, ms);
  }
}
