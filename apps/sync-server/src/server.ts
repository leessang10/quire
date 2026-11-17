/// <reference types="node" />
/**
 * Quire 동기화 중계 서버 (09 §8). 방(URL 경로)마다 Loro 문서를 하나 들고, 클라이언트의 업데이트를 받아 합치고
 * 다른 클라이언트에게 전한다. 프레즌스는 저장하지 않고 전하기만 한다 (새로 온 클라이언트에게는 마지막 것을 보낸다).
 *
 *   node apps/sync-server/src/server.ts [포트]     (기본 8787, Node 22.18+의 타입 제거 실행)
 *
 * 의존성: loro-crdt와 Node 내장 모듈만. WebSocket 프레임(RFC 6455)은 직접 처리한다 (이진 메시지, 조각 이어 붙이기,
 * ping/pong, close).
 *
 * 메시지 (첫 바이트 = 종류)
 *   클라이언트 → 서버  1 HELLO   [키 길이 u8][키 utf8][버전 벡터]
 *                      3 UPDATE  Loro 업데이트
 *                      4 PRESENCE 프레즌스 바이트
 *   서버 → 클라이언트  2 SYNC    [만들기 u8][서버 버전 벡터 길이 u32 BE][서버 버전 벡터][클라이언트에 없는 업데이트]
 *                                 만들기 = 1이면 방이 비어 있으니 이 클라이언트가 처음 내용을 만든다
 *                      3 UPDATE / 4 PRESENCE  다른 클라이언트의 것
 *                      5 GONE    [키 utf8] 연결이 끊긴 클라이언트
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { LoroDoc, VersionVector } from 'loro-crdt';

export const MSG = { HELLO: 1, SYNC: 2, UPDATE: 3, PRESENCE: 4, GONE: 5 } as const;

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

interface Room {
  doc: LoroDoc;
  conns: Set<Conn>;
  /** 빈 방에서 처음 내용을 만들기로 한 클라이언트가 있는가 */
  claimed: boolean;
  /** 처음 내용이 올 때까지 기다리는 클라이언트 (키, 버전 벡터) */
  waiting: Array<{ conn: Conn; vv: Uint8Array }>;
}

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface SyncServer {
  server: Server;
  port: number;
  close(): Promise<void>;
  /** 시험용: 방의 연결을 모두 끊는다 */
  dropAll(): void;
  rooms: Map<string, Room>;
}

export function startServer(port = 8787, log: (s: string) => void = () => {}): Promise<SyncServer> {
  const rooms = new Map<string, Room>();
  const all = new Set<Conn>();

  const roomOf = (name: string): Room => {
    let r = rooms.get(name);
    if (!r) {
      r = { doc: new LoroDoc(), conns: new Set(), claimed: false, waiting: [] };
      rooms.set(name, r);
    }
    return r;
  };

  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`quire sync server: ${rooms.size} room(s)\n`);
  });

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
      const vv = new Uint8Array(body.subarray(1 + klen));
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
      room.doc.import(new Uint8Array(body));
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
        dropAll() {
          for (const c of [...all]) c.socket.destroy();
        },
        close() {
          for (const c of [...all]) c.socket.destroy();
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
  const port = Number(process.argv[2] ?? 8787);
  startServer(port, (s) => console.log(s)).then((s) => console.log(`quire sync server on ws://localhost:${s.port}/<방 이름>`));
}
