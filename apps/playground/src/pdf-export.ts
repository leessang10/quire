/**
 * PDF 내보내기·인쇄 (15 §5.2–5.4): 편집기의 쪽을 @quiredoc/pdf로 PDF로 만들어 새 창에 연다 (브라우저 PDF 보기에서 인쇄).
 * PDF 모듈과 hb-subset WASM은 처음 내보낼 때 불러온다.
 */
import type { Editor } from '@quiredoc/editor';
import type { Subsetter } from '@quiredoc/pdf';
import subsetWasm from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';

let subsetter: Promise<Subsetter> | null = null;

export interface PdfExportStats {
  pages: number;
  bytes: number;
  ms: number;
  fonts: number;
  images: number;
  missingGlyphs: number;
}

export async function editorPdf(editor: Editor): Promise<{ blob: Blob; stats: PdfExportStats }> {
  const t0 = performance.now();
  const pdf = await import('@quiredoc/pdf');
  subsetter ??= fetch(subsetWasm)
    .then((r) => r.arrayBuffer())
    .then((b) => pdf.loadSubsetter(b));
  const src = editor.printSource();
  const r = await pdf.exportPdf({ env: src.env, fonts: src.fonts, asset: src.asset, subsetter: await subsetter, title: src.title });
  const blob = new Blob([r.bytes as BlobPart], { type: 'application/pdf' });
  return { blob, stats: { pages: r.pages, bytes: r.bytes.length, ms: performance.now() - t0, fonts: r.fonts, images: r.images, missingGlyphs: r.missingGlyphs } };
}

/** 내보내 새 창에 연다. 창은 누른 즉시 연다 (팝업 차단을 피해) */
export function openPdf(editor: Editor, onDone?: (s: PdfExportStats) => void): void {
  const win = window.open('', '_blank');
  if (win) win.document.title = 'PDF 만드는 중…';
  editorPdf(editor).then(
    ({ blob, stats }) => {
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else {
        // 팝업이 막혔으면 내려받기
        const a = document.createElement('a');
        a.href = url;
        a.download = `${editor.printSource().title || 'quire'}.pdf`;
        a.click();
      }
      (window as unknown as { lastPdf?: PdfExportStats & { url: string } }).lastPdf = { ...stats, url };
      onDone?.(stats);
    },
    (e: unknown) => {
      win?.close();
      console.error(e);
      alert(`PDF를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    },
  );
}
