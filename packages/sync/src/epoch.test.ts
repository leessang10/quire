/**
 * 새 판 압축·재기반 시험 (09 §9)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Doc } from '@quiredoc/model';
import type { LoroDoc } from 'loro-crdt';
import { displayText } from './history';
import { SyncClient } from './client';
import { SyncCore } from './core';
import { applyHunks, compactDoc, compactLoro, diffText, readEpoch, rebaseHunks, rebaseOnto, type Hunk } from './epoch';
import { formatState, stable } from './format-state.test-util';
import type { ToMain, ToWorker } from './protocol';
import { LoroWriter, docFromLoro, initLoro, newLoro, readRaw } from './shape';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

const ALPHA = ['a', 'b', 'c', '\n', '\n', '가', '😀'];
function randomText(r: () => number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHA[Math.floor(r() * ALPHA.length)];
  return s;
}

/** 코드포인트 단위로 문자열에 변경 적용 */
function apply(text: string, hunks: Hunk[]): string {
  const cps = Array.from(text);
  for (let k = hunks.length - 1; k >= 0; k--) {
    const h = hunks[k]!;
    cps.splice(h.at, h.del, ...Array.from(h.ins));
  }
  return cps.join('');
}

function mutate(r: () => number, text: string, edits: number): string {
  let cps = Array.from(text);
  for (let e = 0; e < edits; e++) {
    const at = Math.floor(r() * (cps.length + 1));
    if (r() < 0.5 && cps.length) cps.splice(at, Math.ceil(r() * 4));
    else cps.splice(at, 0, ...Array.from(randomText(r, 1 + Math.floor(r() * 4))));
    cps = cps.slice();
  }
  return cps.join('');
}

describe('diffText', () => {
  it('turns a into b (random, 2,000 seeds)', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const r = rng(seed);
      const a = randomText(r, Math.floor(r() * 60));
      const b = r() < 0.5 ? randomText(r, Math.floor(r() * 60)) : mutate(r, a, 1 + Math.floor(r() * 4));
      const hunks = diffText(a, b);
      expect(apply(a, hunks), `seed ${seed}`).toBe(b);
      for (let k = 1; k < hunks.length; k++) expect(hunks[k]!.at).toBeGreaterThanOrEqual(hunks[k - 1]!.at + hunks[k - 1]!.del);
    }
  });

  it('applies to a Doc, including changes at the end of the document (random, 1,000 seeds)', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const r = rng(seed);
      const a = `${randomText(r, Math.floor(r() * 30))}\n`;
      const b = r() < 0.3 ? `${randomText(r, Math.floor(r() * 30))}\n` : `${mutate(r, a.slice(0, -1), 1 + Math.floor(r() * 3))}\n`;
      const doc = Doc.fromText(a.slice(0, -1));
      applyHunks(doc, diffText(a, b));
      expect(doc.text(), `seed ${seed}`).toBe(b);
    }
  });

  it('finds a few scattered edits in a large document quickly', () => {
    const a = Array.from({ length: 50_000 }, (_, i) => `문단 ${i % 1000}\n`).join(''); // 같은 줄이 많다
    const lines = a.split('\n');
    lines[100] += '!';
    lines.splice(30_000, 1);
    lines.splice(45_000, 0, '새 문단');
    const b = lines.join('\n');
    const t = performance.now();
    const hunks = diffText(a, b);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(apply(a, hunks)).toBe(b);
    expect(hunks.length).toBe(3);
    expect(hunks.reduce((n, h) => n + h.del + h.ins.length, 0)).toBeLessThan(30);
  });

  it('keeps unchanged paragraphs out of the hunks', () => {
    const a = '하나\n둘\n셋\n넷\n';
    expect(diffText(a, '하나\n둘!\n셋\n넷\n')).toEqual([{ at: 4, del: 0, ins: '!' }]);
    expect(diffText(a, '하나\n셋\n넷\n둘\n')).toEqual([
      { at: 3, del: 2, ins: '' },
      { at: 9, del: 0, ins: '둘\n' },
    ]);
  });
});

describe('rebaseHunks', () => {
  it('applies both sides when they touch different places (random)', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const r = rng(seed);
      // 문단 세 개: 우리는 첫 문단, 그들은 셋째 문단만 고친다
      const p = [randomText(r, 5).replace(/\n/g, ''), randomText(r, 5).replace(/\n/g, ''), randomText(r, 5).replace(/\n/g, '')];
      const base = `${p[0]}\n${p[1]}\n${p[2]}\n`;
      const ours = `${mutate(r, p[0]!, 2).replace(/\n/g, '')}\n${p[1]}\n${p[2]}\n`;
      const theirs = `${p[0]}\n${p[1]}\n${mutate(r, p[2]!, 2).replace(/\n/g, '')}\n`;
      const merged = apply(theirs, rebaseHunks(diffText(base, ours), diffText(base, theirs)));
      expect(merged, `seed ${seed}`).toBe(`${ours.split('\n')[0]}\n${p[1]}\n${theirs.split('\n')[2]}\n`);
    }
  });

  it('puts their insertion first at the same place, and does not delete what they wrote', () => {
    expect(apply('aYb', rebaseHunks([{ at: 1, del: 0, ins: 'X' }], [{ at: 1, del: 0, ins: 'Y' }]))).toBe('aYXb');
    // 우리가 지운 범위 안을 그들이 바꿨다: 그들의 글은 남는다
    expect(apply('a-Z-b', rebaseHunks([{ at: 1, del: 4, ins: '' }], [{ at: 2, del: 2, ins: 'Z' }]))).toBe('aZb');
    expect(apply('a--Z-b', rebaseHunks([{ at: 1, del: 3, ins: 'X' }], [{ at: 3, del: 0, ins: 'Z' }]))).toBe('aXZb');
  });
});

