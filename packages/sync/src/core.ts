/**
 * Worker 쪽 동기화 코어 (09 §8): Loro 문서, 내보내기·가져오기 묶음, 프레즌스, 네트워크.
 * 메인 스레드의 Doc과는 protocol.ts 메시지로만 이야기한다. Worker가 아닌 곳(시험)에서도 그대로 쓸 수 있다.
 */
import { Cursor, LoroDoc, type LoroEventBatch, type LoroText, type VersionVector } from 'loro-crdt';
import { type RemoteOp, type LocalChange, deltaToOps, transform } from './ot';
import {
  LISTS,
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
    this.defIds = new Set([loro.getMap(STYLES).id, loro.getMap(LISTS).id]);
    this.writer = new LoroWriter(loro, () => displayOrderFromLoro(loro));
    this.store = new PresenceStore(loro.peerIdStr, opts.presenceTimeoutMs ?? 30000);
    this.exported = loro.oplogVersion();
    this.unsubscribe = loro.subscribe((e) => this.onEvent(e));
    const { raw, keys } = readRaw(loro);
    const stories: Record<string, StoryInit> = {};
    for (const id of storyIdsOf(loro)) stories[id] = storyInit(loro, id);
    const tables: Record<string, TableRecord> = {};
    for (const id of tableIdsOf(loro)) tables[id] = readTable(loro, id);
    const init = { raw, keys, state: readState(loro), peer: loro.peerIdStr, formats: readFormats(loro), stories, tables };
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
      else if (c.kind === 'tableList' || c.kind === 'tableMap') writeTable(this.loro, c);
      else if (c.story !== undefined) this.writerFor(c.story).apply(c);
      else this.writer.apply(c);
    }
    if (cs.some((c) => c.kind !== 'sel')) this.loro.commit({ origin: LOCAL_ORIGIN });
    this.len++;
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
      });
    } else this.opts.post({ t: 'ack' });
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
          deltaToOps(delta, this.incoming, id);
          if (delta.some((d) => d.attributes?.[SEG_MARK] !== undefined)) this.storySeg.add(id);
        } else if (role === 'tp') this.storyTail.add(id);
        else this.storySeg.add(id);
        continue;
      }
      if (ev.target === this.text.id && ev.diff.type === 'text') {
        const delta = ev.diff.diff;
        deltaToOps(delta, this.incoming);
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
    if (ops.length > 0 || dirty || defs || anyStory || anyTable) {
      this.log.set(this.len, ops);
      this.len++;
      this.opts.post({
        t: 'remote',
        ops,
        ...(dirty ? { state: readState(this.loro) } : {}),
        ...(defs ? { defs: readDefs(this.loro) } : {}),
        ...(anyStory ? { stories } : {}),
        ...(anyTable ? { tables } : {}),
      });
    }
    if (this.store.states.size > 0) this.postRemotes();
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
