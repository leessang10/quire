/**
 * 댓글 (14 §3, G2): 스레드·답글·고치기·해결·지우기, 동시 답글이 모두 남음, 고아 스레드가 남아 보임, 정본·새 판, Worker 경로.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Doc, Document, History, type CommentAuthor, type Op } from '@quire/model';
import { SyncBridge } from './index';
import { SyncClient } from './client';
import { SyncCore } from './core';
import type { ToMain, ToWorker } from './protocol';
import { canonicalJson, documentFromQuire, quireFromDocument } from './canonical';
import { compactDocument } from './epoch';
import { documentFromLoro } from './shape';

const NL = '\n';
const A: CommentAuthor = { id: 'ua', name: '가영', color: '#2563eb' };
const B: CommentAuthor = { id: 'ub', name: '나래', color: '#c2410c' };

/** 비교용: 스레드마다 (고아 여부, 범위 글자, 해결, 메시지 글들) */
function view(d: Document) {
  const out: Record<string, { text: string | null; resolved: boolean; deleted: boolean; msgs: string[] }> = {};
  for (const t of d.threads()) {
    const a = t.anchor ? d.annotation(t.anchor) : undefined;
    const r = a ? d.resolveRange(a) : null;
    const cps = a ? Array.from(d.docOf(a.story).text()) : [];
    out[t.id] = {
      text: r && !r.orphan ? cps.slice(r.from, r.to).join('') : null,
      resolved: t.resolved,
      deleted: t.deleted,
      msgs: t.messages.map((m) => `${m.author.name}:${m.deleted ? '(지움)' : m.text}${m.edited ? '*' : ''}`),
    };
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
  const settle = () => {
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < n; k++) {
        peers[k]!.flush();
        while (queues[k]!.length) peers[k]!.receive(queues[k]!.shift()!);
      }
    for (let k = 0; k < n; k++) peers[k]!.flush();
  };
  return { peers, settle };
}

const thread = (d: Document, id: string, from: number, to: number, text: string, author = A, time = 1) =>
  d.addThread({ thread: id, annotation: `a_${id}`, story: null, from, to, message: `m_${id}`, author, text, time });

describe('comment model (14 §3.1)', () => {
  it('makes a thread on a range, replies in time order, edits, resolves and deletes; undo removes a new thread', () => {
    const d = new Document(Doc.fromText('가나다라마바사'));
    const h = new History();
    const pos = { anchor: d.body.positionAt(0), head: d.body.positionAt(0) };
    const rec = (ops: Op[]) => h.record({ ops, before: pos, after: pos, time: 0 });
    rec(thread(d, 't1', 2, 5, '이 부분 확인'));
    d.addMessage('t1', { id: 'm3', author: B, time: 3, text: '나중 답' });
    d.addMessage('t1', { id: 'm2', author: A, time: 2, text: '먼저 답' });
    expect(view(d).t1).toEqual({ text: '다라마', resolved: false, deleted: false, msgs: ['가영:이 부분 확인', '가영:먼저 답', '나래:나중 답'] });
    d.editMessage('t1', 'm2', '고친 답', 9);
    d.deleteMessage('t1', 'm3');
    d.resolveThread('t1', true);
    expect(view(d).t1).toEqual({ text: '다라마', resolved: true, deleted: false, msgs: ['가영:이 부분 확인', '가영:고친 답*', '나래:(지움)'] });
    d.resolveThread('t1', false);
    expect(d.thread('t1')!.resolved).toBe(false);
    // 스레드 지우기: 주석이 없어지고 스레드는 지운 표시. 되돌리면 돌아온다
    h.seal();
    rec(d.deleteThread('t1'));
    expect(d.annotationIds()).toEqual([]);
    expect(d.thread('t1')!.deleted).toBe(true);
    h.undo(d);
    expect(view(d).t1!.text).toBe('다라마');
    expect(d.thread('t1')!.deleted).toBe(false);
    // 스레드 만들기 되돌리기: 주석과 첫 메시지·기준이 없어진다 (답글은 기록 밖이라 남는다)
    h.undo(d);
    expect(d.annotationIds()).toEqual([]);
    expect(d.thread('t1')!.anchor).toBe(null);
    expect(d.thread('t1')!.messages.map((m) => m.id)).toEqual(['m2', 'm3']);
  });

  it('keeps a thread whose text was all deleted (orphan) and brings the range back on undo', () => {
    const d = new Document(Doc.fromText('가나다라마'));
    const h = new History();
    thread(d, 't', 1, 3, '댓글');
    const pos = { anchor: d.body.positionAt(0), head: d.body.positionAt(0) };
    h.record({ ops: d.body.deleteRange(0, 4), before: pos, after: pos, time: 0 });
    expect(view(d).t).toEqual({ text: null, resolved: false, deleted: false, msgs: ['가영:댓글'] });
    h.undo(d);
    expect(view(d).t!.text).toBe('나다');
  });
});

