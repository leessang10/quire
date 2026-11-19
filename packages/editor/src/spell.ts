/**
 * 맞춤법 검사 (15 §4): 검사기 인터페이스, 내장 검사기 둘(단어 목록, HTTP), 문단 단위 검사 일정과 캐시.
 * DOM이 없다 (Node에서 시험한다). 편집기는 SpellSession에 보이는 문단을 알리고 결과를 장식으로 그린다.
 */

export type SpellKind = 'spelling' | 'spacing' | 'grammar';

/** 문단 안 오류 하나. 오프셋은 문단 텍스트의 코드포인트 */
export interface SpellIssue {
  from: number;
  to: number;
  kind: SpellKind;
  message?: string;
  suggestions: string[];
}

export interface SpellChecker {
  /** 문단 하나. 같은 글자에는 같은 결과 (캐시 키 = 언어 + 텍스트) */
  check(text: string, lang: string, signal: AbortSignal): Promise<SpellIssue[]>;
  /** 사용자 사전 (선택): 앱이 저장한다 */
  addWord?(word: string): void;
}

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

/** 텍스트의 낱말들: [코드포인트 시작, 끝, 낱말]. 숫자가 붙은 낱말(A4, 3D)은 뺀다 */
export function wordsOf(text: string): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  // UTF-16 인덱스 → 코드포인트: 서로게이트가 없으면 같다
  const astral = /[\uD800-\uDBFF]/.test(text);
  let cu = 0;
  let cp = 0;
  const toCp = (i: number) => {
    if (!astral) return i;
    for (; cu < i; cu++) {
      const c = text.charCodeAt(cu);
      if (c < 0xdc00 || c > 0xdfff) cp++;
    }
    return cp;
  };
  for (const m of text.matchAll(WORD)) {
    const i = m.index!;
    const j = i + m[0].length;
    const prev = text.charCodeAt(i - 1);
    const next = text.charCodeAt(j);
    if ((prev >= 48 && prev <= 57) || (next >= 48 && next <= 57)) continue;
    const a = toCp(i);
    out.push([a, toCp(j), m[0]]);
  }
  return out;
}

/**
 * 단어 목록 검사기 (영어 등, 시험용). 낱말을 잘라 목록에 없으면 오류다. 대문자로 시작한 낱말은 소문자로도 찾는다.
 * 고칠 말은 편집 거리 1(지우기·더하기·바꾸기·자리 바꾸기)인 목록 낱말: 한 글자를 지운 꼴의 색인으로 찾는다.
 */
export class WordListChecker implements SpellChecker {
  private readonly words = new Set<string>();
  private deletes: Map<string, string[]> | null = null;

  constructor(
    words: Iterable<string>,
    private readonly opts: { minLength?: number; maxSuggestions?: number } = {},
  ) {
    for (const w of words) if (w) this.words.add(w.normalize('NFC'));
  }

  addWord(word: string): void {
    const w = word.normalize('NFC');
    if (this.words.has(w)) return;
    this.words.add(w);
    if (this.deletes) this.index(w);
  }

  has(word: string): boolean {
    const w = word.normalize('NFC');
    if (this.words.has(w)) return true;
    const lower = w.toLowerCase();
    // Apple은 apple로도, APPLE은 apple·Apple로도
    if (lower !== w && this.words.has(lower)) return true;
    return w === w.toUpperCase() && this.words.has(lower[0]!.toUpperCase() + lower.slice(1));
  }

  async check(text: string, _lang: string, signal: AbortSignal): Promise<SpellIssue[]> {
    if (signal.aborted) throw signal.reason;
    const min = this.opts.minLength ?? 2;
    const out: SpellIssue[] = [];
    for (const [from, to, w] of wordsOf(text)) {
      if (to - from < min || this.has(w)) continue;
      out.push({ from, to, kind: 'spelling', suggestions: this.suggest(w) });
    }
    return out;
  }