/** Loro 문서에 붙인 편집용 Doc */
function editable(loro: LoroDoc): Doc {
  const doc = docFromLoro(loro);
  const w = new LoroWriter(loro, () => doc.segmentOrder());
  doc.observe((c) => w.apply(c));
  return doc;
}

describe('compaction and rebase', () => {
  it('compacts a document with moves and hidden paragraphs to two segments', () => {
    const loro = newLoro(1);
    initLoro(loro, '하나\n둘\n셋\n넷', 1);
    const doc = editable(loro);
    for (let k = 0; k < 20; k++) doc.moveParagraphs(k % 3, k % 3, 4);
    doc.hideParagraphs(2, 2);
    loro.commit();
    expect(readRaw(loro).keys.length).toBeGreaterThan(2);
    const fresh = compactLoro(displayText(loro), 'e1', 99);
    expect(displayText(fresh)).toBe(displayText(loro));
    expect(readRaw(fresh).keys.length).toBe(2);
    expect(readEpoch(fresh)).toBe('e1');
    expect(fresh.export({ mode: 'snapshot' }).length).toBeLessThan(loro.export({ mode: 'snapshot' }).length);
  });

  it('moves offline edits to the new epoch, with the edits others made in the old one', () => {
    const a = newLoro(1);
    initLoro(a, '하나\n둘\n셋', 1);
    const docA = editable(a);
    docA.moveParagraphs(0, 0, 3);
    a.commit();
    // 서버(옛 판) = 지금 A. B는 서버에서 받아 편집한다
    const server = newLoro(50);
    server.import(a.export({ mode: 'snapshot' }));
    const b = newLoro(2);
    b.import(server.export({ mode: 'snapshot' }));
    const docB = editable(b);
    docB.insertText(docB.maxCaret, 'B');
    b.commit();
    server.import(b.export({ mode: 'update', from: server.oplogVersion() }));
    // A는 그동안 오프라인으로 편집
    docA.insertText(0, 'A');
    docA.hideParagraphs(1, 1);
    a.commit();
    // 서버가 압축
    const fresh = compactLoro(displayText(server), 'e1', 99);
    expect(displayText(server)).toBe('둘\n셋\n하나B\n');
    const { loro, lost } = rebaseOnto(
      a,
      {
        epoch: 'e1',
        oldVV: server.oplogVersion().encode(),
        update: server.export({ mode: 'update', from: a.oplogVersion() }),
        base: fresh.export({ mode: 'snapshot' }),
      },
      1,
    );
    expect(lost).toBe(false);
    expect(readEpoch(loro)).toBe('e1');
    expect(displayText(loro)).toBe('A둘\n하나B\n');
    // 새 판에서 다른 피어와 합쳐진다
    const c = newLoro(3);
    c.import(fresh.export({ mode: 'snapshot' }));
    const docC = editable(c);
    docC.insertText(0, 'C');
    c.commit();
    c.import(loro.export({ mode: 'update', from: c.oplogVersion() }));
    loro.import(c.export({ mode: 'update' }));
    expect(displayText(c)).toBe(displayText(loro));
    expect(displayText(c)).toMatch(/^(CA|AC)둘\n하나B\n$/);
  });

  it('keeps formats, paragraph attributes, styles and lists through compaction and rebases offline formatting (2-6)', () => {
    const a = newLoro(1);
    initLoro(a, ['제목', '본문 가나다라', '항목 하나', '항목 둘'].join(String.fromCharCode(10)), 1);
    const docA = editable(a);
    docA.setParaAttr(0, 'style', 'h1');
    docA.format(3, 5, 'bold', true);
    const [list] = docA.createList('number');
    docA.setParaAttr(2, 'list', { id: list, level: 0 });
    docA.setParaAttr(3, 'list', { id: list, level: 0 });
    a.commit();
    const server = newLoro(50);
    server.import(a.export({ mode: 'snapshot' }));
    // B는 옛 판에서 서식을 바꾼다
    const b = newLoro(2);
    b.import(server.export({ mode: 'snapshot' }));
    const docB = editable(b);
    docB.format(5, 8, 'italic', true);
    docB.setParaAttr(1, 'align', 'center');
    b.commit();
    server.import(b.export({ mode: 'update', from: server.oplogVersion() }));
    // A는 오프라인: 글자·서식·문단 속성·스타일·목록 정의
    docA.insertText(0, '새 ');
    docA.format(0, 2, 'color', '#c01c28');
    docA.setParaAttr(3, 'list', { id: list, level: 1 });
    docA.setStyle('h1', { ...docA.style('h1')!, marks: { bold: true, size: 30000 } });
    docA.setList(list, { ...docA.listDef(list)!, levels: docA.listDef(list)!.levels.map((l) => ({ ...l, start: 3 })) });
    a.commit();
    // 서버 압축: 서식이 새 판으로 옮겨진다
    const fresh = compactDoc(docFromLoro(server), 'e1', 99);
    expect(stable(formatState(docFromLoro(fresh)))).toBe(stable(formatState(docFromLoro(server))));
    expect(docFromLoro(fresh).marksAt(6)).toEqual({ italic: true });
    const { loro, lost } = rebaseOnto(
      a,
      { epoch: 'e1', oldVV: server.oplogVersion().encode(), update: server.export({ mode: 'update', from: a.oplogVersion() }), base: fresh.export({ mode: 'snapshot' }) },
      1,
    );
    expect(lost).toBe(false);
    // 새 판 = 옛 판에서 A가 B의 변경까지 받은 상태 (서식 포함)
    const want = docFromLoro(a);
    const got = docFromLoro(loro);
    expect(got.text()).toBe(want.text());
    expect(stable(formatState(got))).toBe(stable(formatState(want)));
    expect(got.marksAt(0)).toEqual({ color: '#c01c28' });
    expect(got.paraAttrs(1)).toEqual({ align: 'center' });
    expect(got.style('h1')!.marks!.size).toBe(30000);
    expect(got.paragraphs().map((p) => got.listLabel(p)?.text ?? null)).toEqual([null, null, '3.', '다.']); // 모든 수준이 3부터
  });

  it('reports lost edits when the server does not know the old epoch', () => {
    const a = newLoro(1);
    initLoro(a, '내 문서', 1);
    const fresh = compactLoro('다른 문서\n', 'e9', 99);
    const { loro, lost } = rebaseOnto(a, { epoch: 'e9', oldVV: new Uint8Array(), update: new Uint8Array(), base: fresh.export({ mode: 'snapshot' }) }, 1);
    expect(lost).toBe(true);
    expect(displayText(loro)).toBe('다른 문서\n');
  });
});

