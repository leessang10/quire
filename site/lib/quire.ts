/**
 * 데모 에디터가 쓰는 것: 글꼴 위치, 처음 문서, 파일 열기·저장 (HWPX·DOCX·Markdown·PDF).
 * 글꼴과 WASM은 postinstall(scripts/copy-assets.mjs)이 public/quire에 복사한다.
 */
import type { QuireDoc, QuireHandle } from '@quiredoc/core';
import type { FontSource } from '@quiredoc/core';

export const ASSET_BASE = '/quire';

export const fonts: FontSource[] = [
  { name: 'Pretendard', manifest: `${ASSET_BASE}/fonts/pretendard/manifest.json`, bold: { manifest: `${ASSET_BASE}/fonts/pretendard-bold/manifest.json` } },
  { name: 'Noto Sans KR', manifest: `${ASSET_BASE}/fonts/noto-sans-kr/manifest.json` },
];

const BODY = {
  ko: (p: P) => [
    p('첫 쪽', { style: 'h1' }),
    p('이 쪽은 그림이 아니라 실제 원고입니다. 아무 곳이나 눌러 한 문장 이어 써 보세요. 굵게, 기울임, 제목도 바꿔 볼 수 있습니다.'),
    p('글자는 브라우저의 글상자가 아니라 Quire의 조판 엔진이 한 줄씩 짜서 그립니다. 그래서 여기서 본 쪽이 PDF에서도, 종이에서도 같은 쪽입니다.'),
    p('조판에 대하여', { style: 'h2' }),
    p('줄은 어절 사이에서 바꾸고, 닫는 문장부호는 줄 첫머리에 두지 않습니다. 이 문단은 양쪽 맞춤이라 어절 사이를 고르게 늘려 오른쪽 끝을 맞춥니다.', { align: 'justify' }),
    p('원고를 옮기는 일', { style: 'h2' }),
    p('열기 단추로 HWPX·DOCX·Markdown 원고를 불러오고, 저장 단추로 HWPX·DOCX·Markdown·PDF를 내려받을 수 있습니다. 모든 일은 이 브라우저 안에서만 일어납니다.', {}, { italic: true }),
  ],
  en: (p: P) => [
    p('The first page', { style: 'h1' }),
    p('This page is not a picture; it is a real manuscript. Click anywhere and continue a sentence. You can also try bold, italic and headings.'),
    p('The text is not laid out by a browser text box. Quire’s own engine sets it line by line, so the page you see here is the same page in the PDF and on paper.'),
    p('On typesetting', { style: 'h2' }),
    p('Korean lines break between words, and closing punctuation never begins a line: 줄은 어절 사이에서 바꾸고, 닫는 문장부호는 줄 첫머리에 두지 않습니다. This paragraph is justified, so the spaces between words widen evenly to meet the right margin.', { align: 'justify' }),
    p('Moving manuscripts', { style: 'h2' }),
    p('Use Open to bring in an HWPX, DOCX or Markdown manuscript, and the save buttons to download HWPX, DOCX, Markdown or PDF. Everything happens inside this browser.', {}, { italic: true }),
  ],
};
type P = (t: string, attrs?: Record<string, unknown>, m?: Record<string, unknown>) => unknown;

export function demoDoc(lang: 'ko' | 'en' = 'ko'): QuireDoc {
  const p: P = (t, attrs = {}, m) => ({ p: attrs, c: [{ t, ...(m ? { m } : {}) }] });
  return {
    format: 'quire',
    version: 1,
    settings: {},
    styles: {},
    sections: [{ id: 's1', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, columns: 1 }],
    stories: {
      body: BODY[lang](p),
    },
    annotations: [],
  } as unknown as QuireDoc;
}

export type SaveKind = 'hwpx' | 'docx' | 'md' | 'pdf';
export const SAVE_KINDS: SaveKind[] = ['hwpx', 'docx', 'md', 'pdf'];
export const ACCEPT = '.hwpx,.docx,.md,.markdown,.txt';

const MIME: Record<SaveKind, string> = {
  hwpx: 'application/hwp+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  pdf: 'application/pdf',
};

/** 파일을 열어 문서를 바꾼다. 옮기지 못하고 버린 요소 수를 돌려준다 */
export async function openFile(h: { load: QuireHandle['load'] }, file: File): Promise<number> {
  const c = await import('@quiredoc/convert');
  const name = file.name.toLowerCase();
  const r = name.endsWith('.hwpx')
    ? await c.importHwpx(new Uint8Array(await file.arrayBuffer()))
    : name.endsWith('.docx')
      ? await c.importDocx(new Uint8Array(await file.arrayBuffer()))
      : await c.importMarkdown(await file.text());
  await h.load(r.doc, r.assets);
  return Object.values(r.report.dropped).reduce<number>((a, n) => a + (n ?? 0), 0);
}

async function exportAs(h: QuireHandle, kind: SaveKind): Promise<Uint8Array | string> {
  const src = h.editor.printSource();
  if (kind === 'pdf') {
    const pdf = await import('@quiredoc/pdf');
    const wasm = await fetch(`${ASSET_BASE}/harfbuzz-subset.wasm`).then((r) => r.arrayBuffer());
    const r = await pdf.exportPdf({ env: src.env, fonts: src.fonts, asset: src.asset, subsetter: await pdf.loadSubsetter(wasm), title: src.title });
    return r.bytes;
  }
  const c = await import('@quiredoc/convert');
  const q = h.toJSON();
  const asset = async (id: string) => {
    const bytes = await src.asset(id);
    return bytes ? { bytes, type: c.mimeOf(bytes) } : null;
  };
  if (kind === 'hwpx') return c.exportHwpx(q, { title: src.title, asset });
  if (kind === 'docx') return c.exportDocx(q, { title: src.title, asset });
  return c.exportMarkdown(q);
}

/** 저장 (내려받기). 바이트 수를 돌려준다 */
export async function saveFile(h: QuireHandle, kind: SaveKind): Promise<number> {
  const data = await exportAs(h, kind);
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[kind] }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(h.editor.printSource().title || 'quire').replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'quire'}.${kind}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
}
