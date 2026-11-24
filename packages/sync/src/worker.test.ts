/**
 * Worker 구조 시험 (09 §8): 피어마다 메인 쪽 SyncClient + Worker 쪽 SyncCore. 메인↔Worker 메시지와
 * 피어 사이 네트워크를 모두 대기열에 넣고 무작위 차례로 전달해, 아직 닿지 않은 로컬 변경 위로 원격 변경이
 * 오는 경우를 만든다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Doc, History, type Op } from '@quiredoc/model';
import { SyncClient } from './client';
import { SyncCore } from './core';
import type { ToMain, ToWorker } from './protocol';
import { readRaw, readState, TEXT } from './shape';

interface Peer {
  core: SyncCore;
  client: SyncClient;
  toWorker: ToWorker[];
  toMain: ToMain[];
  /** 이 피어가 받을 네트워크 업데이트 */
  netIn: Array<{ kind: 'doc' | 'presence'; bytes: Uint8Array }>;
  history: History;
}

const cores: SyncCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.close();
});

/** 로컬 변경이 가는 중에 원격 변경이 도착한 횟수 (시험이 그 경우를 실제로 만드는지 확인) */
const racedCount = new WeakMap<Peer, number>();
const raced = (peers: Peer[]) => peers.reduce((n, p) => n + (racedCount.get(p) ?? 0), 0);

