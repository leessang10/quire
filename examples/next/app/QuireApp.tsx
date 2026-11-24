'use client';
// 예제 5: Next.js + styled-components — @quiredoc/react
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { QuireEditor, useEditorState, useQuire } from '@quiredoc/react';
import { ACCEPT, demoPlugins, fonts, openFile, sampleDoc, saveFile, type SaveKind } from '../lib/quire-demo';

const Shell = styled.div`
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100vh;
  font: 14px/1.5 system-ui, 'Malgun Gothic', sans-serif;
  color: #1d1d1f;
  background: #eef3f1;
`;
const Bar = styled.header`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  background: #fff;
  border-bottom: 1px solid #d3ddd9;
`;
const Group = styled.div`
  display: flex;
  gap: 4px;
`;
const control = `
  font: inherit;
  padding: 4px 10px;
  border: 1px solid #b9c7c2;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  &[aria-pressed='true'] {
    background: #d6f0e6;
    border-color: #2f9b73;
  }
  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`;
const Button = styled.button`
  ${control}
`;
const Select = styled.select`
  ${control}
`;
const Status = styled.footer`
  padding: 4px 12px;
  font-size: 12px;
  color: #50615b;
  background: #fff;
  border-top: 1px solid #d3ddd9;
`;

const SAVE_KINDS: SaveKind[] = ['hwpx', 'docx', 'md', 'pdf'];

export default function QuireApp() {
  const [words, setWords] = useState('');
  const [message, setMessage] = useState('');
  const editor = useQuire({
    doc: sampleDoc('Next.js + styled-components'),
    fonts,
    plugins: demoPlugins((c) => setWords(`${c.chars.toLocaleString()}자 · ${c.words.toLocaleString()}어절`)),
  });
  // 고른 값이 바뀔 때만 다시 그린다
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
    (window as unknown as { quire: unknown; quireDemo: unknown }).quire = editor;
    void import('../lib/quire-demo').then((m) => ((window as unknown as { quireDemo: unknown }).quireDemo = m));
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
    <Shell>
      <Bar>
        <strong>Quire · Next.js + styled-components</strong>
        <Group>
          <Button aria-pressed={bold} onClick={() => run('toggleBold')} title="굵게">
            <b>가</b>
          </Button>
          <Button aria-pressed={italic} onClick={() => run('toggleItalic')} title="기울임">
            <i>가</i>
          </Button>
          <Button aria-pressed={underline} onClick={() => run('toggleUnderline')} title="밑줄">
            <u>가</u>
          </Button>
        </Group>
        <Group>
          <Button disabled={!canUndo} onClick={() => run('undo')} title="실행 취소">
            ↶
          </Button>
          <Button disabled={!canRedo} onClick={() => run('redo')} title="다시 실행">
            ↷
          </Button>
        </Group>
        <Select value={['h1', 'h2', 'h3'].includes(style) ? style : 'body'} onChange={(e) => run('setStyle', e.target.value)}>
          <option value="body">본문</option>
          <option value="h1">제목 1</option>
          <option value="h2">제목 2</option>
          <option value="h3">제목 3</option>
        </Select>
        <Group>
          <Button onClick={() => file.current?.click()}>열기</Button>
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
          {SAVE_KINDS.map((k) => (
            <Button key={k} onClick={() => void save(k)}>
              {k.toUpperCase()}
            </Button>
          ))}
        </Group>
      </Bar>
      <QuireEditor editor={editor} style={{ minHeight: 0 }} />
      <Status>
        {message || words} · 플러그인: {plugins}
      </Status>
    </Shell>
  );
}
