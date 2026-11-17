/**
 * 입력 층 경로 A: EditContext (03 §2–4). EditContext를 지원하는 브라우저(Chromium 121+)에서 쓴다.
 *
 * 숨긴 textarea(경로 B)와 같은 InputIntent를 낸다. 편집기는 어느 경로인지 모른다.
 *
 * 동작
 * - 보이지 않는 div에 EditContext를 붙이고 캐럿 위치에 둔다. 후보 창 위치는 updateSelectionBounds·
 *   updateCharacterBounds로 알린다 (textarea처럼 요소 위치에 기대지 않음).
 * - EditContext의 텍스트 버퍼는 조합 중이 아닐 때 비운다 (경로 B의 textarea와 같음). 버퍼 = 이번 조합·입력분이므로
 *   위치 변환이 필요 없다. 주변 텍스트를 IME에 주지는 않는다 (아래 한계).
 * - textupdate: 조합 중이면 조합 범위의 글자를 preedit로(문서에 넣지 않음), 아니면 insertText.
 * - compositionstart/end는 EditContext에서 온다. 확정 글자는 마지막 preedit(또는 이벤트 data)다.
 * - Enter·Tab은 textupdate가 오지 않으므로 keydown에서 처리한다. 조합 중 Enter(key가 'Process'일 수 있어 code로
 *   본다)는 조합 확정 뒤에 문단을 나눈다.
 * - Backspace·Delete·방향키 등은 keydown → 'key' 의도로 편집기가 처리하고 preventDefault한다 (EditContext가
 *   버퍼를 따로 지우지 않게).
 *
 * 한계: 주변 텍스트가 없어 IME의 재변환·문맥 예측은 쓰지 못한다. 글자별 경계는 모두 캐럿 사각형으로 알린다.
 */
import type { InputBackend, InputIntent, InputLogEntry } from './input';

/** EditContext에서 쓰는 부분 (DOM 타입이 없는 환경·시험용) */
export interface EditContextLike extends EventTarget {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  updateText(start: number, end: number, text: string): void;
  updateSelection(start: number, end: number): void;
  updateControlBounds(rect: DOMRect): void;
  updateSelectionBounds(rect: DOMRect): void;
  updateCharacterBounds(start: number, rects: DOMRect[]): void;
}

interface TextUpdateLike extends Event {
  updateRangeStart: number;
  updateRangeEnd: number;
  text?: string;
  updateText?: string;
  selectionStart: number;
  selectionEnd: number;
}

interface CharacterBoundsLike extends Event {
  rangeStart: number;
  rangeEnd: number;
}

export interface EditContextDeps {
  /** 기본: window.EditContext */
  EditContext?: new () => EditContextLike;
  /** 기본: document.createElement('div') */
  createElement?: () => HTMLElement;
  /** 기본: DOMRect */
  rect?: (x: number, y: number, w: number, h: number) => DOMRect;
}

export function editContextSupported(): boolean {
  return typeof globalThis !== 'undefined' && 'EditContext' in globalThis;
}

export class EditContextInput implements InputBackend {
  readonly kind = 'editcontext' as const;
  readonly el: HTMLElement;
  readonly ec: EditContextLike;
  composing = false;
  private pendingParagraph = false;
  /** 조합 시작 때 버퍼 위치와 길이: preedit = 조합 범위의 글자 */
  private compStart = 0;
  private baseLen = 0;
  private preedit = '';
  private caret: { left: number; top: number; height: number } = { left: 0, top: 0, height: 20 };
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private disposers: Array<() => void> = [];
  private readonly rect: (x: number, y: number, w: number, h: number) => DOMRect;

