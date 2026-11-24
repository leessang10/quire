/**
 * 입력 층 경로 A: EditContext (03 §2–4). EditContext를 지원하는 브라우저(Chromium 121+)에서 쓴다.
 *
 * 숨긴 textarea(경로 B)와 같은 InputIntent를 낸다. 편집기는 어느 경로인지 모른다.
 *
 * 동작
 * - 보이지 않는 div에 EditContext를 붙이고 캐럿 위치에 둔다. 후보 창 위치는 updateSelectionBounds·
 *   updateCharacterBounds로 알린다 (textarea처럼 요소 위치에 기대지 않음).
 * - **버퍼 = 캐럿이 있는 문단** (주변 텍스트, sync). 편집기가 그릴 때마다 맞춘다(조합 중 제외). IME가 이미 확정된 글자를
 *   다시 고칠 수 있다: 한자 재변환(Windows 한국어 IME는 한자 키에 조합을 먼저 확정한 뒤, 확정된 글자를 다시 조합한다),
 *   자동 수정. 버퍼 위치(UTF-16)는 base(문단 첫 글자의 화면 오프셋) + 코드포인트 수로 문서 위치가 된다.
 * - textupdate
 *   - 조합 중이 아니면: 버퍼의 [start, end)를 text로 → replaceText (보통은 캐럿에 입력).
 *   - 조합의 첫 textupdate가 덮는 범위 = 조합이 가져가는 기존 글자(선택 영역, 재변환 대상) → compositionStart(replace).
 *     조합 중인 글자는 문서에 넣지 않고(preedit) compositionend에서 한 번 넣는다.
 * - Enter·Tab은 textupdate가 오지 않으므로 keydown에서 처리한다. 조합 중 Enter(key가 'Process'일 수 있어 code로
 *   본다)는 조합 확정 뒤에 문단을 나눈다. Windows 한국어 IME + Chromium은 같은 Enter를 확정 뒤 keydown으로 한 번 더
 *   보내므로(실제 IME로 확인), keyup 전에 오는 반복 아닌 Enter keydown은 버린다.
 * - Backspace·Delete·방향키 등은 keydown → 'key' 의도로 편집기가 처리하고 preventDefault한다 (EditContext가
 *   버퍼를 따로 지우지 않게).
 *
 * 한계: 버퍼는 문단 하나라 IME가 문단 밖을 볼 수 없다. 글자별 경계는 모두 캐럿 사각형으로 알린다.
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

/** s 앞 u16개 UTF-16 단위의 코드포인트 수 */
function cpCount(s: string, u16: number): number {
  let n = 0;
  for (let i = 0; i < u16 && i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < u16) i++;
    n++;
  }
  return n;
}

/** s의 코드포인트 cp개에 해당하는 UTF-16 길이 */
function u16Of(s: string, cp: number): number {
  let i = 0;
  for (let k = 0; k < cp && i < s.length; k++) {
    const c = s.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < s.length ? 2 : 1;
  }
  return i;
}

