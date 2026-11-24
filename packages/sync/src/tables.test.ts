/**
 * 표 (11 §2.4, §9, 2-11): 표 레코드(행·열 ID 목록 + 지운 표시·너비·병합·속성 맵)와 셀 스토리가 피어 사이에서 수렴하는가.
 * G3 동시성 시나리오: 동시 행 추가, 추가 + 지우기, 동시 병합, 병합 + 행 지우기, 셀 입력 + 행 지우기.
 */
import { describe, expect, it } from 'vitest';
import { Doc, Document, History, cellStoryId, normalizeTable, type Op } from '@quiredoc/model';
import { SyncBridge } from './index';
import { compactDocument, rebaseOnto } from './epoch';
import { newLoro, readTable } from './shape';
import { formatState, stable } from './format-state.test-util';

const NL = String.fromCharCode(10);
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

function network(n: number, text = '') {
  const queues: Uint8Array[][][] = [];
  const peers: SyncBridge[] = [];
  const mk = (k: number, make: (opts: Parameters<typeof SyncBridge.create>[1]) => SyncBridge) =>
    make({
      peer: k + 1,
      batchMs: null,
      onUpdate: (u) => {
        for (let to = 0; to < n; to++) if (to !== k) queues[to]![k]!.push(u);
      },
    });
  for (let k = 0; k < n; k++) queues.push(Array.from({ length: n }, () => []));
  peers.push(mk(0, (o) => SyncBridge.create(text, o)));
  const snap = () => peers[0]!.snapshot();
  const deliver = (from: number, to: number, count = Infinity) => {
    const q = queues[to]![from]!;
    for (let c = 0; c < count && q.length; c++) peers[to]!.receive(q.shift()!);
  };
  const settle = () => {
    for (let round = 0; round < 3; round++) {
      for (const p of peers) p.flush();
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) deliver(a, b);
      for (const p of peers) p.flush();
    }
  };
  /** 첫 피어에서 표를 만든 뒤 나머지 피어를 그 스냅숏에서 연다 */
  const join = () => {
    peers[0]!.flush();
    const s = snap();
    for (let k = 1; k < n; k++) peers.push(mk(k, (o) => SyncBridge.fromSnapshot(s, o)));
  };
  return { peers, deliver, settle, join };
}

const grid = (d: Document, id: string) => {
  const g = normalizeTable(d.table(id)!);
  return { rows: g.rows.length, cols: g.cols.length, cells: g.cells.map((row) => row.map((c) => (c ? `${c.span[0]}x${c.span[1]}` : '-')).join(' ')) };
};

