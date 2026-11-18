/// <reference types="node" />
/**
 * Quire 동기화 중계 서버 (09 §8–9). 방(URL 경로)마다 Loro 문서를 하나 들고, 클라이언트의 업데이트를 받아 합치고
 * 다른 클라이언트에게 전한다. 프레즌스는 저장하지 않고 전하기만 한다 (새로 온 클라이언트에게는 마지막 것을 보낸다).
 *
 *   node --experimental-transform-types --import ./apps/sync-server/src/resolve.ts apps/sync-server/src/server.ts
 *        [포트] [--data=디렉터리] [--idle=ms]
 *
 * 저장 (09 §9): 받은 업데이트는 곧바로 방의 로그에 덧붙이고, 일정 수마다 스냅샷으로 체크포인트한다. 방이 비면 정본 JSON도
 * 쓴다 (화면 텍스트 계산이 10만 문단에서 1초쯤 걸려, 편집 중에는 하지 않는다).
 * 방이 idle ms 동안 비어 있으면 새 판으로 압축하고 메모리에서 내린다. 다음 연결 때 저장소에서 다시 읽는다.
 *
 * WebSocket 메시지 (첫 바이트 = 종류)
 *   클라이언트 → 서버  1 HELLO   [키 길이 u8][키][판 길이 u8][판][버전 벡터]
 *                      3 UPDATE  Loro 업데이트
 *                      4 PRESENCE 프레즌스 바이트
 *   서버 → 클라이언트  2 SYNC    [만들기 u8][서버 버전 벡터 길이 u32 BE][서버 버전 벡터][클라이언트에 없는 업데이트]
 *                                 만들기 = 1이면 방이 비어 있으니 이 클라이언트가 처음 내용을 만든다
 *                      3 UPDATE / 4 PRESENCE  다른 클라이언트의 것
 *                      5 GONE    [키 utf8] 연결이 끊긴 클라이언트
 *                      6 REBASE  클라이언트의 판이 지났다 (ws.ts parseRebase):
 *                                 [다음 판][옛 판 마지막 VV][옛 판에서 클라이언트에 없는 업데이트][다음 판 처음 상태]
 *                                 클라이언트는 새 판으로 옮긴 뒤 HELLO를 다시 보낸다
 *
 * HTTP
 *   GET /<방>.json    정본 JSON (07 §4)
 *   GET /<방>.quire   .quire 파일 (document.json + history/crdt.bin)
 *   PUT /<방>.quire   .quire 파일로 빈 방을 만든다 (07 §3 여는 규칙)
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { LoroDoc, VersionVector } from 'loro-crdt';
import { assetIdOf, assetIdsOf, canonicalJson, compactDocument, documentFromLoro, documentFromQuire, openQuire, packQuire, quireFromDocument, quireFromText, readEpoch, type QuireAsset } from '@quire/sync';
import { fileStorage, memoryStorage, type RoomStore, type Storage } from './store';

export const MSG = { HELLO: 1, SYNC: 2, UPDATE: 3, PRESENCE: 4, GONE: 5, REBASE: 6 } as const;

interface Conn {
  socket: Duplex;
  room: Room;
  key: string | null;
  ready: boolean;
  presence: Uint8Array | null;
  buf: Buffer;
  /** 조각난 메시지 */
  parts: Buffer[];
}

export interface Room {
  name: string;
  doc: LoroDoc;
  /** 지금 판 ID (문서의 meta.epoch) */
  epoch: string;
  store: RoomStore;
  conns: Set<Conn>;
  /** 빈 방에서 처음 내용을 만들기로 한 클라이언트가 있는가 */
  claimed: boolean;
  /** 처음 내용이 올 때까지 기다리는 클라이언트 (키, 버전 벡터) */
  waiting: Array<{ conn: Conn; vv: Uint8Array }>;
  /** 마지막 체크포인트 뒤 받은 업데이트 수 */
  dirty: number;
  /** 저장된 정본 JSON이 지금 문서보다 옛것인가 */
  jsonStale: boolean;
  /** 판의 처음 상태 뒤로 바뀐 것이 있는가 (없으면 압축할 것이 없다) */
  changedSinceBase: boolean;
  idle: ReturnType<typeof setTimeout> | null;
}

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface ServerOptions {
  /** 저장소 (기본: 메모리) */
  storage?: Storage;
  /** 방이 이만큼 비어 있으면 새 판으로 압축하고 메모리에서 내린다. null이면 하지 않는다 (기본) */
  idleMs?: number | null;
  /** 업데이트 이만큼마다 체크포인트 (기본 200) */
  checkpointEvery?: number;
}

