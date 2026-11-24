/**
 * 서버 저장·새 판 압축·재기반 시험 (09 §9). 실제 서버(apps/sync-server)에 Worker 진입점(MessageChannel)으로 붙는다.
 */
import { mkdtempSync, appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type ServerOptions, type SyncServer } from '../../../apps/sync-server/src/server';
import { fileStorage, memoryStorage } from '../../../apps/sync-server/src/store';
import { displayText, restoreHistory } from './history';
import { readEpoch } from './epoch';
import { serveSyncWorker, startSyncWorker, type WorkerClient } from './host';
import { openQuire } from '@quiredoc/model';
import { readRaw } from './shape';

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

async function serve(opts: ServerOptions, port = 0): Promise<SyncServer> {
  const s = await startServer(port, () => {}, opts);
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
  const status: Array<boolean | string> = [];
  const resets: boolean[] = [];
  const p = startSyncWorker(
    ch.port2 as unknown as Parameters<typeof startSyncWorker>[0],
    { mode: 'ws', peer, user: { name: `P${peer}`, color: '#123456' }, url, text, batchMs: 10 },
    { onStatus: (online, detail) => status.push(online || (detail ?? false)), onReset: (lost) => resets.push(lost) },
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
  return { client, status, resets, close };
}

const room = () => `room-${Math.random().toString(36).slice(2)}`;
const settled = (...ps: Array<{ client: WorkerClient }>) => () =>
  ps.every((p) => !p.client.pending && p.client.doc.text() === ps[0]!.client.doc.text());

describe('server storage', () => {
  it('keeps documents across server restarts (snapshot + log on disk)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quire-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const name = room();
    const s1 = await serve({ storage: fileStorage(dir), checkpointEvery: 3 });
    const a = await peer(`ws://localhost:${s1.port}/${name}`, 11, '첫 문단');
    for (const ch of '가나다라마') {
      a.client.doc.insertText(a.client.doc.maxCaret, ch);
      await new Promise((r) => setTimeout(r, 15));
    }
    a.client.doc.moveParagraphs(0, 0, 1);
    await until(() => s1.rooms.get(name)?.doc !== undefined && displayText(s1.rooms.get(name)!.doc) === a.client.doc.text(), 5000, 'server has edits');
    // 서버를 끈다 (클라이언트도 닫아 다시 붙지 않게)
    a.close();
    await s1.close();
    const roomDir = join(dir, encodeURIComponent(name));
    expect(JSON.parse(readFileSync(join(roomDir, 'document.json'), 'utf8')).stories.body).toEqual([{ p: {}, c: [{ t: '첫 문단가나다라마' }] }]);
    // 로그 끝에 잘린 레코드 (덧붙이다 죽은 경우)
    appendFileSync(join(roomDir, 'log.bin'), new Uint8Array([0, 0, 1, 0, 9, 9]));
    const s2 = await serve({ storage: fileStorage(dir) });
    const b = await peer(`ws://localhost:${s2.port}/${name}`, 12, '무시됨');
    expect(b.client.doc.text()).toBe('첫 문단가나다라마\n');
    // HTTP로 정본과 .quire 파일
    const json = await (await fetch(`http://localhost:${s2.port}/${name}.json`)).json();
    expect(json.stories.body[0].c[0].t).toBe('첫 문단가나다라마');
    const file = await openQuire(new Uint8Array(await (await fetch(`http://localhost:${s2.port}/${name}.quire`)).arrayBuffer()));
    expect(file.text).toBe('첫 문단가나다라마\n');
    expect(await restoreHistory(file)).not.toBeNull();
  });

  it('compacts an idle room into a new epoch and late joiners get the compact document', async () => {
    const name = room();
    const s = await serve({ idleMs: 30 });
    const a = await peer(`ws://localhost:${s.port}/${name}`, 21, '하나\n둘\n셋');
    for (let k = 0; k < 6; k++) a.client.doc.moveParagraphs(k % 2, k % 2, 3);
    a.client.doc.hideParagraphs(1, 1);
    await until(() => !a.client.pending && displayText(s.rooms.get(name)!.doc) === a.client.doc.text(), 5000, 'server has edits');
    const text = a.client.doc.text();
    const before = readRaw(s.rooms.get(name)!.doc).keys.length;
    a.close();
    await until(() => !s.rooms.has(name), 5000, 'room compacted and unloaded');
    const b = await peer(`ws://localhost:${s.port}/${name}`, 22);
    expect(b.client.doc.text()).toBe(text);
    const r = s.rooms.get(name)!;
    expect(r.epoch).not.toBe('');
    expect(readEpoch(r.doc)).toBe(r.epoch);
    expect(before).toBeGreaterThan(2);
    expect(readRaw(r.doc).keys.length).toBe(2);
  });

  it('rebases offline edits of a client that missed the compaction, including old-epoch edits it never saw', async () => {
    const storage = memoryStorage();
    const name = room();
    const s1 = await serve({ storage });
    const port = s1.port;
    const a = await peer(`ws://localhost:${port}/${name}`, 31, '하나\n둘\n셋');
    await until(() => s1.rooms.get(name)?.doc.oplogVersion().length() !== 0, 5000, 'created');
    await s1.close();
    await until(() => a.status.includes('연결 끊김 · 0.5초 뒤 다시 연결') || a.status.some((x) => typeof x === 'string'), 5000, 'a offline');
    // A는 오프라인으로 편집
    a.client.doc.insertText(0, 'A');
    a.client.doc.moveParagraphs(2, 2, 0);
    // 그동안 B가 다른 서버 인스턴스(같은 저장소)에서 옛 판을 편집하고 나간다
    const s2 = await serve({ storage });
    const b = await peer(`ws://localhost:${s2.port}/${name}`, 32);
    expect(b.client.doc.text()).toBe('하나\n둘\n셋\n');
    b.client.doc.insertText(b.client.doc.maxCaret, 'B');
    await until(() => !b.client.pending && displayText(s2.rooms.get(name)!.doc) === '하나\n둘\n셋B\n', 5000, 'b edit on server');
    b.close();
    await until(() => s2.rooms.get(name)!.conns.size === 0, 5000, 'b gone');
    expect(s2.compact(name)).toBe(true);
    const epoch = s2.rooms.get(name)!.epoch;
    await s2.close();
    // A가 원래 주소로 다시 붙는다 → REBASE
    const s3 = await serve({ storage }, port);
    await until(() => a.resets.length === 1 && !a.client.pending, 10000, 'a rebased');
    expect(a.resets).toEqual([false]);
    await until(() => displayText(s3.rooms.get(name)!.doc) === a.client.doc.text(), 5000, 'server has rebased edits');
    expect(a.client.doc.text()).toBe('셋B\nA하나\n둘\n');
    expect(s3.rooms.get(name)!.epoch).toBe(epoch);
    // 새로 붙은 C와 함께 편집
    const c = await peer(`ws://localhost:${port}/${name}`, 33);
    expect(c.client.doc.text()).toBe(a.client.doc.text());
    c.client.doc.insertText(0, 'C');
    a.client.doc.insertText(a.client.doc.maxCaret, 'Z');
    await until(settled(a, c), 5000, 'a and c converge');
    expect(c.client.doc.text()).toBe('C셋B\nA하나\n둘Z\n');
  });

  it('creates a room from an uploaded .quire file', async () => {
    const s = await serve({});
    const name = room();
    const { packQuire } = await import('@quiredoc/model');
    const put = await fetch(`http://localhost:${s.port}/${name}.quire`, { method: 'PUT', body: await packQuire({ text: '올린\n파일\n' }) });
    expect(put.status).toBe(201);
    expect(await put.json()).toMatchObject({ history: false });
    const again = await fetch(`http://localhost:${s.port}/${name}.quire`, { method: 'PUT', body: await packQuire({ text: 'x\n' }) });
    expect(again.status).toBe(409);
    const a = await peer(`ws://localhost:${s.port}/${name}`, 41, '무시됨');
    expect(a.client.doc.text()).toBe('올린\n파일\n');
  });

  it('keeps formats of an uploaded .quire file in the room, its JSON and a joining client (2-6)', async () => {
    const s = await serve({});
    const name = room();
    const { packQuire } = await import('@quiredoc/model');
    const { Doc } = await import('@quiredoc/model');
    const doc = Doc.fromText('제목\n굵은 본문');
    doc.setParaAttr(0, 'style', 'h1');
    doc.setParaAttr(1, 'align', 'center');
    doc.format(3, 5, 'bold', true);
    doc.setStyle('h1', { ...doc.style('h1')!, marks: { bold: true, size: 30000 } });
    const put = await fetch(`http://localhost:${s.port}/${name}.quire`, { method: 'PUT', body: await packQuire({ doc }) });
    expect(put.status).toBe(201);
    const json = (await (await fetch(`http://localhost:${s.port}/${name}.json`)).json()) as {
      stories: { body: Array<{ p: unknown; c: unknown }> };
      styles: Record<string, { marks: unknown }>;
    };
    expect(json.stories.body[0]!.p).toEqual({ style: 'h1' });
    expect(json.stories.body[1]).toEqual({ p: { align: 'center' }, c: [{ t: '굵은', m: { bold: true } }, { t: ' 본문' }] });
    expect(json.styles['h1']!.marks).toEqual({ bold: true, size: 30000 });
    const a = await peer(`ws://localhost:${s.port}/${name}`, 42, '무시됨');
    expect(a.client.doc.marksAt(3)).toEqual({ bold: true });
    expect(a.client.doc.paraAttrs(1)).toEqual({ align: 'center' });
    expect(a.client.doc.style('h1')!.marks).toEqual({ bold: true, size: 30000 });
  });

  it('stores assets by content hash, and puts them into and takes them out of .quire files (2-8)', async () => {
    const s = await serve({});
    const name = room();
    const { assetIdOf, packQuire, openQuire } = await import('@quiredoc/model');
    const { Doc } = await import('@quiredoc/model');
    const bytes = new Uint8Array([137, 80, 78, 71, 9, 9, 9, 9]);
    const id = await assetIdOf(bytes);
    const url = `http://localhost:${s.port}/${name}/assets/${id}`;
    expect((await fetch(url)).status).toBe(404);
    // 내용과 ID가 다르면 거절, 이미지가 아니면 거절
    expect((await fetch(`http://localhost:${s.port}/${name}/assets/${'0'.repeat(32)}`, { method: 'PUT', body: bytes, headers: { 'content-type': 'image/png' } })).status).toBe(400);
    expect((await fetch(url, { method: 'PUT', body: bytes, headers: { 'content-type': 'text/html' } })).status).toBe(415);
    expect((await fetch(url, { method: 'PUT', body: bytes, headers: { 'content-type': 'image/png' } })).status).toBe(201);
    const got = await fetch(url);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    // .quire 올리기: 자산도 방에 들어간다. 내려받기: 문서가 가리키는 자산이 들어 있다
    const name2 = room();
    const doc = Doc.fromText('그림 ');
    doc.insertObject(3, { id: 'i1', kind: 'image', asset: id, w: 1000, h: 1000 });
    const put = await fetch(`http://localhost:${s.port}/${name2}.quire`, { method: 'PUT', body: await packQuire({ doc, assets: [{ id, mime: 'image/png', bytes }] }) });
    expect(put.status).toBe(201);
    expect((await fetch(`http://localhost:${s.port}/${name2}/assets/${id}`)).status).toBe(200);
    const file = await openQuire(new Uint8Array(await (await fetch(`http://localhost:${s.port}/${name2}.quire`)).arrayBuffer()));
    expect(file.assets.map((a) => a.id)).toEqual([id]);
  });
});