export class EditContextInput implements InputBackend {
  readonly kind = 'editcontext' as const;
  readonly el: HTMLElement;
  readonly ec: EditContextLike;
  composing = false;
  /** EditContext 버퍼의 사본 (textupdate가 바꾸기 전의 위치를 알기 위해) */
  private shadow = '';
  /** 버퍼 첫 글자의 화면 오프셋 */
  private base = 0;
  private pendingParagraph = false;
  /**
   * 조합 중 눌린 Enter가 아직 떼어지지 않았다 (keyup 전). Windows 한국어 IME + Chromium은 이 Enter를
   * keydown(Process, 229) → compositionend → keydown(Enter, 13)으로 두 번 보낸다. 두 번째는 같은 누름이므로 버린다.
   */
  private compositionEnterDown = false;
  /** 조합: 시작 의도를 냈는가, 버퍼 안 조합 구간 [compStart, compEnd) (UTF-16) */
  private compStarted = false;
  private compStart = 0;
  private compEnd = 0;
  private preedit = '';
  private caret: { left: number; top: number; height: number } = { left: 0, top: 0, height: 20 };
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
        if (enter) {
          this.pendingParagraph = true;
          this.compositionEnterDown = true;
        }
        return;
      }
      if (enter && this.compositionEnterDown && !e.repeat) {
        // 조합을 확정한 그 Enter의 두 번째 keydown: 문단은 이미 나눴다
        this.compositionEnterDown = false;
        e.preventDefault();
        this.log('skip', 'Enter keydown after composition Enter');
        return;
      }
      this.compositionEnterDown = false;
      if (enter && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.onIntent({ kind: 'insertParagraph' });
        return;
      }
      this.onIntent({ kind: 'key', event: e });
    });
    this.on(el, 'keyup', (ev) => {
      const e = ev as KeyboardEvent;
      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') this.compositionEnterDown = false;
    });
    this.on(el, 'blur', () => {
      this.compositionEnterDown = false;
    });

    this.on(this.ec, 'textupdate', (ev) => {
      const e = ev as TextUpdateLike;
      const text = (e.text ?? e.updateText ?? '').replace(/\r\n?/g, '\n');
      const before = this.shadow;
      const s = Math.min(e.updateRangeStart, e.updateRangeEnd);
      const en = Math.max(e.updateRangeStart, e.updateRangeEnd);
      this.shadow = before.slice(0, s) + text + before.slice(en);
      this.log('textupdate', `range=${s}-${en} text=${fmt(text)} sel=${e.selectionStart} buffer=${fmt(this.ec.text)} composing=${this.composing}`);
      const from = this.base + cpCount(before, s);
      const to = this.base + cpCount(before, en);
      if (this.composing) {
        if (!this.compStarted) {
          // 조합이 가져가는 기존 글자(선택 영역, 재변환 대상)를 문서에서 빼고 조합을 시작한다
          this.compStarted = true;
          this.compStart = s;
          this.compEnd = s + text.length;
          this.onIntent({ kind: 'compositionStart', replace: [from, to] });
        } else {
          if (s < this.compStart) this.compStart = s;
          this.compEnd = en <= this.compEnd ? this.compEnd + text.length - (en - s) : s + text.length;
        }
        this.preedit = this.shadow.slice(this.compStart, this.compEnd);
        this.onIntent({ kind: 'compositionUpdate', text: this.preedit });
        return;
      }
      if (from === to && !text) return;
      this.onIntent({ kind: 'replaceText', from, to, text });
    });

    this.on(this.ec, 'compositionstart', (ev) => {
      this.log('compositionstart', `data=${fmt((ev as CompositionEvent).data)} buffer=${fmt(this.ec.text)}`);
      this.composing = true;
      this.compStarted = false;
      this.preedit = '';
    });

    this.on(this.ec, 'compositionend', (ev) => {
      const data = (ev as CompositionEvent).data;
      this.log('compositionend', `data=${fmt(data)} preedit=${fmt(this.preedit)}`);
      if (!this.composing) return;
      this.composing = false;
      if (!this.compStarted) this.onIntent({ kind: 'compositionStart' });
      this.compStarted = false;
      const text = data || this.preedit;
      this.preedit = '';
      this.onIntent({ kind: 'compositionEnd', text });
      if (this.pendingParagraph) {
        this.pendingParagraph = false;
        // 한글 음절 조합을 끝낸 Enter는 확정하고 문단도 나눈다. 후보 창에서 고른 Enter(한자 변환·일본어 변환)는
        // 고르기만 한다: 실제 IME 기록에서 한자 후보를 Enter로 고르면 같은 누름의 두 번째 keydown이 오지 않고,
        // 문단을 나누면 "韓⏎"가 된다
        if (splitsOnEnter(text)) this.onIntent({ kind: 'insertParagraph' });
        else this.log('skip', `Enter chose a candidate (${fmt(text)}): no paragraph`);
      }
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
      // 서식 있는 붙여넣기: Quire 조각, HTML (clipboard.ts)
      const html = e.clipboardData?.getData('text/html') ?? '';
      const quire = e.clipboardData?.getData('application/x-quire-fragment') ?? '';
      // 클립보드 이미지 (11 §5.3)
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      this.log('paste', `text=${fmt(text.slice(0, 40))}${html ? ' html' : ''}${quire ? ' quire' : ''}${files.length ? ` images=${files.length}` : ''}`);
      if (text || html || quire || files.length) this.onIntent({ kind: 'paste', text, ...(html ? { html } : {}), ...(quire ? { quire } : {}), ...(files.length ? { files } : {}) });
    });
  }

  setLabel(label: string): void {
    this.el.setAttribute('aria-label', label);
  }

  focus(): void {
    this.el.focus({ preventScroll: true });
  }

  /** 캐럿 주변 텍스트를 버퍼에 맞춘다 (바뀐 것만 EditContext에 알림) */
  sync(text: string, base: number, anchor: number, head: number): void {
    if (this.composing) return;
    this.base = base;
    if (this.shadow !== text || this.ec.text !== text) {
      this.ec.updateText(0, this.ec.text.length, text);
      this.shadow = text;
    }
    const a = u16Of(text, Math.min(anchor, head));
    const b = u16Of(text, Math.max(anchor, head));
    if (this.ec.selectionStart !== a || this.ec.selectionEnd !== b) this.ec.updateSelection(a, b);
  }

  commitComposition(): void {
    if (!this.composing) return;
    // 포커스를 잃으면 IME가 조합을 끝낸다 (compositionend)
    this.el.blur();
    if (this.composing) {
      this.composing = false;
      if (!this.compStarted) this.onIntent({ kind: 'compositionStart' });
      this.compStarted = false;
      const text = this.preedit;
      this.preedit = '';
      this.onIntent({ kind: 'compositionEnd', text });
    }
    // IME가 조합을 어떻게 끝냈는지 모르므로 다음 sync에서 버퍼를 통째로 다시 쓴다
    this.shadow = '\u0000';
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
    for (const d of this.disposers) d();
    (this.el as unknown as { editContext: EditContextLike | null }).editContext = null;
    this.el.remove();
  }

  /** 캐럿 사각형 (뷰포트 좌표) */
  private caretRect(): DOMRect {
    const b = this.el.getBoundingClientRect();
    return this.rect(b.left, b.top, Math.max(1, b.width), b.height || this.caret.height);
  }

  private on(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.disposers.push(() => target.removeEventListener(type, fn));
  }

  private log(type: string, detail: string): void {
    this.onLog?.({ time: performance.now(), type, detail });
  }
}

/**
 * 조합을 끝낸 Enter가 문단도 나누는가. 한글 조합(음절 확정)은 나누고, 후보 창에서 고른 결과(한자, 일본어 가나·한자)는
 * 고르기만 한다
 */
export function splitsOnEnter(text: string): boolean {
  return !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
}

function fmt(s: string | null | undefined): string {
  return s == null ? 'null' : JSON.stringify(s);
}