  /** 편집 거리 1인 목록 낱말 (대소문자는 원래 낱말을 따른다) */
  suggest(word: string): string[] {
    const max = this.opts.maxSuggestions ?? 5;
    if (!this.deletes) {
      this.deletes = new Map();
      for (const w of this.words) this.index(w);
    }
    const lower = word.toLowerCase();
    const found = new Set<string>();
    const add = (list: readonly string[] | undefined) => {
      for (const w of list ?? []) if (w !== lower && w !== word) found.add(w);
    };
    if (this.words.has(lower) && lower !== word) found.add(lower);
    add(this.deletes.get(lower)); // 더하기 (낱말에서 한 글자 빠짐)
    for (const d of deletions(lower)) {
      if (this.words.has(d)) found.add(d); // 지우기
      add(this.deletes.get(d)); // 바꾸기·자리 바꾸기
    }
    const cap = word[0] !== lower[0];
    const all = word.length > 1 && word === word.toUpperCase() && cap;
    const out: string[] = [];
    for (const w of [...found].sort((a, b) => score(lower, a) - score(lower, b) || a.localeCompare(b))) {
      out.push(all ? w.toUpperCase() : cap ? w[0]!.toUpperCase() + w.slice(1) : w);
      if (out.length >= max) break;
    }
    return out;
  }

  private index(w: string): void {
    for (const d of deletions(w)) {
      let l = this.deletes!.get(d);
      if (!l) this.deletes!.set(d, (l = []));
      l.push(w);
    }
  }
}

function deletions(w: string): Set<string> {
  const cs = Array.from(w);
  const out = new Set<string>();
  for (let i = 0; i < cs.length; i++) out.add(cs.slice(0, i).join('') + cs.slice(i + 1).join(''));
  return out;
}

/** 고칠 말 순서: 같은 길이(바꾸기·자리 바꾸기)를 앞에, 첫 글자가 같으면 앞에 */
function score(word: string, cand: string): number {
  return (cand.length === word.length ? 0 : 2) + (cand[0] === word[0] ? 0 : 1);
}

/**
 * 서버 검사기 어댑터. 한 틱에 들어온 문단들을 한 요청으로 묶는다.
 *   POST url  {"lang": "ko", "texts": ["…", "…"]}  →  {"results": [[SpellIssue…], …]}
 * 모든 문단이 그만두면 요청도 그만둔다.
 */
export class HttpChecker implements SpellChecker {
  private batch: Array<{ text: string; lang: string; signal: AbortSignal; resolve: (r: SpellIssue[]) => void; reject: (e: unknown) => void }> = [];
  private queued = false;

  constructor(
    private readonly opts: {
      url: string;
      headers?: Record<string, string>;
      fetch?: typeof fetch;
      /** 한 요청에 넣을 문단 수 (기본 50) */
      maxBatch?: number;
      addWord?: (word: string) => void;
    },
  ) {
    if (opts.addWord) this.addWord = opts.addWord;
  }

  addWord?: (word: string) => void;

  check(text: string, lang: string, signal: AbortSignal): Promise<SpellIssue[]> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      this.batch.push({ text, lang, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      if (!this.queued) {
        this.queued = true;
        setTimeout(() => this.flush(), 0);
      }
    });
  }

  private flush(): void {
    this.queued = false;
    const all = this.batch.filter((b) => !b.signal.aborted);
    this.batch = [];
    const max = this.opts.maxBatch ?? 50;
    // 언어마다, max개씩
    const byLang = new Map<string, typeof all>();
    for (const b of all) {
      let l = byLang.get(b.lang);
      if (!l) byLang.set(b.lang, (l = []));
      l.push(b);
    }
    for (const [lang, list] of byLang) for (let i = 0; i < list.length; i += max) void this.send(lang, list.slice(i, i + max));
  }

  private async send(lang: string, items: HttpChecker['batch']): Promise<void> {
    const ctl = new AbortController();
    let live = items.length;
    for (const it of items)
      it.signal.addEventListener(
        'abort',
        () => {
          if (--live === 0) ctl.abort();
        },
        { once: true },
      );
    try {
      const f = this.opts.fetch ?? fetch;
      const res = await f(this.opts.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.opts.headers },
        body: JSON.stringify({ lang, texts: items.map((i) => i.text) }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`spell check: HTTP ${res.status}`);
      const body = (await res.json()) as { results?: SpellIssue[][] };
      items.forEach((it, i) => it.resolve(body.results?.[i] ?? []));
    } catch (e) {
      for (const it of items) it.reject(e);
    }
  }
}

