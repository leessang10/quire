/**
 * 여러 스토리 (11 §2.5, 2-10): 본문 + 가벼운 스토리들이 같은 Loro 문서에서 오가고 수렴하는가.
 * 가벼운 스토리는 빈 텍스트 = 빈 문단 하나이고 끝 ¶는 Loro에 없다 (유령 ¶). 두 피어가 같은 스토리를 동시에 처음 만들어도 합쳐진다.
 */
import { describe, expect, it } from 'vitest';
import { Doc, Document, History, MARK_KEYS, type MarkKey, type Op } from '@quiredoc/model';
import { SyncBridge } from './index';
import { docFromLoro, storyNames } from './shape';
import { formatState, stable } from './format-state.test-util';

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
  const snap = peers[0]!.snapshot();
  for (let k = 1; k < n; k++) peers.push(mk(k, (o) => SyncBridge.fromSnapshot(snap, o)));
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
  return { peers, deliver, settle };
}

const NL = String.fromCharCode(10);
const sel = (doc: Doc) => ({ anchor: doc.positionAt(0), head: doc.positionAt(0) });

describe('light stories (model)', () => {
  it('starts as one empty paragraph with a ghost paragraph mark that is never sent', () => {
    const d = new Document(Doc.fromText('본문'));
    const st = d.story('c1');
    expect(st.text()).toBe(NL);
    expect(st.isStory).toBe(true);
    const log: unknown[] = [];
    d.observe((story, c) => log.push([story, c.kind]));
    st.insertText(0, '가나');
    st.insertText(2, `${NL}다`);
    st.setParaAttr(1, 'align', 'center'); // 끝 문단: 유령 ¶ → tail
    st.setParaAttr(0, 'align', 'right');
    st.format(0, st.length, 'bold', true); // 유령 ¶의 서식도 tail
    // 끝 문단의 속성과 유령 ¶의 서식은 tail로, 앞 문단 ¶는 para로
    expect(log.map((x) => (x as [string, string])[1])).toEqual(['insert', 'insert', 'tail', 'para', 'tail', 'mark']);
    expect(log.every((x) => (x as [string, string])[0] === 'c1')).toBe(true);
    // 끝 문단은 옮기거나 숨기지 않는다, 지우기는 유령 ¶ 앞까지
    expect(st.moveParagraphs(1, 1, 0)).toEqual([]);
    expect(st.hideParagraphs(1, 1)).toEqual([]);
    st.deleteRange(0, st.length);
    expect(st.text()).toBe(NL);
  });

  it('undoes operations across stories in one transaction', () => {
    const d = new Document(Doc.fromText('본문'));
    const h = new History();
    const a = d.story('a');
    const b = d.story('b');
    const tr: Op[] = [
      ...Document.tag('a', [{ type: 'insert', ids: a.insertText(0, '에이') }]),
      ...Document.tag('b', [{ type: 'insert', ids: b.insertText(0, '비') }]),
      ...Document.tag('b', b.setParaAttr(0, 'align', 'center')),
    ];
    h.record({ ops: tr, before: sel(d.body), after: sel(d.body), time: 0 });
    h.undo(d);
    expect([a.text(), b.text(), b.paraAttrs(0)]).toEqual([NL, NL, {}]);
    h.redo(d);
    expect([a.text(), b.text(), b.paraAttrs(0)]).toEqual([`에이${NL}`, `비${NL}`, { align: 'center' }]);
  });
});

