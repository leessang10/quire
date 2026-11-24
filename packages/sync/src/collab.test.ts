/**
 * collab() 플러그인 (19 §4.4, P-4): 실제 서버(apps/sync-server)에 Worker 진입점(MessageChannel)으로 붙고,
 * 편집기 대신 가짜 PluginContext로 플러그인이 편집기에 하는 일(문서·원격 변경·캐럿·권한·선택 보내기·정리)을 본다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Document } from '@quiredoc/model';
import type { PluginContext, PluginEvent, RemoteCaret } from '@quiredoc/editor';
import { startServer, type SyncServer } from '../../../apps/sync-server/src/server';
import { memoryStorage } from '../../../apps/sync-server/src/store';
import { collab, type CollabPlugin } from './collab';
import { serveSyncWorker } from './host';

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

/** serveSyncWorker를 돌리는 "Worker" (MessageChannel 한 쪽) */
function fakeWorker() {
  const ch = new MessageChannel();
  serveSyncWorker(ch.port1 as unknown as Parameters<typeof serveSyncWorker>[0]);
  ch.port1.start();
  ch.port2.start();
  let terminated = false;
  const w = Object.assign(ch.port2, {
    terminate() {
      terminated = true;
      setTimeout(() => {
        ch.port1.close();
        ch.port2.close();
      }, 50);
    },
  });
  return { worker: w as unknown as Worker, terminated: () => terminated };
}

/** 편집기 대신: 플러그인이 sync로 부른 것을 적고, 선택·이벤트를 흉내 낸다 */
function fakeEditor() {
  const listeners = new Map<PluginEvent, Set<() => void>>();
  const state = {
    document: null as Document | null,
    access: [] as string[],
    changed: 0,
    carets: [] as RemoteCaret[],
    sel: { anchor: 0, head: 0 },
  };
  const ctx = {
    name: 'collab',
    on(event: PluginEvent, fn: () => void) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(fn);
      return () => set!.delete(fn);
    },
    selection: () => ({ ...state.sel, from: Math.min(state.sel.anchor, state.sel.head), to: Math.max(state.sel.anchor, state.sel.head), story: null }),
    sync: {
      setDocument: (d: Document) => (state.document = d),
      documentChanged: () => state.changed++,
      setRemoteCarets: (list: RemoteCaret[]) => (state.carets = list),
      setAccess: (r: string) => state.access.push(r),
    },
  } as unknown as PluginContext;
  const emit = (e: PluginEvent) => listeners.get(e)?.forEach((f) => f());
  return { ctx, state, emit, listeners };
}

async function serve(): Promise<SyncServer> {
  const s = await startServer(0, () => {}, { storage: memoryStorage() });
  cleanups.push(() => s.close());
  return s;
}

function attach(plugin: CollabPlugin) {
  const ed = fakeEditor();
  const off = plugin.init!(ed.ctx) as () => void;
  cleanups.push(off);
  return { ...ed, off };
}

describe('collab() plugin (19 §4.4)', () => {
  it('connects, hands the shared document to the editor, and keeps two editors in sync', async () => {
    const s = await serve();
    const url = `ws://localhost:${s.port}/room-${Math.random().toString(36).slice(2)}`;
    const wa = fakeWorker();
    const a = collab({ worker: () => wa.worker, url, peer: 11, user: { name: 'A', color: '1' }, text: '첫 문단', batchMs: 10 });
    const ea = attach(a);
    // 연결 전에는 보기만
    expect(ea.state.access).toEqual(['view']);
    const ca = await a.ready;
    expect(a.client).toBe(ca);
    expect(ea.state.document).toBe(ca.document);
    expect(ea.state.access).toEqual(['view', 'edit']);
    expect(ea.state.document!.body.text()).toBe('첫 문단\n');

    const b = collab({ worker: fakeWorker().worker, url, peer: 22, user: { name: 'B', color: '2' }, batchMs: 10 });
    const eb = attach(b);
    const cb = await b.ready;
    await until(() => eb.state.document!.body.text() === '첫 문단\n', 5000, 'B has the document');

    // A가 쓰면 B의 편집기에 원격 변경으로 온다
    const before = eb.state.changed;
    ca.doc.insertText(ca.doc.maxCaret, '가나');
    await until(() => eb.state.document!.body.text() === '첫 문단가나\n', 5000, 'edit reaches B');
    expect(eb.state.changed).toBeGreaterThan(before);

    // A의 선택(편집기 'selection' 이벤트) → 서버 → B의 캐럿
    ea.state.sel = { anchor: 2, head: 4 };
    ea.emit('selection');
    await until(() => eb.state.carets.some((c) => c.name === 'A' && c.anchor === 2 && c.head === 4), 5000, 'A caret at B');
    expect(eb.state.carets.find((c) => c.name === 'A')!.color).toBe('1');
    expect(cb.remotes().map((r) => r.name)).toEqual(['A']);
  });

  it('cleans up: detaching stops listening, closes the client and ends a worker it created', async () => {
    const s = await serve();
    const url = `ws://localhost:${s.port}/room-${Math.random().toString(36).slice(2)}`;
    const w = fakeWorker();
    const p = collab({ worker: () => w.worker, url, peer: 33, user: { name: 'C', color: '3' }, text: 'x', batchMs: 10 });
    const e = attach(p);
    await p.ready;
    expect(e.listeners.get('selection')?.size).toBe(1);
    e.off();
    expect(p.client).toBeNull();
    expect(e.listeners.get('selection')?.size).toBe(0);
    expect(e.listeners.get('change')?.size).toBe(0);
    expect(w.terminated()).toBe(true);
    // 한 플러그인을 두 편집기에 붙이지 않는다
    expect(() => p.init!(fakeEditor().ctx)).toThrow(/하나/);
  });
});
