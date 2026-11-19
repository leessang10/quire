/**
 * 찾기 (15 §3): 스토리마다의 문단 텍스트에서 찾는다. 결과는 오프셋(비영속)이다.
 *
 * - 문단을 넘는 결과는 없다. 개체 글자(U+FFFC)를 덮는 결과는 버린다.
 * - 문단 결과는 문단 텍스트로 캐시한다 (바뀌지 않은 문단은 같은 문자열 객체라 조회가 싸다).
 * - 순서: 본문(표 자리에 그 표의 셀들, 행·열 순), 각주(참조 순), 머리말·꼬리말(구역 순).
 */
import type { Doc } from './doc';
import { OBJ } from './doc';
import { Document, type StoryId } from './document';
import type { Op } from './history';
import { noteRefs, noteStoryId } from './notes';
import { normalizeTable } from './tables';

export interface FindQuery {
  text: string;
  caseSensitive?: boolean;
  /** 앞뒤가 글자·숫자가 아닐 때만 */
  wholeWord?: boolean;
  /** text를 정규식으로 */
  regex?: boolean;
  /** 찾는 스토리: 모두(기본) 또는 본문(과 그 표의 셀)만 */
  stories?: 'all' | 'body';
}

export interface FindMatch {
  story: StoryId | null;
  /** 그 스토리의 오프셋 (코드포인트) */
  from: number;
  to: number;
}

/** 문단 텍스트 → [시작, 끝) 코드포인트 오프셋 쌍들 */
export type Matcher = (text: string) => readonly (readonly [number, number])[];

const ESCAPE = /[.*+?^${}()|[\]\\]/g;
const SURROGATE = /[\uD800-\uDFFF]/;

/** 찾기 조건 → 문단 검색 함수 (정규식이 틀리면 error) */
export function compileFind(q: FindQuery): { matcher: Matcher; regex: RegExp } | { error: string } {
  if (!q.text) return { error: 'empty' };
  let source = q.regex ? q.text : q.text.replace(ESCAPE, '\\$&');
  if (q.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  let re: RegExp;
  try {
    re = new RegExp(source, `gu${q.caseSensitive ? '' : 'i'}`);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const matcher: Matcher = (text) => {
    if (!text) return [];
    const out: Array<readonly [number, number]> = [];
    re.lastIndex = 0;
    const wide = SURROGATE.test(text);
    let cp: Int32Array | null = null;
    if (wide) {
      // UTF-16 위치 → 코드포인트 위치
      cp = new Int32Array(text.length + 1);
      let n = 0;
      for (let i = 0; i < text.length; i++) {
        cp[i] = n;
        const c = text.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
          const d = text.charCodeAt(i + 1);
          if (d >= 0xdc00 && d <= 0xdfff) {
            cp[i + 1] = n;
            i++;
          }
        }
        n++;
      }
      cp[text.length] = n;
    }
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const a = m.index;
      const b = a + m[0].length;
      if (b === a) {
        // 빈 결과는 버리고 한 글자 나아간다
        re.lastIndex = a + (wide && text.codePointAt(a)! > 0xffff ? 2 : 1);
        continue;
      }
      if (m[0].includes(OBJ)) continue;
      out.push(cp ? [cp[a]!, cp[b]!] : [a, b]);
    }
    return out;
  };
  return { matcher, regex: re };
}

/** 찾는 스토리들 (문서 순서) */
export function storiesInOrder(document: Document): Array<StoryId | null> {
  const out: Array<StoryId | null> = [];
  const body = document.body;
  // 본문 + 표 자리의 셀
  out.push(null);
  for (const n of noteRefs(body)) if (document.has(noteStoryId(n.id))) out.push(noteStoryId(n.id));
  const seen = new Set<string>();
  for (const [, def] of body.sectionDefs())
    for (const part of ['header', 'footer'] as const) {
      const m = def[part] as Record<string, string | undefined> | undefined;
      if (!m) continue;
      for (const kind of ['default', 'first', 'even']) {
        const s = m[kind];
        if (s && !seen.has(s) && document.has(s)) {
          seen.add(s);
          out.push(s);
        }
      }
    }
  return out;
}

/** 문단 결과 캐시 (같은 조건 동안 쓴다) */
export class FindCache {
  private readonly map = new Map<string, readonly (readonly [number, number])[]>();
  constructor(readonly matcher: Matcher) {}
  get(text: string): readonly (readonly [number, number])[] {
    let r = this.map.get(text);
    if (!r) {
      r = this.matcher(text);
      this.map.set(text, r);
      // 오래 쓰면 지워진 문단 텍스트가 쌓인다: 크기가 넘으면 비운다
      if (this.map.size > 200_000) this.map.clear();
    }
    return r;
  }
}

