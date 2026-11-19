import { describe, expect, it, vi } from 'vitest';
import { HttpChecker, SpellSession, WordListChecker, carryIssues, wordsOf, type SpellChecker, type SpellIssue } from './spell';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('word list checker (15 §4.1)', () => {
  const c = new WordListChecker(['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'Paris', "don't"]);
  const ac = new AbortController();

  it('words: code point offsets, apostrophes, no words glued to digits', () => {
    expect(wordsOf("😀 don't A4 3D x")).toEqual([
      [2, 7, "don't"],
      [14, 15, 'x'],
    ]);
  });

  it('flags unknown words; case rules', async () => {
    const r = await c.check('The quikc brown fox jumsp over THE lazy dgo paris Paris', 'en', ac.signal);
    expect(r.map((i) => i.from)).toEqual([4, 20, 40, 44]);
    expect(r.map((i) => i.suggestions[0])).toEqual(['quick', 'jumps', 'dog', 'Paris']);
  });

  it('suggestions: delete, insert, replace, transpose; keeps capitals', () => {
    expect(c.suggest('foxx')).toEqual(['fox']);
    expect(c.suggest('brwn')).toEqual(['brown']);
    expect(c.suggest('lazi')).toEqual(['lazy']);
    expect(c.suggest('Teh')).toEqual(['The']);
    expect(c.suggest('OVRE')).toEqual(['OVER']);
  });

  it('addWord', async () => {
    const d = new WordListChecker(['a']);
    expect((await d.check('quire', 'en', ac.signal)).length).toBe(1);
    d.addWord('quire');
    expect((await d.check('quire', 'en', ac.signal)).length).toBe(0);
  });
});

/** 직접 끝내는 검사기 (일정 시험용) */
function manual() {
  const calls: Array<{ text: string; signal: AbortSignal; resolve: (r: SpellIssue[]) => void }> = [];
  const checker: SpellChecker = {
    check: (text, _lang, signal) => new Promise((resolve) => calls.push({ text, signal, resolve })),
  };
  return { checker, calls };
}

describe('spell session (15 §4.2)', () => {
  it('checks wanted paragraphs once, caches by text, limits concurrency', async () => {
    const { checker, calls } = manual();
    const onResult = vi.fn();
    const s = new SpellSession(checker, { concurrency: 2, onResult });
    s.want(['a', 'b', 'c', 'a', '', '123']);
    expect(calls.map((c) => c.text)).toEqual(['a', 'b']); // 빈 문단·글자 없는 문단은 검사하지 않는다
    calls[0]!.resolve([{ from: 0, to: 1, kind: 'spelling', suggestions: [] }]);
    await tick();
    expect(calls.map((c) => c.text)).toEqual(['a', 'b', 'c']);
    expect(s.issuesFor('a')).toHaveLength(1);
    expect(onResult).toHaveBeenCalledTimes(1);
    s.want(['a', 'b', 'c']);
    expect(calls.length).toBe(3); // 캐시·진행 중
  });

  it('aborts checks no longer wanted; idle checks survive', async () => {
    const { checker, calls } = manual();
    const s = new SpellSession(checker, { concurrency: 4 });
    s.want(['one', 'two']);
    s.wantLater(['bg']);
    expect(calls.map((c) => c.text)).toEqual(['one', 'two', 'bg']);
    s.want(['two', 'three']);
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(false);
    expect(calls[2]!.signal.aborted).toBe(false);
    expect(calls[3]!.text).toBe('three');
    // 그만둔 검사의 늦은 결과는 버린다
    calls[0]!.resolve([]);
    await tick();
    expect(s.has('one')).toBe(false);
    expect(s.stats.aborted).toBe(1);
  });

  it('ignore and add word filter results', async () => {
    const add = vi.fn();
    const checker: SpellChecker = {
      check: async (t) => wordsOf(t).map(([from, to]) => ({ from, to, kind: 'spelling' as const, suggestions: [] })),
      addWord: add,
    };
    const s = new SpellSession(checker);
    s.want(['foo bar foo']);
    await tick();
    expect(s.issuesFor('foo bar foo')).toHaveLength(3);
    const v = s.version;
    s.ignore('foo');
    expect(s.issuesFor('foo bar foo')).toHaveLength(1);
    s.addWord('bar');
    expect(add).toHaveBeenCalledWith('bar');
    expect(s.issuesFor('foo bar foo')).toHaveLength(0);
    expect(s.version).toBe(v + 2);
  });

  it('a failed check is cached as empty', async () => {
    const s = new SpellSession({ check: async () => Promise.reject(new Error('down')) });
    s.want(['x y']);
    await tick();
    expect(s.issuesFor('x y')).toEqual([]);
    expect(s.stats.failed).toBe(1);
  });

  it('LRU cache size', async () => {
    const s = new SpellSession({ check: async () => [] }, { cacheSize: 2 });
    s.want(['a', 'b']);
    await tick();
    s.want(['c']);
    await tick();
    expect(s.has('a')).toBe(false);
    expect(s.has('b') && s.has('c')).toBe(true);
  });
});

describe('carry issues to edited text', () => {
  const i = (from: number, to: number): SpellIssue => ({ from, to, kind: 'spelling', suggestions: [] });
  it('keeps issues before the edit, shifts those after, drops the word being typed', () => {
    // 'aa bbb cc' → 'aa bbbx cc' : 'bbb'에 글자를 더하는 중
    expect(carryIssues('aa bbb cc', 'aa bbbx cc', [i(0, 2), i(3, 6), i(7, 9)])).toEqual([i(0, 2), i(8, 10)]);
    // 앞에 글자를 넣으면 모두 옮긴다
    expect(carryIssues(' aa bb', '가 aa bb', [i(1, 3), i(4, 6)])).toEqual([i(2, 4), i(5, 7)]);
    expect(carryIssues('same', 'same', [i(0, 4)])).toEqual([i(0, 4)]);
  });
});

describe('http checker', () => {
  it('batches one tick of paragraphs into one request', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { lang: string; texts: string[] };
      return new Response(JSON.stringify({ results: body.texts.map((t) => [{ from: 0, to: t.length, kind: 'spelling', suggestions: [t.toUpperCase()] }]) }));
    });
    const c = new HttpChecker({ url: '/spell', fetch: fetch as unknown as typeof globalThis.fetch });
    const ac = new AbortController();
    const [a, b] = await Promise.all([c.check('ab', 'ko', ac.signal), c.check('cd', 'ko', ac.signal)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ lang: 'ko', texts: ['ab', 'cd'] });
    expect(a[0]!.suggestions).toEqual(['AB']);
    expect(b[0]!.suggestions).toEqual(['CD']);
  });

  it('aborted paragraphs are left out; all aborted aborts the request', async () => {
    let seen: AbortSignal | null = null;
    const fetch = vi.fn((_u: string, init: RequestInit) => {
      seen = init.signal!;
      return new Promise<Response>(() => {});
    });
    const c = new HttpChecker({ url: '/spell', fetch: fetch as unknown as typeof globalThis.fetch });
    const a1 = new AbortController();
    const a2 = new AbortController();
    const p1 = c.check('x', 'ko', a1.signal).catch(() => 'aborted');
    const p2 = c.check('y', 'ko', a2.signal).catch(() => 'aborted');
    a1.abort();
    await tick();
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string).texts).toEqual(['y']);
    a2.abort();
    expect(seen!.aborted).toBe(true);
    expect(await p1).toBe('aborted');
    expect(await p2).toBe('aborted');
  });
});
