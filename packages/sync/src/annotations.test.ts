/**
 * 주석 레이어 (14 §2): 편집 모델(위치·고아·실행 취소), Loro 맵 + 커서 동기화(브리지·Worker), 정본·새 판 압축.
 * 기준: 동시 편집 뒤에도 범위가 같은 글자들을 덮는다 (모든 피어에서 범위의 글자열이 같다).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Doc, Document, History, type Op } from '@quiredoc/model';
import { SyncBridge } from './index';
import { SyncClient } from './client';
import { SyncCore } from './core';
import type { ToMain, ToWorker } from './protocol';
import { canonicalJson, documentFromQuire, quireFromDocument } from './canonical';
import { compactDocument } from './epoch';
import { documentFromLoro } from './shape';

const NL = '\n';

/** 주석마다 (종류, 범위 글자열, 고아, 데이터) — 피어 사이 비교용 */
function view(d: Document) {
  const out: Record<string, { type: string; text: string | null; orphan: boolean; data: unknown }> = {};
  for (const id of d.annotationIds().sort()) {
    const a = d.annotation(id)!;
    const r = d.resolveRange(a);
    const cps = Array.from(d.docOf(a.story).text());
    out[id] = { type: a.type, text: r && !r.orphan ? cps.slice(r.from, r.to).join('') : null, orphan: !r || r.orphan, data: a.data };
  }
  return out;
}

function network(n: number, text: string) {
  const queues: Uint8Array[][] = Array.from({ length: n }, () => []);
  const peers: SyncBridge[] = [];
  for (let k = 0; k < n; k++) {
    const opts = { peer: k + 1, batchMs: null, onUpdate: (u: Uint8Array) => queues.forEach((q, j) => j !== k && q.push(u)) };
    peers.push(k === 0 ? SyncBridge.create(text, opts) : SyncBridge.fromSnapshot(peers[0]!.snapshot(), opts));
  }
  const deliver = (k: number) => {
    peers[k]!.flush();
    while (queues[k]!.length) peers[k]!.receive(queues[k]!.shift()!);
  };
  const settle = () => {
    for (let r = 0; r < 4; r++) for (let k = 0; k < n; k++) deliver(k);
    for (let k = 0; k < n; k++) peers[k]!.flush();
  };
  return { peers, deliver, settle };
}

