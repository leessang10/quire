'use client';
import { useRef, useState } from 'react';
import { QuireEditor, useEditorState, useQuire } from '@quiredoc/react';
import { ACCEPT, SAVE_KINDS, demoDoc, fonts, openFile, saveFile, type SaveKind } from '../../lib/quire';

export default function DemoEditor() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const editor = useQuire({ doc: demoDoc(), fonts });
  const bold = useEditorState(editor, (s) => !!s.marksAtCaret.bold);
  const italic = useEditorState(editor, (s) => !!s.marksAtCaret.italic);
  const underline = useEditorState(editor, (s) => !!s.marksAtCaret.underline);
  const canUndo = useEditorState(editor, (s) => s.canUndo);
  const canRedo = useEditorState(editor, (s) => s.canRedo);
  const style = useEditorState(editor, (s) => s.paragraphStyle);
  const file = useRef<HTMLInputElement>(null);

  const run = (cmd: string, ...args: unknown[]) => {
    editor.run(cmd, ...args);
    editor.run('focus');
  };
  const save = async (kind: SaveKind) => {
    if (!editor.handle || busy) return;
    setBusy(true);
    setMessage(`${kind.toUpperCase()} 만드는 중…`);
    try {
      const n = await saveFile(editor.handle, kind);
      setMessage(`${kind.toUpperCase()}로 저장했습니다 (${(n / 1024).toFixed(1)} KB)`);
    } catch (e) {
      setMessage(`저장하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="demo">
      <div className="demo-bar" role="toolbar" aria-label="데모 편집 도구">
        <div className="group">
          <button type="button" aria-pressed={bold} onClick={() => run('toggleBold')} title="굵게 (Ctrl+B)">
            <b>가</b>
          </button>
          <button type="button" aria-pressed={italic} onClick={() => run('toggleItalic')} title="기울임 (Ctrl+I)">
            <i>가</i>
          </button>
          <button type="button" aria-pressed={underline} onClick={() => run('toggleUnderline')} title="밑줄 (Ctrl+U)">
            <u>가</u>
          </button>
        </div>
        <div className="group">
          <button type="button" disabled={!canUndo} onClick={() => run('undo')} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">
            ↶
          </button>
          <button type="button" disabled={!canRedo} onClick={() => run('redo')} title="다시 실행 (Ctrl+Y)" aria-label="다시 실행">
            ↷
          </button>
        </div>
        <select aria-label="문단 스타일" value={['h1', 'h2', 'h3'].includes(style) ? style : 'body'} onChange={(e) => run('setStyle', e.target.value)}>
          <option value="body">본문</option>
          <option value="h1">제목 1</option>
          <option value="h2">제목 2</option>
          <option value="h3">제목 3</option>
        </select>
        <div className="group push">
          <button type="button" onClick={() => file.current?.click()}>
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
              try {
                const dropped = await openFile(editor, f);
                setMessage(`${f.name}을(를) 열었습니다${dropped ? ` · 옮기지 못한 요소 ${dropped}개` : ''}`);
              } catch (err) {
                setMessage(`열지 못했습니다: ${(err as Error).message}`);
              }
            }}
          />
          {SAVE_KINDS.map((k) => (
            <button type="button" key={k} disabled={busy} onClick={() => void save(k)} title={`${k.toUpperCase()}로 저장`}>
              {k.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <QuireEditor editor={editor} className="demo-canvas" />
      <p className="demo-status" aria-live="polite">
        {message || '편집한 내용은 이 브라우저 밖으로 나가지 않습니다.'}
      </p>
    </div>
  );
}
