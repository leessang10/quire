/**
 * 찾기 막대 (15 §3.1): Ctrl+F 찾기, Ctrl+H 바꾸기. 편집기 위 오른쪽에 뜬다.
 * Enter 다음, Shift+Enter 앞, Esc 닫기. 결과는 편집기가 칠한다.
 */
import type { Editor, FindStatus } from '@quiredoc/editor';

export class FindBar {
  readonly el: HTMLElement;
  private readonly query: HTMLInputElement;
  private readonly repl: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly replRow: HTMLElement;
  private readonly opts = { caseSensitive: false, wholeWord: false, regex: false };

  constructor(
    private readonly editor: () => Editor,
    host: HTMLElement,
  ) {
    const el = document.createElement('div');
    el.className = 'find-bar';
    el.hidden = true;
    el.setAttribute('role', 'search');
    el.innerHTML = `
      <div class="find-row">
        <input class="find-q" type="search" placeholder="찾기" aria-label="찾을 글" spellcheck="false" />
        <button data-opt="caseSensitive" aria-pressed="false" title="대소문자 구분">Aa</button>
        <button data-opt="wholeWord" aria-pressed="false" title="낱말 단위 (앞뒤가 글자·숫자가 아닐 때만)">낱말</button>
        <button data-opt="regex" aria-pressed="false" title="정규식 ($1 등으로 바꾸기)">.*</button>
        <span class="find-count" aria-live="polite"></span>
        <button data-go="-1" title="앞 결과 (Shift+Enter, Shift+F3)" aria-label="앞 결과">↑</button>
        <button data-go="1" title="다음 결과 (Enter, F3)" aria-label="다음 결과">↓</button>
        <button data-close title="닫기 (Esc)" aria-label="찾기 닫기">×</button>
      </div>
      <div class="find-row find-repl" hidden>
        <input class="find-r" type="text" placeholder="바꿀 글" aria-label="바꿀 글" spellcheck="false" />
        <button data-replace title="지금 결과를 바꾸고 다음으로 (선택돼 있지 않으면 먼저 그리로 간다)">바꾸기</button>
        <button data-replace-all title="모두 바꾸기 (실행 취소 한 번)">모두 바꾸기</button>
      </div>`;
    host.appendChild(el);
    this.el = el;
    this.query = el.querySelector('.find-q')!;
    this.repl = el.querySelector('.find-r')!;
    this.count = el.querySelector('.find-count')!;
    this.replRow = el.querySelector('.find-repl')!;

    this.query.addEventListener('input', () => this.search());
    this.query.addEventListener('keydown', (e) => this.onKey(e, () => this.go(e.shiftKey ? -1 : 1)));
    this.repl.addEventListener('keydown', (e) => this.onKey(e, () => this.replace()));
    el.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.opt as keyof FindBar['opts'];
        this.opts[k] = !this.opts[k];
        b.setAttribute('aria-pressed', String(this.opts[k]));
        this.search();
      }),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => b.addEventListener('click', () => this.go(Number(b.dataset.go) as 1 | -1)));
    el.querySelector('[data-close]')!.addEventListener('click', () => this.close());
    el.querySelector('[data-replace]')!.addEventListener('click', () => this.replace());
    el.querySelector('[data-replace-all]')!.addEventListener('click', () => {
      const n = this.editor().replaceAll(this.repl.value);
      this.show(this.editor().findStatus(), `${n}개 바꿈`);
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** 연다 (replace면 바꾸기 줄까지). 선택한 글이 한 줄이면 그것으로 찾는다 */
  open(replace: boolean): void {
    this.el.hidden = false;
    this.replRow.hidden = !replace && this.replRow.hidden;
    if (replace) this.replRow.hidden = false;
    const sel = this.editor().selectedText();
    if (sel && !sel.includes('\n') && sel.length < 200) this.query.value = sel;
    this.query.focus();
    this.query.select();
    this.search();
  }

  close(): void {
    this.el.hidden = true;
    this.editor().clearFind();
    this.editor().focus();
  }

  /** 편집기가 바뀌면 (입력, 원격 변경) 결과 수를 다시 보인다 */
  update(): void {
    if (this.isOpen) this.show(this.editor().findStatus());
  }

  private onKey(e: KeyboardEvent, enter: () => void): void {
    if (e.key === 'Enter') {
      enter();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.close();
      e.preventDefault();
    } else if (e.key === 'F3') {
      this.go(e.shiftKey ? -1 : 1);
      e.preventDefault();
    }
  }

  private search(): void {
    if (!this.query.value) {
      this.editor().clearFind();
      this.show(null);
      return;
    }
    this.show(this.editor().find({ text: this.query.value, ...this.opts }));
  }

  private go(dir: 1 | -1): void {
    this.show(this.editor().findNext(dir));
  }

  private replace(): void {
    this.editor().replace(this.repl.value);
    this.show(this.editor().findStatus());
  }

  private show(s: FindStatus | null, note?: string): void {
    this.query.classList.toggle('bad', !!s?.error && !!this.query.value);
    if (!s || !this.query.value) this.count.textContent = '';
    else if (s.error) this.count.textContent = '잘못된 식';
    else if (!s.count) this.count.textContent = '결과 없음';
    else this.count.textContent = `${s.current >= 0 ? s.current + 1 : '–'} / ${s.count}${s.truncated ? '+' : ''}`;
    if (note) this.count.textContent += ` · ${note}`;
  }
}
