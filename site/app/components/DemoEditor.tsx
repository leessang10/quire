'use client';
import { useRef, useState } from 'react';
import { QuireEditor, useEditorState, useQuire } from '@quiredoc/react';
import { ACCEPT, SAVE_KINDS, demoDoc, fonts, openFile, saveFile, type SaveKind } from '../../lib/quire';
import type { Lang } from '../../lib/i18n';

const T = {
  ko: {
    toolbar: '데모 편집 도구',
    bold: ['굵게', '굵게 (Ctrl+B)'],
    italic: ['기울임', '기울임 (Ctrl+I)'],
    underline: ['밑줄', '밑줄 (Ctrl+U)'],
    undo: ['실행 취소', '실행 취소 (Ctrl+Z)'],
    redo: ['다시 실행', '다시 실행 (Ctrl+Y)'],
    glyph: '가',
    style: '문단 스타일',
    styles: { body: '본문', h1: '제목 1', h2: '제목 2', h3: '제목 3' },
    open: '열기',
    saveAs: (k: string) => `${k}로 저장`,
    making: (k: string) => `${k} 만드는 중…`,
    saved: (k: string, kb: string) => `${k}로 저장했습니다 (${kb} KB)`,
    saveFailed: (k: string) => `${k}로 저장하지 못했습니다. 페이지를 새로 고친 뒤 다시 시도하거나 다른 형식으로 저장해 보세요.`,
    opened: (name: string, dropped: number) => `'${name}' 파일을 열었습니다.${dropped ? ` 지원하지 않는 요소 ${dropped}개는 빠졌습니다.` : ''}`,
    openFailed: (name: string) => `'${name}' 파일을 열지 못했습니다. HWPX·DOCX·Markdown 파일인지, 손상되지 않았는지 확인하고 다시 열어 보세요.`,
    idle: '쓴 글은 이 브라우저 밖으로 나가지 않습니다. 편집기 안에서 Tab은 탭 문자를 넣고, Shift+Tab으로 빠져나옵니다.',
  },
  en: {
    toolbar: 'Demo editing tools',
    bold: ['Bold', 'Bold (Ctrl+B)'],
    italic: ['Italic', 'Italic (Ctrl+I)'],
    underline: ['Underline', 'Underline (Ctrl+U)'],
    undo: ['Undo', 'Undo (Ctrl+Z)'],
    redo: ['Redo', 'Redo (Ctrl+Y)'],
    glyph: 'A',
    style: 'Paragraph style',
    styles: { body: 'Body', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3' },
    open: 'Open',
    saveAs: (k: string) => `Save as ${k}`,
    making: (k: string) => `Creating ${k}…`,
    saved: (k: string, kb: string) => `Saved as ${k} (${kb} KB)`,
    saveFailed: (k: string) => `Couldn’t save as ${k}. Reload the page and try again, or save in another format.`,
    opened: (name: string, dropped: number) => `Opened “${name}”.${dropped ? ` ${dropped} unsupported element${dropped === 1 ? ' was' : 's were'} left out.` : ''}`,
    openFailed: (name: string) => `Couldn’t open “${name}”. Check that it is an undamaged HWPX, DOCX or Markdown file and open it again.`,
    idle: 'What you write never leaves this browser. Inside the editor, Tab inserts a tab; press Shift+Tab to move out.',
  },
};

export default function DemoEditor({ lang }: { lang: Lang }) {
  const t = T[lang];
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const editor = useQuire({ doc: demoDoc(lang), fonts, locale: lang, colorScheme: 'auto' });
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
    const k = kind.toUpperCase();
    setBusy(true);
    setMessage(t.making(k));
    try {
      const n = await saveFile(editor.handle, kind);
      setMessage(t.saved(k, (n / 1024).toFixed(1)));
    } catch (e) {
      console.error(e);
      setMessage(t.saveFailed(k));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="demo">
      <div className="demo-bar" role="toolbar" aria-label={t.toolbar}>
        <div className="group">
          <button type="button" aria-pressed={bold} onClick={() => run('toggleBold')} title={t.bold[1]} aria-label={t.bold[0]}>
            <b>{t.glyph}</b>
          </button>
          <button type="button" aria-pressed={italic} onClick={() => run('toggleItalic')} title={t.italic[1]} aria-label={t.italic[0]}>
            <i>{t.glyph}</i>
          </button>
          <button type="button" aria-pressed={underline} onClick={() => run('toggleUnderline')} title={t.underline[1]} aria-label={t.underline[0]}>
            <u>{t.glyph}</u>
          </button>
        </div>
        <div className="group">
          <button type="button" disabled={!canUndo} onClick={() => run('undo')} title={t.undo[1]} aria-label={t.undo[0]}>
            ↶
          </button>
          <button type="button" disabled={!canRedo} onClick={() => run('redo')} title={t.redo[1]} aria-label={t.redo[0]}>
            ↷
          </button>
        </div>
        <select aria-label={t.style} value={['h1', 'h2', 'h3'].includes(style) ? style : 'body'} onChange={(e) => run('setStyle', e.target.value)}>
          {Object.entries(t.styles).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <div className="group push">
          <button type="button" onClick={() => file.current?.click()}>
            {t.open}
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
                setMessage(t.opened(f.name, await openFile(editor, f)));
              } catch (err) {
                console.error(err);
                setMessage(t.openFailed(f.name));
              }
            }}
          />
          {SAVE_KINDS.map((k) => (
            <button type="button" key={k} disabled={busy} onClick={() => void save(k)} title={t.saveAs(k.toUpperCase())}>
              {k.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <QuireEditor editor={editor} className="demo-canvas" />
      <p className="demo-status" aria-live="polite">
        {message || t.idle}
      </p>
    </div>
  );
}
