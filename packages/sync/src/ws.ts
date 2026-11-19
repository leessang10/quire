/**
 * WebSocket 연결 (09 §8): 중계 서버(apps/sync-server)와 문서·프레즌스 업데이트를 주고받는다.
 *
 * - 연결될 때마다 버전 벡터를 보내고(HELLO), 서버가 이쪽에 없는 업데이트와 서버의 버전 벡터를 보낸다(SYNC).
 *   이쪽은 서버에 없는 것(끊긴 동안의 편집 포함)을 서버 버전 벡터 기준으로 내보내 보낸다. 그래서 끊긴 동안 보내다
 *   잃은 업데이트가 있어도 다시 연결하면 맞춰진다.
 * - 끊기면 0.5초에서 시작해 두 배씩(최대 5초) 기다렸다가 다시 연결한다.
 * - 빈 방이면 서버가 처음 내용을 만들 클라이언트 하나를 정한다(SYNC의 만들기 표시).
 * - HELLO에는 이쪽 문서의 판(epoch)도 넣는다. 서버가 그사이 새 판으로 압축했으면 SYNC 대신 REBASE가 온다 (09 §9).
 *   onRebase가 새 판 문서를 돌려주면 그 문서로 다시 HELLO를 보낸다.
 */
import { VersionVector, type LoroDoc } from 'loro-crdt';
import type { NetOut } from './core';
import { readEpoch, type RebaseInfo } from './epoch';

export const MSG = { HELLO: 1, SYNC: 2, UPDATE: 3, PRESENCE: 4, GONE: 5, REBASE: 6, ROLE: 7 } as const;

/** 서버가 알린 이 연결의 역할 (14 §6) */
export type Role = 'edit' | 'comment' | 'view';

export interface WsLinkHandlers {
  /**
   * 서버와 맞췄다. update: 이쪽에 없던 업데이트 (가져와야 한다). first: 처음 연결. create: 빈 방이라 이쪽이 처음 내용을 만든다.
   * 이 함수가 끝난 뒤 서버에 없는 이쪽 변경을 보낸다.
   */
  onSync(info: { first: boolean; create: boolean; update: Uint8Array }): void;
  onDoc(bytes: Uint8Array): void;
  onPresence(bytes: Uint8Array): void;
  onGone(key: string): void;
  /** 서버가 새 판으로 바뀌었다: 옛 판 문서(이쪽 변경 포함)를 새 판으로 옮겨 그 문서를 돌려준다 */
  onRebase(info: RebaseInfo): Promise<LoroDoc>;
  onStatus?(online: boolean, detail?: string): void;
  /** 서버가 알린 역할 (SYNC 바로 뒤) */
  onRole?(role: Role): void;
}