describe('comments over the bridge (14 §3.1)', () => {
  it('keeps both concurrent replies in the same order on every peer; edit and delete of one message both survive', () => {
    const { peers, settle } = network(2, '하나 둘 셋 넷');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    thread(a.document, 't', 3, 6, '질문');
    settle();
    expect(view(b.document)).toEqual(view(a.document));
    // 동시 답글 (같은 시각이어도 ID로 차례가 정해진다)
    a.document.addMessage('t', { id: 'mb', author: A, time: 5, text: 'A 답' });
    b.document.addMessage('t', { id: 'ma', author: B, time: 5, text: 'B 답' });
    settle();
    expect(view(a.document)).toEqual(view(b.document));
    expect(view(a.document).t!.msgs).toEqual(['가영:질문', '나래:B 답', '가영:A 답']);
    // 같은 메시지를 A는 고치고 B는 지운다: 지운 표시와 고친 글이 모두 남는다 (지운 메시지로 보인다)
    a.document.editMessage('t', 'mb', 'A 답 고침', 7);
    b.document.deleteMessage('t', 'mb');
    // 해결은 키 하나 LWW
    b.document.resolveThread('t', true);
    settle();
    expect(view(a.document)).toEqual(view(b.document));
    expect(a.document.thread('t')!.messages.find((m) => m.id === 'mb')).toMatchObject({ text: 'A 답 고침', deleted: true });
    expect(view(a.document).t!.resolved).toBe(true);
  });

  it('a thread survives when another peer deletes its text; late joiners see it too', () => {
    const { peers, settle } = network(2, '가나다라마');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    thread(a.document, 'o', 1, 3, '여기');
    settle();
    b.doc.deleteRange(0, 4);
    settle();
    expect(view(a.document).o).toEqual({ text: null, resolved: false, deleted: false, msgs: ['가영:여기'] });
    expect(view(b.document)).toEqual(view(a.document));
    const c = SyncBridge.fromSnapshot(a.snapshot(), { peer: 9, batchMs: null });
    expect(view(c.document)).toEqual(view(a.document));
  });

  it('works for ranges in other stories (footnote)', () => {
    const { peers, settle } = network(2, '본문');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.story('fn|n1').insertText(0, '각주 내용입니다');
    a.document.addThread({ thread: 'tf', annotation: 'af', story: 'fn|n1', from: 3, to: 5, message: 'm', author: A, text: '각주 댓글', time: 1 });
    settle();
    b.story('fn|n1');
    expect(view(b.document).tf).toEqual({ text: '내용', resolved: false, deleted: false, msgs: ['가영:각주 댓글'] });
  });
});

describe('comments over the Worker path (14 §3.1)', () => {
  const cores: SyncCore[] = [];
  afterEach(() => {
    for (const c of cores.splice(0)) c.close();
  });

  for (const seed of [1, 2, 3]) {
    it(`random message timing: every reply survives and all documents agree (seed ${seed})`, () => {
      let s = seed * 7727;
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
      let replies = 0;
      for (let step = 0; step < 150; step++) {
        const k = Math.floor(r() * 2);
        const p = peers[k]!;
        const d = p.client.document;
        const len = d.body.maxCaret;
        const at = Math.floor(r() * (len + 1));
        const x = r();
        const threads = d.threads().filter((t) => !t.deleted);
        const pick = threads.length ? threads[Math.floor(r() * threads.length)]! : null;
        if (x < 0.3) d.body.insertText(at, '가');
        else if (x < 0.4 && len > 3) d.body.deleteRange(Math.min(at, len - 1), Math.min(len, at + 2));
        else if (x < 0.55 && len > 3) {
          const from = Math.min(at, len - 2);
          thread(d, `t${n++}`, from, Math.min(len, from + 1 + Math.floor(r() * 4)), `글${step}`, k ? B : A, step);
        } else if (x < 0.8 && pick) {
          d.addMessage(pick.id, { id: `r${step}`, author: k ? B : A, time: step, text: `답${step}` });
          replies++;
        } else if (x < 0.88 && pick) d.resolveThread(pick.id, !pick.resolved);
        else if (x < 0.95 && pick && pick.messages.length) d.editMessage(pick.id, pick.messages[0]!.id, `고침${step}`, step);
        else if (pick) d.deleteThread(pick.id);
        pump(peers[Math.floor(r() * 2)]!, false);
      }
      for (let round = 0; round < 20; round++) for (const p of peers) pump(p, true);
      const [a, b] = peers as [(typeof peers)[0], (typeof peers)[0]];
      expect(a.client.doc.text()).toBe(b.client.doc.text());
      const va = view(a.client.document);
      expect(Object.keys(va).length).toBeGreaterThan(2);
      expect(view(b.client.document)).toEqual(va);
      expect(view(documentFromLoro(a.core.loro))).toEqual(va);
      // 답글은 하나도 잃지 않는다
      const all = a.client.document.threads().flatMap((t) => t.messages.map((m) => m.id));
      expect(all.filter((id) => id.startsWith('r')).length).toBe(replies);
    });
  }
});

describe('comments in storage (14 §3)', () => {
  it('round-trips threads through the canonical JSON and survives compaction', () => {
    const d = new Document(Doc.fromText(['가나다 라마바', '사아자 차카타'].join(NL)));
    thread(d, 't1', 4, 7, '첫 댓글');
    d.addMessage('t1', { id: 'm2', author: B, time: 2, text: '답글\n두 줄' });
    d.resolveThread('t1', true);
    thread(d, 't2', 8, 9, '고아가 될 댓글');
    d.body.deleteRange(8, 9);
    const q = quireFromDocument(d);
    expect(q.annotations.map((a) => (a as { id: string }).id)).toEqual(['a_t1', 'a_t2']);
    expect(q.threads).toEqual([
      { id: 't1', anchor: 'a_t1', resolved: true, deleted: false, messages: [
        { id: 'm_t1', author: A, time: 1, text: '첫 댓글' },
        { id: 'm2', author: B, time: 2, text: '답글\n두 줄' },
      ] },
      { id: 't2', anchor: 'a_t2', resolved: false, deleted: false, messages: [{ id: 'm_t2', author: A, time: 1, text: '고아가 될 댓글' }] },
    ]);
    const back = documentFromQuire(JSON.parse(canonicalJson(q))).document;
    expect(view(back)).toEqual(view(d));
    expect(canonicalJson(quireFromDocument(back))).toBe(canonicalJson(q));
    const fresh = documentFromLoro(compactDocument(d, 'e2', 5));
    expect(view(fresh)).toEqual(view(d));
  });
});
