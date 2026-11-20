/**
 * HTML·Markdown·DOCX 가져오기·내보내기 (15 §6, 5-5·5-6): 정본을 거친다. 변환 모듈은 처음 쓸 때 불러온다.
 */
import type { Editor } from '@quire/editor';
import { documentFromQuire, quireFromDocument } from '@quire/sync';

export type ConvertKind = 'html' | 'md' | 'docx';
const LABEL: Record<ConvertKind, string> = { html: 'HTML', md: 'Markdown', docx: 'DOCX' };
const MIME: Record<ConvertKind, string> = { html: 'text/html', md: 'text/markdown', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

/** 마지막 가져오기·내보내기 결과 (상태 표시) */
export let lastConvert = '';

function download(name: string, data: string | Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const baseName = (editor: Editor) => (editor.printSource().title || 'quire').replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'quire';

/** 문서를 내보낸다 (내려받기 없이: 시험·확인용) */
export async function exportAs(editor: Editor, kind: ConvertKind): Promise<string | Uint8Array> {
  const c = await import('@quire/convert');
  const q = quireFromDocument(editor.document);
  if (kind === 'md') return c.exportMarkdown(q);
  const src = editor.printSource();
  const asset = async (id: string) => {
    const bytes = await src.asset(id);
    return bytes ? { bytes, type: c.mimeOf(bytes) } : null;
  };
  return kind === 'html' ? c.exportHtml(q, { title: src.title, asset }) : c.exportDocx(q, { title: src.title, asset });
}

/** 글 형식 (HTML·Markdown) */
export async function exportText(editor: Editor, kind: 'html' | 'md'): Promise<string> {
  return (await exportAs(editor, kind)) as string;
}

export async function saveAs(editor: Editor, kind: ConvertKind): Promise<void> {
  const data = await exportAs(editor, kind);
  download(`${baseName(editor)}.${kind}`, data, MIME[kind]);
  lastConvert = `${LABEL[kind]} 내보냄 (${(data.length / 1024).toFixed(1)} KB)`;
}

/** 가져와 편집기 문서로 바꾼다. 버린 요소를 돌려준다 */
export async function importAs(editor: Editor, data: string | Uint8Array, kind: ConvertKind): Promise<Record<string, number>> {
  const c = await import('@quire/convert');
  const r = kind === 'html' ? await c.importHtml(data as string) : kind === 'md' ? await c.importMarkdown(data as string) : await c.importDocx(data as Uint8Array);
  for (const [, a] of r.assets) await editor.putAsset(new Blob([a.bytes as BlobPart], { type: a.type }));
  editor.setDocument(documentFromQuire(r.doc).document);
  const dropped = Object.entries(r.report.dropped);
  lastConvert = `${LABEL[kind]} 가져옴${dropped.length ? ` · 버림: ${dropped.map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}`;
  return r.report.dropped;
}

export function importText(editor: Editor, text: string, kind: 'html' | 'md'): Promise<Record<string, number>> {
  return importAs(editor, text, kind);
}

export async function openFile(editor: Editor, f: File): Promise<void> {
  if (/\.docx$/i.test(f.name)) await importAs(editor, new Uint8Array(await f.arrayBuffer()), 'docx');
  else await importAs(editor, await f.text(), /\.(md|markdown|txt)$/i.test(f.name) ? 'md' : 'html');
}