describe('main thread hold and reset', () => {
  const cores: SyncCore[] = [];
  afterEach(() => {
    for (const c of cores.splice(0)) c.close();
  });

  it('sends pending edits before held, and replays edits made after held onto the new document', () => {
    const toMain: ToMain[] = [];
    const toWorker: ToWorker[] = [];
    const opts = { user: { name: 'A', color: '#000' }, batchMs: null, post: (m: ToMain) => toMain.push(m), net: { sendDoc() {}, sendPresence() {} } };
    const core = SyncCore.create('가나다', 1, opts);
    cores.push(core);
    const resets: boolean[] = [];
    const client = new SyncClient(toMain.shift() as Extract<ToMain, { t: 'init' }>, { post: (m) => toWorker.push(m), onReset: (lost) => resets.push(lost) });
    const drainWorker = () => {
      while (toWorker.length) {
        const m = toWorker.shift()!;
        if (m.t !== 'held') core.handle(m);
        else toMain.push({ t: 'status', online: false, detail: 'held' });
      }
    };
    const drainMain = () => {
      while (toMain.length) client.handle(toMain.shift()!);
    };

    client.doc.insertText(3, '라'); // 보냄 (답 기다림)
    client.handle({ t: 'hold' });
    client.doc.insertText(0, '0'); // 대기열: held 전에 보내야 한다
    expect(toWorker.map((m) => m.t)).toEqual(['ops']);
    drainWorker();
    drainMain(); // ack → 대기열을 보냄
    expect(toWorker.map((m) => m.t)).toEqual(['ops']);
    drainWorker();
    drainMain(); // ack → held
    expect(toWorker.map((m) => m.t)).toEqual(['held']);
    toWorker.length = 0;
    expect(displayText(core.loro)).toBe('0가나다라\n');
    // held 뒤 편집은 보내지 않는다
    client.doc.insertText(client.doc.maxCaret, '!');
    expect(toWorker).toEqual([]);
    // Worker: 새 판 (다른 피어가 옛 판에서 앞에 글을 넣은 상태라고 하자)
    const fresh = compactLoro('앞\n0가나다라\n', 'e1', 99);
    const next = new SyncCore(fresh, { ...opts, reset: { lost: false } });
    cores.push(next);
    drainMain();
    expect(resets).toEqual([false]);
    expect(client.doc.text()).toBe('앞\n0가나다라!\n');
    // 다시 적용한 편집은 새 코어로 간다
    expect(toWorker.map((m) => m.t)).toEqual(['ops']);
    while (toWorker.length) next.handle(toWorker.shift()!);
    expect(displayText(next.loro)).toBe('앞\n0가나다라!\n');
    drainMain();
    expect(client.pending).toBe(false);
  });
});

