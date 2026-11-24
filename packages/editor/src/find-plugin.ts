/**
 * 찾기·바꾸기 (15 §3)를 플러그인 API만으로 짠 내장 플러그인. 편집기의 find·findNext·replace·replaceAll·clearFind는 이것에 맡긴다.
 * - 명령: find.find(query), find.next(dir), find.replace(text), find.replaceAll(text), find.clear(), find.open(replace)
 * - 단축키: Mod+F·Mod+H(앱이 막대를 연다), F3·Shift+F3
 * - 장식: 결과(find), 지금 결과(find-current)
 */
import { FindCache, compileFind, findInDocument, replaceMatches, type Document, type FindMatch, type FindQuery } from '@quiredoc/model';
import type { Decoration, DecorationPara, PluginContext, QuirePlugin } from './plugins';

/** 찾기 상태 (15 §3.1): 결과 수, 지금 결과 번호(-1이면 없음), 상한에 닿았나, 틀린 조건 */
export interface FindStatus {
  count: number;
  current: number;
  truncated: boolean;
  error?: string;
}

interface State {
  query: FindQuery;
  cache: FindCache;
  regex: RegExp | null;
  key: string;
  document: Document | null;
  matches: FindMatch[];
  byStory: Map<string, FindMatch[]>;
  truncated: boolean;
  current: number;
}

export interface FindPluginOptions {
  /** Ctrl+F(replace = false)·Ctrl+H(true): 앱이 찾기 막대를 연다. 없으면 단축키를 쓰지 않는다 (브라우저 기본) */
  onOpen?: (replace: boolean) => void;
}

export interface FindPlugin extends QuirePlugin {
  find(query: FindQuery): FindStatus;
  status(): FindStatus | null;
  next(dir?: 1 | -1): FindStatus | null;
  replace(text: string): boolean;
  replaceAll(text: string): number;
  clear(): void;
}

