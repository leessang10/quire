/**
 * 맞춤법 검사 데모 (15 §4): 자주 틀리는 한국어 표기 몇 개를 찾는 작은 검사기와 오른쪽 클릭 메뉴.
 * 실제 한국어 검사기는 앱이 끼운다 (O-36). 영어 낱말은 WordListChecker로 작은 목록만 본다.
 */
import { WordListChecker, type Editor, type MenuItem, type SpellChecker, type SpellIssue, type SpellMenu } from '@quiredoc/editor';

/** 틀린 표기 → 고칠 말 (낱말 경계와 상관없이 찾는다: 활용형 앞부분이 같다) */
const MISTAKES: Array<[string, string[], SpellIssue['kind'], string?]> = [
  ['되요', ['돼요'], 'spelling', '‘되어요’의 준말은 ‘돼요’'],
  ['됬', ['됐'], 'spelling', '‘되었’의 준말은 ‘됐’'],
  ['안되', ['안 되'], 'spacing', '‘안’은 부사라 띄어 쓴다'],
  ['않되', ['안 되'], 'spelling'],
  ['몇일', ['며칠'], 'spelling'],
  ['어떻해', ['어떡해', '어떻게 해'], 'spelling'],
  ['왠만', ['웬만'], 'spelling'],
  ['금새', ['금세'], 'spelling', '‘금시에’의 준말'],
  ['할께', ['할게'], 'spelling'],
  ['설겆이', ['설거지'], 'spelling'],
  ['오랫만', ['오랜만'], 'spelling'],
  ['희안', ['희한'], 'spelling'],
  ['역활', ['역할'], 'spelling'],
  ['바램', ['바람'], 'spelling', '‘바라다’의 명사형'],
  ['문안하', ['무난하'], 'spelling'],
  ['할수', ['할 수'], 'spacing', '의존 명사 ‘수’는 띄어 쓴다'],
  ['것같', ['것 같'], 'spacing'],
];

const ENGLISH = new WordListChecker(
  `a an the and or but of to in on at for with by from as is are was were be been it this that these those i you he she we they
  not no yes if then than so do does did have has had will would can could should may might must about into over under after before
  editor document page pages text word words paragraph table cell image font fonts layout canvas print find replace spell check
  quire korean english sample test hello world report reports quick brown fox jumps lazy dog
  fix contenteditable textarea enter ctrl shift alt tab esc emoji prototype markdown html pdf docx hwpx`.split(/\s+/),
);

/** 데모 검사기: 한글 표기 규칙 + 영어 작은 낱말 목록. 검사에 시간이 걸리는 척한다 (비동기 일정 확인용) */
export class DemoChecker implements SpellChecker {
  private readonly added = new Set<string>();

  async check(text: string, lang: string, signal: AbortSignal): Promise<SpellIssue[]> {
    await new Promise((r) => setTimeout(r, 30));
    if (signal.aborted) throw signal.reason;
    const cps = Array.from(text);
    const joined = cps.join('');
    const out: SpellIssue[] = [];
    for (const [wrong, fix, kind, message] of MISTAKES) {
      let i = joined.indexOf(wrong);
      while (i >= 0) {
        // UTF-16 → 코드포인트 (한글은 BMP라 대개 같다)
        const from = Array.from(joined.slice(0, i)).length;
        const to = from + Array.from(wrong).length;
        if (!this.added.has(wrong)) out.push({ from, to, kind, message, suggestions: fix });
        i = joined.indexOf(wrong, i + wrong.length);
      }
    }
    for (const e of await ENGLISH.check(text, lang, signal)) {
      const w = cps.slice(e.from, e.to).join('');
      if (/^[A-Za-z']+$/.test(w) && !this.added.has(w.toLowerCase())) out.push(e);
    }
    return out.sort((a, b) => a.from - b.from);
  }

  addWord(word: string): void {
    this.added.add(word.toLowerCase());
    ENGLISH.addWord(word.toLowerCase());
  }
}

/** 오른쪽 클릭 메뉴 (맞춤법 오류 위에서만, 아니면 브라우저 메뉴) */
export class SpellContextMenu {
  readonly el: HTMLElement;
  private readonly onDown = (e: Event) => {
    if (!this.el.contains(e.target as Node)) this.close();
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.close();
      this.editor().focus();
    }
  };

  constructor(private readonly editor: () => Editor) {
    this.el = document.createElement('div');
    this.el.className = 'ctx-menu';
    this.el.setAttribute('role', 'menu');
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  /** onContextMenu에서 부른다. 메뉴를 열었으면 true */
  open(e: MouseEvent, spell: SpellMenu | null, extra: MenuItem[] = []): boolean {
    this.close();
    if (!spell && !extra.length) return false;
    const items: Array<[string, () => void, string?]> = [];
    if (spell) {
      for (const s of spell.suggestions) items.push([s, () => spell.apply(s), 'fix']);
      if (!spell.suggestions.length) items.push(['고칠 말 없음', () => {}, 'none']);
      items.push(['모두 무시', () => spell.ignore()]);
      items.push(['사전에 더하기', () => spell.addWord()]);
    }
    // 플러그인 항목 (15 §7)
    for (const it of extra) items.push([it.label, it.run, it.disabled ? 'none' : undefined]);
    this.el.replaceChildren();
    if (spell) {
      const head = document.createElement('div');
      head.className = 'ctx-head';
      head.textContent = spell.message ?? (spell.kind === 'spacing' ? '띄어쓰기' : spell.kind === 'grammar' ? '문법' : '맞춤법');
      this.el.append(head);
    }
    for (const [label, run, cls] of items) {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.textContent = label;
      if (cls) b.className = cls;
      b.disabled = cls === 'none';
      b.addEventListener('click', () => {
        this.close();
        run();
        this.editor().focus();
      });
      this.el.append(b);
    }
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.min(e.clientX, innerWidth - r.width - 4)}px`;
    this.el.style.top = `${Math.min(e.clientY, innerHeight - r.height - 4)}px`;
    (this.el.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus();
    document.addEventListener('mousedown', this.onDown, true);
    document.addEventListener('keydown', this.onKey, true);
    return true;
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    document.removeEventListener('mousedown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
  }
}
