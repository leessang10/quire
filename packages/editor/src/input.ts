/**
 * 입력 층 경로 B: 숨긴 textarea (03 §2–4)
 *
 * 브라우저 이벤트를 InputIntent로 정규화한다. 편집기는 브라우저 이벤트를 직접 보지 않는다.
 *
 * 한글 조합 처리 원칙
 * - 조합 중 문자열(preedit)은 문서에 넣지 않고 표시만 한다
 * - compositionend의 data로 한 번만 확정한다
 * - 조합 관련 input 이벤트(insertCompositionText 등)는 무시한다 → 브라우저별 순서 차이에 영향받지 않음
 * - Enter는 keydown이 아니라 beforeinput(insertParagraph/insertLineBreak)으로 처리한다
 *   → 조합 중 Enter를 누를 때 keydown 순서가 브라우저마다 달라 생기는 중복·유실을 피함
 * - textarea 값은 조합 중이 아닐 때만 비운다 (연속 음절 조합을 끊지 않기 위해)
 */

export type InputIntent =
  | { kind: 'insertText'; text: string }
  | { kind: 'insertParagraph' }
  /** 문서의 [from, to)(화면 오프셋)를 text로 (IME가 주변 텍스트를 고침: 자동 수정, 재변환) */
  | { kind: 'replaceText'; from: number; to: number; text: string }
  /** replace: 조합이 이 범위의 기존 글자를 가져가 시작한다 (한자 재변환 등). 없으면 선택 영역 */
  | { kind: 'compositionStart'; replace?: [number, number] }
  | { kind: 'compositionUpdate'; text: string }
  | { kind: 'compositionEnd'; text: string }
  | { kind: 'key'; event: KeyboardEvent }
  | { kind: 'copy'; event: ClipboardEvent }
  | { kind: 'cut'; event: ClipboardEvent }
  | { kind: 'paste'; text: string };

export interface InputLogEntry {
  time: number;
  type: string;
  detail: string;
}

/** 입력 층 (경로 A: EditContext, 경로 B: 숨긴 textarea). 편집기는 이것만 본다 */
export interface InputBackend {
  readonly kind: 'textarea' | 'editcontext';
  /** 포커스를 받는 요소 (focus·blur를 편집기가 듣는다) */
  readonly el: HTMLElement;
  readonly composing: boolean;
  focus(): void;
  /** 조합 중이면 강제로 확정시킨다 (클릭 등으로 캐럿을 옮기기 전) */
  commitComposition(): void;
  /** 캐럿 위치 (스크롤 영역 좌표): IME 후보 창 위치 */
  place(left: number, top: number, height: number): void;
  /**
   * 캐럿 주변 텍스트 (03 §2): text = 캐럿이 있는 문단, base = 그 문단 첫 글자의 화면 오프셋, anchor·head = 문단 안 코드포인트
   * 위치. IME의 재변환·문맥 처리에 쓴다. 조합 중에는 부르지 않는다.
   */
  sync?(text: string, base: number, anchor: number, head: number): void;
  destroy(): void;
}

export type InputMode = 'auto' | 'textarea' | 'editcontext';

export class TextareaInput implements InputBackend {
  readonly kind = 'textarea' as const;
  readonly el: HTMLTextAreaElement;
  composing = false;
  private pendingParagraph = false;
  private disposers: Array<() => void> = [];