describe('stories over the bridge', () => {
  it('merges two peers creating the same story at the same time (deterministic id, no sentinel)', () => {
    const { peers, settle } = network(2, '본문');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.story('t|r0|c0').insertText(0, 'A');
    b.story('t|r0|c0').insertText(0, 'B');
    b.story('t|r0|c0').setParaAttr(0, 'align', 'center');
    settle();
    const ta = a.story('t|r0|c0').text();
    expect(ta === `AB${NL}` || ta === `BA${NL}`).toBe(true);
    expect(b.story('t|r0|c0').text()).toBe(ta);
    expect(a.story('t|r0|c0').paraAttrs(0)).toEqual({ align: 'center' });
    // 늦게 연 스토리는 Loro 상태에서
    const c = SyncBridge.fromSnapshot(a.snapshot(), { peer: 9, batchMs: null });
    expect(c.story('t|r0|c0').text()).toBe(ta);
    expect(a.loro.getText(storyNames('t|r0|c0').text).toString()).toBe(ta.slice(0, -1)); // 유령 ¶는 Loro에 없다
  });

  const ALPHA = Array.from('가나다 ab\n😀');
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }
  const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const STORIES = ['a', 'b', 't|r0|c0'];

  for (const seed of Array.from({ length: 16 }, (_, k) => k + 1)) {
    it(`randomized convergence of body + stories, seed ${seed}`, () => {
      const r = rng(seed * 977);
      const { peers, deliver, settle } = network(3, Array.from({ length: 4 }, (_, i) => `본문 ${i} 가나다`).join(NL));
      const histories = peers.map(() => new History(0));
      for (let step = 0; step < 300; step++) {
        const k = Math.floor(r() * 3);
        const p = peers[k]!;
        const h = histories[k]!;
        const story = r() < 0.25 ? null : pick(r, STORIES);
        const doc = story === null ? p.doc : p.story(story);
        const tag = (ops: Op[]) => (story === null ? ops : Document.tag(story, ops));
        const s = sel(p.doc);
        const rec = (ops: Op[]) => ops.length && h.record({ ops: tag(ops), before: s, after: s, time: step });
        const len = doc.length;
        const n = doc.paragraphs().length;
        const roll = r();
        if (roll < 0.25) rec([{ type: 'insert', ids: doc.insertText(Math.floor(r() * len), pick(r, ALPHA) + pick(r, ALPHA)) }]);
        else if (roll < 0.35) {
          const from = Math.floor(r() * len);
          rec(doc.deleteRange(from, Math.min(len, from + 1 + Math.floor(r() * 5))));
        } else if (roll < 0.45) {
          const from = Math.floor(r() * len);
          const key = pick(r, ['bold', 'color', 'size'] as MarkKey[]);
          rec(doc.format(from, Math.min(len, from + 1 + Math.floor(r() * 8)), key, pick<unknown>(r, key === 'bold' ? [true, undefined] : key === 'color' ? ['#c01c28', undefined] : [18000, undefined])));
        } else if (roll < 0.53) rec(doc.setParaAttr(Math.floor(r() * n), pick(r, ['align', 'style'] as const), pick(r, ['center', 'h1', undefined])));
        else if (roll < 0.58) {
          const i = Math.floor(r() * n);
          rec(doc.moveParagraphs(i, i, Math.floor(r() * (n + 1))));
        } else if (roll < 0.6) {
          const i = Math.floor(r() * n);
          rec(doc.hideParagraphs(i, i));
        } else if (roll < 0.68) h.undo(p.document);
        else if (roll < 0.72) h.redo(p.document);
        else if (roll < 0.82) p.flush();
        else {
          const from = Math.floor(r() * 3);
          deliver(from, (from + 1 + Math.floor(r() * 2)) % 3, 1 + Math.floor(r() * 3));
          peers[(from + 1) % 3]!.flush();
          peers[(from + 2) % 3]!.flush();
        }
        // 매 단계: 연 스토리마다 Doc = 그 피어의 Loro
        for (const q of peers)
          for (const id of q.document.storyIds()) {
            const a = stable(formatState(q.story(id)));
            const b = stable(formatState(docFromLoro(q.loro, 'x', id)));
            if (a !== b) throw new Error(`seed ${seed} step ${step} peer ${peers.indexOf(q)} story ${id}\n${a}\n${b}`);
          }
      }
      settle();
      for (const id of STORIES) {
        const f0 = stable(formatState(peers[0]!.story(id)));
        expect(stable(formatState(peers[1]!.story(id))), `story ${id}`).toBe(f0);
        expect(stable(formatState(peers[2]!.story(id))), `story ${id}`).toBe(f0);
      }
      expect(stable(formatState(peers[1]!.doc))).toBe(stable(formatState(peers[0]!.doc)));
      void MARK_KEYS;
    });
  }
});

