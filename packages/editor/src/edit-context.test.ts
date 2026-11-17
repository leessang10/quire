/**
 * 입력 층 경로 A (EditContext) 시험. 브라우저 없이 가짜 EditContext가 IME처럼 이벤트를 낸다.
 * 이벤트 순서는 Chromium의 EditContext 구현을 따른다: compositionstart → textupdate(조합 범위 교체)… → compositionend.
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
  startComposition(): void {
    this.dispatchEvent(Object.assign(new Event('compositionstart'), { data: '' }));
    this.compFrom = this.selectionStart;
    this.compLen = this.selectionEnd - this.selectionStart;
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
  focused = false;
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  appendChild(c: FakeElement) {
    c.parentElement = this;
  }
  focus() {
    this.focused = true;
  }
  blur() {
    this.focused = false;
  }
  remove() {
    this.parentElement = null;
  }
  getBoundingClientRect() {
    return { left: parseFloat(this.style.left ?? '0') || 0, top: parseFloat(this.style.top ?? '0') || 0, width: 2, height: parseFloat(this.style.height ?? '0') || 20 };
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const intents: InputIntent[] = [];
  const parent = new FakeElement();
  let ec!: FakeEditContext;
  const input = new EditContextInput(parent as unknown as HTMLElement, (i) => intents.push(i), undefined, {
    EditContext: class extends FakeEditContext {
      constructor() {
        super();
        ec = this; // eslint-disable-line @typescript-eslint/no-this-alias
      }
    },
    createElement: () => new FakeElement() as unknown as HTMLElement,
    rect: (x, y, w, h) => ({ x, y, width: w, height: h }) as DOMRect,
  });
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
        case 'insertText':
        case 'compositionUpdate':
        case 'compositionEnd':
          return `${i.kind}:${i.text}`;
        case 'key':
          return `key:${i.event.key}`;
        default:
          return i.kind;
      }
    });
  return { input, ec: ec!, el, key, seen };
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

  it('turns plain text updates into insertText and clears the buffer afterwards', async () => {
    const { ec, seen } = setup();
    ec.commit('a');
    ec.commit('b');
    expect(seen()).toEqual(['insertText:a', 'insertText:b']);
    await tick();
    expect(ec.text).toBe('');
    expect(ec.selectionStart).toBe(0);
  });

  it('keeps Hangul composition out of the document until each syllable is committed', async () => {
    const { ec, seen } = setup();
    ec.startComposition();
    for (const t of ['ㅎ', '하', '한']) ec.compose(t);
    ec.endComposition();
    // 음절이 끝나자마자 다음 조합 (버퍼에 '한'이 남아 있음)
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
    await tick();
    expect(ec.text).toBe('');
  });

  it('handles Enter in keydown, and Enter during composition after the commit', () => {
    const { ec, key, seen } = setup();
    const e = key({ key: 'Enter' });
    expect(e.defaultPrevented).toBe(true);
    expect(seen()).toEqual(['insertParagraph']);
    ec.startComposition();
    ec.compose('한');
    // Windows 한국어 IME: 조합 중 Enter는 key가 Process, keyCode 229
    const e2 = key({ key: 'Process', code: 'Enter', keyCode: 229, isComposing: true });
    expect(e2.defaultPrevented).toBe(false);
    ec.endComposition();
    expect(seen()).toEqual(['compositionStart', 'compositionUpdate:한', 'compositionEnd:한', 'insertParagraph']);
  });

  it('splits once when the IME sends Enter again after committing (Windows Korean IME + Chromium)', () => {
    const { ec, key, seen } = setup();
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
    expect(seen()).toEqual(['key:Backspace', 'key:ArrowLeft', 'key:z', 'compositionStart']);
  });

  it('commits a composition the IME did not end when the caret is moved by a click', async () => {
    const { input, ec, seen } = setup();
    ec.startComposition();
    ec.compose('가');
    input.commitComposition(); // 가짜 IME는 blur에 compositionend를 보내지 않는다
    expect(seen()).toEqual(['compositionStart', 'compositionUpdate:가', 'compositionEnd:가']);
    expect(ec.text).toBe('');
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
    const { ec, seen } = setup();
    ec.updateText(0, 0, 'xy');
    ec.updateSelection(0, 2);
    ec.startComposition();
    ec.compose('ㅁ');
    ec.compose('뭐');
    ec.endComposition();
    expect(seen()).toEqual(['compositionStart', 'compositionUpdate:ㅁ', 'compositionUpdate:뭐', 'compositionEnd:뭐']);
  });
});
