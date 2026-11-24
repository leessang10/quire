#!/usr/bin/env node
// 예제 6: Node (브라우저·DOM 없음) — 문서 변환기
//   node convert.mjs <입력> <출력>
//   입력: .hwpx .docx .md .html     출력: .pdf .hwpx .docx .md .html
// 모든 변환은 정본(QuireDoc)을 거친다. PDF는 @quiredoc/fonts의 글꼴 조각으로 서버에서 조판한다 (편집기와 같은 쪽 나눔).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { exportDocx, exportHtml, exportHwpx, exportMarkdown, importDocx, importHtml, importHwpx, importMarkdown, mimeOf } from '@quiredoc/convert';
import { loadSubsetter, pdfFromQuire } from '@quiredoc/pdf';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('사용법: node convert.mjs <입력(.hwpx|.docx|.md|.html)> <출력(.pdf|.hwpx|.docx|.md|.html)>');
  process.exit(1);
}
const require = createRequire(import.meta.url);
const t0 = performance.now();

// ── 가져오기 ──
const inExt = extname(input).toLowerCase();
const raw = readFileSync(input);
const imported =
  inExt === '.hwpx'
    ? await importHwpx(new Uint8Array(raw))
    : inExt === '.docx'
      ? await importDocx(new Uint8Array(raw))
      : inExt === '.md' || inExt === '.markdown'
        ? await importMarkdown(raw.toString('utf8'))
        : await importHtml(raw.toString('utf8'));
const { doc, assets, report } = imported;
const dropped = Object.entries(report.dropped);
console.log(`가져옴: ${input} (문단 ${doc.stories.body.length}개${dropped.length ? `, 버림: ${dropped.map(([k, n]) => `${k} ${n}`).join(', ')}` : ''})`);

// ── 내보내기 ──
const asset = async (id) => {
  const a = assets.get(id);
  return a ? { bytes: a.bytes, type: a.type || mimeOf(a.bytes) } : null;
};
const title = doc.stories.body.find((b) => b.c?.length)?.c.map((r) => r.t ?? '').join('') ?? '';
const outExt = extname(output).toLowerCase();
let data;
if (outExt === '.pdf') {
  // 글꼴: 조각 목록(manifest)의 조각마다 글꼴 자리 하나. 굵은 얼굴은 같은 이름의 조각
  const fontsDir = join(dirname(require.resolve('@quiredoc/fonts/package.json')), 'fonts');
  const manifest = (id) => JSON.parse(readFileSync(join(fontsDir, id, 'manifest.json'), 'utf8'));
  const read = (id, file) => new Uint8Array(readFileSync(join(fontsDir, id, file)));
  const pre = manifest('pretendard');
  const bold = new Map(manifest('pretendard-bold').chunks.map((c) => [c.name, c.file]));
  const fonts = [
    ...pre.chunks.map((c) => ({ name: `Pretendard ${c.name}`, bytes: read('pretendard', c.file), bold: bold.has(c.name) ? read('pretendard-bold', bold.get(c.name)) : undefined })),
    ...manifest('noto-sans-kr').chunks.map((c) => ({ name: `Noto Sans KR ${c.name}`, bytes: read('noto-sans-kr', c.file) })),
  ];
  const subsetter = await loadSubsetter(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')));
  const r = await pdfFromQuire(doc, { fonts, subsetter, title, asset: async (id) => assets.get(id)?.bytes ?? null });
  data = r.bytes;
  console.log(`PDF: ${r.pages}쪽, 글꼴 ${r.fonts}개, 이미지 ${r.images}개${r.missingGlyphs ? `, 빠진 글자 ${r.missingGlyphs}` : ''}`);
} else if (outExt === '.hwpx') data = await exportHwpx(doc, { title, asset });
else if (outExt === '.docx') data = await exportDocx(doc, { title, asset });
else if (outExt === '.md' || outExt === '.markdown') data = exportMarkdown(doc);
else if (outExt === '.html' || outExt === '.htm') data = await exportHtml(doc, { title, asset });
else {
  console.error(`모르는 출력 형식: ${outExt}`);
  process.exit(1);
}
writeFileSync(output, data);
console.log(`저장: ${output} (${(data.length / 1024).toFixed(1)} KB, ${Math.round(performance.now() - t0)} ms)`);
