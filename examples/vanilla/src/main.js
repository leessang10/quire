// 예제 1: 바닐라 — 프레임워크 없이 createEditor만 쓴다
import { createEditor } from '@quiredoc/core';
import { ACCEPT, demoPlugins, fonts, openFile, sampleDoc, saveFile } from './quire-demo.ts';

const $ = (s) => document.querySelector(s);
const status = $('#status');
let words = '';
let editor = null;

editor = await createEditor({
  host: $('#editor'),
  doc: sampleDoc('바닐라 JS + 순수 CSS'),
  fonts,
  plugins: demoPlugins((c) => {
    words = `${c.chars.toLocaleString()}자 · ${c.words.toLocaleString()}어절`;
    render();
  }),
});
window.quire = editor; // 콘솔에서 만져 보기

// 상태 → 툴바 (스냅샷이 바뀔 때만)
let last = null;
function render() {
  if (!editor) return;
  const s = editor.getState();
  if (s !== last) {
    last = s;
    for (const b of document.querySelectorAll('[data-mark]')) b.setAttribute('aria-pressed', String(!!s.marksAtCaret[b.dataset.mark]));
    $('#undo').disabled = !s.canUndo;
    $('#redo').disabled = !s.canRedo;
    $('#style').value = ['h1', 'h2', 'h3'].includes(s.paragraphStyle) ? s.paragraphStyle : 'body';
  }
  status.textContent = `${words}  ·  플러그인: ${s.plugins.join(', ')}`;
}
editor.subscribe(render);
render();

for (const b of document.querySelectorAll('[data-cmd]'))
  b.addEventListener('click', () => {
    editor.run(b.dataset.cmd);
    editor.run('focus');
  });
$('#style').addEventListener('change', (e) => {
  editor.run('setStyle', e.target.value);
  editor.run('focus');
});
const file = $('#file');
file.accept = ACCEPT;
$('#open').addEventListener('click', () => file.click());
file.addEventListener('change', async () => {
  const f = file.files?.[0];
  file.value = '';
  if (!f) return;
  const dropped = await openFile(editor, f);
  const d = Object.entries(dropped);
  status.textContent = `${f.name} 열림${d.length ? ` · 버림: ${d.map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}`;
});
for (const b of document.querySelectorAll('[data-save]'))
  b.addEventListener('click', async () => {
    const n = await saveFile(editor, b.dataset.save);
    status.textContent = `${b.dataset.save.toUpperCase()} 저장 (${(n / 1024).toFixed(1)} KB)`;
  });