/** 크기를 제한한 LRU (Map 삽입 순서) */
class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

export interface SpellSessionOptions {
  lang?: string;
  /** 결과 캐시 크기 (문단 수, 기본 50,000: 1,000쪽 문서의 문단이 다 들어가게) */
  cacheSize?: number;
  /** 동시에 검사하는 문단 수 (기본 4) */
  concurrency?: number;
  /** 결과가 들어오면 (그 문단 텍스트). 무시 목록·캐시가 바뀌면 null */
  onResult?: (text: string | null) => void;
}

/**
 * 검사 일정 (15 §4.2): 결과 캐시 (언어, 텍스트) → 오류. 원하는 문단 목록(앞이 먼저)을 받아 캐시에 없는 것을 검사하고,
 * 더 원하지 않는 진행 중 검사는 그만둔다. 무시 목록은 세션(문서)마다다.
 */
export class SpellSession {
  readonly lang: string;
  private readonly cache: Lru<SpellIssue[]>;
  private readonly inflight = new Map<string, AbortController>();
  private queue: string[] = [];
  private readonly ignored = new Set<string>();
  /** 유휴 검사로 넣은 텍스트 (보이지 않아도 그만두지 않는다) */
  private readonly later = new Set<string>();
  /** 결과나 무시 목록이 바뀌면 오른다 (그리기·미러 캐시 키) */
  version = 0;
  private disposed = false;
  readonly stats = { checked: 0, failed: 0, aborted: 0 };

  constructor(
    readonly checker: SpellChecker,
    private readonly opts: SpellSessionOptions = {},
  ) {
    this.lang = opts.lang ?? 'ko';
    this.cache = new Lru(opts.cacheSize ?? 50_000);
  }

  /** 캐시한 결과 (무시한 낱말은 뺀다). 아직 검사하지 않았으면 undefined */
  issuesFor(text: string): SpellIssue[] | undefined {
    const r = this.cache.get(text);
    if (!r || !this.ignored.size || !r.length) return r;
    return r.filter((i) => !this.ignored.has(slice(text, i.from, i.to)));
  }

  has(text: string): boolean {
    return this.cache.get(text) !== undefined;
  }

  /**
   * 원하는 문단들 (앞이 먼저). 캐시에 없는 것을 큐에 넣고, 이 목록에 없는 진행 중 검사는 그만둔다.
   */
  want(texts: readonly string[]): void {
    if (this.disposed) return;
    const wanted = new Set<string>();
    const queue: string[] = [];
    for (const t of texts) {
      if (wanted.has(t) || !checkable(t)) continue;
      wanted.add(t);
      if (this.cache.get(t) === undefined && !this.inflight.has(t)) queue.push(t);
    }
    for (const [t, ctl] of this.inflight)
      if (!wanted.has(t) && !this.later.has(t)) {
        ctl.abort();
        this.inflight.delete(t);
        this.stats.aborted++;
      }
    // 유휴 검사로 넣은 것은 뒤에 남긴다
    for (const t of this.queue) if (this.later.has(t) && !wanted.has(t)) queue.push(t);
    this.queue = queue;
    this.pump();
  }

