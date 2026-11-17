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

/** Loro 텍스트의 구획 표식 키 (저장 순서) */
function segKeysOf(b: SyncBridge): string[] {
  const keys: string[] = [];
  for (const op of b.loro.getText('body').toDelta()) {
    const k = op.attributes?.['seg'];
    if (typeof op.insert === 'string' && typeof k === 'string') keys.push(k);
  }
  return keys;
}

function consistent(b: SyncBridge) {
  // Doc의 살아 있는 원소 열 = Loro 텍스트
  expect(b.doc.rawText()).toBe(b.loro.getText('body').toString());
  expect(b.doc.paragraphs()).toEqual(b.doc.paragraphsFromScratch());
  expect(b.doc.segmentKeys()).toEqual(segKeysOf(b));
  b.doc.checkInvariants();
}

const sel = (doc: Doc) => ({ anchor: doc.positionAt(0), head: doc.positionAt(0) });
/** 문단들 → 화면 텍스트 (각 문단 뒤에 ¶) */
const t = (...ps: string[]) => ps.map((x) => x + String.fromCharCode(10)).join('');

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

  it('syncs paragraph moves, deletes and their undo', () => {
    const { peers, settle } = network(2, t('가', '나', '다', '라').slice(0, -1));
    const [a, b] = peers as [SyncBridge, SyncBridge];
    const h = new History(0);
    const s = sel(a.doc);
    h.record({ ops: a.doc.moveParagraphs(0, 0, 3), before: s, after: s, time: 0 });
    settle();
    expect(b.doc.text()).toBe(t('나', '다', '가', '라'));
    h.record({ ops: a.doc.hideParagraphs(3, 3), before: s, after: s, time: 1 });
    settle();
    expect(b.doc.text()).toBe(t('나', '다', '가'));
    // B가 그사이 옮긴 문단은 A의 실행 취소와 무관하게 제자리
    b.doc.moveParagraphs(1, 1, 0);
    settle();
    expect(a.doc.text()).toBe(t('다', '나', '가'));
    h.undo(a.doc);
    h.undo(a.doc);
    settle();
    expect(a.doc.text()).toBe(t('다', '가', '나', '라'));
    expect(b.doc.text()).toBe(a.doc.text());
    consistent(a);
    consistent(b);
  });

  it('shows a placeholder paragraph when everything is deleted, and typing into it converges', () => {
    const { peers, settle } = network(2, t('가', '나').slice(0, -1));
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.doc.hideParagraphs(0, 0);
    b.doc.hideParagraphs(1, 1);
    settle();
    expect(a.doc.text()).toBe(t(''));
    a.doc.insertText(0, 'X');
    b.doc.insertText(0, 'Y');
    settle();
    expect(a.doc.paragraphs().length).toBe(1);
    expect([t('XY'), t('YX')]).toContain(a.doc.text());
    expect(b.doc.text()).toBe(a.doc.text());
    consistent(a);
    consistent(b);
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

  for (const seed of [...Array.from({ length: 28 }, (_, k) => k + 1), 42, 2024]) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const { peers, deliver, settle } = network(3, randomText(r, 200));
      const histories = peers.map(() => new History(0));
      let moves = 0;
      const cursors: Uint8Array[] = [];
      for (let step = 0; step < 300; step++) {
        const k = Math.floor(r() * 3);
        const p = peers[k]!;
        const h = histories[k]!;
        const doc = p.doc;
        const len = doc.length;
        const roll = r();
        const s = sel(doc);
        const n = doc.paragraphs().length;
        if (roll < 0.3) {
          const ops: Op[] = [{ type: 'insert', ids: doc.insertText(Math.floor(r() * len), randomText(r, r() < 0.05 ? 300 : 5)) }];
          h.record({ ops, before: s, after: s, time: step });
        } else if (roll < 0.52) {
          const from = Math.floor(r() * len);
          const to = Math.min(len - 1, from + Math.floor(r() * 20));
          if (from < to) h.record({ ops: doc.deleteRange(from, to), before: s, after: s, time: step });
        } else if (roll < 0.64) {
          // 문단 이동 (여러 문단 함께)
          const i = Math.floor(r() * n);
          const j = Math.min(n - 1, i + Math.floor(r() * 2));
          h.record({ ops: doc.moveParagraphs(i, j, Math.floor(r() * (n + 1))), before: s, after: s, time: step });
          moves++;
        } else if (roll < 0.7) {
          const i = Math.floor(r() * n);
          h.record({ ops: doc.hideParagraphs(i, i), before: s, after: s, time: step });
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
        // 매 단계: 모든 피어의 Doc과 Loro는 일치하고, 문단 목록은 처음부터 계산한 것과 같다
        for (const q of peers) {
          expect(q.doc.rawText()).toBe(q.loro.getText('body').toString());
          expect(q.doc.segmentKeys()).toEqual(segKeysOf(q));
          expect(q.doc.paragraphs()).toEqual(q.doc.paragraphsFromScratch());
          // 공유 위치: 아무 캐럿 자리나 커서로 만들었다 풀면 제자리
          const o = Math.floor(r() * (q.doc.maxCaret + 1));
          expect(q.resolveCursor(q.cursorAt(o))).toBe(o);
        }
        // 이따금 공유 위치를 만들어 두고 끝에서 모든 피어가 같은 자리로 푸는지 본다
        if (step % 25 === 0) {
          const o = Math.floor(r() * (doc.maxCaret + 1));
          cursors.push(p.cursorAt(o));
        }
      }
      expect(moves).toBeGreaterThan(10);
      settle();
      const texts = peers.map((p) => p.doc.text());
      expect(texts[1]).toBe(texts[0]);
      expect(texts[2]).toBe(texts[0]);
      for (const p of peers) consistent(p);
      for (const c of cursors) {
        const at = peers.map((p) => p.resolveCursor(c));
        expect(at[0]).not.toBeNull();
        expect(at[1]).toBe(at[0]);
        expect(at[2]).toBe(at[0]);
      }
    });
  }
});
