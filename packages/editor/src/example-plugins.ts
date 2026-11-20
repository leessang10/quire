/**
 * 예제 플러그인 (15 §7): 플러그인 API의 면을 고루 쓴다.
 * - 글자 수 세기: 이벤트(change)와 명령, 내보내기 형식(통계 글), 장식 없음
 * - 강조 낱말: 장식 소스 + 장식 겉모양, 명령(낱말 더하기·빼기, 다음 낱말로 가기), 단축키, 오른쪽 클릭 항목, 문서 데이터(낱말 목록, 판 옮기기)
 */
import type { MenuItem, PluginContext, QuirePlugin } from './plugins';

export interface WordCount {
  /** 글자 (공백 포함·제외), 어절, 문단 */
  chars: number;
  charsNoSpace: number;
  words: number;
  paragraphs: number;
}

/** 본문의 글자·어절·문단 수 (개체 글자 빼고) */
function countOf(ctx: PluginContext): WordCount {
  let chars = 0;
  let charsNoSpace = 0;
  let words = 0;
  let paragraphs = 0;
  for (const p of ctx.document().body.paragraphs()) {
    const t = p.text.replace(/￼/g, '');
    if (t.trim()) paragraphs++;
    for (const ch of t) {
      chars++;
      if (!/\s/.test(ch)) charsNoSpace++;
    }
    words += t.split(/\s+/).filter(Boolean).length;
  }
  return { chars, charsNoSpace, words, paragraphs };
}

/** 글자 수 세기: 문서가 바뀔 때마다 onCount를 부른다 (입력이 몰리면 한 번에) */
export function wordCountPlugin(onCount?: (c: WordCount) => void): QuirePlugin & { count(): WordCount | null } {
  /** 마지막으로 붙은 편집기 (count()용). 상태는 붙일 때마다 따로 둔다: 같은 플러그인 객체를 편집기 둘이 써도
   *  (React StrictMode의 이중 마운트처럼 앞 편집기를 늦게 정리해도) 서로 지우지 않는다 */
  let ctx: PluginContext | null = null;
  return {
    name: 'wordCount',
    count: () => (ctx ? countOf(ctx) : null),
    commands: {
      report: (c) => (onCount?.(countOf(c)), true),
    },
    exporters: {
      stats: {
        label: '문서 통계 (글)',
        extension: 'txt',
        mime: 'text/plain',
        export: (c) => {
          const n = countOf(c);
          return `글자 ${n.chars} (공백 빼고 ${n.charsNoSpace})\n어절 ${n.words}\n문단 ${n.paragraphs}\n`;
        },
      },
    },
    init(c) {
      ctx = c;
      let alive = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const later = (ms: number) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (alive) onCount?.(countOf(c));
        }, ms);
      };
      // 첫 알림은 다음 틱으로 미룬다: 붙이는 중(createEditor 안, await가 값을 돌려주기 전)에 앱 콜백이 불리면 앱은 아직 에디터를 받지 못했다
      later(0);
      const off = c.on('change', () => later(150));
      return () => {
        alive = false;
        off();
        if (timer) clearTimeout(timer);
        if (ctx === c) ctx = null;
      };
    },
  };
}

interface HighlightData {
  words: string[];
}

/**
 * 강조 낱말: 문서 데이터의 낱말 목록(정본 x.highlightWords)이 나오는 곳에 바탕색 장식.
 * 판 1은 낱말을 쉼표로 이은 글이었다 (판 옮기기 예).
 */