describe('table record (model)', () => {
  it('inserts a table paragraph and normalizes the grid', () => {
    const d = new Document(Doc.fromText(`앞${NL}뒤`));
    const { id } = d.insertTable(2, 2, 3, 300000);
    expect(d.body.text()).toBe(`앞${NL}￼${NL}뒤${NL}`);
    expect(d.body.objAt(2)).toMatchObject({ kind: 'table', table: id });
    const g = normalizeTable(d.table(id)!);
    expect([g.rows.length, g.cols.length, g.widths]).toEqual([2, 3, [100000, 100000, 100000]]);
  });

  it('merges by id lists and clamps to the cells that remain', () => {
    const d = new Document(Doc.fromText(''));
    const id = d.createTable(3, 3);
    const t = d.table(id)!;
    const [r0, r1, r2] = t.rows as [string, string, string];
    const [c0, c1, c2] = t.cols as [string, string, string];
    d.mergeCells(id, r0, c0, [r1, r2], [c1]);
    expect(grid(d, id).cells).toEqual(['3x2 - 1x1', '- - 1x1', '- - 1x1']);
    expect(normalizeTable(d.table(id)!).cells[0]![0]!.covered).toEqual([
      cellStoryId(id, r0, c1),
      cellStoryId(id, r1, c0),
      cellStoryId(id, r1, c1),
      cellStoryId(id, r2, c0),
      cellStoryId(id, r2, c1),
    ]);
    d.deleteRowOrCol(id, r2); // 덮인 행을 지우면 병합이 줄어든다
    expect(grid(d, id).cells).toEqual(['2x2 - 1x1', '- - 1x1']);
    d.deleteRowOrCol(id, c0); // 왼쪽 위 열을 지우면 병합이 사라진다 (주인 셀이 없다)
    expect(grid(d, id).cells).toEqual(['1x1 1x1', '1x1 1x1']);
    void c2;
  });

  it('undoes and redoes row insertion, deletion and merge', () => {
    const d = new Document(Doc.fromText(''));
    const h = new History(0);
    const id = d.createTable(2, 2);
    const t = d.table(id)!;
    const s = { anchor: d.body.positionAt(0), head: d.body.positionAt(0) };
    const rec = (ops: Op[]) => h.record({ ops, before: s, after: s, time: Math.random() * 1e9 });
    rec(d.addRow(id, t.rows[0]!).ops);
    expect(grid(d, id).rows).toBe(3);
    rec(d.mergeCells(id, t.rows[0]!, t.cols[0]!, [t.rows[1]!], [t.cols[1]!]));
    expect(grid(d, id).cells[0]).toBe('2x2 -');
    h.undo(d);
    expect(grid(d, id).cells[0]).toBe('1x1 1x1');
    h.undo(d);
    expect(grid(d, id).rows).toBe(2);
    h.redo(d);
    expect(grid(d, id).rows).toBe(3);
    rec(d.deleteRowOrCol(id, t.cols[0]!));
    expect(grid(d, id).cols).toBe(1);
    h.undo(d);
    expect(grid(d, id).cols).toBe(2);
  });
});

