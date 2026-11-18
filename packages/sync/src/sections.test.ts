/**
 * 구역 동기화·저장 (12 §3.2): 구역 설정은 Loro 맵 sections의 '<구역 ID>|<키>' (키마다 LWW), 구역 나눔은 ¶의 문단 속성.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LAST_SECTION, fullSection, type SectionProps } from '@quire/model';
import { SyncBridge } from './index';
import { SyncClient } from './client';
import { SyncCore } from './core';
import type { ToMain, ToWorker } from './protocol';
import { canonicalJson, docFromQuire, documentFromQuire, quireFromDoc, quireFromDocument } from './canonical';
import { docFromLoro } from './shape';
import { formatState, stable } from './format-state.test-util';

const NL = String.fromCharCode(10);
const LANDSCAPE: SectionProps = { page: { width: 841890, height: 595276, margin: [36000, 36000, 36000, 36000] }, start: 'nextPage' };

function bridges(text: string) {
  const queues: Uint8Array[][] = [[], []];
  const mk = (k: number, make: (o: Parameters<typeof SyncBridge.create>[1]) => SyncBridge) =>
    make({ peer: k + 1, batchMs: null, onUpdate: (u) => queues[1 - k]!.push(u) });
  const a = mk(0, (o) => SyncBridge.create(text, o));
  const b = mk(1, (o) => SyncBridge.fromSnapshot(a.snapshot(), o));
  const settle = () => {
    for (let round = 0; round < 3; round++) {
      a.flush();
      b.flush();
      while (queues[1]!.length) b.receive(queues[1]!.shift()!);
      while (queues[0]!.length) a.receive(queues[0]!.shift()!);
    }
  };
  return { a, b, settle };
}

describe('section sync (bridge)', () => {
  it('sends section breaks and settings, and rebuilds them from Loro', () => {
    const { a, b, settle } = bridges(['표지', '가로 쪽', '본문'].join(NL));
    a.doc.setSection('s1', fullSection(undefined));
    a.doc.setParaAttr(0, 'section', 's1');
    a.doc.setSection(LAST_SECTION, LANDSCAPE);
    settle();
    expect(b.doc.sectionBreaks()).toEqual([0]);
    expect(b.doc.sectionOf(1).id).toBe(LAST_SECTION);
    expect(b.doc.sectionDef(LAST_SECTION)).toEqual(LANDSCAPE);
    expect(stable(formatState(docFromLoro(b.loro)))).toEqual(stable(formatState(a.doc)));
  });

  it('keeps both sides when two peers change different keys of the same section at once (LWW per key)', () => {
    const { a, b, settle } = bridges(['가', '나'].join(NL));
    a.doc.setSection(LAST_SECTION, fullSection(undefined));
    settle();
    a.doc.setSection(LAST_SECTION, { ...fullSection(undefined), page: LANDSCAPE.page });
    b.doc.setSection(LAST_SECTION, { ...fullSection(undefined), start: 'oddPage' });
    settle();
    const want = { ...fullSection(undefined), page: LANDSCAPE.page, start: 'oddPage' };
    expect(a.doc.sectionDef(LAST_SECTION)).toEqual(want);
    expect(b.doc.sectionDef(LAST_SECTION)).toEqual(want);
  });

  it('keeps a setting that a peer changed while the other removed the break, and uses it again on undo', () => {
    const { a, b, settle } = bridges(['가', '나', '다'].join(NL));
    a.doc.setSection('s1', fullSection(undefined));
    a.doc.setParaAttr(0, 'section', 's1');
    settle();
    const ops = a.doc.setParaAttr(0, 'section', undefined);
    b.doc.setSection('s1', LANDSCAPE);
    settle();
    expect(a.doc.sectionBreaks()).toEqual([]);
    expect(a.doc.sectionDef('s1')).toEqual(LANDSCAPE); // 남지만 쓰이지 않는다
    // 되돌리기 (구역 나눔 속성을 다시 건다)
    for (const op of ops) if (op.type === 'para') a.doc.apply({ ...op, before: op.after, after: op.before });
    settle();
    expect(b.doc.sectionOf(0).id).toBe('s1');
    expect(b.doc.sectionDef('s1')).toEqual(LANDSCAPE);
  });
});

describe('section sync through the worker', () => {
  const cores: SyncCore[] = [];
  afterEach(() => {
    for (const c of cores.splice(0)) c.close();
  });

  it('applies a remote section setting on the main thread, and defers it while a local one is in flight', () => {
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
      const core: SyncCore = k === 0 ? SyncCore.create(['가', '나'].join(NL), 1, opts) : SyncCore.fromSnapshot(snap!, 2, opts);
      if (k === 0) snap = core.loro.export({ mode: 'snapshot' });
      cores.push(core);
      const init = toMain.shift() as Extract<ToMain, { t: 'init' }>;
      const toWorker: ToWorker[] = [];
      peers.push({ core, client: new SyncClient(init, { post: (m) => toWorker.push(m) }), toWorker, toMain, netIn: [] });
    }
    const settle = () => {
      for (let round = 0; round < 20; round++) {
        for (const p of peers) {
          while (p.toWorker.length) p.core.handle(p.toWorker.shift()!);
          p.core.flush();
        }
        for (const p of peers) {
          while (p.netIn.length) p.core.receiveDoc(p.netIn.shift()!);
          p.core.flush();
          while (p.toMain.length) p.client.handle(p.toMain.shift()!);
        }
      }
    };
    const [a, b] = peers as [(typeof peers)[0], (typeof peers)[0]];
    a.client.doc.setSection('s1', fullSection(undefined));
    a.client.doc.setParaAttr(0, 'section', 's1');
    a.client.doc.setSection(LAST_SECTION, LANDSCAPE);
    settle();
    expect(b.client.doc.sectionBreaks()).toEqual([0]);
    expect(b.client.doc.sectionDef(LAST_SECTION)).toEqual(LANDSCAPE);
    // 둘이 같은 구역의 다른 키를 동시에: 둘 다 남는다
    a.client.doc.setSection('s1', { ...fullSection(undefined), start: 'evenPage' });
    b.client.doc.setSection('s1', { ...fullSection(undefined), page: LANDSCAPE.page });
    settle();
    const want = { ...fullSection(undefined), page: LANDSCAPE.page, start: 'evenPage' };
    expect(a.client.doc.sectionDef('s1')).toEqual(want);
    expect(b.client.doc.sectionDef('s1')).toEqual(want);
    expect(stable(formatState(docFromLoro(a.core.loro)))).toEqual(stable(formatState(a.client.doc)));
  });
});

describe('sections in the canonical JSON', () => {
  it('writes sections in document order with the last one as the default section, and reads them back', () => {
    const { doc } = docFromQuire({
      format: 'quire', version: 1, settings: {}, styles: {}, annotations: [],
      sections: [
        { id: 'cover', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, start: 'nextPage' },
        { id: 'wide', ...LANDSCAPE },
        { id: 'whatever', page: { width: 595276, height: 841890, margin: [85039, 85039, 85039, 85039] }, start: 'oddPage' },
      ],
      stories: { body: [{ p: { section: 'cover' }, c: [{ t: '표지' }] }, { p: { section: 'wide' }, c: [{ t: '가로' }] }, { p: {}, c: [{ t: '본문' }] }] },
    });
    expect(doc.sectionBreaks()).toEqual([0, 1]);
    expect(doc.sectionDef('wide')).toEqual(LANDSCAPE);
    expect(doc.sectionDef(LAST_SECTION)!.start).toBe('oddPage');
    const q = quireFromDoc(doc);
    expect(q.sections.map((s) => s.id)).toEqual(['cover', 'wide', LAST_SECTION]);
    // 다시 읽고 다시 쓰면 같은 바이트열
    expect(canonicalJson(quireFromDoc(docFromQuire(q).doc))).toBe(canonicalJson(q));
    // 여러 스토리 문서 경로도 같다
    expect(canonicalJson(quireFromDocument(documentFromQuire(q).document))).toBe(canonicalJson(q));
  });

  it('keeps the old single default section (same bytes as before) for documents without sections', () => {
    const { doc } = docFromQuire({
      format: 'quire', version: 1, settings: {}, styles: {}, annotations: [],
      sections: [{ id: 's1', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, columns: 1 }],
      stories: { body: [{ p: { align: 'center' }, c: [{ t: '가' }] }] },
    });
    expect(doc.sectionDefs()).toEqual([]);
    expect(quireFromDoc(doc).sections).toEqual([{ id: 's1', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, columns: 1 }]);
  });
});