function network(n: number, text: string) {
  const peers: Peer[] = [];
  let snapshot: Uint8Array | null = null;
  for (let k = 0; k < n; k++) {
    const toMain: ToMain[] = [];
    const opts = {
      user: { name: `P${k}`, color: '#336699' },
      batchMs: null,
      post: (m: ToMain) => toMain.push(m),
      net: {
        sendDoc: (bytes: Uint8Array) => {
          for (const p of peers) if (p !== peers[k]) p.netIn.push({ kind: 'doc', bytes });
        },
        sendPresence: (bytes: Uint8Array) => {
          for (const p of peers) if (p !== peers[k]) p.netIn.push({ kind: 'presence', bytes });
        },
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
      if (m.t === 'remote' && p.client.pending) racedCount.set(p, (racedCount.get(p) ?? 0) + 1);
      p.client.handle(m);
    }
  };
  const net = (p: Peer, count = Infinity) => {
    for (let c = 0; c < count && p.netIn.length; c++) {
      const m = p.netIn.shift()!;
      if (m.kind === 'doc') p.core.receiveDoc(m.bytes);
      else p.core.receivePresence(m.bytes);
    }
  };
  /** 모든 대기열이 빌 때까지 전달 */
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

/** 메인 Doc = Worker Loro, 그리고 Loro에서 새로 만든 Doc과 화면이 같다 */
function consistent(p: Peer) {
  const loro = p.core.loro;
  expect(p.client.doc.rawText()).toBe(loro.getText(TEXT).toString());
  const { raw, keys } = readRaw(loro);
  const fresh = Doc.fromRaw(raw, keys, readState(loro), 'check');
  expect(p.client.doc.text()).toBe(fresh.text());
  expect(p.client.doc.paragraphs()).toEqual(p.client.doc.paragraphsFromScratch());
  p.client.doc.checkInvariants();
}

const NL = String.fromCharCode(10);
const t = (...ps: string[]) => ps.map((x) => x + NL).join('');

describe('SyncClient + SyncCore', () => {
  it('applies a remote edit that arrives before the local edit reached the worker', () => {
    const { peers, toWorker, toMain, net, settle } = network(2, '가나다');
    const [a, b] = peers as [Peer, Peer];
    // B가 앞에 입력해 A의 Worker까지 가져온 상태
    b.client.doc.insertText(0, 'XY');
    toWorker(b);
    b.core.flush();
    net(a);
    a.core.flush(); // A의 Worker: 'XY가나다'. 메인에는 아직 안 감
    // A의 메인은 아직 모르고 '나' 앞에 입력 → Worker는 원격 항목에 대해 변환해서 넣어야 한다
    a.client.doc.insertText(1, 'Z');
    toWorker(a);
    expect(a.core.loro.getText(TEXT).toString().startsWith('XY가Z나다')).toBe(true);
    toMain(a);
    expect(a.client.doc.text()).toBe('XY가Z나다\n');
    settle();
    expect(b.client.doc.text()).toBe('XY가Z나다\n');
    consistent(a);
    consistent(b);
  });

  it('defers a remote segment state while a local move is in flight', () => {
    const { peers, toMain, settle } = network(2, t('가', '나', '다').slice(0, -1));
    const [a, b] = peers as [Peer, Peer];
    b.client.doc.hideParagraphs(2, 2);
    settle();
    expect(a.client.doc.text()).toBe(t('가', '나'));
    // A가 문단을 옮겼지만 아직 Worker에 닿지 않음. 그 사이 B의 숨김 취소가 온다
    b.client.doc.moveParagraphs(1, 1, 0);
    b.core.handle(b.toWorker.shift()!);
    b.core.flush();
    a.client.doc.moveParagraphs(0, 0, 2);
    expect(a.client.doc.text()).toBe(t('나', '가'));
    a.core.handle({ t: 'flush' }); // B의 업데이트는 아직 netIn에
    for (const m of a.netIn.splice(0)) if (m.kind === 'doc') a.core.receiveDoc(m.bytes);
    a.core.flush();
    toMain(a); // 원격 상태가 오지만 A의 로컬 이동이 가는 중이라 미룬다
    expect(a.client.doc.text()).toBe(t('나', '가'));
    settle();
    expect(a.client.doc.text()).toBe(b.client.doc.text());
    consistent(a);
    consistent(b);
  });

  it('shares carets through the worker', () => {
    const { peers, settle } = network(2, '가나다라');
    const [a, b] = peers as [Peer, Peer];
    a.client.setSelection(1, 3);
    settle();
    expect(b.client.remotes()).toEqual([{ key: '1', name: 'P0', color: '#336699', anchor: 1, head: 3 }]);
    // B의 로컬 입력(아직 Worker에 안 감)만큼 원격 캐럿이 밀린다
    b.client.doc.insertText(0, '앞');
    expect(b.client.remotes()[0]).toMatchObject({ anchor: 2, head: 4 });
    settle();
    expect(b.client.remotes()[0]).toMatchObject({ anchor: 2, head: 4 });
  });
});

describe('SyncClient + SyncCore randomized (3 peers, random message timing)', () => {
  const ALPHA = Array.from('가나다 ab\n😀');
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }
  const randomText = (r: () => number, max: number) => {
    let out = '';
    const n = 1 + Math.floor(r() * max);
    for (let i = 0; i < n; i++) out += ALPHA[Math.floor(r() * ALPHA.length)];
    return out;
  };

  for (const seed of [...Array.from({ length: 28 }, (_, k) => k + 1), 42, 2024]) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const { peers, toWorker, toMain, net, settle } = network(3, randomText(r, 200));
      for (let step = 0; step < 300; step++) {
        const p = peers[Math.floor(r() * 3)]!;
        const doc = p.client.doc;
        const len = doc.length;
        const n = doc.paragraphs().length;
        const s = { anchor: doc.positionAt(0), head: doc.positionAt(0) };
        const rec = (ops: Op[]) => p.history.record({ ops, before: s, after: s, time: step });
        const roll = r();
        if (roll < 0.25) rec([{ type: 'insert', ids: doc.insertText(Math.floor(r() * len), randomText(r, r() < 0.05 ? 200 : 4)) }]);
        else if (roll < 0.4) {
          const from = Math.floor(r() * len);
          const to = Math.min(len - 1, from + Math.floor(r() * 15));
          if (from < to) rec(doc.deleteRange(from, to));
        } else if (roll < 0.48) {
          const i = Math.floor(r() * n);
          rec(doc.moveParagraphs(i, Math.min(n - 1, i + Math.floor(r() * 2)), Math.floor(r() * (n + 1))));
        } else if (roll < 0.52) {
          const i = Math.floor(r() * n);
          rec(doc.hideParagraphs(i, i));
        } else if (roll < 0.58) p.history.undo(doc);
        else if (roll < 0.61) p.history.redo(doc);
        else if (roll < 0.66) {
          const a = Math.floor(r() * (doc.maxCaret + 1));
          p.client.setSelection(a, Math.min(doc.maxCaret, a + Math.floor(r() * 5)));
        } else if (roll < 0.76) toWorker(p, 1 + Math.floor(r() * 2));
        else if (roll < 0.86) toMain(p, 1 + Math.floor(r() * 3));
        else if (roll < 0.93) p.core.flush();
        else net(p, 1 + Math.floor(r() * 3));
        // 매 단계: 메인 Doc의 문단 목록과 불변식
        expect(doc.paragraphs()).toEqual(doc.paragraphsFromScratch());
      }
      settle();
      const texts = peers.map((p) => p.client.doc.text());
      expect(texts[1]).toBe(texts[0]);
      expect(texts[2]).toBe(texts[0]);
      for (const p of peers) consistent(p);
      // 캐럿: 모두 받은 뒤에는 각 피어가 보는 다른 피어의 캐럿 = 그 피어 자신의 커서를 자기 문서에서 푼 자리
      let carets = 0;
      for (const p of peers) {
        for (const rs of p.client.remotes()) {
          const owner = peers.find((q) => q.core.loro.peerIdStr === rs.key)!;
          const own = (owner.core as unknown as { store: { local: { anchor: Uint8Array; head: Uint8Array } } }).store.local;
          const resolve = (b: Uint8Array) =>
            Math.min(owner.client.doc.maxCaret, owner.client.doc.offsetOfU16((owner.core as unknown as { resolve(b: Uint8Array): number }).resolve(b)));
          expect([rs.anchor, rs.head]).toEqual([resolve(own.anchor), resolve(own.head)]);
          carets++;
        }
      }
      expect(carets).toBeGreaterThan(0);
      expect(raced(peers)).toBeGreaterThan(0);
    });
  }
});