describe('annotation model (14 §2.1)', () => {
  it('keeps covering the same characters; text typed at either end stays outside; deleting all makes it an orphan; undo brings it back', () => {
    const d = new Document(Doc.fromText('가나다라마바사'));
    const h = new History();
    const rec = (ops: Op[]) => h.record({ ops, before: { anchor: d.body.positionAt(0), head: d.body.positionAt(0) }, after: { anchor: d.body.positionAt(0), head: d.body.positionAt(0) }, time: 0 });
    rec(d.annotate({ id: 'a', type: 'comment', story: null, from: 2, to: 5, data: { thread: 't1' } }));
    expect(view(d).a!.text).toBe('다라마');
    d.body.insertText(2, 'X'); // 앞 끝
    d.body.insertText(6, 'Y'); // 뒤 끝 (다라마 뒤)
    d.body.insertText(4, 'Z'); // 안
    expect(view(d).a!.text).toBe('다Z라마');
    h.seal();
    rec(d.body.deleteRange(3, 7).map((o) => o));
    expect(view(d).a!.orphan).toBe(true);
    h.undo(d);
    expect(view(d).a!.text).toBe('다Z라마');
    h.undo(d); // 주석 걸기 되돌리기
    expect(d.annotationIds()).toEqual([]);
    h.redo(d);
    expect(view(d).a!.data).toEqual({ thread: 't1' });
  });

  it('finds annotations over a range and lists them by position', () => {
    const d = new Document(Doc.fromText(['첫 문단', '둘째 문단입니다'].join(NL)));
    d.annotate({ id: 'b', type: 'highlight', story: null, from: 6, to: 8 });
    d.annotate({ id: 'a', type: 'comment', story: null, from: 0, to: 3 });
    d.annotate({ id: 'c', type: 'comment', story: null, from: 1, to: 9 });
    expect(d.annotationRanges().map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(d.annotationsIn(null, 5, 7).map((r) => r.id).sort()).toEqual(['b', 'c']);
  });
});

describe('annotations over the bridge (14 §2.2)', () => {
  it('sends annotations and keeps their ranges on the same characters under concurrent edits', () => {
    const { peers, settle } = network(2, '하나 둘 셋 넷 다섯');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.document.annotate({ id: 'x', type: 'comment', story: null, from: 3, to: 6, data: { thread: 't' } });
    settle();
    expect(view(b.document)).toEqual(view(a.document));
    expect(view(b.document).x!.text).toBe('둘 셋');
    // 동시에: A는 범위 앞, B는 범위 안과 뒤 끝에 입력
    a.doc.insertText(3, '앞');
    b.doc.insertText(4, '안');
    b.doc.insertText(7, '뒤');
    settle();
    expect(view(a.document)).toEqual(view(b.document));
    expect(view(a.document).x!.text).toBe('둘안 셋');
    // 데이터를 바꾸는 동안 다른 피어가 지우면 지우기가 이긴다
    a.document.updateAnnotation('x', { resolved: true });
    b.document.unannotate('x');
    settle();
    expect(a.document.annotationIds()).toEqual([]);
    expect(b.document.annotationIds()).toEqual([]);
  });

  it('marks an annotation whose characters were all deleted as an orphan on every peer', () => {
    const { peers, settle } = network(2, '가나다라마');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.document.annotate({ id: 'o', type: 'comment', story: null, from: 1, to: 3 });
    settle();
    b.doc.deleteRange(0, 4);
    settle();
    expect(view(a.document).o!.orphan).toBe(true);
    expect(view(b.document).o!.orphan).toBe(true);
    // 늦게 연 피어도
    const c = SyncBridge.fromSnapshot(a.snapshot(), { peer: 9, batchMs: null });
    expect(view(c.document).o!.orphan).toBe(true);
  });

  it('works in other stories (cells, notes)', () => {
    const { peers, settle } = network(2, '본문');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.story('fn|n1').insertText(0, '각주 내용입니다');
    a.document.annotate({ id: 's', type: 'highlight', story: 'fn|n1', from: 3, to: 5 });
    settle();
    b.story('fn|n1');
    expect(view(b.document).s!.text).toBe('내용');
  });

  const rng = (seed: number) => {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
  };
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`randomized: 3 peers edit text and annotations, all end with the same annotations (seed ${seed})`, () => {
      const r = rng(seed * 7919);
      const { peers, deliver, settle } = network(3, Array.from({ length: 5 }, (_, i) => `문단 ${i} 가나다라마바사`).join(NL));
      let n = 0;
      for (let step = 0; step < 200; step++) {
        const k = Math.floor(r() * 3);
        const p = peers[k]!;
        const len = p.doc.maxCaret;
        const x = r();
        const at = Math.floor(r() * (len + 1));
        if (x < 0.35) p.doc.insertText(at, r() < 0.15 ? NL : '가나'.slice(0, 1 + Math.floor(r() * 2)));
        else if (x < 0.55 && len > 2) p.doc.deleteRange(Math.min(at, len - 1), Math.min(len, at + 1 + Math.floor(r() * 4)));
        else if (x < 0.75 && len > 3) {
          const from = Math.min(at, len - 2);
          p.document.annotate({ id: `p${k}a${n++}`, type: r() < 0.5 ? 'comment' : 'highlight', story: null, from, to: Math.min(len, from + 1 + Math.floor(r() * 6)) });
        } else if (x < 0.88) {
          const ids = p.document.annotationIds();
          if (ids.length) p.document.updateAnnotation(ids[Math.floor(r() * ids.length)]!, { n: step });
        } else {
          const ids = p.document.annotationIds();
          if (ids.length) p.document.unannotate(ids[Math.floor(r() * ids.length)]!);
        }
        if (r() < 0.3) deliver(Math.floor(r() * 3));
      }
      settle();
      const v0 = view(peers[0]!.document);
      expect(Object.keys(v0).length).toBeGreaterThan(5);
      expect(view(peers[1]!.document)).toEqual(v0);
      expect(view(peers[2]!.document)).toEqual(v0);
      // Loro에서 새로 연 문서도 같다
      expect(view(documentFromLoro(peers[0]!.loro))).toEqual(v0);
    });
  }
});

