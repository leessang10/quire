// 예제 2: React + Vite + Tailwind — @quiredoc/react의 useQuire·QuireEditor·useEditorState
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QuireEditor, useEditorState, useQuire } from '@quiredoc/react';
import { ACCEPT, demoPlugins, fonts, openFile, sampleDoc, saveFile, type SaveKind } from './quire-demo.ts';

const btn = 'rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40 aria-pressed:border-blue-400 aria-pressed:bg-blue-100';

export function App() {
  const [words, setWords] = useState('');
  const [message, setMessage] = useState('');
  const editor = useQuire({
    doc: sampleDoc('React + Vite + Tailwind'),
    fonts,
    plugins: demoPlugins((c) => setWords(`${c.chars.toLocaleString()}자 · ${c.words.toLocaleString()}어절`)),
  });
  // 고른 값이 바뀔 때만 다시 그린다 (입력 한 번이 툴바를 다시 그리지 않는다)
  const bold = useEditorState(editor, (s) => !!s.marksAtCaret.bold);
  const italic = useEditorState(editor, (s) => !!s.marksAtCaret.italic);
  const underline = useEditorState(editor, (s) => !!s.marksAtCaret.underline);
  const canUndo = useEditorState(editor, (s) => s.canUndo);
  const canRedo = useEditorState(editor, (s) => s.canRedo);
  const style = useEditorState(editor, (s) => s.paragraphStyle);
  const plugins = useEditorState(editor, (s) => s.plugins.join(', '));
  const file = useRef<HTMLInputElement>(null);
  // 콘솔에서 만져 보기
  useEffect(() => {
    (window as unknown as { quire: unknown }).quire = editor;
  }, [editor]);

  const run = (cmd: string, ...args: unknown[]) => {
    editor.run(cmd, ...args);
    editor.run('focus');
  };
  const save = async (kind: SaveKind) => {
    if (!editor.handle) return;
    const n = await saveFile(editor.handle, kind);
    setMessage(`${kind.toUpperCase()} 저장 (${(n / 1024).toFixed(1)} KB)`);
  };

  return (
    <div className="grid h-screen grid-rows-[auto_1fr_auto] bg-zinc-100 text-zinc-900">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-300 bg-white px-3 py-2">
        <strong className="mr-2">Quire · React + Tailwind</strong>
        <Group>
          <button className={btn} aria-pressed={bold} onClick={() => run('toggleBold')} title="굵게">
            <b>가</b>
          </button>
          <button className={btn} aria-pressed={italic} onClick={() => run('toggleItalic')} title="기울임">
            <i>가</i>
          </button>
          <button className={btn} aria-pressed={underline} onClick={() => run('toggleUnderline')} title="밑줄">
            <u>가</u>
          </button>
        </Group>
        <Group>
          <button className={btn} disabled={!canUndo} onClick={() => run('undo')} title="실행 취소">
            ↶
          </button>
          <button className={btn} disabled={!canRedo} onClick={() => run('redo')} title="다시 실행">
            ↷
          </button>
        </Group>
        <select className={btn} value={['h1', 'h2', 'h3'].includes(style) ? style : 'body'} onChange={(e) => run('setStyle', e.target.value)}>
          <option value="body">본문</option>
          <option value="h1">제목 1</option>
          <option value="h2">제목 2</option>
          <option value="h3">제목 3</option>
        </select>
        <Group>
          <button className={btn} onClick={() => file.current?.click()}>
            열기
          </button>
          <input
            ref={file}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const d = Object.entries(await openFile(editor, f));
              setMessage(`${f.name} 열림${d.length ? ` · 버림: ${d.map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}`);
            }}
          />
          {(['hwpx', 'docx', 'md', 'pdf'] as const).map((k) => (
            <button key={k} className={btn} onClick={() => void save(k)}>
              {k.toUpperCase()}
            </button>
          ))}
        </Group>
      </header>
      <QuireEditor editor={editor} className="min-h-0" />
      <footer className="border-t border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-600">
        {message || words} · 플러그인: {plugins}
      </footer>
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className="flex gap-1">{children}</div>;
}