export interface SyncServer {
  server: Server;
  port: number;
  close(): Promise<void>;
  /** 시험용: 방의 연결을 모두 끊는다 */
  dropAll(): void;
  /** 메모리에 올라온 방 */
  rooms: Map<string, Room>;
  /** 시험용: 방을 지금 압축한다 (저장소에서 읽어 오며, 연결이 없을 때만) */
  compact(name: string): boolean;
}

const randomEpoch = () => randomBytes(6).toString('hex');
/** 서버가 새 판을 만들 때 쓰는 피어 ID (2^48 미만 임의 값) */
const randomPeer = () => randomBytes(6).readUIntBE(0, 6);

/** 문서의 정본 JSON */
export function documentJson(doc: LoroDoc): string {
  // 서식·문단 속성·스타일·목록까지 (10)
  return canonicalJson(doc.oplogVersion().length() > 0 ? quireFromDocument(documentFromLoro(doc)) : quireFromText('\n'));
}

export function startServer(port = 8787, log: (s: string) => void = () => {}, opts: ServerOptions = {}): Promise<SyncServer> {
  const rooms = new Map<string, Room>();
  const all = new Set<Conn>();
  const storage = opts.storage ?? memoryStorage();
  const idleMs = opts.idleMs ?? null;
  const checkpointEvery = opts.checkpointEvery ?? 200;

  const roomOf = (name: string): Room => {
    const loaded = rooms.get(name);
    if (loaded) return loaded;
    const store = storage.room(name);
    const doc = new LoroDoc();
    const { snapshot, updates } = store.load();
    if (snapshot && snapshot.length > 0) doc.import(snapshot);
    if (updates.length > 0) doc.importBatch(updates);
    const epoch = readEpoch(doc);
    let changedSinceBase = true;
    const base = store.epochBase(epoch);
    if (base) {
      const b = new LoroDoc();
      b.import(base);
      changedSinceBase = b.oplogVersion().compare(doc.oplogVersion()) !== 0;
    }
    const r: Room = { name, doc, epoch, store, conns: new Set(), claimed: false, waiting: [], dirty: updates.length, jsonStale: true, changedSinceBase, idle: null };
    rooms.set(name, r);
    if (snapshot || updates.length > 0) log(`< ${name}: 판 '${epoch}', 로그 ${updates.length}개`);
    return r;
  };

  /** 스냅샷 체크포인트. withJson이면 정본 JSON도 (바뀌었을 때만) */
  function checkpoint(room: Room, withJson = false): void {
    const json = withJson && room.jsonStale;
    if (room.dirty === 0 && !json) return;
    room.store.checkpoint(room.doc.export({ mode: 'snapshot' }), json ? documentJson(room.doc) : null);
    room.dirty = 0;
    if (json) room.jsonStale = false;
  }

  /** 새 판으로 압축한다 (연결이 없고 바뀐 것이 있을 때만) */
  function compact(room: Room): boolean {
    if (room.conns.size > 0 || room.doc.oplogVersion().length() === 0 || !room.changedSinceBase) return false;
    checkpoint(room);
    const old = room.doc.export({ mode: 'snapshot' });
    const next = randomEpoch();
    const fresh = compactDocument(documentFromLoro(room.doc), next, randomPeer());
    const base = fresh.export({ mode: 'snapshot' });
    room.store.saveEpoch(room.epoch, old, next, base, documentJson(fresh));
    log(`* ${room.name}: 판 '${room.epoch}' → '${next}' (${old.length} → ${base.length} 바이트)`);
    room.doc = fresh;
    room.epoch = next;
    room.changedSinceBase = false;
    room.jsonStale = false;
    return true;
  }

  /** 방이 비었을 때(또는 HTTP로만 열었을 때): 체크포인트하고, idle 뒤에 압축하고 내린다 */
  function idle(room: Room): void {
    if (room.conns.size > 0) return;
    checkpoint(room, true);
    if (idleMs === null) return;
    if (room.idle !== null) clearTimeout(room.idle);
    room.idle = setTimeout(() => {
      room.idle = null;
      if (room.conns.size > 0 || rooms.get(room.name) !== room) return;
      compact(room);
      rooms.delete(room.name);
      log(`> ${room.name}: 메모리에서 내림`);
    }, idleMs);
  }

  const server = createServer((req, res) => {
    try {
      onHttp(req, res);
    } catch (e) {
      log(`! ${String(e)}`);
      if (!res.headersSent) reply(res, 500, String(e));
    }
  });

  function reply(res: ServerResponse, status: number, body: string | Uint8Array, type = 'text/plain; charset=utf-8', extra: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', ...extra });
    res.end(body);
  }

  const jsonReply = (res: ServerResponse, status: number, body: unknown) => reply(res, status, JSON.stringify(body), 'application/json; charset=utf-8');

  /** 자산 한 개를 이만큼까지 받는다 */
  const MAX_ASSET = 20 * 1024 * 1024;

  function onAsset(req: IncomingMessage, res: ServerResponse, name: string, id: string): void {
    const room = roomOf(name);
    const store = room.store;
    if (req.method === 'GET') {
      const a = store.getAsset(id);
      if (!a) reply(res, 404, 'no such asset');
      else reply(res, 200, a.bytes, a.mime, { 'cache-control': 'public, max-age=31536000, immutable' });
      idle(room);
      return;
    }
    if (req.method !== 'PUT') {
      reply(res, 405, 'method not allowed');
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= MAX_ASSET) chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_ASSET) {
        reply(res, 413, 'asset too large');
        return;
      }
      const bytes = new Uint8Array(Buffer.concat(chunks));
      void assetIdOf(bytes).then((got) => {
        if (got !== id) {
          reply(res, 400, 'content does not match the asset id');
          return;
        }
        const mime = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!;
        if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(mime)) {
          reply(res, 415, 'unsupported asset type');
          return;
        }
        store.putAsset(id, mime, bytes);
        reply(res, 201, 'ok');
        idle(room);
      });
    });
  }

  function onHttp(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, PUT',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!.replace(/^\/+/, ''));
    // 자산 (11 §2.2): <방>/assets/<ID>. ID는 내용 해시라 PUT은 내용을 확인한다
    const am = /^(.+)\/assets\/([0-9a-f]{32})$/.exec(path);
    if (am) {
      onAsset(req, res, am[1]!, am[2]!);
      return;
    }
    const m = /^(.+)\.(json|quire)$/.exec(path);
    if (!m) {
      reply(res, 200, `quire sync server: ${rooms.size} room(s) loaded\n`);
      return;
    }
    const name = m[1]!;
    const ext = m[2]!;
    if (req.method === 'PUT' && ext === 'quire') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        putQuire(name, new Uint8Array(Buffer.concat(chunks)))
          .then((r) => jsonReply(res, r.status, r.body))
          .catch((e: unknown) => jsonReply(res, 400, { error: e instanceof Error ? e.message : String(e) }));
      });
      return;
    }
    if (req.method !== 'GET') {
      reply(res, 405, 'method not allowed');
      return;
    }
    const room = roomOf(name);
    if (ext === 'json') {
      reply(res, 200, documentJson(room.doc), 'application/json; charset=utf-8');
      idle(room);
      return;
    }
    const assets: QuireAsset[] = [];
    for (const id of assetIdsOf(documentFromLoro(room.doc))) {
      const a = room.store.getAsset(id);
      if (a) assets.push({ id, ...a });
    }
    void packQuire({ loro: room.doc, assets }).then((bytes) => {
      reply(res, 200, bytes, 'application/vnd.quire', { 'content-disposition': `attachment; filename="${encodeURIComponent(name)}.quire"` });
      idle(room);
    });
  }

  /** .quire 파일로 빈 방을 만든다 */
  async function putQuire(name: string, bytes: Uint8Array): Promise<{ status: number; body: unknown }> {
    const opened = await openQuire(bytes);
    if (opened.readOnly) return { status: 422, body: { error: '이 엔진보다 새 포맷이라 읽기 전용으로만 열 수 있습니다' } };
    const room = roomOf(name);
    if (room.doc.oplogVersion().length() > 0 || room.conns.size > 0) return { status: 409, body: { error: '이미 내용이 있는 방입니다' } };
    let update: Uint8Array;
    if (opened.crdt) {
      update = opened.crdt;
    } else {
      update = compactDocument(documentFromQuire(opened.doc).document, randomEpoch(), randomPeer()).export({ mode: 'snapshot' });
    }
    room.doc.import(update);
    for (const a of opened.assets) room.store.putAsset(a.id, a.mime, a.bytes);
    room.epoch = readEpoch(room.doc);
    room.store.append(update);
    room.dirty++;
    room.changedSinceBase = true;
    room.jsonStale = true;
    idle(room);
    log(`+ ${name}: .quire에서 만듦 (이력 ${opened.crdt ? '있음' : '없음'})`);
    return { status: 201, body: { room: name, history: opened.crdt !== null, notes: opened.notes } };
  }

  server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const name = decodeURIComponent((req.url ?? '/').split('?')[0]!.replace(/^\/+/, '')) || 'default';
    const room = roomOf(name);
    if (room.idle !== null) {
      clearTimeout(room.idle);
      room.idle = null;
    }
    const conn: Conn = { socket, room, key: null, ready: false, presence: null, buf: Buffer.alloc(0), parts: [] };
    room.conns.add(conn);
    all.add(conn);
    log(`+ ${name} (${room.conns.size})`);
    socket.on('data', (d: Buffer) => onData(conn, d));
    const gone = () => {
      if (!room.conns.delete(conn)) return;
      all.delete(conn);
      room.waiting = room.waiting.filter((w) => w.conn !== conn);
      log(`- ${name} (${room.conns.size})`);
      if (conn.key) broadcast(room, conn, frame(MSG.GONE, Buffer.from(conn.key, 'utf8')));
      if (room.conns.size === 0) {
        room.claimed = false;
        idle(room);
      }
    };
    socket.on('close', gone);
    socket.on('error', gone);
  });

  function onData(conn: Conn, d: Buffer): void {
    conn.buf = conn.buf.length ? Buffer.concat([conn.buf, d]) : d;
    for (;;) {
      const f = parseFrame(conn.buf);
      if (!f) return;
      conn.buf = conn.buf.subarray(f.size);
      if (f.opcode === 0x8) {
        conn.socket.end(wsFrame(0x8, Buffer.alloc(0)));
        return;
      }
      if (f.opcode === 0x9) {
        conn.socket.write(wsFrame(0xa, f.payload));
        continue;
      }
      if (f.opcode === 0x2 || f.opcode === 0x1 || f.opcode === 0x0) {
        conn.parts.push(f.payload);
        if (!f.fin) continue;
        const msg = conn.parts.length === 1 ? conn.parts[0]! : Buffer.concat(conn.parts);
        conn.parts = [];
        try {
          onMessage(conn, msg);
        } catch (e) {
          log(`! ${String(e)}`);
        }
      }
    }
  }

  function onMessage(conn: Conn, msg: Buffer): void {
    const room = conn.room;
    const type = msg[0];
    const body = msg.subarray(1);
    if (type === MSG.HELLO) {
      const klen = body[0]!;
      conn.key = body.subarray(1, 1 + klen).toString('utf8');
      const elen = body[1 + klen]!;
      const epoch = body.subarray(2 + klen, 2 + klen + elen).toString('utf8');
      const vv = new Uint8Array(body.subarray(2 + klen + elen));
      conn.ready = false;
      const clientHas = vv.length > 0 && VersionVector.decode(vv).length() > 0;
      if (clientHas && epoch !== room.epoch && room.doc.oplogVersion().length() > 0) {
        sendRebase(conn, epoch, vv);
        return;
      }
      if (room.doc.oplogVersion().length() === 0) {
        if (!room.claimed) {
          room.claimed = true;
          sendSync(conn, true, vv);
        } else {
          room.waiting.push({ conn, vv });
        }
        return;
      }
      sendSync(conn, false, vv);
    } else if (type === MSG.UPDATE) {
      if (!conn.ready) return;
      const update = new Uint8Array(body);
      room.doc.import(update);
      room.store.append(update);
      room.changedSinceBase = true;
      room.jsonStale = true;
      if (room.epoch === '') room.epoch = readEpoch(room.doc);
      if (++room.dirty >= checkpointEvery) checkpoint(room);
      broadcast(room, conn, frame(MSG.UPDATE, body));
      if (room.waiting.length) {
        const w = room.waiting;
        room.waiting = [];
        for (const { conn: c, vv } of w) sendSync(c, false, vv);
      }
    } else if (type === MSG.PRESENCE) {
      conn.presence = new Uint8Array(body);
      broadcast(room, conn, frame(MSG.PRESENCE, body));
    }
  }

  function sendSync(conn: Conn, create: boolean, clientVV: Uint8Array): void {
    const doc = conn.room.doc;
    const server = doc.oplogVersion().encode();
    let update: Uint8Array = new Uint8Array(0);
    if (!create) {
      const from = clientVV.length ? VersionVector.decode(clientVV) : new VersionVector(null);
      update = doc.export({ mode: 'update', from });
    }
    const head = Buffer.alloc(5);
    head[0] = create ? 1 : 0;
    head.writeUInt32BE(server.length, 1);
    send(conn, frame(MSG.SYNC, Buffer.concat([head, Buffer.from(server), Buffer.from(update)])));
    conn.ready = true;
    // 다른 클라이언트의 마지막 프레즌스
    for (const c of conn.room.conns) if (c !== conn && c.presence) send(conn, frame(MSG.PRESENCE, Buffer.from(c.presence)));
  }

  /** 클라이언트의 판이 지났다: 다음 판으로 옮길 정보를 보낸다 */
  function sendRebase(conn: Conn, epoch: string, clientVV: Uint8Array): void {
    const room = conn.room;
    const info = room.store.epochFinal(epoch);
    const base = info ? room.store.epochBase(info.next) : null;
    let next = room.epoch;
    let oldVV: Uint8Array = new Uint8Array(0);
    let update: Uint8Array = new Uint8Array(0);
    let start: Uint8Array;
    if (info && base) {
      const old = new LoroDoc();
      old.import(info.final);
      update = old.export({ mode: 'update', from: VersionVector.decode(clientVV) });
      oldVV = old.oplogVersion().encode();
      next = info.next;
      start = base;
    } else {
      // 모르는 판: 이쪽 변경을 살릴 수 없다. 지금 문서를 통째로 준다
      start = room.doc.export({ mode: 'snapshot' });
    }
    const e = Buffer.from(next, 'utf8');
    const b = Buffer.alloc(1 + e.length + 4 + oldVV.length + 4 + update.length + start.length);
    let at = 0;
    b[at++] = e.length;
    e.copy(b, at);
    at += e.length;
    b.writeUInt32BE(oldVV.length, at);
    at += 4;
    b.set(oldVV, at);
    at += oldVV.length;
    b.writeUInt32BE(update.length, at);
    at += 4;
    b.set(update, at);
    at += update.length;
    b.set(start, at);
    log(`~ ${room.name}: ${conn.key} 판 '${epoch}' → '${next}'${info ? '' : ' (모르는 판)'}`);
    send(conn, frame(MSG.REBASE, b));
  }

  function broadcast(room: Room, from: Conn, data: Buffer): void {
    for (const c of room.conns) if (c !== from && c.ready) send(c, data);
  }

  function send(conn: Conn, data: Buffer): void {
    if (!conn.socket.destroyed) conn.socket.write(wsFrame(0x2, data));
  }

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        server,
        port: actual,
        rooms,
        compact(name) {
          return compact(roomOf(name));
        },
        dropAll() {
          for (const c of [...all]) c.socket.destroy();
        },
        close() {
          for (const c of [...all]) c.socket.destroy();
          for (const r of rooms.values()) {
            if (r.idle !== null) clearTimeout(r.idle);
            checkpoint(r, true);
          }
          return new Promise((r) => server.close(() => r()));
        },
      });
    });
  });
}

