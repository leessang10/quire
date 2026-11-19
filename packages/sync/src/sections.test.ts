/**
 * 구역 동기화·저장 (12 §3.2): 구역 설정은 Loro 맵 sections의 '<구역 ID>|<키>' (키마다 LWW), 구역 나눔은 ¶의 문단 속성.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Doc, Document, LAST_SECTION, fullSection, hfStoryId, noteRefs, noteStoryId, type SectionProps } from '@quire/model';
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

describe('headers, footers and fields (12 §5)', () => {
  /** 꼬리말 "쪽 / 전체 쪽" (필드 개체 둘) */
  const footer = (d: Doc) => {
    d.insertObject(0, { kind: 'field', field: 'page' });
    d.insertText(1, ' / ');
    d.insertObject(4, { kind: 'field', field: 'pages' });
    d.setParaAttr(0, 'align', 'center');
  };
  const fields = (d: Doc) => [...(d.paragraphs()[0]!.objs ?? new Map()).entries()].map(([k, o]) => [k, o.kind, o.field]);

  it('sends header and footer stories with their fields and the section references', () => {
    const { a, b, settle } = bridges(['가', '나'].join(NL));
    const id = hfStoryId('footer', LAST_SECTION, 'default');
    footer(a.story(id));
    a.doc.setSection(LAST_SECTION, { ...fullSection(undefined), titlePage: true, footer: { default: id } });
    settle();
    expect(b.doc.sectionDef(LAST_SECTION)!.footer).toEqual({ default: id });
    expect(b.doc.sectionDef(LAST_SECTION)!.titlePage).toBe(true);
    expect(fields(b.story(id))).toEqual([[0, 'field', 'page'], [4, 'field', 'pages']]);
    expect(b.story(id).paraAttrs(0)).toEqual({ align: 'center' });
    // 두 사람이 같은 머리말(같은 ID)을 동시에 처음 만들어도 한 스토리로 합쳐진다
    const h = hfStoryId('header', LAST_SECTION, 'default');
    a.story(h).insertText(0, 'A');
    b.story(h).insertText(0, 'B');
    settle();
    expect(a.story(h).text()).toBe(b.story(h).text());
    expect(a.story(h).text().length).toBe(3);
  });

  it('round-trips header references and fields through the canonical JSON', () => {
    const d = new Document(Doc.fromText(['가', '나'].join(NL)));
    const id = hfStoryId('footer', LAST_SECTION, 'default');
    footer(d.story(id));
    d.body.setSection(LAST_SECTION, { ...fullSection(undefined), oddEven: true, footer: { default: id, even: id }, pageNumber: { start: 3, format: 'roman' } });
    const q = quireFromDocument(d);
    expect(q.stories[id]).toEqual([{ p: { align: 'center' }, c: [{ img: { kind: 'field', field: 'page' } }, { t: ' / ' }, { img: { kind: 'field', field: 'pages' } }] }]);
    const back = documentFromQuire(JSON.parse(canonicalJson(q))).document;
    expect(back.body.sectionDef(LAST_SECTION)).toEqual(d.body.sectionDef(LAST_SECTION));
    expect(fields(back.story(id))).toEqual(fields(d.story(id)));
    expect(canonicalJson(quireFromDocument(back))).toBe(canonicalJson(q));
  });
});

describe('columns (12 §7)', () => {
  it('sends column settings and column breaks, and round-trips them through the canonical JSON', () => {
    const { a, b, settle } = bridges(['가', '나', '다'].join(NL));
    const cols: SectionProps = { ...fullSection(undefined), start: 'continuous', columns: { count: 3, gap: 14173, separator: true } };
    a.doc.setSection(LAST_SECTION, cols);
    a.doc.setParaAttr(2, 'columnBreakBefore', true);
    settle();
    expect(b.doc.sectionDef(LAST_SECTION)).toEqual(cols);
    expect(b.doc.paraAttrs(2)).toEqual({ columnBreakBefore: true });
    const q = quireFromDoc(b.doc);
    expect(q.sections.at(-1)!.columns).toEqual({ count: 3, gap: 14173, separator: true });
    expect(canonicalJson(quireFromDoc(docFromQuire(JSON.parse(canonicalJson(q))).doc))).toBe(canonicalJson(q));
  });
});

describe('footnotes (12 §6)', () => {
  it('sends note references and note stories; numbers follow the reference order on both peers', () => {
    const { a, b, settle } = bridges(['첫 문단', '둘째 문단'].join(NL));
    a.doc.insertObject(2, { id: 'x1', kind: 'note' });
    a.story(noteStoryId('x1')).insertText(0, '첫 각주');
    settle();
    // 다른 피어가 앞에 각주를 넣으면 번호가 밀린다 (번호는 저장하지 않는다)
    b.doc.insertObject(0, { id: 'x0', kind: 'note' });
    b.story(noteStoryId('x0')).insertText(0, '앞 각주');
    settle();
    for (const d of [a, b]) {
      expect(noteRefs(d.doc).map((n) => n.id)).toEqual(['x0', 'x1']);
      expect(d.story(noteStoryId('x1')).text()).toBe(`첫 각주${NL}`);
    }
  });

  it('stores only notes whose reference is still in the body, and round-trips them', () => {
    const d = new Document(Doc.fromText(['가나다', '라마'].join(NL)));
    d.body.insertObject(1, { id: 'a', kind: 'note' });
    d.body.insertObject(5, { id: 'b', kind: 'note' });
    d.story(noteStoryId('a')).insertText(0, '각주 A');
    d.story(noteStoryId('b')).insertText(0, '각주 B');
    // 참조 b를 지운다: 스토리는 남지만 (되돌리면 돌아온다) 정본에는 쓰지 않는다
    d.body.deleteRange(5, 6);
    expect(d.story(noteStoryId('b')).text()).toBe(`각주 B${NL}`);
    const q = quireFromDocument(d);
    expect(Object.keys(q.stories).sort()).toEqual(['body', noteStoryId('a')]);
    expect(q.stories.body[0]).toEqual({ p: {}, c: [{ t: '가' }, { img: { id: 'a', kind: 'note' } }, { t: '나다' }] });
    const back = documentFromQuire(JSON.parse(canonicalJson(q))).document;
    expect(noteRefs(back.body).map((n) => n.id)).toEqual(['a']);
    expect(back.story(noteStoryId('a')).text()).toBe(`각주 A${NL}`);
    expect(canonicalJson(quireFromDocument(back))).toBe(canonicalJson(q));
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
