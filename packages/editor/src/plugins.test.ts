/**
 * 플러그인 API (15 §7): 내장 찾기 플러그인과 예제 플러그인이 PluginContext만으로 돈다 (편집기 내부를 쓰지 않는다).
 * 시험은 문서 하나 위의 가짜 컨텍스트로 돌린다: 트랜잭션은 Document 연산을 받아 기록하고, 장식은 소스를 직접 부른다.
 */
import { Messages } from './i18n';
import { describe, expect, it } from 'vitest';
import { Doc, Document, type Op } from '@quiredoc/model';
import { findPlugin } from './find-plugin';
import { highlightWordsPlugin, wordCountPlugin, type WordCount } from './example-plugins';
import { normalizeKey, eventKey, type DecorationSource, type PluginContext, type PluginEvent, type QuirePlugin } from './plugins';

/** 가짜 편집기: 본문만, 선택·데이터·이벤트·명령 */
function host(text: string) {
  const document = new Document(Doc.fromText(text));
  let sel = { anchor: 0, head: 0 };
  const listeners = new Map<PluginEvent, Set<() => void>>();
  const data = new Map<string, unknown>();
  const commands = new Map<string, (...a: unknown[]) => boolean>();
  const sources: DecorationSource[] = [];
  const edits: Op[][] = [];
  let redraws = 0;
  let readOnly = false;
  const ctxFor = (p: QuirePlugin): PluginContext => ({
    name: p.name,
    t: new Messages().t,
    document: () => document,
    story: () => null,
    doc: () => document.body,
    selection: () => ({ ...sel, from: Math.min(sel.anchor, sel.head), to: Math.max(sel.anchor, sel.head), story: null }),
    select(a, h = a) {
      sel = { anchor: a, head: h };
    },
    reveal(story, from, to) {
      if (story !== null) return false;
      sel = { anchor: from, head: to };
      return true;
    },
    canEdit: () => !readOnly,
    sync: { setDocument() {}, documentChanged() {}, setRemoteCarets() {}, setAccess() {} },
    edit(fn) {
      if (readOnly) return false;
      const ops = fn(document.body);
      edits.push(ops);
      return ops.length > 0;
    },
    editDocument(fn, opts) {
      if (readOnly) return false;
      const ops = fn(document);
      edits.push(ops);
      if (opts?.select) sel = { anchor: opts.select[0], head: opts.select[1] };
      return ops.length > 0;
    },
    caretRect: () => null,
    rangeRects: () => [],
    hitTest: () => null,
    redraw: () => void redraws++,
    on(ev, fn) {
      let s = listeners.get(ev);
      if (!s) listeners.set(ev, (s = new Set()));
      s.add(fn);
      return () => s!.delete(fn);
    },
    run: (c, ...a) => commands.get(c)?.(...a) ?? false,
    getData: <T>() => (data.get(p.name) as { data: T } | undefined)?.data,
    setData: (v) => void data.set(p.name, { v: p.data?.schemaVersion ?? 1, data: v }),
  });
  const use = (p: QuirePlugin) => {
    const ctx = ctxFor(p);
    for (const [n, fn] of Object.entries(p.commands ?? {})) commands.set(`${p.name}.${n}`, (...a) => fn(ctx, ...a));
    if (p.decorations) sources.push(p.decorations(ctx));
    p.init?.(ctx);
    return ctx;
  };
  const emit = (ev: PluginEvent) => {
    for (const f of listeners.get(ev) ?? []) f();
  };
  /** 보이는 모든 문단의 장식 (그리기처럼: beforeRender → 문단마다) */
  const decorations = () => {
    emit('beforeRender');
    const out: Array<{ text: string; kind: string }> = [];
    for (const p of document.body.paragraphs())
      for (const s of sources)
        for (const d of s.decorationsIn(null, { id: p.id, start: p.start, text: p.text }) ?? [])
          out.push({ text: Array.from(document.body.text()).slice(d.from, d.to).join(''), kind: d.kind });
    emit('afterRender');
    return out;
  };
  return { document, use, emit, decorations, commands, data, edits, get sel() { return sel; }, set readOnly(v: boolean) { readOnly = v; }, get redraws() { return redraws; } };
}