describe('tables over the bridge (G3 concurrency scenarios)', () => {
  const setup = (rows = 2, cols = 2) => {
    const net = network(2, '본문');
    const id = net.peers[0]!.document.createTable(rows, cols);
    net.join();
    const [a, b] = net.peers as [SyncBridge, SyncBridge];
    expect(b.document.table(id)).toEqual(a.document.table(id));
    return { ...net, a, b, id, t: structuredClone(a.document.table(id)!) };
  };
  const same = (a: SyncBridge, b: SyncBridge, id: string) => {
    expect(b.document.table(id)).toEqual(a.document.table(id));
    expect(readTable(a.loro, id)).toEqual(a.document.table(id));
    expect(readTable(b.loro, id)).toEqual(b.document.table(id));
  };

  it('keeps both rows added at the same place', () => {
    const { a, b, id, t, settle } = setup();
    a.document.addRow(id, t.rows[0]!);
    b.document.addRow(id, t.rows[0]!);
    settle();
    same(a, b, id);
    expect(grid(a.document, id).rows).toBe(4);
  });

  it('adding a row after a row deleted at the same time keeps the new row', () => {
    const { a, b, id, t, settle } = setup();
    a.document.addRow(id, t.rows[0]!);
    b.document.deleteRowOrCol(id, t.rows[0]!);
    settle();
    same(a, b, id);
    expect(grid(a.document, id).rows).toBe(2);
  });

  it('two merges at the same time: one wins deterministically, no text moves', () => {
    const { a, b, id, t, settle } = setup(3, 3);
    const [r0, r1, r2] = t.rows as [string, string, string];
    const [c0, c1, c2] = t.cols as [string, string, string];
    a.story(cellStoryId(id, r1, c1)).insertText(0, '가운데');
    settle();
    a.document.mergeCells(id, r0, c0, [r1], [c1]);
    b.document.mergeCells(id, r1, c1, [r2], [c2]);
    settle();
    same(a, b, id);
    expect(grid(a.document, id).cells).toEqual(grid(b.document, id).cells);
    // 행 우선 순서로 앞의 병합이 이긴다: (r0,c0) 2x2, 겹친 (r1,c1)의 병합은 무시
    expect(grid(a.document, id).cells).toEqual(['2x2 - 1x1', '- - 1x1', '1x1 1x1 1x1']);
    // 덮인 셀의 글은 그대로 (주인 셀 뒤에 이어 그린다)
    expect(b.story(cellStoryId(id, r1, c1)).text()).toBe(`가운데${NL}`);
  });

  it('merge while the covered row is deleted shrinks the merge', () => {
    const { a, b, id, t, settle } = setup(3, 2);
    a.document.mergeCells(id, t.rows[0]!, t.cols[0]!, [t.rows[1]!, t.rows[2]!], []);
    b.document.deleteRowOrCol(id, t.rows[2]!);
    settle();
    same(a, b, id);
    expect(grid(a.document, id).cells).toEqual(['2x1 1x1', '- 1x1']);
  });

  it('typing in a cell of a row deleted at the same time keeps the text for undo', () => {
    const { a, b, id, t, settle } = setup();
    const h = new History(0);
    const story = cellStoryId(id, t.rows[1]!, t.cols[0]!);
    a.story(story).insertText(0, '입력');
    const s = { anchor: b.doc.positionAt(0), head: b.doc.positionAt(0) };
    h.record({ ops: b.document.deleteRowOrCol(id, t.rows[1]!), before: s, after: s, time: 0 });
    settle();
    same(a, b, id);
    expect(grid(a.document, id).rows).toBe(1);
    h.undo(b.document);
    settle();
    same(a, b, id);
    expect(grid(a.document, id).rows).toBe(2);
    expect(b.story(story).text()).toBe(`입력${NL}`);
  });

  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }
  const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

  for (const seed of Array.from({ length: 16 }, (_, k) => k + 1)) {
    it(`randomized table convergence, seed ${seed}`, () => {
      const r = rng(seed * 7919);
      const net = network(3, '본문');
      const id = net.peers[0]!.document.createTable(2, 2);
      net.join();
      const { peers, deliver, settle } = net;
      const histories = peers.map(() => new History(0));
      for (let step = 0; step < 300; step++) {
        const k = Math.floor(r() * 3);
        const p = peers[k]!;
        const d = p.document;
        const t = d.table(id)!;
        const g = normalizeTable(t);
        const s = { anchor: p.doc.positionAt(0), head: p.doc.positionAt(0) };
        const rec = (ops: Op[]) => ops.length && histories[k]!.record({ ops, before: s, after: s, time: step });
        const row = () => pick(r, g.rows.length ? g.rows : t.rows);
        const col = () => pick(r, g.cols.length ? g.cols : t.cols);
        const roll = r();
        if (roll < 0.1) rec(d.addRow(id, r() < 0.2 ? null : row()).ops);
        else if (roll < 0.17) rec(d.addCol(id, r() < 0.2 ? null : col()).ops);
        else if (roll < 0.23 && g.rows.length > 1) rec(d.deleteRowOrCol(id, row()));
        else if (roll < 0.28 && g.cols.length > 1) rec(d.deleteRowOrCol(id, col()));
        else if (roll < 0.36) rec(d.mergeCells(id, row(), col(), [row()], [col()]));
        else if (roll < 0.4) rec(d.unmergeCell(id, row(), col()));
        else if (roll < 0.44) rec(d.setColWidth(id, col(), 20000 + Math.floor(r() * 100) * 1000));
        else if (roll < 0.48) rec(d.setCellAttrs(id, row(), col(), pick(r, [{ fill: '#eeeeee' }, undefined])));
        else if (roll < 0.56) {
          const story = cellStoryId(id, row(), col());
          const doc = p.story(story);
          rec(Document.tag(story, [{ type: 'insert', ids: doc.insertText(Math.floor(r() * doc.length), pick(r, ['가', 'ab', NL])) }]));
        } else if (roll < 0.64) histories[k]!.undo(d);
        else if (roll < 0.68) histories[k]!.redo(d);
        else if (roll < 0.8) p.flush();
        else {
          const from = Math.floor(r() * 3);
          deliver(from, (from + 1 + Math.floor(r() * 2)) % 3, 1 + Math.floor(r() * 3));
          peers[(from + 1) % 3]!.flush();
          peers[(from + 2) % 3]!.flush();
        }
        for (const q of peers) {
          const a = canon(q.document.table(id));
          const b = canon(readTable(q.loro, id));
          if (a !== b) throw new Error(`seed ${seed} step ${step} peer ${peers.indexOf(q)}\n${a}\n${b}`);
        }
      }
      settle();
      const t0 = peers[0]!.document.table(id);
      for (const q of peers) {
        expect(q.document.table(id)).toEqual(t0);
        for (const sid of q.document.storyIds()) expect(stable(formatState(q.story(sid)))).toBe(stable(formatState(peers[0]!.story(sid))));
      }
    });
  }
});