  constructor(
    parent: HTMLElement,
    private readonly onIntent: (intent: InputIntent) => void,
    private readonly onLog?: (entry: InputLogEntry) => void,
    deps: EditContextDeps = {},
  ) {
    const Ctor = deps.EditContext ?? (globalThis as unknown as { EditContext: new () => EditContextLike }).EditContext;
    this.rect = deps.rect ?? ((x, y, w, h) => new DOMRect(x, y, w, h));
    const el = deps.createElement ? deps.createElement() : document.createElement('div');
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-label', '문서 편집 영역');
    el.setAttribute('aria-multiline', 'true');
    el.tabIndex = 0;
    Object.assign(el.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: '2px',
      height: '20px',
      outline: 'none',
      opacity: '0',
      overflow: 'hidden',
      caretColor: 'transparent',
      zIndex: '-1',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(el);
    this.el = el;
    this.ec = new Ctor();
    (el as unknown as { editContext: EditContextLike | null }).editContext = this.ec;

    this.on(el, 'keydown', (ev) => {
      const e = ev as KeyboardEvent;
      this.log('keydown', `key=${e.key} code=${e.code} keyCode=${e.keyCode} isComposing=${e.isComposing}`);
      const enter = e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter';
      if (e.isComposing || e.keyCode === 229 || this.composing) {
        // 조합 중 Enter: IME가 확정한 뒤 문단을 나눈다
        if (enter) this.pendingParagraph = true;
        return;
      }
      if (enter && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.onIntent({ kind: 'insertParagraph' });
        return;
      }
      this.onIntent({ kind: 'key', event: e });
    });

    this.on(this.ec, 'textupdate', (ev) => {
      const e = ev as TextUpdateLike;
      const text = e.text ?? e.updateText ?? '';
      this.log('textupdate', `range=${e.updateRangeStart}-${e.updateRangeEnd} text=${fmt(text)} sel=${e.selectionStart} buffer=${fmt(this.ec.text)} composing=${this.composing}`);
      if (this.composing) {
        const len = this.ec.text.length - this.baseLen;
        this.preedit = this.ec.text.slice(this.compStart, this.compStart + Math.max(0, len));
        this.onIntent({ kind: 'compositionUpdate', text: this.preedit });
        return;
      }
      if (text) this.onIntent({ kind: 'insertText', text: text.replace(/\r\n?/g, '\n') });
      this.clearSoon();
    });

    this.on(this.ec, 'compositionstart', (ev) => {
      this.log('compositionstart', `data=${fmt((ev as CompositionEvent).data)} buffer=${fmt(this.ec.text)}`);
      if (this.clearTimer !== null) {
        clearTimeout(this.clearTimer);
        this.clearTimer = null;
      }
      this.composing = true;
      this.compStart = Math.min(this.ec.selectionStart, this.ec.selectionEnd);
      this.baseLen = this.ec.text.length - Math.abs(this.ec.selectionEnd - this.ec.selectionStart);
      this.preedit = '';
      this.onIntent({ kind: 'compositionStart' });
    });

    this.on(this.ec, 'compositionend', (ev) => {
      const data = (ev as CompositionEvent).data;
      this.log('compositionend', `data=${fmt(data)} preedit=${fmt(this.preedit)}`);
      if (!this.composing) return;
      this.composing = false;
      const text = data || this.preedit;
      this.preedit = '';
      this.onIntent({ kind: 'compositionEnd', text });
      if (this.pendingParagraph) {
        this.pendingParagraph = false;
        this.onIntent({ kind: 'insertParagraph' });
      }
      this.clearSoon();
    });

    this.on(this.ec, 'characterboundsupdate', (ev) => {
      const e = ev as CharacterBoundsLike;
      const n = Math.max(0, e.rangeEnd - e.rangeStart);
      const r = this.caretRect();
      this.ec.updateCharacterBounds(e.rangeStart, Array.from({ length: n }, () => r));
    });

    this.on(el, 'copy', (e) => this.onIntent({ kind: 'copy', event: e as ClipboardEvent }));
    this.on(el, 'cut', (e) => this.onIntent({ kind: 'cut', event: e as ClipboardEvent }));
    this.on(el, 'paste', (ev) => {
      const e = ev as ClipboardEvent;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      this.log('paste', `text=${fmt(text.slice(0, 40))}`);
      if (text) this.onIntent({ kind: 'paste', text });
    });
  }

  focus(): void {
    this.el.focus({ preventScroll: true });
  }

  commitComposition(): void {
    if (!this.composing) return;
    // 포커스를 잃으면 IME가 조합을 끝낸다 (compositionend)
    this.el.blur();
    if (this.composing) {
      this.composing = false;
      const text = this.preedit;
      this.preedit = '';
      this.onIntent({ kind: 'compositionEnd', text });
    }
    this.reset();
    this.focus();
  }

  place(left: number, top: number, height: number): void {
    this.caret = { left, top, height };
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.height = `${height}px`;
    const r = this.caretRect();
    this.ec.updateSelectionBounds(r);
    const parent = this.el.parentElement;
    if (parent) {
      const p = parent.getBoundingClientRect();
      this.ec.updateControlBounds(this.rect(p.left, p.top, p.width, p.height));
    }
  }

  destroy(): void {
    if (this.clearTimer !== null) clearTimeout(this.clearTimer);
    for (const d of this.disposers) d();
    (this.el as unknown as { editContext: EditContextLike | null }).editContext = null;
    this.el.remove();
  }

  /** 캐럿 사각형 (뷰포트 좌표) */
  private caretRect(): DOMRect {
    const b = this.el.getBoundingClientRect();
    return this.rect(b.left, b.top, Math.max(1, b.width), b.height || this.caret.height);
  }

  private reset(): void {
    if (this.ec.text.length > 0) this.ec.updateText(0, this.ec.text.length, '');
    this.ec.updateSelection(0, 0);
  }

  /** 조합 중이 아니면 버퍼를 비운다. 한글은 음절마다 조합이 끝나고 바로 다시 시작하므로 한 박자 늦춘다 */
  private clearSoon(): void {
    if (this.clearTimer !== null) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      this.clearTimer = null;
      if (!this.composing) this.reset();
    }, 0);
  }

  private on(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.disposers.push(() => target.removeEventListener(type, fn));
  }

  private log(type: string, detail: string): void {
    this.onLog?.({ time: performance.now(), type, detail });
  }
}

function fmt(s: string | null | undefined): string {
  return s == null ? 'null' : JSON.stringify(s);
}
