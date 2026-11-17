/**
 * Worker 진입점과 메인 쪽 연결 도우미 (09 §8).
 *
 * Worker 파일에서:   import { serveSyncWorker } from '@quire/sync/host'; serveSyncWorker(self);
 * 메인에서:          const client = await startSyncWorker(new Worker(...), config, options);
 *
 * 모드
 * - relay: 네트워크 업데이트를 메인으로 넘긴다 (한 페이지에 피어 여럿을 두는 데모: 메인이 지연·오프라인을 흉내 낸다).
 * - ws: Worker가 직접 중계 서버에 WebSocket으로 붙는다 (재접속 포함).
 */
import type { SegState } from '@quire/model';
import { SyncClient, type ClientOptions } from './client';
import { SyncCore, type CoreOptions, type NetOut } from './core';
import type { PresenceUser } from './presence';
import type { ToMain, ToWorker } from './protocol';
import { initLoro, newLoro } from './shape';
import { WsLink } from './ws';

export type WorkerConfig =
  | { mode: 'relay'; peer: number; user: PresenceUser; text?: string; snapshot?: Uint8Array; batchMs?: number }
  | { mode: 'ws'; peer: number; user: PresenceUser; url: string; text: string; batchMs?: number };

/** 메인 → Worker 첫 메시지 */
export type StartMsg = { t: 'start'; config: WorkerConfig };
/** relay 모드에서 새 피어에게 줄 스냅샷 요청 */
export type SnapshotMsg = { t: 'snapshot' };

interface PortLike {
  postMessage(msg: unknown): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
}

/** Worker 안에서 부른다 */
export function serveSyncWorker(scope: PortLike): void {
  let core: SyncCore | null = null;
  let link: WsLink | null = null;
  const post = (m: ToMain | { t: 'snapshot'; bytes: Uint8Array }) => scope.postMessage(m);
  const early: ToWorker[] = [];

  scope.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as ToWorker | StartMsg | SnapshotMsg;
    if (msg.t === 'start') {
      start(msg.config);
      return;
    }
    if (msg.t === 'snapshot') {
      if (core) post({ t: 'snapshot', bytes: core.loro.export({ mode: 'snapshot' }) });
      return;
    }
    if (!core) {
      early.push(msg);
      return;
    }
    if (msg.t === 'close') link?.close();
    core.handle(msg);
  });

  function coreOptions(c: WorkerConfig, net: NetOut): CoreOptions {
    return { user: c.user, post, net, batchMs: c.batchMs };
  }

  function ready(c: SyncCore): void {
    core = c;
    for (const m of early.splice(0)) c.handle(m);
  }

  function start(c: WorkerConfig): void {
    if (c.mode === 'relay') {
      const net: NetOut = {
        sendDoc: (bytes) => post({ t: 'net', kind: 'doc', bytes }),
        sendPresence: (bytes) => post({ t: 'net', kind: 'presence', bytes }),
      };
      ready(c.snapshot ? SyncCore.fromSnapshot(c.snapshot, c.peer, coreOptions(c, net)) : SyncCore.create(c.text ?? '', c.peer, coreOptions(c, net)));
      return;
    }
    const loro = newLoro(c.peer);
    const l: WsLink = new WsLink(c.url, loro, loro.peerIdStr, {
      onSync: ({ first, create, update }) => {
        if (first) {
          if (update.length) loro.import(update);
          if (create) initLoro(loro, c.text, c.peer);
          ready(new SyncCore(loro, coreOptions(c, l)));
          return;
        }
        if (update.length) core?.receiveDoc(update);
        core?.flush();
      },
      onDoc: (b) => core?.receiveDoc(b),
      onPresence: (b) => core?.receivePresence(b),
      onGone: (k) => core?.forgetPeer(k),
      onStatus: (online, detail) => {
        post({ t: 'status', online, detail });
        if (online) core?.announce();
      },
    });
    link = l;
  }
}

/** 메인에서: Worker를 시작하고 첫 문서를 받으면 SyncClient를 돌려준다 */
export function startSyncWorker(
  worker: PortLike,
  config: WorkerConfig,
  opts: Omit<ClientOptions, 'post'> & { onNet?: (kind: 'doc' | 'presence', bytes: Uint8Array) => void } = {},
): Promise<WorkerClient> {
  return new Promise((resolve) => {
    let client: WorkerClient | null = null;
    const early: ToMain[] = [];
    worker.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data as ToMain | { t: 'snapshot'; bytes: Uint8Array };
      if (msg.t === 'snapshot') {
        client?.takeSnapshot(msg.bytes);
        return;
      }
      if (msg.t === 'net') {
        opts.onNet?.(msg.kind, msg.bytes);
        return;
      }
      if (msg.t === 'status' && !client) {
        opts.onStatus?.(msg.online, msg.detail);
        return;
      }
      if (msg.t === 'init') {
        client = new WorkerClient(worker, msg, opts);
        for (const m of early.splice(0)) client.handle(m);
        resolve(client);
        return;
      }
      if (client) client.handle(msg);
      else early.push(msg);
    });
    worker.postMessage({ t: 'start', config } satisfies StartMsg);
  });
}

/** Worker에 붙은 SyncClient + 중계·스냅샷 도우미 */
export class WorkerClient extends SyncClient {
  private snapshotWaiters: Array<(b: Uint8Array) => void> = [];

  constructor(
    private readonly worker: PortLike,
    init: Extract<ToMain, { t: 'init' }>,
    opts: Omit<ClientOptions, 'post'>,
  ) {
    super(init, { ...opts, post: (m) => worker.postMessage(m) });
  }

  /** relay 모드: 네트워크에서 받은 업데이트를 Worker로 */
  deliver(kind: 'doc' | 'presence', bytes: Uint8Array): void {
    this.worker.postMessage({ t: 'net', kind, bytes } satisfies ToWorker);
  }

  /** Worker의 Loro 스냅샷 (relay 모드에서 새 피어를 붙일 때) */
  snapshot(): Promise<Uint8Array> {
    return new Promise((resolve) => {
      this.snapshotWaiters.push(resolve);
      this.worker.postMessage({ t: 'snapshot' } satisfies SnapshotMsg);
    });
  }

  takeSnapshot(bytes: Uint8Array): void {
    this.snapshotWaiters.shift()?.(bytes);
  }

  close(): void {
    this.worker.postMessage({ t: 'close' } satisfies ToWorker);
  }
}

export type { SegState };