describe('stories through the worker (random message timing)', () => {
  // 피어마다 메인 SyncClient + Worker SyncCore, 모든 메시지를 대기열에 넣고 무작위 차례로 전달 (worker-format.test.ts와 같은 틀)
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
  async function network(n: number, text: string) {
    const { SyncCore } = await import('./core');
    const { SyncClient } = await import('./client');
    const peers: Peer[] = [];
    let snapshot: Uint8Array | null = null;
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
      const core: Peer['core'] = k === 0 ? SyncCore.create(text, k + 1, opts) : SyncCore.fromSnapshot(snapshot!, k + 1, opts);
      if (k === 0) snapshot = core.loro.export({ mode: 'snapshot' });
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
  const STORIES = ['a', 't|r0|c0'];
  const ALPHA = Array.from('가나다 ab\n😀');

  it('starts a new client with the stories that exist', async () => {
    const { peers, settle } = await network(2, '본문');
    peers[0]!.client.story('a').insertText(0, '에이');
    peers[0]!.client.story('a').setParaAttr(0, 'align', 'right');
    settle();
    expect(peers[1]!.client.document.storyIds()).toEqual(['a']);
    expect(peers[1]!.client.story('a').text()).toBe(`에이${NL}`);
    expect(peers[1]!.client.story('a').paraAttrs(0)).toEqual({ align: 'right' });
    for (const p of peers) p.core.close();
  });

  for (const seed of Array.from({ length: 40 }, (_, k) => k + 1)) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed * 31 + 7);
      const { peers, toWorker, toMain, net, settle } = await network(3, Array.from({ length: 4 }, (_, i) => `본문 ${i} 가나다`).join(NL));
      for (let step = 0; step < 300; step++) {
        const p = peers[Math.floor(r() * 3)]!;
        const story = r() < 0.3 ? null : pick(r, STORIES);
        const doc = story === null ? p.client.doc : p.client.story(story);
        const tag = (ops: Op[]) => (story === null ? ops : Document.tag(story, ops));
        const s = { anchor: p.client.doc.positionAt(0), head: p.client.doc.positionAt(0) };
        const rec = (ops: Op[]) => ops.length && p.history.record({ ops: tag(ops), before: s, after: s, time: step });
        const len = doc.length;
        const n = doc.paragraphs().length;
        const roll = r();
        if (roll < 0.22) rec([{ type: 'insert', ids: doc.insertText(Math.floor(r() * len), pick(r, ALPHA) + pick(r, ALPHA)) }]);
        else if (roll < 0.3) {
          const from = Math.floor(r() * len);
          rec(doc.deleteRange(from, Math.min(len, from + 1 + Math.floor(r() * 5))));
        } else if (roll < 0.38) {
          const from = Math.floor(r() * len);
          rec(doc.format(from, Math.min(len, from + 1 + Math.floor(r() * 8)), 'bold', pick<unknown>(r, [true, undefined])));
        } else if (roll < 0.44) rec(doc.setParaAttr(Math.floor(r() * n), 'align', pick<unknown>(r, ['center', undefined])));
        else if (roll < 0.48) {
          const i = Math.floor(r() * n);
          rec(doc.moveParagraphs(i, i, Math.floor(r() * (n + 1))));
        } else if (roll < 0.53) p.history.undo(p.client.document);
        else if (roll < 0.56) p.history.redo(p.client.document);
        else if (roll < 0.7) toWorker(p, 1 + Math.floor(r() * 2));
        else if (roll < 0.84) toMain(p, 1 + Math.floor(r() * 3));
        else if (roll < 0.92) p.core.flush();
        else net(p, 1 + Math.floor(r() * 3));
      }
      settle();
      for (const id of [...STORIES, null]) {
        const view = (q: Peer) => stable(formatState(id === null ? q.client.doc : q.client.story(id)));
        const f0 = view(peers[0]!);
        for (const q of peers) {
          expect(view(q), `seed ${seed} story ${id} peer ${peers.indexOf(q)}`).toBe(f0);
          // 메인 Doc = Worker의 Loro
          expect(stable(formatState(id === null ? docFromLoro(q.core.loro) : docFromLoro(q.core.loro, 'x', id)))).toBe(f0);
        }
      }
      for (const p of peers) p.core.close();
    });
  }
});

