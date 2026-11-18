/**
 * 서식 동기화 (10 §3, 2-6): 같은 스레드 브리지에서 글자 서식·문단 속성·스타일·목록 정의가 Loro로 오가고 수렴하는가.
 * 매 단계: 각 피어의 Doc = 그 피어의 Loro에서 처음부터 만든 Doc (서식 포함). 끝: 모든 피어가 같다.
 */
import { describe, expect, it } from 'vitest';
import { History, MARK_KEYS, defaultListDef, type Doc, type MarkKey, type Op } from '@quire/model';
import { SyncBridge } from './index';
import { docFromLoro } from './shape';
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

const sel = (doc: Doc) => ({ anchor: doc.positionAt(0), head: doc.positionAt(0) });
const NL = String.fromCharCode(10);

describe('format sync (bridge)', () => {
  it('sends marks, paragraph attributes, styles and lists to another peer', () => {
    const { peers, settle } = network(2, `제목${NL}본문 굵게 글자${NL}항목`);
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.doc.format(6, 8, 'bold', true);
    a.doc.format(6, 8, 'color', '#c01c28');
    a.doc.setParaAttr(0, 'style', 'h1');
    a.doc.setParaAttr(1, 'align', 'justify');
    a.doc.setStyle('h1', { ...a.doc.style('h1')!, marks: { bold: true, size: 30000 } });
    const [id] = a.doc.createList('number');
    a.doc.setParaAttr(2, 'list', { id, level: 0 });
    settle();
    expect(b.doc.marksAt(6)).toEqual({ bold: true, color: '#c01c28' });
    expect(b.doc.paraAttrs(0)).toEqual({ style: 'h1' });
    expect(b.doc.paraAttrs(1)).toEqual({ align: 'justify' });
    expect(b.doc.style('h1')!.marks).toEqual({ bold: true, size: 30000 });
    expect(b.doc.listLabel(b.doc.paragraphs()[2]!)!.text).toBe('1.');
    expect(formatState(b.doc)).toEqual(formatState(a.doc));
    // 새로 참여하는 피어(스냅샷)도 서식을 받는다
    const c = SyncBridge.fromSnapshot(a.snapshot(), { peer: 9, batchMs: null });
    expect(formatState(c.doc)).toEqual(formatState(a.doc));
  });

  it('inherits marks when typing at the end of a bold run on both sides, and not for links', () => {
    const { peers, settle } = network(2, `가나다${NL}`);
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.doc.format(0, 3, 'bold', true);
    a.doc.format(0, 3, 'link', 'https://x');
    a.doc.insertText(3, '라');
    settle();
    expect(a.doc.marksAt(3)).toEqual({ bold: true });
    expect(b.doc.marksAt(3)).toEqual({ bold: true });
    // 보류 서식(Doc이 명시한 서식)으로 넣은 글자도 Loro와 같다
    b.doc.insertText(0, '앞', { italic: true });
    settle();
    expect(a.doc.marksAt(0)).toEqual({ italic: true });
    expect(formatState(a.doc)).toEqual(formatState(b.doc));
  });

  it('reads paragraph attributes only from the ¶ even when a concurrent insert lands next to it', () => {
    const { peers, settle } = network(2, `가나${NL}다라`);
    const [a, b] = peers as [SyncBridge, SyncBridge];
    a.doc.setParaAttr(0, 'align', 'center');
    b.doc.insertText(2, 'X'); // ¶ 바로 앞
    b.doc.insertText(4, 'Y'); // ¶ 바로 뒤 (다음 문단 첫머리)
    settle();
    for (const p of [a, b]) {
      expect(p.doc.paraAttrs(0)).toEqual({ align: 'center' });
      expect(p.doc.paraAttrs(1)).toEqual({});
    }
    expect(formatState(a.doc)).toEqual(formatState(b.doc));
  });

  const ALPHA = Array.from('가나다 ab\n😀');
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }
  const VALUES: Record<string, unknown[]> = {
    bold: [true, undefined], italic: [true, undefined], underline: [true, undefined], strike: [true, undefined],
    size: [9000, 18000, undefined], color: ['#c01c28', '#1a5fb4', undefined], highlight: ['#fff3a3', undefined],
    link: ['https://a', undefined], script: ['sup', 'sub', undefined], font: [undefined],
  };
  const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

  for (const seed of Array.from({ length: 16 }, (_, k) => k + 1)) {
    it(`randomized convergence with formats, seed ${seed}`, () => {
      const r = rng(seed * 101);
      const { peers, deliver, settle } = network(3, Array.from({ length: 8 }, (_, i) => `문단 ${i} 가나다 abc`).join(NL));
      const histories = peers.map(() => new History(0));
      for (let step = 0; step < 300; step++) {
        const k = Math.floor(r() * 3);
        const p = peers[k]!;
        const h = histories[k]!;
        const doc = p.doc;
        const len = doc.length;
        const n = doc.paragraphs().length;
        const s = sel(doc);
        const roll = r();
        const rec = (ops: Op[]) => ops.length && h.record({ ops, before: s, after: s, time: step });
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
        if (roll < 0.18) rec([{ type: 'insert', ids: doc.insertText(Math.floor(r() * len), pick(r, ALPHA) + pick(r, ALPHA)) }]);
        else if (roll < 0.28) {
          const from = Math.floor(r() * len);
          const to = Math.min(len - 1, from + 1 + Math.floor(r() * 6));
          if (from < to) rec(doc.deleteRange(from, to));
        } else if (roll < 0.46) {
          const from = Math.floor(r() * len);
          const to = Math.min(len, from + 1 + Math.floor(r() * 12));
          const key = pick(r, MARK_KEYS) as MarkKey;
          rec(doc.format(from, to, key, pick(r, VALUES[key]!)));
        } else if (roll < 0.54) {
          const i = Math.floor(r() * n);
          const key = pick(r, ['align', 'indent', 'style', 'line'] as const);
          const v =
            key === 'align' ? pick(r, ['center', 'justify', undefined])
            : key === 'indent' ? pick(r, [{ left: 24000 }, { first: 12000 }, undefined])
            : key === 'style' ? pick(r, ['h1', 'quote', undefined])
            : pick(r, [{ rule: 'multiple', value: 1.5 }, undefined]);
          rec(doc.setParaAttr(i, key, v));
        } else if (roll < 0.58) {
          const i = Math.floor(r() * n);
          const lists = doc.lists();
          if (lists.length === 0 || r() < 0.2) {
            const [id, ops] = doc.createList(r() < 0.5 ? 'number' : 'bullet');
            rec([...ops, ...doc.setParaAttr(i, 'list', { id, level: 0 })]);
          } else rec(doc.setParaAttr(i, 'list', r() < 0.2 ? undefined : { id: pick(r, lists).id, level: Math.floor(r() * 3) }));
        } else if (roll < 0.6) {
          const name = pick(r, ['h1', 'quote', 'note']);
          const cur = doc.style(name);
          rec(doc.setStyle(name, r() < 0.15 ? undefined : { ...(cur ?? { name }), name, marks: { ...cur?.marks, size: pick(r, [20000, 26000]) } }));
        } else if (roll < 0.62 && doc.lists().length) {
          const l = pick(r, doc.lists());
          rec(doc.setList(l.id, { ...defaultListDef(l.id, l.kind), levels: defaultListDef(l.id, l.kind).levels.map((x) => ({ ...x, start: pick(r, [1, 5]) })) }));
        } else if (roll < 0.67) {
          const i = Math.floor(r() * n);
          rec(doc.moveParagraphs(i, i, Math.floor(r() * (n + 1))));
        } else if (roll < 0.69) {
          const i = Math.floor(r() * n);
          rec(doc.hideParagraphs(i, i));
        } else if (roll < 0.77) h.undo(doc);
        else if (roll < 0.81) h.redo(doc);
        else if (roll < 0.9) p.flush();
        else {
          const from = Math.floor(r() * 3);
          const to = (from + 1 + Math.floor(r() * 2)) % 3;
          deliver(from, to, 1 + Math.floor(r() * 3));
          peers[to]!.flush();
        }
        // 매 단계: Doc = 그 피어의 Loro (서식 포함)
        for (const q of peers) {
          expect(q.doc.rawText()).toBe(q.loro.getText('body').toString());
          const fa = formatState(q.doc);
          const fb = formatState(docFromLoro(q.loro));
          if (stable(fa) !== stable(fb)) {
            const diff = (Object.keys(fa) as Array<keyof typeof fa>).flatMap((key): unknown[] => (stable(fa[key]) === stable(fb[key]) ? [] : key === "paras" ? fa.paras.flatMap((x, i) => (stable(x) === stable(fb.paras[i]) ? [] : [{ i, doc: x, loro: fb.paras[i] }])) : [{ key, doc: fa[key], loro: fb[key] }]));
            throw new Error(`seed ${seed} step ${step} peer ${peers.indexOf(q)} roll ${roll.toFixed(3)}: ${JSON.stringify(diff).slice(0, 1500)}`);
          }
        }
      }
      settle();
      const f0 = formatState(peers[0]!.doc);
      expect(formatState(peers[1]!.doc)).toEqual(f0);
      expect(formatState(peers[2]!.doc)).toEqual(f0);
    });
  }
});