export function highlightWordsPlugin(initial: string[] = [], color = '#ffe08a'): QuirePlugin {
  /** 편집기(붙인 자리)마다 낱말 목록과 정규식: 같은 플러그인 객체를 여러 편집기가 써도 섞이지 않는다 */
  const states = new WeakMap<PluginContext, { words: string[]; re: RegExp | null }>();
  const stateOf = (ctx: PluginContext) => {
    let st = states.get(ctx);
    if (!st) states.set(ctx, (st = { words: [], re: null }));
    return st;
  };
  const compile = (st: { words: string[]; re: RegExp | null }) => {
    const ws = st.words.filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    st.re = ws.length ? new RegExp(ws.sort((a, b) => b.length - a.length).join('|'), 'gu') : null;
  };
  const setWords = (ctx: PluginContext, words: string[]) => {
    const st = stateOf(ctx);
    st.words = words;
    ctx.setData({ words } satisfies HighlightData);
    compile(st);
    ctx.redraw();
  };
  /** 문단 안 낱말 범위 (코드포인트 오프셋) */
  const rangesIn = (ctx: PluginContext, text: string): Array<[number, number]> => {
    const re = stateOf(ctx).re;
    if (!re) return [];
    const out: Array<[number, number]> = [];
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const from = Array.from(text.slice(0, m.index)).length;
      out.push([from, from + Array.from(m[0]).length]);
    }
    return out;
  };
  return {
    name: 'highlightWords',
    data: {
      schemaVersion: 2,
      migrate: (old, from) => (from < 2 && typeof old === 'string' ? { words: old.split(',').map((w) => w.trim()).filter(Boolean) } : old),
    },
    decorationStyles: { 'highlight-word': { fill: color } },
    decorations: (ctx) => ({
      decorationsIn: (_story, para) => rangesIn(ctx, para.text).map(([a, b]) => ({ from: para.start + a, to: para.start + b, kind: 'highlight-word' })),
    }),
    commands: {
      add: (ctx, word) => {
        const w = String(word ?? '').trim();
        const words = stateOf(ctx).words;
        if (!w || words.includes(w)) return false;
        setWords(ctx, [...words, w]);
        return true;
      },
      remove: (ctx, word) => {
        const words = stateOf(ctx).words;
        if (!words.includes(String(word))) return false;
        setWords(
          ctx,
          words.filter((x) => x !== word),
        );
        return true;
      },
      /** 선택한 글을 낱말로 더한다 */
      addSelection: (ctx) => {
        const sel = ctx.selection();
        if (sel.from === sel.to) return false;
        const para = ctx.doc().paragraphs()[ctx.doc().paragraphIndexAt(sel.from)];
        if (!para) return false;
        const w = Array.from(para.text)
          .slice(sel.from - para.start, sel.to - para.start)
          .join('')
          .trim();
        return ctx.run('highlightWords.add', w);
      },
      /** 캐럿 뒤 다음 강조 낱말로 (본문) */
      next: (ctx) => {
        const sel = ctx.selection();
        for (const p of ctx.document().body.paragraphs()) {
          for (const [a, b] of rangesIn(ctx, p.text)) {
            // 캐럿 뒤 (선택해 둔 낱말이면 그다음)
            if (sel.story === null && (sel.from === sel.to ? p.start + a < sel.from : p.start + a <= sel.from)) continue;
            return ctx.reveal(null, p.start + a, p.start + b);
          }
        }
        return false;
      },
    },
    keymap: { 'Mod+Alt+K': 'highlightWords.addSelection', 'Mod+Alt+J': 'highlightWords.next' },
    contextMenu: (ctx, at): MenuItem[] => {
      const sel = ctx.selection();
      const items: MenuItem[] = [];
      if (sel.from !== sel.to) items.push({ label: '강조 낱말로 더하기', run: () => void ctx.run('highlightWords.addSelection') });
      const para = ctx.doc().paragraphs()[ctx.doc().paragraphIndexAt(at.offset)];
      if (para) {
        const rel = at.offset - para.start;
        const hit = rangesIn(ctx, para.text).find(([a, b]) => a <= rel && rel <= b);
        if (hit) {
          const w = Array.from(para.text).slice(hit[0], hit[1]).join('');
          items.push({ label: `강조 빼기: ${w}`, run: () => void ctx.run('highlightWords.remove', w) });
        }
      }
      return items;
    },
    init(ctx) {
      const d = ctx.getData<HighlightData>();
      const st = stateOf(ctx);
      st.words = d?.words ?? [...initial];
      if (!d && initial.length) ctx.setData({ words: st.words });
      compile(st);
      return () => states.delete(ctx);
    },
  };
}
