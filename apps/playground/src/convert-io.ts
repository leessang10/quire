/**
 * HTML·Markdown 가져오기·내보내기 (15 §6, 5-5): 정본을 거친다. 변환 모듈은 처음 쓸 때 불러온다.
 */
import type { Editor } from '@quire/editor';
import { documentFromQuire, quireFromDocument } from '@quire/sync';

/** 마지막 가져오기·내보내기 결과 (상태 표시) */
export let lastConvert = '';

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const baseName = (editor: Editor) => (editor.printSource().title || 'quire').replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'quire';

/** 문서를 HTML·Markdown 글로 (내려받기 없이: 시험·확인용) */
export async function exportText(editor: Editor, kind: 'html' | 'md'): Promise<string> {
  const c = await import('@quire/convert');
  const q = quireFromDocument(editor.document);
  if (kind === 'md') return c.exportMarkdown(q);
  const src = editor.printSource();
  return c.exportHtml(q, {
    title: src.title,
    asset: async (id) => {
      const bytes = await src.asset(id);
      return bytes ? { bytes, type: c.mimeOf(bytes) } : null;
    },
  });
}

export async function saveAs(editor: Editor, kind: 'html' | 'md'): Promise<void> {
  const text = await exportText(editor, kind);
  download(`${baseName(editor)}.${kind}`, text, kind === 'html' ? 'text/html' : 'text/markdown');
  lastConvert = `${kind === 'html' ? 'HTML' : 'Markdown'} 내보냄 (${(text.length / 1024).toFixed(1)} KB)`;
}

/** 글(HTML·Markdown)을 가져와 편집기 문서로 바꾼다. 버린 요소를 돌려준다 */
export async function importText(editor: Editor, text: string, kind: 'html' | 'md'): Promise<Record<string, number>> {
  const c = await import('@quire/convert');
  const r = kind === 'html' ? await c.importHtml(text) : await c.importMarkdown(text);
  for (const [, a] of r.assets) await editor.putAsset(new Blob([a.bytes as BlobPart], { type: a.type }));
  editor.setDocument(documentFromQuire(r.doc).document);
  const dropped = Object.entries(r.report.dropped);
  lastConvert = `${kind === 'html' ? 'HTML' : 'Markdown'} 가져옴${dropped.length ? ` · 버림: ${dropped.map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}`;
  return r.report.dropped;
}

export async function openFile(editor: Editor, f: File): Promise<void> {
  const kind = /\.(md|markdown|txt)$/i.test(f.name) ? 'md' : 'html';
  await importText(editor, await f.text(), kind);
}