describe('tables in storage (compaction, rebase)', () => {
  it('keeps the table record and cells through compaction', async () => {
    const { documentFromLoro } = await import('./shape');
    const d = new Document(Doc.fromText('본문'));
    const { id } = d.insertTable(0, 2, 2, 200000);
    const t = d.table(id)!;
    d.mergeCells(id, t.rows[0]!, t.cols[0]!, [], [t.cols[1]!]);
    d.setCellAttrs(id, t.rows[1]!, t.cols[0]!, { fill: '#eeeeee' });
    d.story(cellStoryId(id, t.rows[1]!, t.cols[1]!)).insertText(0, '셀');
    const back = documentFromLoro(compactDocument(d, 'e1', 1));
    expect(back.table(id)).toEqual(d.table(id));
    expect(back.story(cellStoryId(id, t.rows[1]!, t.cols[1]!)).text()).toBe(`셀${NL}`);
    expect(back.body.objAt(0)).toMatchObject({ kind: 'table', table: id });
  });

  it('moves offline table edits to a new epoch', async () => {
    const { documentFromLoro } = await import('./shape');
    const d = new Document(Doc.fromText('본문'));
    const { id } = d.insertTable(0, 2, 2, 200000);
    const base = compactDocument(d, '', 1);
    const server = newLoro(50);
    server.import(base.export({ mode: 'snapshot' }));
    // 오프라인 피어: 옛 판에서 행 추가·지우기·병합
    const old = SyncBridge.fromSnapshot(base.export({ mode: 'snapshot' }), { peer: 5, batchMs: null });
    const t = old.document.table(id)!;
    old.document.addRow(id, t.rows[1]!);
    old.document.deleteRowOrCol(id, t.rows[0]!);
    old.document.mergeCells(id, t.rows[1]!, t.cols[0]!, [], [t.cols[1]!]);
    old.flush();
    const want = structuredClone(old.document.table(id));
    const fresh = compactDocument(documentFromLoro(server), 'e1', 99);
    const { loro } = rebaseOnto(old.loro, { epoch: 'e1', oldVV: server.oplogVersion().encode(), update: new Uint8Array(), base: fresh.export({ mode: 'snapshot' }) }, 5);
    expect(readTable(loro, id)).toEqual(want);
  });
});

