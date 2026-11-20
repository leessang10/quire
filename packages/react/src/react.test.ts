// @vitest-environment happy-dom
/**
 * React 래퍼 (08 §4, 15 §8): 입력 한 번(상태 판이 바뀌어도 고른 값이 같음)이 리렌더를 일으키지 않는다 (렌더 횟수 세기).
 * 옵션 객체가 렌더마다 새로 만들어져도 제어기는 하나다. StrictMode 이중 마운트에서 에디터는 하나만 남고, 다시 붙을 때 문서를 잇는다.
 */
import { StrictMode, act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { EditorState, QuireHandle } from '@quire/sdk';
import { EMPTY_STATE, QuireEditor, createController, useEditorState, useQuire, type EditorStore, type QuireController } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 가짜 상태 저장소: set으로 새 스냅샷을 알린다 */
function fakeStore(): EditorStore & { set(patch: Partial<EditorState>): void } {
  let state: EditorState = EMPTY_STATE;
  const ls = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(l) {
      ls.add(l);
      return () => ls.delete(l);
    },
    set(patch) {
      state = { ...state, ...patch, version: state.version + 1 };
      for (const l of ls) l();
    },
  };
}

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});
const mount = (el: ReturnType<typeof createElement>) => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(el));
};

describe('React wrapper (08 §4)', () => {
  it('useEditorState re-renders only when the selected value changes', () => {
    const store = fakeStore();
    let renders = 0;
    let bold: unknown;
    const Toolbar = () => {
      renders++;
      bold = useEditorState(store, (s) => !!s.marksAtCaret.bold);
      return null;
    };
    mount(createElement(Toolbar));
    expect(renders).toBe(1);
    // 입력: 선택·판이 바뀌어도 굵게는 그대로 → 다시 그리지 않는다
    for (let i = 1; i <= 20; i++) act(() => store.set({ selection: { anchor: i, head: i, story: null }, canUndo: true }));
    expect(renders).toBe(1);
    // 굵게가 바뀌면 한 번
    act(() => store.set({ marksAtCaret: { bold: true } }));
    expect(renders).toBe(2);
    expect(bold).toBe(true);
    // 새 객체를 고르면 isEqual로 막는다
    let objRenders = 0;
    const Sel = () => {
      objRenders++;
      useEditorState(store, (s) => ({ style: s.paragraphStyle }), (a, b) => a.style === b.style);
      return null;
    };
    act(() => root!.render(createElement(Sel)));
    const n = objRenders;
    act(() => store.set({ canRedo: true }));
    expect(objRenders).toBe(n);
  });

  it('useQuire keeps one controller even if options change every render', () => {
    const seen = new Set<QuireController>();
    let bump: () => void = () => {};
    const App = () => {
      const [n, setN] = useState(0);
      bump = () => setN((x) => x + 1);
      seen.add(useQuire({ fontSize: 16 + n }));
      return null;
    };
    mount(createElement(App));
    act(() => bump());
    act(() => bump());
    expect(seen.size).toBe(1);
  });

  it('QuireEditor mounts once under StrictMode and keeps the document across remounts', async () => {
    const created: Array<{ host: HTMLElement; doc: unknown; destroyed: boolean }> = [];
    const fakeCreate = async (o: { host: HTMLElement; doc?: unknown }): Promise<QuireHandle> => {
      const rec = { host: o.host, doc: o.doc, destroyed: false };
      created.push(rec);
      return {
        editor: null as never,
        run: () => true,
        getState: () => EMPTY_STATE,
        subscribe: () => () => {},
        caretRect: () => null,
        rangeRects: () => [],
        toJSON: () => ({ marker: created.indexOf(rec) }) as never,
        use: () => () => {},
        load: async () => {},
        destroy: () => void (rec.destroyed = true),
      };
    };
    const ctrl = createController({ doc: { marker: 'initial' } as never }, fakeCreate as never);
    mount(createElement(StrictMode, null, createElement(QuireEditor, { editor: ctrl })));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // StrictMode: 붙고·떼고·붙는다. 살아 있는 에디터는 하나
    const alive = created.filter((c) => !c.destroyed);
    expect(alive).toHaveLength(1);
    expect(ctrl.handle).not.toBeNull();
    expect(ctrl.run('toggleBold')).toBe(true);
    // 떼면 문서를 들고 있다가 다시 붙을 때 그것으로 만든다
    act(() => root!.unmount());
    root = null;
    expect(alive[0]!.destroyed).toBe(true);
    const saved = ctrl.toJSON();
    expect(saved).toEqual({ marker: created.indexOf(alive[0]!) });
    mount(createElement(QuireEditor, { editor: ctrl }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(created[created.length - 1]!.doc).toEqual(saved);
  });
});
