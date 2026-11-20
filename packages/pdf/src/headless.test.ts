/**
 * 브라우저 없이 정본 → PDF (15 §5.4): 편집기를 만들지 않고 정본과 글꼴 파일만으로 PDF를 낸다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { quireFromText } from '@quire/sync';
import { loadSubsetter, pdfFromQuire } from './index';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const bytes = (p: string) => new Uint8Array(readFileSync(root(p)));

describe('pdfFromQuire (headless)', () => {
  it('lays out a canonical document with given fonts and writes a PDF', async () => {
    const q = quireFromText(['보고서 제목', '본문 문단입니다. 漢字도 섞습니다.', ...Array.from({ length: 80 }, (_, i) => `${i + 1}. 쪽을 넘기는 문단입니다.`)].join('\n'));
    (q.stories.body[0] as { p: Record<string, unknown> }).p.style = 'h1';
    const r = await pdfFromQuire(q, {
      fonts: [
        { name: 'Pretendard', bytes: bytes('fonts/pretendard/Pretendard-Regular.otf'), bold: bytes('fonts/pretendard/Pretendard-Bold.otf') },
        { name: 'Noto Sans KR', bytes: bytes('fonts/noto-sans-kr/NotoSansKR-Regular.otf') },
      ],
      subsetter: await loadSubsetter(readFileSync(root('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'))),
      title: '보고서',
    });
    expect(r.pages).toBeGreaterThan(1);
    expect(r.missingGlyphs).toBe(0);
    // 제목(굵게) · 본문 · 漢字: 얼굴 셋
    expect(r.fonts).toBe(3);
    expect(new TextDecoder('latin1').decode(r.bytes.subarray(0, 8))).toBe('%PDF-1.7');
  }, 60_000);

  it('writes link annotations only for safe links (16 §6)', async () => {
    const q = quireFromText('링크 문단');
    (q.stories.body[0] as { c: Array<{ t: string; m?: Record<string, unknown> }> }).c = [
      { t: '안전한 링크 ', m: { link: 'https://ok.example.com/' } },
      { t: '위험한 링크', m: { link: 'javascript:alert(1)' } },
    ];
    const r = await pdfFromQuire(q, {
      fonts: [{ name: 'Pretendard', bytes: bytes('fonts/pretendard/Pretendard-Regular.otf') }, { name: 'Noto Sans KR', bytes: bytes('fonts/noto-sans-kr/NotoSansKR-Regular.otf') }],
      subsetter: await loadSubsetter(readFileSync(root('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'))),
    });
    const text = new TextDecoder('latin1').decode(r.bytes);
    expect(text).toContain('https://ok.example.com/');
    expect(text).not.toMatch(/javascript/i);
  }, 60_000);
});