describe('tables through the worker (random message timing)', () => {
  type ToMain = import('./protocol').ToMain;
  type ToWorker = import('./protocol').ToWorker;
  interface Peer {
    core: import('./core').SyncCore;
    client: import('./client').SyncClient;
    toWorker: ToWorker[];
    toMain: ToMain[];
    netIn: Uint8Array[];
    history: History;
  }
  async function network(n: number, snapshot: Uint8Array) {
    const { SyncCore } = await import('./core');
    const { SyncClient } = await import('./client');
    const peers: Peer[] = [];
    for (let k = 0; k < n; k++) {
      const toMain: ToMain[] = [];
      const opts = {
        user: { name: `P${k}`, color: '#336699' },
        batchMs: null,
        presenceTimeoutMs: 1e9,
        post: (m: ToMain) => toMain.push(m),
        net: {
          sendDoc: (bytes: Uint8Array) => {
            for (const p of peers) if (p !== peers[k]) p.netIn.push(bytes);
          },
          sendPresence: () => {},
        },
      };
      const core: Peer['core'] = SyncCore.fromSnapshot(snapshot, k + 1, opts);
      const init = toMain.shift() as Extract<ToMain, { t: 'init' }>;
      const toWorker: ToWorker[] = [];
      const client = new SyncClient(init, { post: (m) => toWorker.push(m) });
      peers.push({ core, client, toWorker, toMain, netIn: [], history: new History(0) });
    }
    const toWorker = (p: Peer, count = Infinity) => {
      for (let c = 0; c < count && p.toWorker.length; c++) p.core.handle(p.toWorker.shift()!);
    };
    const toMain = (p: Peer, count = Infinity) => {
      for (let c = 0; c < count && p.toMain.length; c++) p.client.handle(p.toMain.shift()!);
    };
    const net = (p: Peer, count = Infinity) => {
      for (let c = 0; c < count && p.netIn.length; c++) p.core.receiveDoc(p.netIn.shift()!);
    };
    const settle = () => {
      for (let round = 0; round < 50; round++) {
        let busy = false;
        for (const p of peers) {
          if (p.toWorker.length || p.toMain.length || p.netIn.length || p.client.pending) busy = true;
          toWorker(p);
          p.core.flush();
        }
        for (const p of peers) {
          net(p);
          p.core.flush();
          toMain(p);
        }
        if (!busy && peers.every((p) => !p.toWorker.length && !p.toMain.length && !p.netIn.length)) return;
      }
      throw new Error('did not settle');
    };
    return { peers, toWorker, toMain, net, settle };
  }
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }
  const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

  for (const seed of Array.from({ length: 30 }, (_, k) => k + 1)) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed * 131 + 3);
      const d = new Document(Doc.fromText('본문'));
      const { id } = d.insertTable(0, 2, 2, 200000);
      const { peers, toWorker, toMain, net, settle } = await network(3, compactDocument(d, '', 1).export({ mode: 'snapshot' }));
      for (let step = 0; step < 300; step++) {
        const p = peers[Math.floor(r() * 3)]!;
        const doc = p.client.document;
        const t = doc.table(id)!;
        const g = normalizeTable(t);
        const s = { anchor: p.client.doc.positionAt(0), head: p.client.doc.positionAt(0) };
        const rec = (ops: Op[]) => ops.length && p.history.record({ ops, before: s, after: s, time: step });
        const row = () => pick(r, g.rows.length ? g.rows : t.rows);
        const col = () => pick(r, g.cols.length ? g.cols : t.cols);
        const roll = r();
        if (roll < 0.08) rec(doc.addRow(id, row()).ops);
        else if (roll < 0.14) rec(doc.addCol(id, col()).ops);
        else if (roll < 0.2 && g.rows.length > 1) rec(doc.deleteRowOrCol(id, row()));
        else if (roll < 0.25 && g.cols.length > 1) rec(doc.deleteRowOrCol(id, col()));
        else if (roll < 0.32) rec(doc.mergeCells(id, row(), col(), [row()], [col()]));
        else if (roll < 0.36) rec(doc.setColWidth(id, col(), 20000 + Math.floor(r() * 100) * 1000));
        else if (roll < 0.44) {
          const story = cellStoryId(id, row(), col());
          const cell = p.client.story(story);
          rec(Document.tag(story, [{ type: 'insert', ids: cell.insertText(Math.floor(r() * cell.length), pick(r, ['가', 'ab', NL])) }]));
        } else if (roll < 0.5) p.history.undo(doc);
        else if (roll < 0.53) p.history.redo(doc);
        else if (roll < 0.68) toWorker(p, 1 + Math.floor(r() * 2));
        else if (roll < 0.83) toMain(p, 1 + Math.floor(r() * 3));
        else if (roll < 0.91) p.core.flush();
        else net(p, 1 + Math.floor(r() * 3));
      }
      settle();
      const t0 = canon(peers[0]!.client.document.table(id));
      for (const q of peers) {
        expect(canon(q.client.document.table(id)), `peer ${peers.indexOf(q)}`).toBe(t0);
        expect(canon(readTable(q.core.loro, id))).toBe(t0);
        for (const sid of q.client.document.storyIds())
          expect(stable(formatState(q.client.story(sid)))).toBe(stable(formatState(peers[0]!.client.story(sid))));
      }
      for (const p of peers) p.core.close();
    });
  }
});

