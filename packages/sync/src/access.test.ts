/**
 * 권한 (14 §6, 4-7, G6): 토큰 → 역할, 서버 검사 (view는 모두, comment는 댓글 밖의 변경을 거부), 거부되면 클라이언트가 서버 상태로
 * 돌아감, HTTP 쓰기 권한. 실제 서버에 Worker 진입점(MessageChannel)으로 붙는다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { commentOnlyUpdate, startServer, type ServerOptions, type SyncServer } from '../../../apps/sync-server/src/server';
import { memoryStorage } from '../../../apps/sync-server/src/store';
import { serveSyncWorker, startSyncWorker, type WorkerClient } from './host';
import { SyncBridge } from './index';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const f of cleanups.splice(0).reverse()) await f();
});

async function until(cond: () => boolean | Promise<boolean>, ms = 8000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function serve(opts: ServerOptions): Promise<SyncServer> {
  const s = await startServer(0, () => {}, opts);
  let closed = false;
  const close = s.close.bind(s);
  s.close = () => {
    if (closed) return Promise.resolve();
    closed = true;
    return close();
  };
  cleanups.push(() => s.close());
  return s;
}

async function peer(url: string, peer: number, text = '') {
  const ch = new MessageChannel();
  serveSyncWorker(ch.port1 as unknown as Parameters<typeof serveSyncWorker>[0]);
  ch.port1.start();
  const roles: string[] = [];
  const resets: boolean[] = [];
  const p = startSyncWorker(
    ch.port2 as unknown as Parameters<typeof startSyncWorker>[0],
    { mode: 'ws', peer, user: { name: `P${peer}`, color: '#123456' }, url, text, batchMs: 10 },
    { onRole: (r) => roles.push(r), onReset: (lost) => resets.push(lost) },
  );
  ch.port2.start();
  const client: WorkerClient = await p;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    client.close();
    setTimeout(() => {
      ch.port1.close();
      ch.port2.close();
    }, 50);
  };
  cleanups.push(close);
  return { client, roles, resets, close };
}

const room = () => `room-${Math.random().toString(36).slice(2)}`;
const author = { id: 'u', name: '가', color: '#000000' };

describe('access control (14 §6)', () => {
  it('without access.json everyone edits (development default)', async () => {
    const s = await serve({ storage: memoryStorage(), versionIdleMs: null });
    const a = await peer(`ws://localhost:${s.port}/${room()}`, 1, '글');
    await until(() => a.roles.length > 0, 5000, 'role');
    expect(a.roles).toEqual(['edit']);
  });

  it('view and comment tokens: the server rejects disallowed changes and the client falls back to the server state', async () => {
    const storage = memoryStorage();
    const name = room();
    storage.room(name).putAccess({ 'tok-e': 'edit', 'tok-c': 'comment', 'tok-v': 'view' });
    const s = await serve({ storage, versionIdleMs: null });
    const url = (t: string) => `ws://localhost:${s.port}/${name}?token=${t}`;
    const e = await peer(url('tok-e'), 11, '하나 둘 셋');
    await until(() => s.rooms.get(name)?.doc.oplogVersion().length() !== 0 && !e.client.pending, 5000, 'created');
    const c = await peer(url('tok-c'), 12);
    const v = await peer(url('tok-v'), 13);
    await until(() => c.client.doc.text() === '하나 둘 셋\n' && v.client.doc.text() === '하나 둘 셋\n', 5000, 'joined');
    await until(() => c.roles.includes('comment') && v.roles.includes('view'), 5000, 'roles');
    // view의 본문 편집: 거부되고 서버 상태로 돌아간다
    v.client.doc.insertText(0, 'V');
    await until(() => v.resets.length > 0, 5000, 'view reset');
    expect(v.resets).toEqual([true]);
    await until(() => v.client.doc.text() === '하나 둘 셋\n', 5000, 'view back to server');
    // comment의 댓글: 받아들인다
    c.client.document.addThread({ thread: 't1', annotation: 'a1', story: null, from: 3, to: 4, message: 'm1', author, text: '질문', time: 1 });
    await until(() => e.client.document.thread('t1')?.messages.length === 1, 5000, 'comment reached editor');
    expect(e.client.document.annotation('a1')?.type).toBe('comment');
    // comment의 본문 편집과 댓글 아닌 주석: 거부
    const denied = s.stats.denied;
    c.client.doc.insertText(0, 'C');
    await until(() => c.resets.length > 0 && c.client.doc.text() === '하나 둘 셋\n', 5000, 'comment reset');
    expect(s.stats.denied).toBeGreaterThan(denied);
    expect(s.rooms.get(name)!.doc.getText('body').toString().startsWith('C')).toBe(false);
    // 돌아간 뒤에도 댓글은 남아 있고 계속 달 수 있다
    await until(() => c.client.document.thread('t1') !== undefined, 5000, 'thread kept after reset');
    c.client.document.addMessage('t1', { id: 'm2', author, time: 2, text: '답' });
    await until(() => e.client.document.thread('t1')?.messages.length === 2, 5000, 'reply reached editor');
    // 편집 역할은 그대로 편집한다
    e.client.doc.insertText(0, 'E');
    await until(() => c.client.doc.text() === 'E하나 둘 셋\n' && v.client.doc.text() === 'E하나 둘 셋\n', 5000, 'edit reached all');
  });

  it('refuses unknown tokens and guards HTTP writes', async () => {
    const storage = memoryStorage();
    const name = room();
    storage.room(name).putAccess({ 'tok-e': 'edit', 'tok-v': 'view' });
    const s = await serve({ storage, versionIdleMs: null });
    const ws = new WebSocket(`ws://localhost:${s.port}/${name}?token=nope`);
    const closed = await new Promise<boolean>((r) => {
      ws.addEventListener('close', () => r(true));
      ws.addEventListener('error', () => r(true));
      setTimeout(() => r(false), 3000);
    });
    expect(closed).toBe(true);
    ws.close();
    const base = `http://localhost:${s.port}/${name}`;
    expect((await fetch(`${base}.json`)).status).toBe(403);
    expect((await fetch(`${base}.json?token=tok-v`)).status).toBe(200);
    const e = await peer(`ws://localhost:${s.port}/${name}?token=tok-e`, 21, '글');
    await until(() => s.rooms.get(name)?.doc.oplogVersion().length() !== 0 && !e.client.pending, 5000, 'created');
    const post = (t: string) => fetch(`${base}/versions?token=${t}`, { method: 'POST', body: JSON.stringify({ name: 'x' }) });
    expect((await post('tok-v')).status).toBe(403);
    expect((await post('tok-e')).status).toBe(201);
    expect((await fetch(`${base}/versions?token=tok-v`)).status).toBe(200);
  });

  it('measures the comment check (fork + diff) on a large document', () => {
    const b = SyncBridge.create(Array.from({ length: 10000 }, (_, i) => `${i}. 권한 검사 비용을 재는 긴 문서의 문단입니다.`).join('\n'), { peer: 1, batchMs: null });
    b.flush();
    const doc = new LoroDoc();
    doc.import(b.snapshot());
    const c = SyncBridge.fromSnapshot(b.snapshot(), { peer: 2, batchMs: null });
    const v0 = c.loro.oplogVersion();
    c.document.addThread({ thread: 't', annotation: 'a', story: null, from: 5000, to: 5010, message: 'm', author, text: '댓글', time: 1 });
    c.flush();
    const ok = c.loro.export({ mode: 'update', from: v0 });
    const v1 = c.loro.oplogVersion();
    c.doc.insertText(10, '본문');
    c.flush();
    const bad = c.loro.export({ mode: 'update', from: v1 });
    const t0 = performance.now();
    expect(commentOnlyUpdate(doc, ok)).toBe(true);
    const ms = performance.now() - t0;
    doc.import(ok);
    expect(commentOnlyUpdate(doc, bad)).toBe(false);
    console.log(`댓글 검사 (1만 문단): ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(500);
  });
});
