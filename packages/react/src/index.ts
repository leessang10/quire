/**
 * React 래퍼 (08 §4, 15 §8): useQuire, QuireEditor, useEditorState.
 * - useQuire(options): 에디터 제어기를 만든다. 옵션 객체가 렌더마다 새로 만들어져도 처음 것만 쓴다 (바꿀 값은 명령으로).
 * - QuireEditor: 제어기를 div에 붙인다. 떼면 문서를 정본으로 들고 있다가 다시 붙일 때 그것으로 만든다 (StrictMode 이중 마운트).
 * - useEditorState(editor, selector): useSyncExternalStore 기반. 고른 값이 바뀔 때만 다시 그린다 (입력 한 번이 리렌더를 일으키지 않는다).
 * JSX 없이 createElement로 쓴다 (빌드 설정 없이 쓰게).
 */
import { createElement, useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactElement } from 'react';
import { createEditor, type CreateEditorOptions, type EditorState, type QuireDoc, type QuireHandle, type Rect } from '@quiredoc/sdk';

export type { EditorState, QuireHandle } from '@quiredoc/sdk';

/** 붙기 전(또는 뗀 뒤)의 상태 */
export const EMPTY_STATE: EditorState = Object.freeze({
  version: 0,
  selection: { anchor: 0, head: 0, story: null },
  marksAtCaret: {},
  paragraphStyle: 'body',
  canUndo: false,
  canRedo: false,
  suggesting: false,
  find: null,
  plugins: [],
});

/** 상태를 읽고 구독하는 것 (제어기, 또는 시험용 가짜) */
export interface EditorStore {
  getState(): EditorState;
  subscribe(listener: () => void): () => void;
}

export type QuireOptions = Omit<CreateEditorOptions, 'host'>;

/** 에디터 제어기: 화면에 붙기 전에도 쓸 수 있다 (명령은 붙은 뒤에만 듣는다) */
export interface QuireController extends EditorStore {
  readonly handle: QuireHandle | null;
  run(command: string, ...args: unknown[]): boolean;
  caretRect(): Rect | null;
  rangeRects(from: number, to: number): Rect[];
  toJSON(): QuireDoc | null;
  /** 문서를 바꾼다 (가져오기 결과). 붙기 전이면 붙을 때 그것으로 만든다 */
  load(doc: QuireDoc, assets?: Iterable<[string, { bytes: Uint8Array; type: string }]>): Promise<void>;
  /** QuireEditor가 부른다 */
  mount(host: HTMLElement): void;
  unmount(): void;
}

/** 제어기를 만든다 (React 밖에서도 쓴다). create는 시험에서 바꾼다 */
export function createController(options: QuireOptions, create: (o: CreateEditorOptions) => Promise<QuireHandle> = createEditor): QuireController {
  let handle: QuireHandle | null = null;
  let saved: QuireDoc | undefined = options.doc;
  let token = 0;
  let unsub: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  return {
    get handle() {
      return handle;
    },
    getState: () => handle?.getState() ?? EMPTY_STATE,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run: (command, ...args) => handle?.run(command, ...args) ?? false,
    caretRect: () => handle?.caretRect() ?? null,
    rangeRects: (from, to) => handle?.rangeRects(from, to) ?? [],
    toJSON: () => handle?.toJSON() ?? saved ?? null,
    async load(doc, assets) {
      if (handle) return handle.load(doc, assets);
      saved = doc;
    },
    mount(host) {
      const my = ++token;
      void create({ ...options, host, doc: saved }).then((h) => {
        // 그 사이에 떼였으면 (StrictMode) 바로 정리한다
        if (my !== token) {
          h.destroy();
          return;
        }
        handle = h;
        unsub = h.subscribe(notify);
        notify();
      });
    },
    unmount() {
      token++;
      if (handle) {
        saved = handle.toJSON();
        unsub?.();
        unsub = null;
        handle.destroy();
        handle = null;
        notify();
      }
    },
  };
}

/** 제어기 (처음 렌더의 옵션으로 한 번만 만든다) */
export function useQuire(options: QuireOptions): QuireController {
  const ref = useRef<QuireController | null>(null);
  ref.current ??= createController(options);
  return ref.current;
}

/**
 * 상태에서 고른 값. 고른 값이 같으면(isEqual) 다시 그리지 않는다. selector가 새 객체를 만들면 isEqual을 준다
 */
export function useEditorState<T>(editor: EditorStore | null, selector: (s: EditorState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const memo = useRef<{ state: EditorState; value: T } | null>(null);
  const getSnapshot = () => {
    const state = editor?.getState() ?? EMPTY_STATE;
    const m = memo.current;
    if (m && m.state === state) return m.value;
    const value = selector(state);
    if (m && isEqual(m.value, value)) {
      memo.current = { state, value: m.value };
      return m.value;
    }
    memo.current = { state, value };
    return value;
  };
  const subscribe = (fn: () => void) => editor?.subscribe(fn) ?? (() => {});
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface QuireEditorProps {
  editor: QuireController | null;
  className?: string;
  style?: CSSProperties;
}

/** 에디터를 붙일 자리 */
export function QuireEditor({ editor, className, style }: QuireEditorProps): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = ref.current;
    if (!editor || !host) return;
    editor.mount(host);
    return () => editor.unmount();
  }, [editor]);
  return createElement('div', { ref, className, style: { position: 'relative', ...style } });
}
