/**
 * 프레즌스 확장 (14 §7, 4-8, G7): 셀·머리말·각주 안 원격 캐럿이 그 피어의 자기 캐럿 자리와 같다 (Worker 경로, 실제 서버).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type SyncServer } from '../../../apps/sync-server/src/server';
import { memoryStorage } from '../../../apps/sync-server/src/store';
import { serveSyncWorker, startSyncWorker, type WorkerClient } from './host';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const f of cleanups.splice(0).reverse()) await f();
});

async function until(cond: () => boolean, ms = 8000, what = 'condition'): Promise<void> {
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
  const p = startSyncWorker(ch.port2 as unknown as Parameters<typeof startSyncWorker>[0], { mode: 'ws', peer, user: { name: `P${peer}`, color: '#123456' }, url, text, batchMs: 10 }, {});
  ch.port2.start();
  const client: WorkerClient = await p;
  cleanups.push(() => {
    client.close();
    setTimeout(() => {
      ch.port1.close();
      ch.port2.close();
    }, 50);
  });
  return client;
}

describe('presence in stories (14 §7)', () => {
  it('a caret inside a footnote or a header resolves to the same story offset on the other peer, and follows edits there', async () => {
    const s: SyncServer = await startServer(0, () => {}, { storage: memoryStorage(), versionIdleMs: null });
    cleanups.push(() => s.close());
    const url = `ws://localhost:${s.port}/room-${Math.random().toString(36).slice(2)}`;
    const a = await peer(url, 101, '본문 글');
    a.document.story('fn|n1').insertText(0, '각주 내용입니다');
    a.document.story('hdr|last|default').insertText(0, '머리말');
    const b = await peer(url, 102);
    await until(() => b.document.story('fn|n1').text() === '각주 내용입니다\n', 5000, 'story synced');
    // A의 캐럿: 각주 안 3
    a.setSelection(3, 5, 'fn|n1');
    await until(() => b.remotes().some((r) => r.story === 'fn|n1'), 5000, 'remote in footnote');
    const r1 = b.remotes().find((r) => r.story === 'fn|n1')!;
    expect([r1.anchor, r1.head]).toEqual([3, 5]);
    // B가 각주 앞에 글자를 넣으면 A의 캐럿은 같은 글자에 붙어 따라간다
    b.document.story('fn|n1').insertText(0, '앞');
    await until(() => b.remotes().find((r) => r.story === 'fn|n1')?.anchor === 4, 5000, 'follows edits');
    // 머리말: 쪽 번호도 간다
    a.setSelection(2, 2, 'hdr|last|default', 3);
    await until(() => b.remotes().some((r) => r.story === 'hdr|last|default'), 5000, 'remote in header');
    expect(b.remotes().find((r) => r.story)).toMatchObject({ story: 'hdr|last|default', anchor: 2, head: 2, page: 3 });
    // 본문으로 돌아오면 story가 없다
    a.setSelection(1, 1);
    await until(() => b.remotes().some((r) => !r.story && r.anchor === 1), 5000, 'back in body');
  }, 30000);
});