  /** 유휴 시간에 검사할 문단들을 큐 뒤에 더한다 (진행 중인 것을 그만두지 않는다) */
  wantLater(texts: readonly string[]): number {
    if (this.disposed) return 0;
    const inQueue = new Set(this.queue);
    let n = 0;
    for (const t of texts) {
      if (!checkable(t) || inQueue.has(t) || this.inflight.has(t) || this.cache.get(t) !== undefined) continue;
      inQueue.add(t);
      this.later.add(t);
      this.queue.push(t);
      n++;
    }
    this.pump();
    return n;
  }

  /** 아무것도 기다리지 않는가 (유휴 검사를 더 넣어도 되는가) */
  get idle(): boolean {
    return !this.queue.length && !this.inflight.size;
  }

  /** 이 낱말을 모두 무시한다 (이 문서에서만, 저장하지 않음) */
  ignore(word: string): void {
    this.ignored.add(word);
    this.version++;
    this.opts.onResult?.(null);
  }

  /** 사전에 더한다: 검사기의 addWord (앱이 저장), 그리고 바로 무시한다 */
  addWord(word: string): void {
    this.checker.addWord?.(word);
    this.ignore(word);
  }

  /** 캐시를 비운다 (검사기 사전이 바뀌었을 때) */
  reset(): void {
    this.cache.clear();
    this.version++;
    this.opts.onResult?.(null);
  }

  dispose(): void {
    this.disposed = true;
    for (const ctl of this.inflight.values()) ctl.abort();
    this.inflight.clear();
    this.queue = [];
    this.later.clear();
  }

  private pump(): void {
    const max = this.opts.concurrency ?? 4;
    while (this.inflight.size < max && this.queue.length) {
      const text = this.queue.shift()!;
      if (this.inflight.has(text) || this.cache.get(text) !== undefined) continue;
      const ctl = new AbortController();
      this.inflight.set(text, ctl);
      this.checker.check(text, this.lang, ctl.signal).then(
        (issues) => {
          if (this.inflight.get(text) !== ctl) return; // 그만뒀다
          this.inflight.delete(text);
          this.later.delete(text);
          if (this.disposed) return;
          this.cache.set(text, issues.filter((i) => i.to > i.from).sort((a, b) => a.from - b.from));
          this.stats.checked++;
          this.version++;
          this.pump();
          this.opts.onResult?.(text);
        },
        () => {
          if (this.inflight.get(text) !== ctl) return;
          this.inflight.delete(text);
          this.later.delete(text);
          this.stats.failed++;
          // 실패한 문단은 빈 결과로 둔다 (계속 다시 보내지 않는다)
          if (!this.disposed) this.cache.set(text, []);
          this.pump();
        },
      );
    }
  }
}

/** 검사할 글자가 있는가 (빈 문단, 개체만 있는 문단은 아니다) */
function checkable(text: string): boolean {
  return /[\p{L}]/u.test(text);
}

function slice(text: string, from: number, to: number): string {
  return Array.from(text).slice(from, to).join('');
}

/**
 * 바뀐 문단의 지난 결과를 새 텍스트로 옮긴다 (검사가 끝나기 전에 밑줄이 깜박이지 않게).
 * 공통 앞부분 안의 것은 그대로, 공통 뒷부분 안의 것은 길이 차이만큼 옮기고, 바뀐 곳에 걸친 것(입력 중인 낱말)은 버린다.
 */
export function carryIssues(oldText: string, newText: string, issues: readonly SpellIssue[]): SpellIssue[] {
  if (oldText === newText) return issues.slice();
  const a = Array.from(oldText);
  const b = Array.from(newText);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const delta = b.length - a.length;
  const oldSufStart = a.length - suf;
  const out: SpellIssue[] = [];
  for (const i of issues) {
    // 바뀐 곳에 붙은 낱말도 버린다 (낱말 끝에 글자를 더하는 중)
    if (i.to < pre) out.push(i);
    else if (i.from > oldSufStart) out.push({ ...i, from: i.from + delta, to: i.to + delta });
  }
  return out;
}
