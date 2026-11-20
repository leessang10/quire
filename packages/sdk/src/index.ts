/**
 * 에디터 공개 API (08 §3, 15 §8): 프레임워크와 무관한 createEditor. 편집기(@quire/editor)를 감싸
 * 명령(run), 불변 상태 스냅샷(getState), 상태 변경 알림(subscribe), UI 배치용 좌표(caretRect·rangeRects), 정본(toJSON),
 * 정리(destroy)를 준다. 문서 상태는 에디터가 소유한다: 앱은 저장할 때 subscribe + 디바운스로 toJSON()을 받는다.
 */
import { Editor, type EditorOptions, type FindStatus, type ParagraphState, type PluginContext, type QuirePlugin, type Rect, type SelectionMarks } from '@quire/editor';
import type { MarkSet } from '@quire/model';
import { documentFromQuire, quireFromDocument, type QuireDoc } from '@quire/sync';

export type { QuirePlugin, PluginContext, Rect } from '@quire/editor';
export type { QuireDoc } from '@quire/sync';

/** 불변 상태 스냅샷 (바뀔 때만 새 객체) */
export interface EditorState {
  /** 바뀔 때마다 늘어난다 */
  readonly version: number;
  readonly selection: { readonly anchor: number; readonly head: number; readonly story: string | null };
  /** 캐럿(선택 영역)의 글자 서식 (섞인 키는 빠진다) */
  readonly marksAtCaret: Readonly<MarkSet>;
  readonly paragraphStyle: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly suggesting: boolean;
  readonly find: FindStatus | null;
  readonly plugins: readonly string[];
}

export interface CreateEditorOptions extends Omit<EditorOptions, 'host' | 'document' | 'doc' | 'text' | 'plugins'> {
  host: HTMLElement;
  /** 정본 문서 (없으면 빈 문서) */
  doc?: QuireDoc;
  plugins?: QuirePlugin[];
}

export interface QuireHandle {
  /** 편집기 자체 (탈출구: 넓은 API) */
  readonly editor: Editor;
  /** 명령 실행: 내장 명령(toggleBold, undo, …, 점 없는 이름) 또는 플러그인 명령('플러그인.명령') */
  run(command: string, ...args: unknown[]): boolean;
  getState(): EditorState;
  subscribe(listener: () => void): () => void;
  caretRect(): Rect | null;
  rangeRects(from: number, to: number): Rect[];
  toJSON(): QuireDoc;
  /** 문서를 바꾼다 (가져오기 결과). assets는 문서가 쓰는 새 자산 (이미지 바이트) */
  load(doc: QuireDoc, assets?: Iterable<[string, { bytes: Uint8Array; type: string }]>): Promise<void>;
  use(plugin: QuirePlugin): () => void;
  destroy(): void;
}

/** 내장 명령 (플러그인 'core'): 서식·문단·실행 취소·삽입 */
function corePlugin(editor: Editor): QuirePlugin {
  const mark = (k: 'bold' | 'italic' | 'underline' | 'strike') => () => (editor.toggleMark(k), true);
  return {
    name: 'core',
    commands: {
      toggleBold: mark('bold'),
      toggleItalic: mark('italic'),
      toggleUnderline: mark('underline'),
      toggleStrike: mark('strike'),
      superscript: () => (editor.toggleScript('sup'), true),
      subscript: () => (editor.toggleScript('sub'), true),
      clearFormatting: () => (editor.clearMarks(), true),
      setMark: (_c, key, value) => (editor.setMark(key as never, value), true),
      setStyle: (_c, name) => (editor.setParagraphStyle(String(name)), true),
      setAlign: (_c, align) => (editor.setParagraphAttr('align', align), true),
      bulletList: () => (editor.toggleList('bullet'), true),
      numberedList: () => (editor.toggleList('number'), true),
      indent: () => (editor.indent(1), true),
      outdent: () => (editor.indent(-1), true),
      undo: () => (editor.undo(), true),
      redo: () => (editor.redo(), true),
      insertPageBreak: () => (editor.insertPageBreak(), true),
      insertTable: (_c, rows, cols) => (editor.insertTable(Number(rows ?? 3), Number(cols ?? 3)), true),
      insertFootnote: () => (editor.insertFootnote(), true),
      setSuggesting: (_c, on) => (editor.setSuggesting(!!on), true),
      addComment: (_c, text) => editor.addComment(String(text ?? '')) !== null,
      focus: () => (editor.focus(), true),
    },
  };
}

/** 에디터를 만든다. 같은 host에 destroy 뒤 다시 만들어도 된다 (React StrictMode의 이중 마운트) */
export async function createEditor(opts: CreateEditorOptions): Promise<QuireHandle> {
  const { host, doc, plugins, onChange, ...rest } = opts;
  const document = doc ? documentFromQuire(doc).document : undefined;
  const listeners = new Set<() => void>();
  let state: EditorState | null = null;
  let version = 0;
  let destroyed = false;
  const notify = () => {
    if (destroyed) return;
    state = null; // 다음 getState에서 새로 만든다 (값이 같으면 앞 객체를 그대로)
    for (const l of [...listeners]) l();
  };
  const editor = new Editor({ ...rest, host, document, onChange: (e) => onChange?.(e) });
  let pluginCtx: PluginContext | null = null;
  editor.use(corePlugin(editor));
  // 상태 알림: 그리기가 끝날 때마다 (문서·선택·서식 대기·찾기가 바뀌면 그린다)
  editor.use({
    name: 'sdk-state',
    init(ctx) {
      pluginCtx = ctx;
      return ctx.on('afterRender', notify);
    },
  });
  for (const p of plugins ?? []) editor.use(p);

  let last: EditorState | null = null;
  const build = (): EditorState => {
    const sel = editor.selection();
    const sm: SelectionMarks = editor.selectionMarks();
    const marks: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sm.marks)) if (!sm.mixed.has(k as never)) marks[k] = v;
    const ps: ParagraphState = editor.paragraphState();
    const next: Omit<EditorState, 'version'> = {
      selection: { anchor: sel.anchor, head: sel.head, story: pluginCtx?.story() ?? null },
      marksAtCaret: marks,
      paragraphStyle: ps.style,
      canUndo: editor.history.canUndo,
      canRedo: editor.history.canRedo,
      suggesting: editor.suggesting,
      find: editor.findStatus(),
      plugins: editor.pluginNames(),
    };
    // 값이 같으면 앞 스냅샷 그대로 (useSyncExternalStore가 다시 그리지 않게)
    if (last && JSON.stringify({ ...last, version: 0 }) === JSON.stringify({ ...next, version: 0 })) return last;
    last = { ...next, version: ++version };
    return last;
  };

  return {
    editor,
    run(command, ...args) {
      if (editor.run(command, ...args)) return true;
      return !command.includes('.') && editor.run(`core.${command}`, ...args);
    },
    getState() {
      state ??= build();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    caretRect: () => pluginCtx?.caretRect() ?? null,
    rangeRects: (from, to) => pluginCtx?.rangeRects(from, to) ?? [],
    toJSON: () => quireFromDocument(editor.document),
    async load(next, assets) {
      for (const [, a] of assets ?? []) await editor.putAsset(new Blob([a.bytes as BlobPart], { type: a.type }));
      editor.setDocument(documentFromQuire(next).document);
    },
    use: (plugin) => editor.use(plugin),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      editor.destroy();
    },
  };
}
