/**
 * 맞춤법 검사 (15 §4)를 플러그인 API만으로 짠 내장 플러그인. 편집기의 setSpellChecker·spellSession·spellAt은 이것에 맡긴다.
 * - 장식: 보이는 문단의 오류 (물결). 결과가 아직 없으면 지난 결과를 새 글자로 옮겨 보인다. 캐럿 문단은 입력이 멈춘 뒤 검사한다
 * - 일정: 그리기가 끝나면(afterRender) 보인 문단을 세션에 알리고, 할 일이 없으면 유휴 시간에 나머지 본문 문단을 검사한다
 * - 오른쪽 클릭: 고칠 말·이 문서에서 무시·사전에 더하기 (그 낱말을 선택해 둔다)
 */
import { replaceMatches } from '@quiredoc/model';
import type { Decoration, DecorationPara, MenuItem, PluginContext, QuirePlugin, StoryPos } from './plugins';
import { SpellSession, carryIssues, type SpellChecker, type SpellIssue, type SpellKind } from './spell';

/** 캐럿 문단은 입력이 이만큼 멈춘 뒤 검사한다 */
export const SPELL_PAUSE_MS = 500;

/** 맞춤법 오류 위의 오른쪽 클릭 (15 §4.3) */
export interface SpellMenu {
  word: string;
  kind: SpellKind;
  message?: string;
  suggestions: string[];
  /** 고칠 말로 바꾼다 (제안 모드면 제안). 바꿨으면 true */
  apply(text: string): boolean;
  /** 이 문서에서 이 낱말을 모두 무시 */
  ignore(): void;
  /** 사전에 더하기 (검사기의 addWord) */
  addWord(): void;
}

export interface SpellPlugin extends QuirePlugin {
  readonly session: SpellSession;
  /** 화면 점의 오류 메뉴 (편집 중인 스토리에서). 없으면 null */
  menuAt(clientX: number, clientY: number, select?: boolean): SpellMenu | null;
}

