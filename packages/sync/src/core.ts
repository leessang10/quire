/**
 * Worker 쪽 동기화 코어 (09 §8): Loro 문서, 내보내기·가져오기 묶음, 프레즌스, 네트워크.
 * 메인 스레드의 Doc과는 protocol.ts 메시지로만 이야기한다. Worker가 아닌 곳(시험)에서도 그대로 쓸 수 있다.
 */
import { Cursor, LoroDoc, type LoroEventBatch, type LoroText, type VersionVector } from 'loro-crdt';
import { type RemoteOp, type LocalChange, deltaToOps, transform } from './ot';
import { LoroWriter, SEG_MARK, TEXT, displayOrderFromLoro, initLoro, newLoro, readRaw, readState, type PeerId } from './shape';
import { PresenceStore } from './presence-store';
import type { RemoteSel, ToMain, ToWorker } from './protocol';
import type { PresenceUser } from './presence';

const LOCAL_ORIGIN = 'quire-local';

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
    this.writer = new LoroWriter(loro, () => displayOrderFromLoro(loro));
    this.store = new PresenceStore(loro.peerIdStr, opts.presenceTimeoutMs ?? 30000);
    this.exported = loro.oplogVersion();
    this.unsubscribe = loro.subscribe((e) => this.onEvent(e));
    const { raw, keys } = readRaw(loro);
    const init = { raw, keys, state: readState(loro), peer: loro.peerIdStr };
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
      else this.writer.apply(c);
    }
    if (cs.some((c) => c.kind !== 'sel')) this.loro.commit({ origin: LOCAL_ORIGIN });
    this.len++;
    // 메인의 다음 묶음은 이 ack까지 받은 뒤에 만든 것이므로 지금까지의 항목은 다시 쓰지 않는다
    this.log.clear();
    this.opts.post(wantState ? { t: 'ack', state: readState(this.loro) } : { t: 'ack' });
    if (sel) this.setSelection(sel.anchor, sel.head);
    if (this.pendingExport) this.schedule();
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
    this.incoming = [];
    this.segDirty = false;
    if (ops.length > 0 || dirty) {
      this.log.set(this.len, ops);
      this.len++;
      this.opts.post(dirty ? { t: 'remote', ops, state: readState(this.loro) } : { t: 'remote', ops });
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
