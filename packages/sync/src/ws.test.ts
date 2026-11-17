/**
 * WebSocket 중계 서버 + Worker 진입점 시험 (09 §8). Worker 대신 MessageChannel 양 끝에
 * serveSyncWorker / startSyncWorker를 붙이고, 실제 서버(apps/sync-server)에 연결한다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type SyncServer } from '../../../apps/sync-server/src/server';
import { serveSyncWorker, startSyncWorker, type WorkerClient } from './host';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const f of cleanups.splice(0).reverse()) await f();
});

async function until(cond: () => boolean, ms = 5000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function peer(url: string, peer: number, text = '') {
  const ch = new MessageChannel();
  serveSyncWorker(ch.port1 as unknown as Parameters<typeof serveSyncWorker>[0]);
  ch.port1.start();
  const status: boolean[] = [];
  const p = startSyncWorker(
    ch.port2 as unknown as Parameters<typeof startSyncWorker>[0],
    { mode: 'ws', peer, user: { name: `P${peer}`, color: '#123456' }, url, text, batchMs: 10 },
    { onStatus: (online) => status.push(online) },
  );
  ch.port2.start();
  const client: WorkerClient = await p;
  cleanups.push(() => {
    client.close();
    ch.port1.close();
    ch.port2.close();
  });
  return { client, status };
}

describe('WebSocket sync', () => {
  let server: SyncServer;

  async function serve() {
    server = await startServer(0);
    cleanups.push(() => server.close());
    return `ws://localhost:${server.port}/room-${Math.random().toString(36).slice(2)}`;
  }

  it('creates the document on the first client, syncs edits and carets to the second', async () => {
    const url = await serve();
    const a = await peer(url, 11, '첫 문단\n둘째 문단');
    const b = await peer(url, 12, '무시되는 내용');
    expect(b.client.doc.text()).toBe(a.client.doc.text());
    a.client.doc.insertText(0, '가');
    b.client.doc.insertText(b.client.doc.maxCaret, '나');
    await until(() => a.client.doc.text() === b.client.doc.text() && a.client.doc.text().includes('나'), 5000, 'edits');
    expect(a.client.doc.text()).toBe('가첫 문단\n둘째 문단나\n');
    a.client.setSelection(1, 3);
    await until(() => b.client.remotes().length === 1, 5000, 'caret');
    expect(b.client.remotes()[0]).toMatchObject({ key: '11', anchor: 1, head: 3 });
  });

  it('reconnects after the connection drops and merges edits made while offline', async () => {
    const url = await serve();
    const a = await peer(url, 21, '가나다');
    const b = await peer(url, 22);
    server.dropAll();
    await until(() => a.status.includes(false) && b.status.includes(false), 5000, 'offline');
    // 끊긴 동안 양쪽에서 편집
    a.client.doc.insertText(0, 'A');
    b.client.doc.insertText(2, 'B');
    b.client.doc.moveParagraphs(0, 0, 1);
    await until(() => a.client.doc.text() === b.client.doc.text() && a.client.doc.text().includes('A') && a.client.doc.text().includes('B'), 8000, 'merge after reconnect');
    expect(a.client.doc.text()).toBe('A가나B다\n');
    expect(a.status.at(-1)).toBe(true);
    // 서버의 문서도 같다
    const room = [...server.rooms.values()][0]!;
    expect(room.doc.getText('body').toString().replace(//g, '')).toContain('A가나B다');
  });

  it('forgets the caret of a peer that disconnects', async () => {
    const url = await serve();
    const a = await peer(url, 31, '가나다');
    const b = await peer(url, 32);
    a.client.setSelection(2, 2);
    await until(() => b.client.remotes().length === 1, 5000, 'caret');
    a.client.close();
    await until(() => b.client.remotes().length === 0, 5000, 'caret removed');
  });

  it('gives a late joiner the current carets', async () => {
    const url = await serve();
    const a = await peer(url, 41, '가나다');
    a.client.setSelection(1, 1);
    await new Promise((r) => setTimeout(r, 50));
    const b = await peer(url, 42);
    await until(() => b.client.remotes().length === 1, 5000, 'caret for late joiner');
    expect(b.client.remotes()[0]).toMatchObject({ anchor: 1 });
  });
});