describe('annotations through the worker (14 §2.2)', () => {
  const cores: SyncCore[] = [];
  afterEach(() => {
    for (const c of cores.splice(0)) c.close();
  });

  for (const seed of [1, 2, 3, 4]) {
    it(`random message timing: main documents agree with each other and with Loro (seed ${seed})`, () => {
      let s = seed * 104729;
      const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 0x100000000);
      const peers: Array<{ core: SyncCore; client: SyncClient; toWorker: ToWorker[]; toMain: ToMain[]; netIn: Uint8Array[] }> = [];
      let snap: Uint8Array | null = null;
      for (let k = 0; k < 2; k++) {
        const toMain: ToMain[] = [];
        const opts = {
          user: { name: `P${k}`, color: '#336699' },
          batchMs: null,
          post: (m: ToMain) => toMain.push(m),
          net: { sendDoc: (bytes: Uint8Array) => peers.filter((_, j) => j !== k).forEach((p) => p.netIn.push(bytes)), sendPresence: () => {} },
        };
        const core: SyncCore = k === 0 ? SyncCore.create(['첫 문단 가나다라', '둘째 문단 마바사아'].join(NL), 1, opts) : SyncCore.fromSnapshot(snap!, 2, opts);
        if (k === 0) snap = core.loro.export({ mode: 'snapshot' });
        cores.push(core);
        const init = toMain.shift() as Extract<ToMain, { t: 'init' }>;
        const toWorker: ToWorker[] = [];
        peers.push({ core, client: new SyncClient(init, { post: (m) => toWorker.push(m) }), toWorker, toMain, netIn: [] });
      }
      const pump = (p: (typeof peers)[0], all: boolean) => {
        while (p.toWorker.length && (all || r() < 0.6)) p.core.handle(p.toWorker.shift()!);
        p.core.flush();
        while (p.netIn.length && (all || r() < 0.6)) p.core.receiveDoc(p.netIn.shift()!);
        p.core.flush();
        while (p.toMain.length && (all || r() < 0.6)) p.client.handle(p.toMain.shift()!);
      };
      let n = 0;
      for (let step = 0; step < 150; step++) {
        const p = peers[Math.floor(r() * 2)]!;
        const d = p.client.document;
        const len = d.body.maxCaret;
        const at = Math.floor(r() * (len + 1));
        const x = r();
        if (x < 0.4) d.body.insertText(at, '가');
        else if (x < 0.6 && len > 3) d.body.deleteRange(Math.min(at, len - 1), Math.min(len, at + 2));
        else if (x < 0.85 && len > 3) {
          const from = Math.min(at, len - 2);
          d.annotate({ id: `w${n++}`, type: 'comment', story: null, from, to: Math.min(len, from + 1 + Math.floor(r() * 5)) });
        } else {
          const ids = d.annotationIds();
          if (ids.length) d.updateAnnotation(ids[Math.floor(r() * ids.length)]!, { s: step });
        }
        pump(peers[Math.floor(r() * 2)]!, false);
      }
      for (let round = 0; round < 20; round++) for (const p of peers) pump(p, true);
      const [a, b] = peers as [(typeof peers)[0], (typeof peers)[0]];
      expect(a.client.doc.text()).toBe(b.client.doc.text());
      const va = view(a.client.document);
      expect(Object.keys(va).length).toBeGreaterThan(3);
      expect(view(b.client.document)).toEqual(va);
      expect(view(documentFromLoro(a.core.loro))).toEqual(va);
    });
  }
});

describe('annotations in storage (14 §2.3)', () => {
  it('round-trips through the canonical JSON and survives compaction to a new epoch', () => {
    const d = new Document(Doc.fromText(['가나다 라마바', '사아자 차카타'].join(NL)));
    d.annotate({ id: 'a1', type: 'comment', story: null, from: 4, to: 7, data: { thread: 't1' } });
    d.story('hdr|last|default').insertText(0, '머리말 글');
    d.annotate({ id: 'a2', type: 'highlight', story: 'hdr|last|default', from: 0, to: 3 });
    d.annotate({ id: 'a3', type: 'comment', story: null, from: 8, to: 9 });
    d.body.deleteRange(8, 9); // a3은 고아
    const q = quireFromDocument(d);
    expect(q.annotations).toEqual([
      { id: 'a1', type: 'comment', data: { thread: 't1' }, start: { story: 'body', offset: 4 }, end: { story: 'body', offset: 7 } },
      { id: 'a2', type: 'highlight', data: {}, start: { story: 'hdr|last|default', offset: 0 }, end: { story: 'hdr|last|default', offset: 3 } },
      { id: 'a3', type: 'comment', data: {}, story: 'body' },
    ]);
    const back = documentFromQuire(JSON.parse(canonicalJson(q))).document;
    expect(view(back).a1).toEqual(view(d).a1);
    expect(view(back).a2).toEqual(view(d).a2);
    expect(canonicalJson(quireFromDocument(back))).toBe(canonicalJson(q));
    // 새 판 압축: 커서를 새 텍스트에 다시 만든다
    const fresh = documentFromLoro(compactDocument(d, 'e2', 5));
    expect(view(fresh).a1).toEqual(view(d).a1);
    expect(view(fresh).a2!.text).toBe('머리말');
  });
});