describe('stories in storage (canonical JSON, compaction, .quire, rebase)', () => {
  const build = () => {
    const d = new Document(Doc.fromText('본문'));
    const c = d.story('t|r0|c0');
    c.insertText(0, `셀 가나${NL}둘째 줄`);
    c.format(0, 1, 'bold', true);
    c.setParaAttr(1, 'align', 'center'); // 끝 문단 (유령 ¶) → tail
    c.setParaAttr(0, 'align', 'right');
    d.story('empty'); // 빈 스토리는 저장하지 않는다
    return d;
  };
  const view = (d: Document) => ({
    body: stable(formatState(d.body)),
    stories: Object.fromEntries(
      d
        .storyIds()
        .filter((id) => d.story(id).text() !== NL)
        .sort()
        .map((id) => [id, stable(formatState(d.story(id)))]),
    ),
  });

  it('round-trips stories through the canonical JSON', async () => {
    const { quireFromDocument, documentFromQuire, canonicalJson } = await import('./canonical');
    const d = build();
    const json = canonicalJson(quireFromDocument(d));
    const q = JSON.parse(json);
    expect(Object.keys(q.stories).sort()).toEqual(['body', 't|r0|c0']);
    expect(q.stories['t|r0|c0'][1]).toEqual({ p: { align: 'center' }, c: [{ t: '둘째 줄' }] });
    const back = documentFromQuire(q).document;
    expect(view(back)).toEqual(view(d));
    expect(canonicalJson(quireFromDocument(back))).toBe(json);
  });

  it('keeps stories (with last-paragraph attributes in the tail map) through compaction and .quire', async () => {
    const { compactDocument } = await import('./epoch');
    const { documentFromLoro } = await import('./shape');
    const { packQuire, openQuire } = await import('./quire-file');
    const { documentFromQuire } = await import('./canonical');
    const d = build();
    const loro = compactDocument(d, 'e1', 5);
    expect(loro.getText('s:t|r0|c0').toString()).toBe(`셀 가나${NL}둘째 줄`);
    expect(loro.getMap('tp:t|r0|c0').toJSON()).toEqual({ p_align: 'center' });
    expect(view(documentFromLoro(loro))).toEqual(view(d));
    const opened = await openQuire(await packQuire({ loro }));
    expect(opened.crdt).not.toBeNull();
    expect(view(documentFromQuire(opened.doc).document)).toEqual(view(d));
  });

  it('moves offline story edits to a new epoch', async () => {
    const { compactDocument, rebaseOnto, readEpoch } = await import('./epoch');
    const { documentFromLoro, newLoro } = await import('./shape');
    const { LoroWriter } = await import('./shape');
    const a = compactDocument(build(), '', 1);
    // 서버 = 지금 A. A는 오프라인으로 스토리를 고친다
    const server = newLoro(50);
    server.import(a.export({ mode: 'snapshot' }));
    const docA = documentFromLoro(a);
    const names = (await import('./shape')).storyNames('t|r0|c0');
    const st = docA.story('t|r0|c0');
    const w = new LoroWriter(a, () => st.segmentOrder(), names);
    st.observe((c) => w.apply(c));
    st.insertText(0, '오프라인 ');
    st.setParaAttr(st.paragraphs().length - 1, 'align', 'right');
    a.commit();
    const fresh = compactDocument(documentFromLoro(server), 'e1', 99);
    const { loro } = rebaseOnto(a, { epoch: 'e1', oldVV: server.oplogVersion().encode(), update: new Uint8Array(), base: fresh.export({ mode: 'snapshot' }) }, 1);
    expect(readEpoch(loro)).toBe('e1');
    const got = documentFromLoro(loro).story('t|r0|c0');
    expect(got.text()).toBe(`오프라인 셀 가나${NL}둘째 줄${NL}`);
    expect(got.paraAttrs(1)).toEqual({ align: 'right' });
    expect(stable(formatState(got))).toBe(stable(formatState(documentFromLoro(a).story('t|r0|c0'))));
  });
});