export function findPlugin(opts: FindPluginOptions = {}): FindPlugin {
  let ctx: PluginContext | null = null;
  let s: State | null = null;

  /** 글자 판이 바뀌었으면 결과를 다시 구한다 (바뀌지 않은 문단은 캐시). 지금 결과는 같은 자리에 가까운 것으로 */
  const refresh = () => {
    if (!s || !ctx) return;
    const document = ctx.document();
    const key = document.contentKey();
    if (s.key === key && s.document === document) return;
    const cur = s.matches[s.current];
    const r = findInDocument(document, s.cache, { stories: s.query.stories });
    s.key = key;
    s.document = document;
    s.matches = r.matches;
    s.truncated = r.truncated;
    s.byStory = new Map();
    for (const m of r.matches) {
      const k = m.story ?? '';
      let l = s.byStory.get(k);
      if (!l) s.byStory.set(k, (l = []));
      l.push(m);
    }
    if (cur) s.current = r.matches.findIndex((m) => order(m, cur) >= 0);
    else if (s.current >= r.matches.length) s.current = -1;
  };

  /** 문서 순서 비교 (같은 스토리 안에서만 오프셋으로, 다른 스토리면 결과 목록 순) */
  const order = (a: FindMatch, b: FindMatch) => (a.story === b.story ? a.from - b.from : s!.matches.indexOf(a) - s!.matches.indexOf(b));

  /** 캐럿 자리 뒤 첫 결과의 번호 (없으면 다음 스토리의 첫 결과, 그것도 없으면 0, 결과가 없으면 -1) */
  const afterCaret = () => {
    const ms = s!.matches;
    if (!ms.length) return -1;
    const sel = ctx!.selection();
    const first = ms.findIndex((m) => m.story === sel.story);
    if (first < 0) return 0;
    for (let i = first; i < ms.length && ms[i]!.story === sel.story; i++) if (ms[i]!.from >= sel.from) return i;
    let i = first;
    while (i < ms.length && ms[i]!.story === sel.story) i++;
    return i < ms.length ? i : 0;
  };

  const selected = (m: FindMatch) => {
    const sel = ctx!.selection();
    return sel.story === m.story && sel.from === m.from && sel.to === m.to;
  };

  const status = (): FindStatus | null => {
    if (!s) return null;
    refresh();
    return { count: s.matches.length, current: s.current, truncated: s.truncated };
  };

  const decorations = (story: string | null, para: DecorationPara): Decoration[] | null => {
    if (!s) return null;
    const ms = s.byStory.get(story ?? '');
    if (!ms) return null;
    const end = para.start + para.text.length; // UTF-16 길이 ≥ 코드포인트 길이: 넉넉하다
    let lo = 0;
    let hi = ms.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ms[mid]!.to <= para.start) lo = mid + 1;
      else hi = mid;
    }
    const cur = s.matches[s.current];
    const out: Decoration[] = [];
    for (let i = lo; i < ms.length && ms[i]!.from < end; i++) out.push({ from: ms[i]!.from, to: ms[i]!.to, kind: ms[i] === cur ? 'find-current' : 'find' });
    return out;
  };

  const plugin: FindPlugin = {
    name: 'find',
    find(query) {
      const c = compileFind(query);
      if ('error' in c) {
        s = null;
        ctx?.redraw();
        return { count: 0, current: -1, truncated: false, error: c.error };
      }
      s = { query, cache: new FindCache(c.matcher), regex: query.regex ? c.regex : null, key: '', document: null, matches: [], byStory: new Map(), truncated: false, current: -1 };
      refresh();
      s.current = afterCaret();
      ctx?.redraw();
      return status()!;
    },
    status,
    next(dir = 1) {
      if (!s || !ctx) return null;
      refresh();
      const n = s.matches.length;
      if (!n) return status();
      const cur = s.matches[s.current];
      // 지금 결과가 선택돼 있으면 그다음, 아니면 캐럿에서 가까운 것
      const isSel = !!cur && selected(cur);
      if (isSel || s.current < 0) s.current = isSel ? (s.current + dir + n) % n : dir > 0 ? Math.max(0, afterCaret()) : (afterCaret() - 1 + n) % n;
      const m = s.matches[s.current]!;
      ctx.reveal(m.story, m.from, m.to);
      return status();
    },
    replace(text) {
      if (!s || !ctx || !ctx.canEdit()) return false;
      refresh();
      const m = s.matches[s.current];
      if (!m || !selected(m)) {
        plugin.next(1);
        return false;
      }
      const st = s;
      let count = 0;
      ctx.editDocument((document) => {
        const r = replaceMatches(document, [m], st.cache.matcher, st.regex, text);
        count = r.count;
        return r.ops;
      });
      if (!count) {
        plugin.next(1);
        return false;
      }
      refresh();
      // 바꾼 자리 뒤 첫 결과
      const at = s.matches.findIndex((x) => order(x, m) > 0 || (x.story === m.story && x.from >= m.from + Array.from(text).length));
      s.current = at;
      if (at >= 0) ctx.reveal(s.matches[at]!.story, s.matches[at]!.from, s.matches[at]!.to);
      else ctx.redraw();
      return true;
    },
    replaceAll(text) {
      if (!s || !ctx || !ctx.canEdit()) return 0;
      refresh();
      if (!s.matches.length) return 0;
      const st = s;
      let count = 0;
      ctx.editDocument((document) => {
        const r = replaceMatches(document, st.matches, st.cache.matcher, st.regex, text);
        count = r.count;
        return r.ops;
      });
      refresh();
      s.current = -1;
      ctx.redraw();
      return count;
    },
    clear() {
      if (!s) return;
      s = null;
      ctx?.redraw();
    },
    commands: {
      find: (_c, query) => (plugin.find(query as FindQuery), true),
      next: (_c, dir) => !!plugin.next(dir === -1 ? -1 : 1),
      prev: () => !!plugin.next(-1),
      replace: (_c, text) => plugin.replace(String(text ?? '')),
      replaceAll: (_c, text) => plugin.replaceAll(String(text ?? '')) > 0,
      clear: () => (plugin.clear(), true),
      open: (_c, replace) => {
        if (!opts.onOpen) return false;
        opts.onOpen(!!replace);
        return true;
      },
      'open-replace': () => {
        if (!opts.onOpen) return false;
        opts.onOpen(true);
        return true;
      },
      'next-key': () => (s ? !!plugin.next(1) : false),
      'prev-key': () => (s ? !!plugin.next(-1) : false),
    },
    keymap: { 'Mod+F': 'find.open', 'Mod+H': 'find.open-replace', F3: 'find.next-key', 'Shift+F3': 'find.prev-key' },
    decorations: () => ({ decorationsIn: decorations }),
    init(c) {
      ctx = c;
      const off = c.on('beforeRender', refresh);
      return () => {
        off();
        ctx = null;
        s = null;
      };
    },
  };
  return plugin;
}
