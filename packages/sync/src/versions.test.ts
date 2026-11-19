/**
 * 버전 이력 (14 §5.1–5.2, 4-5): 서버 버전 목록(자동·이름), 피어 → 사용자, 버전 스냅샷(읽기 전용 보기), 앞 판 버전.
 * 실제 서버에 Worker 진입점(MessageChannel)으로 붙는다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type ServerOptions, type SyncServer } from '../../../apps/sync-server/src/server';
import { memoryStorage } from '../../../apps/sync-server/src/store';
import { documentFromSnapshot } from './epoch';
import { serveSyncWorker, startSyncWorker, type WorkerClient } from './host';

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

async function peer(url: string, peer: number, name: string, color: string, text = '') {
  const ch = new MessageChannel();
  serveSyncWorker(ch.port1 as unknown as Parameters<typeof serveSyncWorker>[0]);
  ch.port1.start();
  const p = startSyncWorker(ch.port2 as unknown as Parameters<typeof startSyncWorker>[0], { mode: 'ws', peer, user: { name, color }, url, text, batchMs: 10 }, {});
  ch.port2.start();
  const client: WorkerClient = await p;
  client.setSelection(0, 0); // 프레즌스 (서버가 피어 → 사용자를 배운다)
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
  return { client, close };
}

const room = () => `room-${Math.random().toString(36).slice(2)}`;
interface ListItem { id: string; epoch: string; time: number; auto: boolean; name?: string; authors: Array<{ name: string; color: string }>; current: boolean }
const list = async (port: number, name: string) => (await (await fetch(`http://localhost:${port}/${name}/versions`)).json()) as ListItem[];
const snapshotText = async (port: number, name: string, id: string) => {
  const res = await fetch(`http://localhost:${port}/${name}/versions/${id}`);
  expect(res.status).toBe(200);
  return documentFromSnapshot(new Uint8Array(await res.arrayBuffer())).body.text();
};

describe('version history (14 §5)', () => {
  it('records automatic versions after an edit pause and when the room empties, with authors from presence', async () => {
    const name = room();
    const s = await serve({ storage: memoryStorage(), versionIdleMs: 80 });
    const url = `ws://localhost:${s.port}/${name}`;
    const a = await peer(url, 41, '가영', '#2563eb', '하나');
    const b = await peer(url, 42, '나래', '#c2410c');
    a.client.doc.insertText(2, ' 둘');
    await until(async () => (await list(s.port, name)).length === 1, 5000, 'auto version after pause');
    const v1 = (await list(s.port, name))[0]!;
    expect(v1.auto).toBe(true);
    expect(v1.authors.map((u) => u.name)).toEqual(['가영']);
    expect(await snapshotText(s.port, name, v1.id)).toBe('하나 둘\n');
    // B가 편집하고 모두 나가면 (방이 빔) 바로 자동 버전
    await until(() => b.client.doc.text() === '하나 둘\n', 5000, 'b synced');
    b.client.doc.insertText(b.client.doc.maxCaret, ' 셋');
    await until(() => !b.client.pending && s.rooms.get(name)!.doc.toJSON() !== null, 2000);
    await new Promise((r) => setTimeout(r, 40));
    a.close();
    b.close();
    await until(async () => (await list(s.port, name)).length === 2, 5000, 'auto version when empty');
    const [v2] = await list(s.port, name);
    expect(v2!.authors.map((u) => u.name)).toEqual(['나래']);
    expect(await snapshotText(s.port, name, v2!.id)).toBe('하나 둘 셋\n');
    // 바뀐 것이 없으면 자동 버전을 또 남기지 않는다
    expect(s.version(name)).toBeNull();
  });

  it('names a version over HTTP, and opens versions of an earlier epoch after compaction', async () => {
    const name = room();
    const s = await serve({ storage: memoryStorage(), versionIdleMs: null });
    const url = `ws://localhost:${s.port}/${name}`;
    const a = await peer(url, 51, '가영', '#2563eb', '처음 글');
    await until(() => s.rooms.get(name)?.doc.oplogVersion().length() !== 0 && !a.client.pending, 5000, 'created');
    const res = await fetch(`http://localhost:${s.port}/${name}/versions`, { method: 'POST', body: JSON.stringify({ name: '초안 1' }) });
    expect(res.status).toBe(201);
    const named = (await res.json()) as ListItem;
    expect(named).toMatchObject({ name: '초안 1', auto: false, current: true });
    expect(named.authors.map((u) => u.name)).toEqual(['가영']);
    a.client.doc.insertText(0, '고친 ');
    await until(() => !a.client.pending, 5000);
    await new Promise((r) => setTimeout(r, 40));
    a.close();
    await until(() => s.rooms.get(name)!.conns.size === 0, 5000, 'left');
    const oldEpoch = s.rooms.get(name)!.epoch;
    expect(s.compact(name)).toBe(true);
    const vs = await list(s.port, name);
    // 압축 직전 자동 버전 + 이름 붙인 버전, 둘 다 앞 판
    expect(vs.map((v) => [v.name ?? 'auto', v.epoch === oldEpoch, v.current])).toEqual([
      ['auto', true, false],
      ['초안 1', true, false],
    ]);
    expect(await snapshotText(s.port, name, vs[1]!.id)).toBe('처음 글\n');
    expect(await snapshotText(s.port, name, vs[0]!.id)).toBe('고친 처음 글\n');
    // 새 판에서 이름 붙인 버전
    const b = await peer(url, 52, '나래', '#c2410c');
    await until(() => b.client.doc.text() === '고친 처음 글\n', 5000, 'joined new epoch');
    b.client.doc.insertText(0, '새 판 ');
    await until(() => !b.client.pending, 5000);
    await new Promise((r) => setTimeout(r, 40));
    const v3 = s.version(name, { name: '판 2' })!;
    expect(v3.epoch).not.toBe(oldEpoch);
    expect(await snapshotText(s.port, name, v3.id)).toBe('새 판 고친 처음 글\n');
    expect((await fetch(`http://localhost:${s.port}/${name}/versions/000000000000`)).status).toBe(404);
  });
});
