/**
 * Worker 경로의 서식 동기화 (10 §3, 2-6): 메인 Doc ↔ Worker Loro 사이에 서식 변경이 가는 중일 때 원격 서식·편집이 오는
 * 경우를 무작위 차례로 만든다. 모두 받은 뒤: 모든 피어가 같고, 메인 Doc = Worker Loro (서식 포함).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { History, MARK_KEYS, type MarkKey, type Op } from '@quire/model';
import { SyncClient } from './client';
import { SyncCore } from './core';
import type { ToMain, ToWorker } from './protocol';
import { docFromLoro } from './shape';
import { formatState, stable } from './format-state.test-util';

interface Peer {
  core: SyncCore;
  client: SyncClient;
  toWorker: ToWorker[];
  toMain: ToMain[];
  netIn: Uint8Array[];
  history: History;
}

const cores: SyncCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.close();
});

function network(n: number, text: string) {
  const peers: Peer[] = [];
  let snapshot: Uint8Array | null = null;
  let raced = 0;
  for (let k = 0; k < n; k++) {
    const toMain: ToMain[] = [];
    const opts = {
      user: { name: `P${k}`, color: '#336699' },
      batchMs: null,
      post: (m: ToMain) => toMain.push(m),
      net: {
        sendDoc: (bytes: Uint8Array) => {
          for (const p of peers) if (p !== peers[k]) p.netIn.push(bytes);
        },
        sendPresence: () => {},
      },
    };
    const core: SyncCore = k === 0 ? SyncCore.create(text, k + 1, opts) : SyncCore.fromSnapshot(snapshot!, k + 1, opts);
    if (k === 0) snapshot = core.loro.export({ mode: 'snapshot' });
    cores.push(core);
    const init = toMain.shift() as Extract<ToMain, { t: 'init' }>;
    const toWorker: ToWorker[] = [];
    const client = new SyncClient(init, { post: (m) => toWorker.push(m) });
    peers.push({ core, client, toWorker, toMain, netIn: [], history: new History(0) });
  }
  const toWorker = (p: Peer, count = Infinity) => {
    for (let c = 0; c < count && p.toWorker.length; c++) p.core.handle(p.toWorker.shift()!);
  };
  const toMain = (p: Peer, count = Infinity) => {
    for (let c = 0; c < count && p.toMain.length; c++) {
      const m = p.toMain.shift()!;
      if (m.t === 'remote' && p.client.pending) raced++;
      p.client.handle(m);
    }
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
  return { peers, toWorker, toMain, net, settle, raced: () => raced };
}

const NL = String.fromCharCode(10);
const ALPHA = Array.from('가나다 ab\n😀');
const VALUES: Record<string, unknown[]> = {
  bold: [true, undefined], italic: [true, undefined], underline: [true, undefined], strike: [true, undefined],
  size: [9000, 18000, undefined], color: ['#c01c28', '#1a5fb4', undefined], highlight: ['#fff3a3', undefined],
  link: ['https://a', undefined], script: ['sup', 'sub', undefined], font: [undefined],
};
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

describe('format sync through the worker (random message timing)', () => {
  it('starts a new client with the formats of the worker document', () => {
    const { peers, settle } = network(2, `가나다${NL}라마`);
    const [a] = peers as [Peer, Peer];
    a.client.doc.format(0, 2, 'bold', true);
    a.client.doc.setParaAttr(1, 'align', 'center');
    a.client.doc.setStyle('h1', { ...a.client.doc.style('h1')!, marks: { size: 30000 } });
    settle();
    const toMain: ToMain[] = [];
    const core = SyncCore.fromSnapshot(a.core.loro.export({ mode: 'snapshot' }), 9, { user: { name: 'x', color: '#000' }, batchMs: null, post: (m) => toMain.push(m), net: { sendDoc() {}, sendPresence() {} } });
    cores.push(core);
    const c = new SyncClient(toMain.shift() as Extract<ToMain, { t: 'init' }>, { post() {} });
    expect(stable(formatState(c.doc))).toBe(stable(formatState(a.client.doc)));
  });

  for (const seed of Array.from({ length: 20 }, (_, k) => k + 1)) {
    it(`seed ${seed}`, () => {
      const r = rng(seed * 7 + 3);
      const { peers, toWorker, toMain, net, settle, raced } = network(3, Array.from({ length: 6 }, (_, i) => `문단 ${i} 가나다 abc`).join(NL));
      for (let step = 0; step < 300; step++) {
        const p = peers[Math.floor(r() * 3)]!;
        const doc = p.client.doc;
        const len = doc.length;
        const n = doc.paragraphs().length;
        const s = { anchor: doc.positionAt(0), head: doc.positionAt(0) };
        const rec = (ops: Op[]) => ops.length && p.history.record({ ops, before: s, after: s, time: step });
        // 개체 (2-8): 넣기, 속성 바꾸기
        if (r() < 0.08) {
          const len0 = doc.length;
          const objOffsets: number[] = [];
          for (const q of doc.paragraphs()) if (q.objs) for (const k of q.objs.keys()) objOffsets.push(q.start + k);
          if (objOffsets.length === 0 || r() < 0.4)
            rec(doc.insertObject(Math.floor(r() * len0), { id: `o${step}`, kind: 'image', asset: 'a'.repeat(32), w: 72000, h: 36000 }));
          else rec(doc.setObjAttr(objOffsets[Math.floor(r() * objOffsets.length)]!, r() < 0.5 ? 'w' : 'alt', r() < 0.5 ? Math.floor(r() * 100000) : `alt${step}`));
          continue;
        }
        const roll = r();
        if (roll < 0.16) rec([{ type: 'insert', ids: doc.insertText(Math.floor(r() * len), pick(r, ALPHA) + pick(r, ALPHA)) }]);
        else if (roll < 0.24) {
          const from = Math.floor(r() * len);
          const to = Math.min(len - 1, from + 1 + Math.floor(r() * 6));
          if (from < to) rec(doc.deleteRange(from, to));
        } else if (roll < 0.4) {
          const from = Math.floor(r() * len);
          const key = pick(r, MARK_KEYS) as MarkKey;
          rec(doc.format(from, Math.min(len, from + 1 + Math.floor(r() * 12)), key, pick(r, VALUES[key]!)));
        } else if (roll < 0.46) {
          const key = pick(r, ['align', 'style'] as const);
          rec(doc.setParaAttr(Math.floor(r() * n), key, key === 'align' ? pick(r, ['center', 'right', undefined]) : pick(r, ['h2', 'quote', undefined])));
        } else if (roll < 0.49) {
          const lists = doc.lists();
          if (lists.length === 0 || r() < 0.3) {
            const [id, ops] = doc.createList(pick(r, ['number', 'bullet'] as const));
            rec([...ops, ...doc.setParaAttr(Math.floor(r() * n), 'list', { id, level: 0 })]);
          } else rec(doc.setParaAttr(Math.floor(r() * n), 'list', { id: pick(r, lists).id, level: Math.floor(r() * 3) }));
        } else if (roll < 0.51) {
          const cur = doc.style('h2')!;
          rec(doc.setStyle('h2', { ...cur, marks: { ...cur.marks, color: pick(r, ['#c01c28', '#1a5fb4']) } }));
        } else if (roll < 0.55) {
          const i = Math.floor(r() * n);
          rec(doc.moveParagraphs(i, i, Math.floor(r() * (n + 1))));
        } else if (roll < 0.6) p.history.undo(doc);
        else if (roll < 0.63) p.history.redo(doc);
        else if (roll < 0.75) toWorker(p, 1 + Math.floor(r() * 2));
        else if (roll < 0.87) toMain(p, 1 + Math.floor(r() * 3));
        else if (roll < 0.93) p.core.flush();
        else net(p, 1 + Math.floor(r() * 3));
        expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
      }
      settle();
      const f0 = stable(formatState(peers[0]!.client.doc));
      for (const p of peers) {
        expect(stable(formatState(p.client.doc)), `seed ${seed} peer ${peers.indexOf(p)}`).toBe(f0);
        expect(stable(formatState(docFromLoro(p.core.loro))), `seed ${seed} loro ${peers.indexOf(p)}`).toBe(f0);
      }
      expect(raced()).toBeGreaterThan(0);
    });
  }
});