export interface WsLinkOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  /** 시험용: WebSocket 생성자 */
  WebSocketImpl?: typeof WebSocket;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class WsLink implements NetOut {
  private ws: WebSocket | null = null;
  private synced = false;
  private first = true;
  private delay: number;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private loro: LoroDoc;
  private readonly opts: Required<Omit<WsLinkOptions, 'WebSocketImpl'>> & { WebSocketImpl: typeof WebSocket };

  constructor(
    private readonly url: string,
    loro: LoroDoc,
    private readonly key: string,
    private readonly h: WsLinkHandlers,
    opts: WsLinkOptions = {},
  ) {
    this.loro = loro;
    this.opts = {
      minDelayMs: opts.minDelayMs ?? 500,
      maxDelayMs: opts.maxDelayMs ?? 5000,
      WebSocketImpl: opts.WebSocketImpl ?? WebSocket,
    };
    this.delay = this.opts.minDelayMs;
    this.connect();
  }

  get online(): boolean {
    return this.synced;
  }

  sendDoc(bytes: Uint8Array): void {
    this.send(MSG.UPDATE, bytes);
  }

  sendPresence(bytes: Uint8Array): void {
    this.send(MSG.PRESENCE, bytes);
  }

  /** 시험용: 연결을 끊는다 (곧 다시 연결한다) */
  drop(): void {
    this.ws?.close();
  }

  close(): void {
    this.closed = true;
    if (this.retry !== null) clearTimeout(this.retry);
    this.ws?.close();
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new this.opts.WebSocketImpl(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => this.hello(ws);
    ws.onmessage = (e: MessageEvent) => this.onMessage(new Uint8Array(e.data as ArrayBuffer));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.synced = false;
      if (this.closed) return;
      this.h.onStatus?.(false, `연결 끊김 · ${Math.round(this.delay / 100) / 10}초 뒤 다시 연결`);
      this.retry = setTimeout(() => {
        this.retry = null;
        this.connect();
      }, this.delay);
      this.delay = Math.min(this.opts.maxDelayMs, this.delay * 2);
    };
    ws.onerror = () => {
      /* onclose가 뒤따른다 */
    };
  }

  private hello(ws: WebSocket): void {
    const k = encoder.encode(this.key);
    const e = encoder.encode(readEpoch(this.loro));
    const vv = this.loro.oplogVersion().encode();
    const msg = new Uint8Array(3 + k.length + e.length + vv.length);
    msg[0] = MSG.HELLO;
    msg[1] = k.length;
    msg.set(k, 2);
    msg[2 + k.length] = e.length;
    msg.set(e, 3 + k.length);
    msg.set(vv, 3 + k.length + e.length);
    ws.send(msg);
  }

  private onMessage(m: Uint8Array): void {
    const type = m[0];
    const body = m.subarray(1);
    if (type === MSG.REBASE) {
      const info = parseRebase(body);
      const ws = this.ws;
      this.h.onStatus?.(false, '새 판으로 옮기는 중');
      void this.h.onRebase(info).then((loro) => {
        this.loro = loro;
        if (ws && this.ws === ws && ws.readyState === 1) this.hello(ws);
      });
    } else if (type === MSG.SYNC) {
      const create = body[0] === 1;
      const n = ((body[1]! << 24) | (body[2]! << 16) | (body[3]! << 8) | body[4]!) >>> 0;
      const serverVV = body.slice(5, 5 + n);
      const update = body.slice(5 + n);
      const first = this.first;
      this.first = false;
      this.h.onSync({ first, create, update });
      // 서버에 없는 이쪽 변경 (처음 만든 내용, 끊긴 동안의 편집)
      const from = serverVV.length ? VersionVector.decode(serverVV) : new VersionVector(null);
      const mine = this.loro.export({ mode: 'update', from });
      this.synced = true;
      this.delay = this.opts.minDelayMs;
      if (mine.length > 0) this.send(MSG.UPDATE, mine);
      this.h.onStatus?.(true);
    } else if (type === MSG.UPDATE) {
      this.h.onDoc(body.slice());
    } else if (type === MSG.PRESENCE) {
      this.h.onPresence(body.slice());
    } else if (type === MSG.GONE) {
      this.h.onGone(decoder.decode(body));
    } else if (type === MSG.ROLE) {
      const r = decoder.decode(body);
      if (r === 'edit' || r === 'comment' || r === 'view') this.h.onRole?.(r);
    }
  }

  private send(type: number, bytes: Uint8Array): void {
    const ws = this.ws;
    if (!ws || !this.synced || ws.readyState !== 1) return;
    const msg = new Uint8Array(1 + bytes.length);
    msg[0] = type;
    msg.set(bytes, 1);
    ws.send(msg);
  }
}

/** REBASE 본문: [판 길이 u8][판][옛 VV 길이 u32][옛 VV][업데이트 길이 u32][업데이트][새 판 처음 스냅샷] */
export function parseRebase(b: Uint8Array): RebaseInfo {
  const u32 = (at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
  let at = 0;
  const el = b[at++]!;
  const epoch = decoder.decode(b.subarray(at, at + el));
  at += el;
  const vl = u32(at);
  at += 4;
  const oldVV = b.slice(at, at + vl);
  at += vl;
  const ul = u32(at);
  at += 4;
  const update = b.slice(at, at + ul);
  at += ul;
  return { epoch, oldVV, update, base: b.slice(at) };
}
