/**
 * 입력 층 경로 A (EditContext) 시험. 브라우저 없이 가짜 EditContext가 IME처럼 이벤트를 내고, 가짜 편집기가 의도를
 * 문자열 문서에 적용한 뒤 실제 편집기처럼 캐럿 문단을 sync로 돌려준다 (버퍼 ↔ 문서 왕복).
 * 이벤트 순서는 Chromium의 EditContext와 실제 Windows 한국어 IME 기록을 따른다.
 */
import { describe, expect, it } from 'vitest';
import { EditContextInput, type EditContextLike } from './edit-context';
import type { InputIntent } from './input';

class FakeEditContext extends EventTarget implements EditContextLike {
  text = '';
  selectionStart = 0;
  selectionEnd = 0;
  selectionBounds: unknown = null;
  charBounds: [number, unknown[]] | null = null;
  private compFrom = -1;
  private compLen = 0;

  updateText(start: number, end: number, text: string): void {
    this.text = this.text.slice(0, start) + text + this.text.slice(end);
  }
  updateSelection(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  updateControlBounds(): void {}
  updateSelectionBounds(r: unknown): void {
    this.selectionBounds = r;
  }
  updateCharacterBounds(start: number, rects: unknown[]): void {
    this.charBounds = [start, rects];
  }

  // ── IME 흉내 ──
  private textUpdate(from: number, to: number, text: string): void {
    this.updateText(from, to, text);
    const at = from + text.length;
    this.updateSelection(at, at);
    this.dispatchEvent(Object.assign(new Event('textupdate'), { updateRangeStart: from, updateRangeEnd: to, text, selectionStart: at, selectionEnd: at }));
  }
  commit(text: string): void {
    this.textUpdate(this.selectionStart, this.selectionEnd, text);
  }
  /** range가 있으면 그 기존 글자를 조합으로 가져간다 (재변환) */
  startComposition(range?: [number, number]): void {
    this.dispatchEvent(Object.assign(new Event('compositionstart'), { data: '' }));
    this.compFrom = range ? range[0] : this.selectionStart;
    this.compLen = range ? range[1] - range[0] : this.selectionEnd - this.selectionStart;
  }
  compose(text: string): void {
    this.textUpdate(this.compFrom, this.compFrom + this.compLen, text);
    this.compLen = text.length;
  }
  endComposition(): void {
    const data = this.text.slice(this.compFrom, this.compFrom + this.compLen);
    this.compFrom = -1;
    this.compLen = 0;
    this.dispatchEvent(Object.assign(new Event('compositionend'), { data }));
  }
  askBounds(from: number, to: number): void {
    this.dispatchEvent(Object.assign(new Event('characterboundsupdate'), { rangeStart: from, rangeEnd: to }));
  }
}

class FakeElement extends EventTarget {
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  tabIndex = -1;
  parentElement: FakeElement | null = null;
  editContext: unknown = null;
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  appendChild(c: FakeElement) {
    c.parentElement = this;
  }
  focus() {}
  blur() {}
  remove() {
    this.parentElement = null;
  }
  getBoundingClientRect() {
    return { left: parseFloat(this.style.left ?? '0') || 0, top: parseFloat(this.style.top ?? '0') || 0, width: 2, height: parseFloat(this.style.height ?? '0') || 20 };
  }
}

/** 문자열 문서에 의도를 적용하는 가짜 편집기 (코드포인트 오프셋) */
class FakeEditor {
  cps: string[];
  anchor: number;
  head: number;
  preedit = '';
  input!: EditContextInput;
  constructor(text: string, anchor = Array.from(text).length, head = anchor) {
    this.cps = Array.from(text);
    this.anchor = anchor;
    this.head = head;
  }
  get text() {
    return this.cps.join('');
  }
  private replace(from: number, to: number, t: string) {
    this.cps.splice(from, to - from, ...Array.from(t));
    this.anchor = this.head = from + Array.from(t).length;
  }
  apply(i: InputIntent) {
    const [a, b] = [Math.min(this.anchor, this.head), Math.max(this.anchor, this.head)];
    switch (i.kind) {
      case 'replaceText':
        this.replace(i.from, i.to, i.text);
        break;
      case 'insertText':
        this.replace(a, b, i.text);
        break;
      case 'compositionStart': {
        const [f, t] = i.replace ?? [a, b];
        this.replace(f, t, '');
        this.preedit = '';
        break;
      }
      case 'compositionUpdate':
        this.preedit = i.text;
        break;
      case 'compositionEnd':
        this.preedit = '';
        this.replace(a, b, i.text);
        break;
      case 'insertParagraph':
        this.replace(a, b, '\n');
        break;
      case 'key':
        if (i.event.key === 'Backspace' && a > 0) this.replace(a === b ? a - 1 : a, b, '');
        if (i.event.key === 'ArrowLeft') this.anchor = this.head = Math.max(0, a - 1);
        break;
      default:
        break;
    }
    this.sync();
  }
  /** 실제 편집기의 updateCaret: 캐럿 문단을 입력 층에 */
  sync() {
    if (this.input.composing) return;
    const text = this.text;
    const cpBefore = (o: number) => Array.from(text).slice(0, o).join('');
    const start = cpBefore(this.head).lastIndexOf('\n') + 1;
    const startCp = Array.from(text.slice(0, start)).length;
    const nl = text.indexOf('\n', cpBefore(this.head).length);
    const para = text.slice(start, nl < 0 ? text.length : nl);
    const clamp = (o: number) => Math.max(0, Math.min(Array.from(para).length, o - startCp));
    this.input.sync(para, startCp, clamp(this.anchor), clamp(this.head));
  }
}

function setup(text = '', anchor?: number, head?: number) {
  const intents: InputIntent[] = [];
  const parent = new FakeElement();
  let ec!: FakeEditContext;
  const editor = new FakeEditor(text, anchor, head);
  const input = new EditContextInput(
    parent as unknown as HTMLElement,
    (i) => {
      intents.push(i);
      editor.apply(i);
    },
    undefined,
    {
      EditContext: class extends FakeEditContext {
        constructor() {
          super();
          ec = this; // eslint-disable-line @typescript-eslint/no-this-alias
        }
      },
      createElement: () => new FakeElement() as unknown as HTMLElement,
      rect: (x, y, w, h) => ({ x, y, width: w, height: h }) as DOMRect,
    },
  );
  editor.input = input;
  editor.sync();
  const el = input.el as unknown as FakeElement;
  const key = (init: { key: string; code?: string; keyCode?: number; isComposing?: boolean; ctrlKey?: boolean; repeat?: boolean }, type = 'keydown') => {
    const e = Object.assign(new Event(type, { cancelable: true }), { code: init.key, keyCode: 0, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...init });
    el.dispatchEvent(e);
    return e;
  };
  /** 의도를 간단한 문자열로 */
  const seen = () =>
    intents.splice(0).map((i) => {
      switch (i.kind) {
        case 'replaceText':
          return `replace ${i.from}-${i.to}:${i.text}`;
        case 'compositionStart':
          return i.replace && i.replace[0] !== i.replace[1] ? `compositionStart ${i.replace[0]}-${i.replace[1]}` : 'compositionStart';
        case 'compositionUpdate':
        case 'compositionEnd':
          return `${i.kind}:${i.text}`;
        case 'key':
          return `key:${i.event.key}`;
        default:
          return i.kind;
      }
    });
  return { input, ec: ec!, el, key, seen, editor };
}

describe('EditContext input (path A)', () => {
  it('attaches an EditContext to a focusable element', () => {
    const { input, ec, el } = setup();
    expect(input.kind).toBe('editcontext');
    expect(el.editContext).toBe(ec);
    expect(el.tabIndex).toBe(0);
    expect(el.attrs.role).toBe('textbox');
    input.destroy();
    expect(el.editContext).toBeNull();
  });

  it('keeps the buffer equal to the caret paragraph, in UTF-16', () => {
    const { ec, editor } = setup('첫 문단\n둘😀째 문단', 8);
    expect(ec.text).toBe('둘😀째 문단');
    expect(ec.selectionStart).toBe(4); // 둘 + 😀(2) + 째 = UTF-16 4
    ec.commit('X');
    expect(editor.text).toBe('첫 문단\n둘😀째X 문단');
    expect(ec.text).toBe('둘😀째X 문단');
  });

  it('turns plain text updates into replacements at the caret', () => {
    const { ec, seen, editor } = setup('ab', 1);
    ec.commit('x');
    ec.commit('y');
    expect(seen()).toEqual(['replace 1-1:x', 'replace 2-2:y']);
    expect(editor.text).toBe('axyb');
  });

  it('keeps Hangul composition out of the document until each syllable is committed', () => {
    const { ec, seen, editor } = setup();
    ec.startComposition();
    for (const t of ['ㅎ', '하', '한']) ec.compose(t);
    expect(editor.text).toBe('');
    ec.endComposition();
    ec.startComposition();
    for (const t of ['ㄱ', '그', '글']) ec.compose(t);
    ec.endComposition();
    expect(seen()).toEqual([
      'compositionStart',
      'compositionUpdate:ㅎ',
      'compositionUpdate:하',
      'compositionUpdate:한',
      'compositionEnd:한',
      'compositionStart',
      'compositionUpdate:ㄱ',
      'compositionUpdate:그',
      'compositionUpdate:글',
      'compositionEnd:글',
    ]);
    expect(editor.text).toBe('한글');
    expect(ec.text).toBe('한글');
  });

  it('converts a committed syllable to Hanja (Windows: Hanja key commits, then reconverts the committed text)', () => {
    const { ec, seen, editor } = setup('대한', 2);
    ec.startComposition();
    for (const t of ['ㅁ', '미', '민']) ec.compose(t);
    // 실제 기록: 오른쪽 Ctrl(한자) → textupdate "민" → compositionend "민"
    ec.compose('민');
    ec.endComposition();
    expect(editor.text).toBe('대한민');
    seen();
    // IME가 확정된 "민"(버퍼 2–3)을 다시 조합해 후보 중 民을 고른다
    ec.startComposition([2, 3]);
    ec.compose('民');
    ec.endComposition();
    expect(seen()).toEqual(['compositionStart 2-3', 'compositionUpdate:民', 'compositionEnd:民']);
    expect(editor.text).toBe('대한民');
    expect(ec.text).toBe('대한民');
  });

  it('applies a non-composition replacement of earlier text (autocorrect)', () => {
    const { ec, seen, editor } = setup('teh cat', 3);
    ec.dispatchEvent(Object.assign(new Event('textupdate'), { updateRangeStart: 0, updateRangeEnd: 3, text: 'the', selectionStart: 3, selectionEnd: 3 }));
    ec.updateText(0, 3, 'the');
    expect(seen()).toEqual(['replace 0-3:the']);
    expect(editor.text).toBe('the cat');
  });

  it('handles Enter in keydown, and Enter during composition after the commit', () => {
    const { ec, key, seen, editor } = setup();
    const e = key({ key: 'Enter' });
    expect(e.defaultPrevented).toBe(true);
    expect(seen()).toEqual(['insertParagraph']);
    ec.startComposition();
    ec.compose('한');
    const e2 = key({ key: 'Process', code: 'Enter', keyCode: 229, isComposing: true });
    expect(e2.defaultPrevented).toBe(false);
    ec.endComposition();
    expect(seen()).toEqual(['compositionStart', 'compositionUpdate:한', 'compositionEnd:한', 'insertParagraph']);
    expect(editor.text).toBe('\n한\n');
    expect(ec.text).toBe('');
  });

  it('splits once when the IME sends Enter again after committing (Windows Korean IME + Chromium)', () => {
    const { ec, key, seen, editor } = setup();
    ec.startComposition();
    ec.compose('한');
    // 실제 기록: keydown Process/Enter/229 → compositionend → keydown Enter/13 → keyup
    key({ key: 'Process', code: 'Enter', keyCode: 229 });
    ec.endComposition();
    const second = key({ key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(second.defaultPrevented).toBe(true);
    key({ key: 'Enter', code: 'Enter', keyCode: 13 }, 'keyup');
    ec.startComposition();
    ec.compose('글');
    ec.endComposition();
    expect(seen()).toEqual(['compositionStart', 'compositionUpdate:한', 'compositionEnd:한', 'insertParagraph', 'compositionStart', 'compositionUpdate:글', 'compositionEnd:글']);
    expect(editor.text).toBe('한\n글');
    // 그 뒤의 Enter는 평소대로, 길게 눌러 반복되는 Enter도 그대로
    key({ key: 'Enter', keyCode: 13 });
    key({ key: 'Enter', keyCode: 13, repeat: true });
    expect(seen()).toEqual(['insertParagraph', 'insertParagraph']);
  });

  it('keeps holding Enter after a composition: repeated keydowns are not dropped', () => {
    const { ec, key, seen } = setup();
    ec.startComposition();
    ec.compose('가');
    key({ key: 'Process', code: 'Enter', keyCode: 229 });
    ec.endComposition();
    key({ key: 'Enter', keyCode: 13 }); // 같은 누름의 두 번째: 버림
    key({ key: 'Enter', keyCode: 13, repeat: true });
    key({ key: 'Enter', keyCode: 13, repeat: true });
    expect(seen().filter((x) => x === 'insertParagraph')).toHaveLength(3);
  });

  it('passes other keys to the editor, but not while composing', () => {
    const { ec, key, seen } = setup();
    key({ key: 'Backspace' });
    key({ key: 'ArrowLeft' });
    key({ key: 'z', ctrlKey: true });
    ec.startComposition();
    key({ key: 'Backspace', keyCode: 229, isComposing: true });
    expect(seen()).toEqual(['key:Backspace', 'key:ArrowLeft', 'key:z']);
  });

  it('commits a composition the IME did not end when the caret is moved by a click', () => {
    const { input, ec, seen, editor } = setup('ab', 2);
    ec.startComposition();
    ec.compose('가');
    input.commitComposition(); // 가짜 IME는 blur에 compositionend를 보내지 않는다
    expect(seen()).toEqual(['compositionStart', 'compositionUpdate:가', 'compositionEnd:가']);
    expect(editor.text).toBe('ab가');
    editor.sync();
    expect(ec.text).toBe('ab가');
    // 그 뒤의 늦은 compositionend는 무시
    ec.endComposition();
    expect(seen()).toEqual([]);
  });

  it('reports caret bounds for the candidate window', () => {
    const { input, ec } = setup();
    input.place(120, 300, 24);
    expect(ec.selectionBounds).toEqual({ x: 120, y: 300, width: 2, height: 24 });
    ec.startComposition();
    ec.compose('漢字');
    ec.askBounds(0, 2);
    expect(ec.charBounds?.[0]).toBe(0);
    expect(ec.charBounds?.[1]).toHaveLength(2);
  });

  it('replaces a selection when composition starts over it', () => {
    const { ec, seen, editor } = setup('바꿀 글자', 0, 2);
    expect([ec.selectionStart, ec.selectionEnd]).toEqual([0, 2]);
    ec.startComposition();
    ec.compose('ㅅ');
    ec.compose('새');
    ec.endComposition();
    expect(seen()).toEqual(['compositionStart 0-2', 'compositionUpdate:ㅅ', 'compositionUpdate:새', 'compositionEnd:새']);
    expect(editor.text).toBe('새 글자');
  });
});