function pushDoc(out: FindMatch[], d: Doc, story: StoryId | null, cache: FindCache, limit: number, onTable?: (table: string) => void): boolean {
  for (const p of d.paragraphs()) {
    if (onTable && p.objs) {
      const t = p.objs.get(0)?.table;
      if (t && p.objs.get(0)?.kind === 'table') {
        onTable(t);
        if (out.length >= limit) return false;
        continue;
      }
    }
    const r = cache.get(p.text);
    for (const [a, b] of r) {
      out.push({ story, from: p.start + a, to: p.start + b });
      if (out.length >= limit) return false;
    }
  }
  return true;
}

/**
 * 문서 전체에서 찾는다. limit에 닿으면 멈추고 truncated = true.
 * stories: 'body'면 본문(과 그 표의 셀)만.
 */
export function findInDocument(document: Document, cache: FindCache, opts: { limit?: number; stories?: 'all' | 'body' } = {}): { matches: FindMatch[]; truncated: boolean } {
  const limit = opts.limit ?? 10_000;
  const out: FindMatch[] = [];
  const onTable = (id: string) => {
    const rec = document.table(id);
    if (!rec) return;
    const g = normalizeTable(rec);
    for (const row of g.cells)
      for (const c of row) {
        if (!c || !document.has(c.story) || out.length >= limit) continue;
        pushDoc(out, document.story(c.story), c.story, cache, limit);
      }
  };
  let ok = pushDoc(out, document.body, null, cache, limit, onTable);
  if (ok && opts.stories !== 'body')
    for (const s of storiesInOrder(document)) {
      if (s === null) continue;
      ok = pushDoc(out, document.story(s), s, cache, limit);
      if (!ok) break;
    }
  return { matches: out, truncated: !ok || out.length >= limit };
}

/** 정규식 바꾸기 글자 ($1, $& …): 결과 글자에 다시 맞춰 만든다 */
export function replacementFor(regex: RegExp | null, matched: string, replacement: string): string {
  if (!regex) return replacement;
  const re = new RegExp(regex.source, regex.flags.replace('g', ''));
  return matched.replace(re, replacement);
}

/**
 * 결과들을 바꾸는 연산 (15 §3.3). 스토리마다 뒤에서 앞으로 바꿔 오프셋이 밀리지 않게 한다.
 * - 글자가 이미 검색어와 맞지 않는 결과(협업 중 바뀐 것)는 건너뛴다.
 * - 바꾼 글자의 서식은 결과 첫 글자의 서식이다.
 * - 제안 모드면 제안으로 기록한다 (14 §4). 스토리 연산은 Document.tag로 감싼다.
 */
export function replaceMatches(
  document: Document,
  matches: readonly FindMatch[],
  matcher: Matcher,
  regex: RegExp | null,
  text: string,
): { ops: Op[]; count: number } {
  const byStory = new Map<StoryId | null, FindMatch[]>();
  for (const m of matches) {
    let l = byStory.get(m.story);
    if (!l) byStory.set(m.story, (l = []));
    l.push(m);
  }
  const out: Op[] = [];
  let count = 0;
  for (const [story, list] of byStory) {
    const d = document.docOf(story);
    // 맞는지는 바꾸기 전에 모두 본다 (뒤에서 앞으로 바꾸므로 앞 결과의 오프셋·글자는 그대로다)
    const paras = d.paragraphs();
    const valid = new Map<number, Set<string>>();
    const ok = (m: FindMatch) => {
      if (m.to > d.maxCaret) return false;
      const i = d.paragraphIndexAt(m.from);
      const p = paras[i];
      if (!p || m.to > p.end) return false;
      let set = valid.get(i);
      if (!set) valid.set(i, (set = new Set(matcher(p.text).map(([a, b]) => `${p.start + a}:${p.start + b}`))));
      return set.has(`${m.from}:${m.to}`);
    };
    const sorted = list.filter(ok).sort((a, b) => b.from - a.from);
    const ops: Op[] = [];
    for (const m of sorted) {
      const value = replacementFor(regex, d.slice(m.from, m.to), text);
      const marks = d.marksAt(m.from);
      const sub: Op[] = [...d.deleteRange(m.from, m.to)];
      if (value) sub.push({ type: 'insert', ids: d.insertText(m.from, value, marks) });
      ops.push(...sub);
      if (document.suggesting) ops.push(...document.recordSuggestions(story, d, sub));
      count++;
    }
    out.push(...(story === null ? ops : Document.tag(story, ops)));
  }
  return { ops: out, count };
}
