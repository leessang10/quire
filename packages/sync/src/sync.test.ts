/**
 * 브리지 수렴 시험: 피어마다 Doc + Loro, 업데이트를 손으로 주고받는다 (batchMs: null → flush()를 직접 호출).
 */
import { describe, expect, it } from 'vitest';
import { History, type Doc, type Op } from '@quire/model';
import { SyncBridge } from './index';

/** 피어 묶음: 각 피어의 내보낸 업데이트를 다른 피어의 받은편지함 대기열에 넣는다 */
function network(n: number, text = '') {
  const queues: Uint8Array[][][] = []; // queues[to][from]
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
  const snap = peers[0]!.snapshot();
  for (let k = 1; k < n; k++) peers.push(mk(k, (o) => SyncBridge.fromSnapshot(snap, o)));
  /** 대기열에서 from → to 업데이트를 count개(기본 전부) 전달 */
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
  return { peers, deliver, settle, queues };
}

function consistent(b: SyncBridge) {
  // Doc의 살아 있는 원소 열 = Loro 텍스트
  expect(b.doc.rawText()).toBe(b.loro.getText('body').toString());
  expect(b.doc.paragraphs()).toEqual(b.doc.paragraphsFromScratch());
  b.doc.checkInvariants();
}

const sel = (doc: Doc) => ({ anchor: doc.positionAt(0), head: doc.positionAt(0) });

describe('SyncBridge', () => {
  it('propagates typing to another peer', () => {
    const { peers, settle } = network(2, '가나다');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.doc.insertText(1, 'X');
    a.doc.insertText(5, '\n라');
    settle();
    expect(b.doc.text()).toBe('가X나다\n라\n');
    consistent(a);
    consistent(b);
  });

  it('merges concurrent edits and keeps the local caret in place', () => {
    const { peers, settle } = network(2, '가나다라');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    const caret = b.doc.positionAt(3); // B의 캐럿: 라 앞
    a.doc.insertText(0, '앞');
    b.doc.insertText(4, '뒤');
    a.doc.deleteRange(2, 3); // A: 나 삭제
    settle();
    expect(a.doc.text()).toBe('앞가다라뒤\n');
    expect(b.doc.text()).toBe(a.doc.text());
    expect(b.doc.resolve(caret)).toBe(3); // 여전히 라 앞
    consistent(a);
    consistent(b);
  });

  it('counts astral characters in UTF-16 positions', () => {
    const { peers, settle } = network(2, '😀a😀');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.doc.insertText(2, 'B'); // 두 번째 😀 앞
    b.doc.insertText(3, '🎉'); // 끝
    settle();
    expect(a.doc.text()).toBe('😀aB😀🎉\n');
    expect(b.doc.text()).toBe(a.doc.text());
    b.doc.deleteRange(0, 2);
    settle();
    expect(a.doc.text()).toBe('B😀🎉\n');
    consistent(a);
    consistent(b);
  });

  it('applies import events synchronously (Doc matches Loro right after flush)', () => {
    const { peers, deliver } = network(2, 'abc');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.doc.insertText(1, 'X');
    a.flush();
    deliver(0, 1);
    b.flush();
    // 같은 틱 안에서 바로 맞아야 다음 로컬 편집이 올바른 위치로 간다
    expect(b.doc.text()).toBe('aXbc\n');
    b.doc.insertText(2, 'Y');
    expect(b.doc.rawText()).toBe(b.loro.getText('body').toString());
  });

  it('syncs local undo and redo', () => {
    const { peers, settle } = network(2, '가나다');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    const h = new History(0);
    const s = sel(a.doc);
    h.record({ ops: a.doc.deleteRange(0, 2), before: s, after: s, time: 0 });
    h.record({ ops: [{ type: 'insert', ids: a.doc.insertText(1, '😀\n') }], before: s, after: s, time: 1 });
    settle();
    expect(b.doc.text()).toBe('다😀\n\n');
    h.undo(a.doc);
    h.undo(a.doc);
    settle();
    expect(b.doc.text()).toBe('가나다\n');
    h.redo(a.doc);
    settle();
    expect(b.doc.text()).toBe('다\n');
    consistent(a);
    consistent(b);
  });

  it('refuses segment operations while attached', () => {
    const { peers } = network(1, '가\n나');
    expect(peers[0]!.doc.moveParagraphs(0, 0, 2)).toEqual([]);
    expect(peers[0]!.doc.hideParagraphs(0, 0)).toEqual([]);
  });
});

describe('SyncBridge randomized convergence (3 peers)', () => {
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

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 42, 2024]) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const { peers, deliver, settle } = network(3, randomText(r, 200));
      const histories = peers.map(() => new History(0));
      for (let step = 0; step < 300; step++) {
        const k = Math.floor(r() * 3);
        const p = peers[k]!;
        const h = histories[k]!;
        const doc = p.doc;
        const len = doc.length;
        const roll = r();
        const s = sel(doc);
        if (roll < 0.4) {
          const ops: Op[] = [{ type: 'insert', ids: doc.insertText(Math.floor(r() * len), randomText(r, r() < 0.05 ? 300 : 5)) }];
          h.record({ ops, before: s, after: s, time: step });
        } else if (roll < 0.7) {
          const from = Math.floor(r() * len);
          const to = Math.min(len - 1, from + Math.floor(r() * 20));
          if (from < to) h.record({ ops: doc.deleteRange(from, to), before: s, after: s, time: step });
        } else if (roll < 0.8) {
          h.undo(doc);
        } else if (roll < 0.85) {
          h.redo(doc);
        } else if (roll < 0.93) {
          p.flush();
        } else {
          // 임의의 피어 쌍 사이에서 일부만 전달
          const from = Math.floor(r() * 3);
          const to = (from + 1 + Math.floor(r() * 2)) % 3;
          deliver(from, to, 1 + Math.floor(r() * 3));
          peers[to]!.flush();
        }
        // 매 단계: 각 피어의 Doc과 Loro는 일치
        expect(p.doc.rawText()).toBe(p.loro.getText('body').toString());
      }
      settle();
      const texts = peers.map((p) => p.doc.text());
      expect(texts[1]).toBe(texts[0]);
      expect(texts[2]).toBe(texts[0]);
      for (const p of peers) consistent(p);
    });
  }
});
