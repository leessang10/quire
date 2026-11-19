/**
 * 제안 모드 동기화 (14 §4): 제안은 주석이므로 주석 동기화를 그대로 탄다. 제안 모드는 편집기(피어)마다의 상태다.
 */
import { describe, expect, it } from 'vitest';
import type { CommentAuthor, Document, Op } from '@quire/model';
import { SyncBridge } from './index';

const A: CommentAuthor = { id: 'ua', name: '가영', color: '#2563eb' };

function network(text: string) {
  const queues: Uint8Array[][] = [[], []];
  const peers: SyncBridge[] = [];
  for (let k = 0; k < 2; k++) {
    const opts = { peer: k + 1, batchMs: null, onUpdate: (u: Uint8Array) => queues.forEach((q, j) => j !== k && q.push(u)) };
    peers.push(k === 0 ? SyncBridge.create(text, opts) : SyncBridge.fromSnapshot(peers[0]!.snapshot(), opts));
  }
  const settle = () => {
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 2; k++) {
        peers[k]!.flush();
        while (queues[k]!.length) peers[k]!.receive(queues[k]!.shift()!);
      }
    for (const p of peers) p.flush();
  };
  return { peers, settle };
}

function view(d: Document) {
  const cps = Array.from(d.body.text());
  return d
    .annotationRanges()
    .filter((r) => r.type === 'suggestion' && !r.orphan)
    .map((r) => `${r.data.kind}:${cps.slice(r.from, r.to).join('')}`)
    .sort();
}

describe('suggestions over the bridge (14 §4)', () => {
  it("another peer sees the same suggestions on the same characters, and edits there stay direct (mode is per editor)", () => {
    const { peers, settle } = network('하나 둘 셋 넷');
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.document.setSuggesting({ author: A });
    const rec = (ops: Op[]) => a.document.recordSuggestions(null, a.doc, ops);
    rec([{ type: 'insert', ids: a.doc.insertText(2, '와') }]);
    rec(a.doc.deleteRange(4, 5)); // 둘의 '둘'
    rec(a.doc.format(6, 7, 'bold', true));
    settle();
    expect(a.doc.text()).toBe('하나와 둘 셋 넷\n');
    expect(b.doc.text()).toBe(a.doc.text());
    expect(view(b.document)).toEqual(view(a.document));
    expect(view(a.document)).toEqual(['delete:둘', 'format:셋', 'insert:와']);
    // B는 제안 모드가 아니다: B의 지우기는 실제로 지운다
    b.doc.deleteRange(8, 9);
    settle();
    expect(a.doc.text()).toBe('하나와 둘 셋 \n');
    expect(view(a.document)).toEqual(view(b.document));
  });
});