  constructor(
    parent: HTMLElement,
    private readonly onIntent: (intent: InputIntent) => void,
    private readonly onLog?: (entry: InputLogEntry) => void,
  ) {
    const ta = document.createElement('textarea');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.spellcheck = false;
    ta.setAttribute('aria-label', '문서 편집 영역');
    ta.setAttribute('aria-multiline', 'true');
    Object.assign(ta.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: '2px',
      height: '20px',
      padding: '0',
      border: '0',
      margin: '0',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      whiteSpace: 'pre',
      opacity: '0',
      caretColor: 'transparent',
      background: 'transparent',
      color: 'transparent',
      zIndex: '-1',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(ta);
    this.el = ta;

    this.on('keydown', (e) => {
      this.log('keydown', `key=${e.key} code=${e.code} keyCode=${e.keyCode} isComposing=${e.isComposing}`);
      if (e.isComposing || e.keyCode === 229 || this.composing) return;
      this.onIntent({ kind: 'key', event: e });
    });

    this.on('beforeinput', (e) => {
      this.log('beforeinput', `inputType=${e.inputType} data=${fmt(e.data)} isComposing=${e.isComposing}`);
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
        e.preventDefault();
        // 조합이 아직 열려 있으면 확정 후에 적용 (브라우저마다 Enter와 compositionend 순서가 다름)
        if (this.composing) this.pendingParagraph = true;
        else this.onIntent({ kind: 'insertParagraph' });
        return;
      }
      if (e.inputType === 'insertText' && !e.isComposing && !this.composing) {
        e.preventDefault();
        if (e.data) this.onIntent({ kind: 'insertText', text: e.data });
      }
      // insertCompositionText, insertFromComposition, deleteCompositionText 등은 조합 이벤트로 처리
    });

    this.on('input', (e) => {
      const ie = e as InputEvent;
      this.log('input', `inputType=${ie.inputType} data=${fmt(ie.data)} isComposing=${ie.isComposing} value=${fmt(ta.value)}`);
      this.clearSoon();
    });

    this.on('compositionstart', (e) => {
      this.log('compositionstart', `data=${fmt(e.data)}`);
      this.composing = true;
      this.onIntent({ kind: 'compositionStart' });
    });

    this.on('compositionupdate', (e) => {
      this.log('compositionupdate', `data=${fmt(e.data)}`);
      this.onIntent({ kind: 'compositionUpdate', text: e.data ?? '' });
    });

    this.on('compositionend', (e) => {
      this.log('compositionend', `data=${fmt(e.data)}`);
      if (!this.composing) return;
      this.composing = false;
      this.onIntent({ kind: 'compositionEnd', text: e.data ?? '' });
      if (this.pendingParagraph) {
        this.pendingParagraph = false;
        this.onIntent({ kind: 'insertParagraph' });
      }
      this.clearSoon();
    });

    this.on('copy', (e) => this.onIntent({ kind: 'copy', event: e }));
    this.on('cut', (e) => this.onIntent({ kind: 'cut', event: e }));
    this.on('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      this.log('paste', `text=${fmt(text.slice(0, 40))}`);
      if (text) this.onIntent({ kind: 'paste', text });
    });
  }

  focus(): void {
    this.el.focus({ preventScroll: true });
  }

  /** 조합 중이면 강제로 확정시킨다 (클릭 등으로 캐럿을 옮기기 전) */
  commitComposition(): void {
    if (!this.composing) return;
    // 대부분의 브라우저는 blur 시 compositionend를 동기적으로 보낸다
    this.el.blur();
    if (this.composing) {
      // 보내지 않은 경우: 표시 중이던 preedit을 그대로 확정
      this.composing = false;
      this.onIntent({ kind: 'compositionEnd', text: '' });
    }
    this.el.value = '';
    this.focus();
  }

  /** IME 후보 창이 캐럿 근처에 뜨도록 위치시킨다 */
  place(left: number, top: number, height: number): void {
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.height = `${height}px`;
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.el.remove();
  }

  private clearSoon(): void {
    setTimeout(() => {
      if (!this.composing) this.el.value = '';
    }, 0);
  }

  private on<K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void): void {
    this.el.addEventListener(type, fn);
    this.disposers.push(() => this.el.removeEventListener(type, fn));
  }

  private log(type: string, detail: string): void {
    this.onLog?.({ time: performance.now(), type, detail });
  }
}

function fmt(s: string | null | undefined): string {
  return s == null ? 'null' : JSON.stringify(s);
}