describe('plugin API (15 §7)', () => {
  it('find plugin: find, decorate, next, replace, replace all (one transaction)', () => {
    const h = host('사과 배 사과\n바나나 사과');
    const find = findPlugin();
    h.use(find);
    const st = find.find({ text: '사과' });
    expect(st).toEqual({ count: 3, current: 0, truncated: false });
    expect(h.decorations()).toEqual([
      { text: '사과', kind: 'find-current' },
      { text: '사과', kind: 'find' },
      { text: '사과', kind: 'find' },
    ]);
    // 다음: 결과를 고른다
    find.next(1);
    expect(h.sel).toEqual({ anchor: 0, head: 2 });
    // 바꾸기: 고른 결과를 바꾸고 다음으로
    expect(find.replace('감')).toBe(true);
    expect(h.document.body.text()).toBe('감 배 사과\n바나나 사과\n');
    expect(h.sel).toEqual({ anchor: 4, head: 6 });
    // 모두 바꾸기: 트랜잭션 하나
    const before = h.edits.length;
    expect(find.replaceAll('귤')).toBe(2);
    expect(h.edits.length).toBe(before + 1);
    expect(h.document.body.text()).toBe('감 배 귤\n바나나 귤\n');
    // 읽기 전용이면 바꾸지 않는다 (권한이 플러그인에도)
    find.find({ text: '귤' });
    h.readOnly = true;
    expect(find.replaceAll('x')).toBe(0);
    expect(h.document.body.text()).toBe('감 배 귤\n바나나 귤\n');
    // 틀린 정규식
    expect(find.find({ text: '(', regex: true }).error).toBeTruthy();
    find.clear();
    expect(h.decorations()).toEqual([]);
  });

  it('highlight words: decorations, commands, document data and migration', () => {
    const h = host('보고서 초안과 최종 보고서');
    // 옛 판 데이터 (쉼표 글)를 옮긴다
    const p = highlightWordsPlugin();
    const migrated = p.data!.migrate!('초안, 최종', 1);
    expect(migrated).toEqual({ words: ['초안', '최종'] });
    h.data.set('highlightWords', { v: 2, data: migrated });
    h.use(p);
    expect(h.decorations().map((d) => d.text)).toEqual(['초안', '최종']);
    expect(h.commands.get('highlightWords.add')!('보고서')).toBe(true);
    expect(h.decorations().map((d) => d.text)).toEqual(['보고서', '초안', '최종', '보고서']);
    expect(h.data.get('highlightWords')).toEqual({ v: 2, data: { words: ['초안', '최종', '보고서'] } });
    expect(h.commands.get('highlightWords.remove')!('초안')).toBe(true);
    expect(h.commands.get('highlightWords.next')!()).toBe(true);
    expect(h.sel).toEqual({ anchor: 0, head: 3 });
    expect(h.commands.get('highlightWords.next')!()).toBe(true);
    expect(h.sel).toEqual({ anchor: 8, head: 10 });
  });

  it('word count: counts on init and on change (debounced), exporter', async () => {
    const h = host('하나 둘 셋\n\nfour five');
    const seen: WordCount[] = [];
    const wc = wordCountPlugin((c) => seen.push(c));
    const ctx = h.use(wc);
    expect(seen).toHaveLength(0); // 첫 알림은 미룬다
    await new Promise((r) => setTimeout(r, 0));
    expect(seen[0]).toEqual({ chars: 15, charsNoSpace: 12, words: 5, paragraphs: 2 });
    h.document.body.insertText(0, '영 ');
    h.emit('change');
    h.emit('change');
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toHaveLength(2);
    expect(seen[1]!.words).toBe(6);
    expect(await wc.exporters!.stats!.export(ctx)).toBe('글자 17 (공백 빼고 13)\n어절 6\n문단 2\n');
  });

  it('one plugin object on two editors (StrictMode double mount): disposing the first does not break the second', async () => {
    const seen: number[] = [];
    const wc = wordCountPlugin((c) => seen.push(c.chars));
    const hw = highlightWordsPlugin(['둘']);
    const a = host('하나 둘');
    const b = host('둘 셋 넷');
    // 앞 편집기에 붙고, 뒤 편집기에 붙은 다음, 앞 편집기를 늦게 정리한다
    const ca = a.use(wc);
    a.use(hw);
    b.use(wc);
    b.use(hw);
    void ca;
    const disposeA = wc.init!(a.use({ name: 'probe' }));
    if (typeof disposeA === 'function') disposeA();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toContain(5); // 뒤 편집기('둘 셋 넷')의 첫 알림
    expect(b.decorations().map((d) => d.text)).toEqual(['둘']);
    expect(a.decorations().map((d) => d.text)).toEqual(['둘']);
  });

  it('normalizes key specs and events', () => {
    expect(normalizeKey('Mod+F')).toBe('mod+f');
    expect(normalizeKey('Shift+Ctrl+F3')).toBe('mod+shift+f3');
    expect(normalizeKey('Cmd+Alt+K')).toBe('mod+alt+k');
    // 한글 자판: key는 'ㄹ'이어도 code KeyF
    expect(eventKey({ key: 'ㄹ', code: 'KeyF', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe('mod+f');
    expect(eventKey({ key: 'F3', code: 'F3', ctrlKey: false, metaKey: false, altKey: false, shiftKey: true })).toBe('shift+f3');
  });
});
