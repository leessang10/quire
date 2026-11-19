/**
 * 댓글 창 (14 §3.2): 편집기 밖의 DOM. 범위가 있는 열린 스레드는 범위 시작의 y(문서 y - 스크롤)에 맞추어 놓고 겹치면 아래로 민다.
 * 해결한 스레드와 고아 스레드(글이 지워짐)는 아래 목록에 모은다. 캐럿이 댓글 범위에 들어가면 그 스레드를 고른다.
 */
import type { Editor, ThreadView } from '@quire/editor';

const GAP = 8;

const fmtTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class CommentsPane {
  private readonly track: HTMLElement;
  private readonly rest: HTMLElement;
  private readonly restList: HTMLElement;
  private readonly countEl: HTMLElement;
  private cards = new Map<string, HTMLElement>();
  private views: ThreadView[] = [];
  /** 데이터가 바뀌었을 때만 다시 만든다 (쓰는 중인 답글을 지키려고) */
  private key = '';
  /** 쓰다 만 글 (스레드·메시지별) */
  private drafts = new Map<string, string>();
  /** 고치는 중인 메시지 "스레드|메시지" */
  private editing: string | null = null;
  /** 새 댓글 쓰는 중: 선택 범위의 y */
  private composer: { y: number } | null = null;
  private focused: string | null = null;
  private lastCaretThread: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly editor: Editor,
  ) {
    root.replaceChildren();
    const head = el('div', 'cm-head');
    head.append(el('h2', undefined, '댓글'));
    this.countEl = el('span', 'cm-count');
    head.append(this.countEl);
    const add = el('button', undefined, '댓글 달기');
    add.title = '선택 범위에 댓글을 단다 (Ctrl+Alt+M)';
    add.addEventListener('click', () => this.openComposer());
    head.append(add);
    this.track = el('div', 'cm-track');
    this.rest = el('details', 'cm-rest');
    const sum = el('summary', undefined, '해결함 · 글이 지워진 댓글');
    this.rest.append(sum);
    this.restList = el('div', 'cm-rest-list');
    this.rest.append(this.restList);
    root.append(head, this.track, this.rest);
    editor.scrollElement.addEventListener('scroll', () => this.place(), { passive: true });
    new ResizeObserver(() => this.place()).observe(this.track);
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.altKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        this.openComposer();
      }
    });
    this.update();
  }

  /** 편집기가 바뀌었을 때 (onChange) */
  update(): void {
    this.views = this.editor.threads();
    // 캐럿이 댓글 범위에 들어가면 그 스레드를 고른다 (Google Docs처럼)
    const at = this.editor.threadsAtCaret()[0] ?? null;
    if (at !== this.lastCaretThread) {
      this.lastCaretThread = at;
      if (at) this.setFocus(at, false);
    }
    const key = JSON.stringify(this.views.map((v) => [v.id, v.resolved, v.orphan, v.messages])) + (this.composer ? 'c' : '') + this.editing;
    if (key !== this.key) {
      this.key = key;
      this.build();
    }
    this.place();
  }

  private open(v: ThreadView): boolean {
    return !v.resolved && !v.orphan && v.y !== null;
  }

  private build(): void {
    const keepFocus = document.activeElement instanceof HTMLTextAreaElement && this.root.contains(document.activeElement) ? (document.activeElement.dataset.draft ?? null) : null;
    this.cards.clear();
    this.track.replaceChildren();
    this.restList.replaceChildren();
    const open = this.views.filter((v) => this.open(v));
    const rest = this.views.filter((v) => !this.open(v));
    this.countEl.textContent = this.views.length ? `${open.length}개 열림` : '';
    if (this.composer) this.track.append(this.composerCard());
    for (const v of open) {
      const c = this.card(v);
      this.cards.set(v.id, c);
      this.track.append(c);
    }
    for (const v of rest) this.restList.append(this.card(v));
    this.rest.hidden = rest.length === 0;
    if (keepFocus) {
      const t = this.root.querySelector<HTMLTextAreaElement>(`textarea[data-draft="${CSS.escape(keepFocus)}"]`);
      if (t) {
        t.focus();
        t.setSelectionRange(t.value.length, t.value.length);
      }
    }
  }

  /** 범위 y에 맞추어 놓기: 겹치면 아래로 민다. 고른 스레드는 제자리에 두고 위 카드를 위로 민다 */
  private place(): void {
    const top = this.editor.scrollElement.scrollTop;
    const items: Array<{ e: HTMLElement; y: number; id: string }> = [];
    if (this.composer) {
      const e = this.track.querySelector<HTMLElement>('.cm-composer');
      if (e) items.push({ e, y: this.composer.y - top, id: '' });
    }
    for (const v of this.views) {
      const e = this.cards.get(v.id);
      if (e && v.y !== null) items.push({ e, y: v.y - top, id: v.id });
    }
    items.sort((a, b) => a.y - b.y);
    const ys = items.map((it) => it.y);
    const hs = items.map((it) => it.e.offsetHeight);
    const pin = items.findIndex((it) => it.id === this.focused || (it.id === '' && !!this.composer));
    // 고른 것부터 아래로, 위로 민다
    const start = pin >= 0 ? pin : 0;
    for (let i = start + 1; i < items.length; i++) ys[i] = Math.max(ys[i]!, ys[i - 1]! + hs[i - 1]! + GAP);
    for (let i = start - 1; i >= 0; i--) ys[i] = Math.min(ys[i]!, ys[i + 1]! - hs[i]! - GAP);
    items.forEach((it, i) => {
      it.e.style.transform = `translateY(${Math.round(ys[i]!)}px)`;
    });
  }

  private setFocus(id: string | null, reveal: boolean): void {
    this.focused = id;
    for (const [k, c] of this.cards) c.classList.toggle('is-focus', k === id);
    for (const c of this.restList.children) (c as HTMLElement).classList.toggle('is-focus', (c as HTMLElement).dataset.thread === id);
    if (id && reveal) this.editor.revealThread(id);
    else this.editor.focusThread(id);
    this.place();
  }

  private openComposer(): void {
    const sel = this.editor.selection();
    if (sel.anchor === sel.head) {
      this.flash('먼저 댓글을 달 글을 선택하세요');
      return;
    }
    this.composer = { y: this.editor.selectionY() ?? this.editor.scrollElement.scrollTop + 40 };
    this.focused = null;
    this.key = '';
    this.update();
    this.root.querySelector<HTMLTextAreaElement>('textarea[data-draft="new"]')?.focus();
  }

  private flash(msg: string): void {
    this.countEl.textContent = msg;
    setTimeout(() => this.update(), 1600);
  }

  private textarea(draft: string, placeholder: string, submit: (text: string) => void): HTMLTextAreaElement {
    const t = el('textarea');
    t.rows = 2;
    t.placeholder = placeholder;
    t.dataset.draft = draft;
    t.value = this.drafts.get(draft) ?? '';
    t.addEventListener('input', () => this.drafts.set(draft, t.value));
    t.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (t.value.trim()) {
          this.drafts.delete(draft);
          submit(t.value);
        }
      } else if (e.key === 'Escape') {
        this.drafts.delete(draft);
        if (draft === 'new') this.composer = null;
        if (draft.startsWith('edit:')) this.editing = null;
        this.key = '';
        this.update();
        this.editor.focus();
      }
    });
    return t;
  }

  private composerCard(): HTMLElement {
    const c = el('div', 'cm-card cm-composer is-focus');
    const t = this.textarea('new', '댓글 (Ctrl+Enter 달기, Esc 취소)', (text) => this.submitNew(text));
    const row = el('div', 'cm-actions');
    const ok = el('button', 'primary', '달기');
    ok.addEventListener('click', () => this.submitNew(t.value));
    const no = el('button', undefined, '취소');
    no.addEventListener('click', () => {
      this.composer = null;
      this.drafts.delete('new');
      this.key = '';
      this.update();
    });
    row.append(ok, no);
    c.append(t, row);
    return c;
  }

  private submitNew(text: string): void {
    if (!text.trim()) return;
    const id = this.editor.addComment(text);
    this.composer = null;
    this.drafts.delete('new');
    if (id) this.focused = id;
    this.key = '';
    this.update();
  }

  private card(v: ThreadView): HTMLElement {
    const c = el('article', 'cm-card');
    c.dataset.thread = v.id;
    c.classList.toggle('is-focus', v.id === this.focused);
    c.classList.toggle('is-resolved', v.resolved);
    c.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button, textarea')) return;
      this.setFocus(v.id, true);
    });
    if (v.orphan) c.append(el('div', 'cm-note', '글이 지워진 곳에 단 댓글'));
    else if (v.resolved) c.append(el('div', 'cm-note', '해결함'));
    v.messages.forEach((m, i) => {
      const box = el('div', 'cm-msg');
      const meta = el('div', 'cm-meta');
      const dot = el('span', 'cm-dot');
      dot.style.background = m.author.color;
      meta.append(dot, el('b', undefined, m.author.name), el('time', undefined, fmtTime(m.time) + (m.edited ? ' (고침)' : '')));
      box.append(meta);
      const ek = `edit:${v.id}|${m.id}`;
      if (this.editing === `${v.id}|${m.id}`) {
        if (!this.drafts.has(ek)) this.drafts.set(ek, m.text);
        box.append(
          this.textarea(ek, '고칠 글 (Ctrl+Enter)', (text) => {
            this.editing = null;
            this.editor.editComment(v.id, m.id, text);
          }),
        );
      } else box.append(el('p', m.deleted ? 'cm-text is-deleted' : 'cm-text', m.deleted ? '지운 메시지' : m.text));
      if (!m.deleted && !v.orphan) {
        const tools = el('div', 'cm-msg-tools');
        const ed = el('button', undefined, '고치기');
        ed.addEventListener('click', () => {
          this.editing = `${v.id}|${m.id}`;
          this.key = '';
          this.update();
          this.root.querySelector<HTMLTextAreaElement>(`textarea[data-draft="${CSS.escape(ek)}"]`)?.focus();
        });
        const del = el('button', undefined, i === 0 ? '스레드 지우기' : '지우기');
        del.addEventListener('click', () => this.editor.deleteComment(v.id, m.id));
        tools.append(ed, del);
        box.append(tools);
      }
      c.append(box);
    });
    const row = el('div', 'cm-actions');
    if (!v.orphan && !v.resolved) {
      c.append(this.textarea(`reply:${v.id}`, '답글 (Ctrl+Enter)', (text) => this.editor.replyComment(v.id, text)));
      const send = el('button', 'primary', '답글');
      send.addEventListener('click', () => {
        const t = c.querySelector<HTMLTextAreaElement>('textarea[data-draft^="reply:"]');
        if (t?.value.trim()) {
          this.drafts.delete(`reply:${v.id}`);
          this.editor.replyComment(v.id, t.value);
        }
      });
      row.append(send);
    }
    const res = el('button', undefined, v.resolved ? '다시 열기' : '해결');
    res.addEventListener('click', () => this.editor.resolveThread(v.id, !v.resolved));
    row.append(res);
    if (v.orphan) {
      const del = el('button', undefined, '지우기');
      del.addEventListener('click', () => this.editor.deleteThread(v.id));
      row.append(del);
    }
    c.append(row);
    return c;
  }
}