function frame(type: number, body: Uint8Array): Buffer {
  const b = Buffer.alloc(1 + body.length);
  b[0] = type;
  b.set(body, 1);
  return b;
}

/** 서버 → 클라이언트 프레임 (마스크 없음) */
function wsFrame(opcode: number, payload: Buffer): Buffer {
  const n = payload.length;
  const head = n < 126 ? Buffer.alloc(2) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (n < 126) head[1] = n;
  else if (n < 65536) {
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

/** 클라이언트 → 서버 프레임 하나 (마스크 있음). 아직 다 오지 않았으면 null */
function parseFrame(b: Buffer): { fin: boolean; opcode: number; payload: Buffer; size: number } | null {
  if (b.length < 2) return null;
  const fin = (b[0]! & 0x80) !== 0;
  const opcode = b[0]! & 0x0f;
  const masked = (b[1]! & 0x80) !== 0;
  let n = b[1]! & 0x7f;
  let off = 2;
  if (n === 126) {
    if (b.length < 4) return null;
    n = b.readUInt16BE(2);
    off = 4;
  } else if (n === 127) {
    if (b.length < 10) return null;
    n = Number(b.readBigUInt64BE(2));
    off = 10;
  }
  const maskOff = off;
  if (masked) off += 4;
  if (b.length < off + n) return null;
  const payload = Buffer.from(b.subarray(off, off + n));
  if (masked) for (let i = 0; i < n; i++) payload[i] = payload[i]! ^ b[maskOff + (i & 3)]!;
  return { fin, opcode, payload, size: off + n };
}

// 직접 실행했을 때
if (process.argv[1] && /server\.ts$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const flag = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const port = Number(args.find((a) => !a.startsWith('--')) ?? 8787);
  const data = flag('data') ?? '.quire-data';
  const idleMs = Number(flag('idle') ?? 10000);
  void startServer(port, (s) => console.log(s), { storage: fileStorage(data), idleMs }).then((s) =>
    console.log(`quire sync server on ws://localhost:${s.port}/<방 이름> (저장: ${data}, 빈 방 ${idleMs} ms 뒤 압축)`),
  );
}