describe('tables in the canonical JSON and .quire', () => {
  const build = () => {
    const d = new Document(Doc.fromText(`앞${NL}뒤`));
    const { id } = d.insertTable(2, 3, 2, 300000);
    const t = d.table(id)!;
    d.story(cellStoryId(id, t.rows[0]!, t.cols[0]!)).insertText(0, `왼쪽 위${NL}둘째 줄`);
    d.story(cellStoryId(id, t.rows[0]!, t.cols[1]!)).insertText(0, '덮일 셀');
    d.story(cellStoryId(id, t.rows[2]!, t.cols[1]!)).insertText(0, '끝');
    d.mergeCells(id, t.rows[0]!, t.cols[0]!, [t.rows[1]!], [t.cols[1]!]);
    d.setCellAttrs(id, t.rows[2]!, t.cols[0]!, { fill: '#eeeeee' });
    d.setRowAttrs(id, t.rows[2]!, { minHeight: 30000 });
    d.addRow(id, t.rows[2]!);
    d.deleteRowOrCol(id, t.rows[3]!); // 지운 행은 정본에 없다
    return { d, id };
  };

  it('writes the normalized grid with covered text appended to the owner cell', async () => {
    const { quireFromDocument, documentFromQuire, canonicalJson } = await import('./canonical');
    const { d } = build();
    const q = JSON.parse(canonicalJson(quireFromDocument(d)));
    expect(q.stories.body[1]).toEqual({
      table: {
        cols: [150000, 150000],
        rows: [
          { cells: [{ story: 't1.r1c1', span: [2, 2] }] },
          { cells: [] },
          { cells: [{ story: 't1.r3c1', fill: '#eeeeee' }, { story: 't1.r3c2' }], h: 30000 },
        ],
      },
    });
    expect(q.stories['t1.r1c1'].map((b: { c: Array<{ t: string }> }) => b.c[0]?.t)).toEqual(['왼쪽 위', '둘째 줄', '덮일 셀']);
    expect(q.stories['t1.r3c2']).toEqual([{ p: {}, c: [{ t: '끝' }] }]);
    expect(Object.keys(q.stories).sort()).toEqual(['body', 't1.r1c1', 't1.r3c2']);
    // 다시 열면 새 ID, 같은 정본
    const back = documentFromQuire(q).document;
    const json = canonicalJson(quireFromDocument(back));
    expect(json).toBe(canonicalJson(q));
    const id2 = back.tableIds()[0]!;
    const g = normalizeTable(back.table(id2)!);
    expect([g.rows.length, g.cols.length, g.cells[0]![0]!.span]).toEqual([3, 2, [2, 2]]);
    expect(back.body.objAt(2)).toMatchObject({ kind: 'table', table: id2 });
  });

  it('packs and opens a .quire with a table (CRDT and canonical agree)', async () => {
    const { quireFromDocument, canonicalJson } = await import('./canonical');
    const { packQuire, openQuire } = await import('./quire-file');
    const { documentFromLoro } = await import('./shape');
    const { d } = build();
    const loro = compactDocument(d, 'e1', 5);
    const opened = await openQuire(await packQuire({ loro }));
    expect(canonicalJson(opened.doc)).toBe(canonicalJson(quireFromDocument(d)));
    const crdt = newLoro(9);
    crdt.import(opened.crdt!);
    expect(canonicalJson(quireFromDocument(documentFromLoro(crdt)))).toBe(canonicalJson(quireFromDocument(d)));
  });
});