export function spellPlugin(checker: SpellChecker, opts: { lang?: string } = {}): SpellPlugin {
  let ctx: PluginContext | null = null;
  /** 문단마다 마지막으로 보인 결과, 이번 그리기에서 원한 문단, 보인 문단 글, 캐럿 문단의 입력 시각 */
  const shown = new Map<string, { text: string; issues: readonly SpellIssue[] }>();
  let wanted: string[] = [];
  const visible = new Set<string>();
  let caret: { key: string; text: string; at: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idle: number | null = null;
  let cursor = 0;
  let cursorVersion = -1;

  const session = new SpellSession(checker, {
    lang: opts.lang,
    onResult: (text) => {
      if (!ctx) return;
      if (text === null || visible.has(text)) ctx.redraw();
      else if (session.idle) idleCheck();
    },
  });

  /** 할 일이 없으면 유휴 시간에 나머지 본문 문단을 검사한다 (15 §4.2) */
  const idleCheck = () => {
    if (!ctx || !session.idle || idle !== null) return;
    const body = ctx.document().body;
    if (cursorVersion !== body.version) {
      cursorVersion = body.version;
      cursor = 0;
    }
    if (cursor >= body.paragraphs().length) return;
    const ric = window.requestIdleCallback ?? ((f: (d: { timeRemaining(): number }) => void) => setTimeout(() => f({ timeRemaining: () => 8 }), 100));
    idle = ric((dl) => {
      idle = null;
      if (!ctx) return;
      const b = ctx.document().body;
      const paras = b.paragraphs();
      if (cursorVersion !== b.version) {
        cursorVersion = b.version;
        cursor = 0;
      }
      const texts: string[] = [];
      while (cursor < paras.length && texts.length < 50 && dl.timeRemaining() > 1) {
        const t = paras[cursor++]!.text;
        if (t && !session.has(t)) texts.push(t);
      }
      session.wantLater(texts);
      if (!texts.length && cursor < paras.length) idleCheck();
    }) as unknown as number;
  };

  const decorations = (story: string | null, para: DecorationPara): Decoration[] | null => {
    if (!ctx || !para.text) return null;
    const key = `${story ?? ''}|${para.id}`;
    let wait = false;
    const sel = ctx.selection();
    if (story === sel.story) {
      const at = sel.from;
      if (at >= para.start && at <= para.start + para.text.length) {
        const now = performance.now();
        if (!caret || caret.key !== key) caret = { key, text: para.text, at: 0 };
        else if (caret.text !== para.text) caret = { key, text: para.text, at: now };
        const left = caret.at + SPELL_PAUSE_MS - now;
        if (left > 0) {
          wait = true;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            ctx?.redraw();
          }, left + 5);
        }
      }
    }
    visible.add(para.text);
    if (!wait) wanted.push(para.text);
    let issues: readonly SpellIssue[] | undefined = session.issuesFor(para.text);
    const last = shown.get(key);
    if (issues) {
      if (!last || last.text !== para.text || last.issues !== issues) shown.set(key, { text: para.text, issues });
    } else if (last) {
      issues = carryIssues(last.text, para.text, last.issues);
      shown.set(key, { text: para.text, issues });
    }
    if (shown.size > 20000) shown.clear();
    if (!issues?.length) return null;
    return issues.map((i) => ({ from: para.start + i.from, to: para.start + i.to, kind: `spell-${i.kind}`, data: i }));
  };

  /** 자리의 오류 (문단, 오류) */
  const issueAt = (at: StoryPos) => {
    if (!ctx) return null;
    const doc = ctx.doc();
    const para = doc.paragraphs()[doc.paragraphIndexAt(at.offset)];
    if (!para) return null;
    const rel = at.offset - para.start;
    const issue = (session.issuesFor(para.text) ?? []).find((i) => i.from <= rel && rel <= i.to);
    return issue ? { para, issue } : null;
  };

  const menuFor = (at: StoryPos, select: boolean): SpellMenu | null => {
    const hit = issueAt(at);
    if (!hit || !ctx) return null;
    const { para, issue } = hit;
    const from = para.start + issue.from;
    const to = para.start + issue.to;
    const text = para.text;
    const word = Array.from(text).slice(issue.from, issue.to).join('');
    const story = at.story;
    // 그 낱말을 선택해 둔다 (Word와 같다)
    if (select) ctx.select(from, to);
    return {
      word,
      kind: issue.kind,
      message: issue.message,
      suggestions: issue.suggestions,
      apply: (value: string) => {
        const c = ctx;
        if (!c || !c.canEdit() || c.story() !== story) return false;
        let count = 0;
        c.editDocument(
          (document) => {
            const r = replaceMatches(document, [{ story, from, to }], (t) => (t === text ? [[issue.from, issue.to]] : []), null, value);
            count = r.count;
            return r.ops;
          },
          { select: [from + Array.from(value).length, from + Array.from(value).length] },
        );
        return count > 0;
      },
      ignore: () => session.ignore(word),
      addWord: () => session.addWord(word),
    };
  };

  const plugin: SpellPlugin = {
    name: 'spell',
    session,
    menuAt(clientX, clientY, select = false) {
      const at = ctx?.hitTest(clientX, clientY);
      return at ? menuFor(at, select) : null;
    },
    decorations: () => ({ decorationsIn: decorations }),
    contextMenu(c, at) {
      const m = menuFor(at, true);
      if (!m) return [];
      const items: MenuItem[] = m.suggestions.slice(0, 5).map((s) => ({ label: s, run: () => void m.apply(s) }));
      if (!items.length) items.push({ label: c.t('spell.noSuggestions'), run: () => {}, disabled: true });
      items.push({ label: c.t('spell.ignore'), run: () => m.ignore(), separator: true }, { label: c.t('spell.addWord'), run: () => m.addWord() });
      return items;
    },
    commands: {
      ignore: (c, word) => (session.ignore(String(word)), c.redraw(), true),
    },
    init(c) {
      ctx = c;
      const offBefore = c.on('beforeRender', () => visible.clear());
      const offAfter = c.on('afterRender', () => {
        session.want(wanted);
        wanted = [];
        idleCheck();
      });
      return () => {
        offBefore();
        offAfter();
        session.dispose();
        if (timer) clearTimeout(timer);
        if (idle !== null) (window.cancelIdleCallback ?? clearTimeout)(idle);
        ctx = null;
      };
    },
  };
  return plugin;
}
