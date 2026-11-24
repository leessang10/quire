/**
 * Quire 예제 공통 (프레임워크 무관): 글꼴 위치, 처음 문서, 파일 열기·저장(HWPX·DOCX·Markdown·HTML·PDF), 예제 플러그인.
 * 예제마다 이 파일을 복사해 쓴다 (examples/shared/quire-demo.ts가 원본).
 *
 * 앱이 공개 폴더에 둘 것 (examples/shared/copy-assets.mjs가 복사한다):
 *   <public>/quire/fonts/…              @quiredoc/fonts의 글꼴 조각
 *   <public>/quire/harfbuzz-subset.wasm  PDF 글꼴 부분화
 */
import type { QuireDoc, QuireHandle, QuirePlugin } from '@quiredoc/core';
import { DEFAULT_LOCALE, Messages, dropMessageKey, highlightWordsPlugin, wordCountPlugin, type DropKind, type FontSource, type MessageKey, type WordCount } from '@quiredoc/core';

export const ASSET_BASE = '/quire';

/** 엔진 글꼴: 문서에 나온 글자가 든 조각만 받는다 */
export const fonts: FontSource[] = [
  { name: 'Pretendard', manifest: `${ASSET_BASE}/fonts/pretendard/manifest.json`, bold: { manifest: `${ASSET_BASE}/fonts/pretendard-bold/manifest.json` } },
  { name: 'Noto Sans KR', manifest: `${ASSET_BASE}/fonts/noto-sans-kr/manifest.json` },
];

/** 처음 문서 (정본) */
export function sampleDoc(framework: string): QuireDoc {
  const p = (t: string, attrs: Record<string, unknown> = {}, m?: Record<string, unknown>) => ({ p: attrs, c: [{ t, ...(m ? { m } : {}) }] });
  return {
    format: 'quire',
    version: 1,
    settings: {},
    styles: {},
    sections: [{ id: 's1', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, columns: 1 }],
    stories: {
      body: [
        p(`Quire 예제: ${framework}`, { style: 'h1' }),
        p('이 문서는 캔버스에 직접 그려집니다. 굵게·기울임 단추와 실행 취소를 써 보고, HWPX·DOCX·Markdown 파일을 열거나 PDF로 저장해 보세요.'),
        p('강조 낱말 플러그인이 "Quire"를 칠하고, 글자 수 플러그인이 아래 상태 줄을 채웁니다.', {}, { italic: true }),
        p('한글 조판', { style: 'h2' }),
        p('줄바꿈은 어절 단위이고, 닫는 문장부호는 줄 첫머리에 오지 않습니다. 양쪽 맞춤 문단에서는 어절 사이를 고르게 늘립니다.', { align: 'justify' }),
      ],
    },
    annotations: [],
  } as unknown as QuireDoc;
}

/** 예제 플러그인: 글자 수(콜백), 강조 낱말 */
export function demoPlugins(onCount: (c: WordCount) => void): QuirePlugin[] {
  return [wordCountPlugin(onCount), highlightWordsPlugin(['Quire'])];
}

export type SaveKind = 'hwpx' | 'docx' | 'md' | 'html' | 'pdf';

const MIME: Record<SaveKind, string> = {
  hwpx: 'application/hwp+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  html: 'text/html',
  pdf: 'application/pdf',
};

/** 파일을 열어 문서를 바꾼다. 버린 요소를 편집기 언어의 이름으로 돌려준다 (이름 → 개수) */
export async function openFile(h: { load: QuireHandle['load']; editor?: { t: (key: MessageKey) => string } }, file: File): Promise<Record<string, number>> {
  const c = await import('@quiredoc/convert');
  const name = file.name.toLowerCase();
  const r = name.endsWith('.hwpx')
    ? await c.importHwpx(new Uint8Array(await file.arrayBuffer()))
    : name.endsWith('.docx')
      ? await c.importDocx(new Uint8Array(await file.arrayBuffer()))
      : name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')
        ? await c.importMarkdown(await file.text())
        : await c.importHtml(await file.text());
  await h.load(r.doc, r.assets);
  const t = h.editor?.t ?? ((k: MessageKey) => new Messages(DEFAULT_LOCALE).t(k));
  return Object.fromEntries(Object.entries(r.report.dropped).map(([k, n]) => [t(dropMessageKey(k as DropKind)), n ?? 0]));
}

/** 지금 문서를 그 형식의 바이트·글로 */
export async function exportAs(h: QuireHandle, kind: SaveKind): Promise<Uint8Array | string> {
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
  if (kind === 'html') return c.exportHtml(q, { title: src.title, asset });
  return c.exportMarkdown(q);
}

/** 저장 (내려받기) */
export async function saveFile(h: QuireHandle, kind: SaveKind): Promise<number> {
  const data = await exportAs(h, kind);
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[kind] }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(h.editor.printSource().title || 'quire').replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'quire'}.${kind}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return data.length;
}

export const ACCEPT = '.hwpx,.docx,.md,.markdown,.txt,.html,.htm';
