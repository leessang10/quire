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

describe('version compare, restore and retention (14 §5.3–5.5)', () => {
  const restore = (port: number, name: string, id: string) => fetch(`http://localhost:${port}/${name}/versions/${id}/restore`, { method: 'POST' });

  it('restores a version for every client (revertTo), and the state just before is kept as a version so restore can be undone', async () => {
    const name = room();
    const s = await serve({ storage: memoryStorage(), versionIdleMs: null });
    const url = `ws://localhost:${s.port}/${name}`;
    const a = await peer(url, 61, '가영', '#2563eb', '하나 둘');
    const b = await peer(url, 62, '나래', '#c2410c');
    await until(() => b.client.doc.text() === '하나 둘\n', 5000, 'joined');
    const v1 = s.version(name, { name: '처음' })!;
    a.client.doc.insertText(0, 'A ');
    await until(() => b.client.doc.text() === 'A 하나 둘\n', 5000, 'a edit');
    b.client.doc.insertText(b.client.doc.maxCaret, ' B');
    await until(() => a.client.doc.text() === 'A 하나 둘 B\n', 5000, 'b edit');
    expect((await restore(s.port, name, v1.id)).status).toBe(200);
    await until(() => a.client.doc.text() === '하나 둘\n' && b.client.doc.text() === '하나 둘\n', 5000, 'restored on both');
    // 복원 직전 상태가 자동 버전으로 남았다: 그것으로 다시 복원하면 되돌아간다
    const before = (await list(s.port, name)).find((v) => v.auto)!;
    expect(await snapshotText(s.port, name, before.id)).toBe('A 하나 둘 B\n');
    expect((await restore(s.port, name, before.id)).status).toBe(200);
    await until(() => a.client.doc.text() === 'A 하나 둘 B\n' && b.client.doc.text() === 'A 하나 둘 B\n', 5000, 'restored back');
    // 복원한 뒤에도 편집이 이어진다
    a.client.doc.insertText(0, '>');
    await until(() => b.client.doc.text() === '>A 하나 둘 B\n', 5000, 'edit after restore');
  });

  it('restores a version of an earlier epoch by applying the difference', async () => {
    const name = room();
    const s = await serve({ storage: memoryStorage(), versionIdleMs: null });
    const url = `ws://localhost:${s.port}/${name}`;
    const a = await peer(url, 71, '가영', '#2563eb', '옛 글 하나');
    await until(() => s.rooms.get(name)?.doc.oplogVersion().length() !== 0 && !a.client.pending, 5000, 'created');
    const v = s.version(name, { name: '옛 판' })!;
    a.client.doc.deleteRange(0, 2);
    a.client.doc.insertText(a.client.doc.maxCaret, ' 고침');
    await until(() => !a.client.pending, 5000);
    await new Promise((r) => setTimeout(r, 40));
    a.close();
    await until(() => s.rooms.get(name)!.conns.size === 0, 5000, 'left');
    expect(s.compact(name)).toBe(true);
    const b = await peer(url, 72, '나래', '#c2410c');
    await until(() => b.client.doc.text() === '글 하나 고침\n', 5000, 'new epoch');
    expect(s.restore(name, v.id)).toBe(true);
    await until(() => b.client.doc.text() === '옛 글 하나\n', 5000, 'restored from old epoch');
  });

  it('compares two versions on the client from the epoch history (accept-all = later version)', async () => {
    const name = room();
    const s = await serve({ storage: memoryStorage(), versionIdleMs: null });
    const a = await peer(`ws://localhost:${s.port}/${name}`, 81, '가영', '#2563eb', '하나 둘 셋');
    await until(() => s.rooms.get(name)?.doc.oplogVersion().length() !== 0 && !a.client.pending, 5000, 'created');
    s.version(name, { name: 'A' });
    a.client.doc.insertText(3, '새 ');
    a.client.doc.deleteRange(0, 2);
    await until(() => !a.client.pending, 5000);
    await new Promise((r) => setTimeout(r, 40));
    s.version(name, { name: 'B' });
    const [vB, vA] = (await list(s.port, name)) as Array<ListItem & { frontiers: Array<{ peer: string; counter: number }> }>;
    const epoch = vA!.epoch || '_';
    const hist = new Uint8Array(await (await fetch(`http://localhost:${s.port}/${name}/history/${epoch}`)).arrayBuffer());
    const { compareVersions } = await import('./compare');
    const { LoroDoc } = await import('loro-crdt');
    const loro = new LoroDoc();
    loro.import(hist);
    const c = compareVersions(loro, vA!.frontiers, vB!.frontiers);
    expect(c.annotationRanges().map((r) => r.data.kind).sort()).toEqual(['delete', 'insert']);
    c.resolveAll(true, undefined, false);
    expect(c.body.text()).toBe(await snapshotText(s.port, name, vB!.id));
  });

  it('keeps named versions and prunes automatic versions beyond the limit', async () => {
    const name = room();
    const s = await serve({ storage: memoryStorage(), versionIdleMs: null, maxAutoVersions: 2 });
    const a = await peer(`ws://localhost:${s.port}/${name}`, 91, '가영', '#2563eb', '글');
    await until(() => s.rooms.get(name)?.doc.oplogVersion().length() !== 0 && !a.client.pending, 5000, 'created');
    s.version(name, { name: '이름' });
    for (let k = 0; k < 4; k++) {
      a.client.doc.insertText(0, String(k));
      await until(() => !a.client.pending, 5000);
      await new Promise((r) => setTimeout(r, 30));
      expect(s.version(name)).not.toBeNull();
    }
    const vs = await list(s.port, name);
    expect(vs.filter((v) => v.auto).length).toBe(2);
    expect(vs.filter((v) => !v.auto).map((v) => v.name)).toEqual(['이름']);
  });
});
