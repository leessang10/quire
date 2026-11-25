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

export function demoDoc(): QuireDoc {
  const p = (t: string, attrs: Record<string, unknown> = {}, m?: Record<string, unknown>) => ({ p: attrs, c: [{ t, ...(m ? { m } : {}) }] });
  return {
    format: 'quire',
    version: 1,
    settings: {},
    styles: {},
    sections: [{ id: 's1', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, columns: 1 }],
    stories: {
      body: [
        p('Quire로 써 보는 문서', { style: 'h1' }),
        p('이 화면은 그림이 아니라 실제 편집기입니다. 아무 곳이나 눌러 한글을 입력하고, 굵게·기울임·제목을 바꿔 보세요.'),
        p('글자는 브라우저의 텍스트 상자가 아니라 Quire의 조판 엔진이 캔버스에 직접 그립니다. 그래서 화면에서 본 쪽 나눔이 PDF와 인쇄에서도 그대로입니다.'),
        p('한글 조판', { style: 'h2' }),
        p('줄바꿈은 어절 단위로 하고, 닫는 문장부호는 줄 첫머리에 오지 않게 합니다. 양쪽 맞춤 문단에서는 어절 사이를 고르게 늘려 오른쪽 끝을 맞춥니다.', { align: 'justify' }),
        p('파일', { style: 'h2' }),
        p('위의 열기 단추로 HWPX·DOCX·Markdown 파일을 불러오고, 저장 단추로 HWPX·DOCX·Markdown·PDF를 내려받을 수 있습니다. 모든 처리는 이 브라우저 안에서만 일어납니다.', {}, { italic: true }),
      ],
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
