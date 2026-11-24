/**
 * PDF 내보내기 (15 §5.2–5.3): 저장소 글꼴(Pretendard, Noto Sans KR)로 셰이핑·조판한 문서를 PDF로 낸다. 파일 구조(상호 참조),
 * 부분화한 글꼴(CID·W·ToUnicode), 글자 위치(TJ), 책갈피, 링크, 이미지(PNG 알파 → SMask)를 확인한다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Doc, Document } from '@quiredoc/model';
import { LayoutCache, PagedLayout, SectionFrames } from '@quiredoc/layout';
import { HbShaper, loadShapingFont, slotOf } from '@quiredoc/shaping';
import { DEFAULT_METRICS, Formatter, defaultPageSetup } from '@quiredoc/editor';
import { exportPdf, loadSubsetter, streamInflate, type PdfFontSource } from './index';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const regular = new Uint8Array(readFileSync(root('fonts/pretendard/Pretendard-Regular.otf')));
const bold = new Uint8Array(readFileSync(root('fonts/pretendard/Pretendard-Bold.otf')));
const noto = new Uint8Array(readFileSync(root('fonts/noto-sans-kr/NotoSansKR-Regular.otf')));
const wasm = readFileSync(root('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'));

const NL = '\n';

/** PNG 만들기 (시험용): 8비트, 필터 없음 */
async function png(width: number, height: number, type: 2 | 6, pixel: (x: number, y: number) => number[]): Promise<Uint8Array> {
  const ch = type === 6 ? 4 : 3;
  const raw = new Uint8Array(height * (1 + width * ch));
  let at = 0;
  for (let y = 0; y < height; y++) {
    raw[at++] = 0;
    for (let x = 0; x < width; x++) for (const v of pixel(x, y)) raw[at++] = v;
  }
  const cs = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  const idat = new Uint8Array(await new Response(cs).arrayBuffer());
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (tag: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = tag.charCodeAt(i);
    out.set(data, 8);
    let c = 0xffffffff;
    for (let i = 4; i < 8 + data.length; i++) c = crcTable[(c ^ out[i]!) & 0xff]! ^ (c >>> 8);
    v.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr.set([8, type, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function build() {
  const doc = Doc.fromText(
    ['첫째 장 제목', '본문은 Pretendard로, 漢字는 대체 글꼴로 그립니다.', '굵은 글과 링크가 있는 문단', '둘째 절', ...Array.from({ length: 50 }, (_, i) => `${i + 1}. 쪽을 넘기는 본문 문단입니다. 줄을 채우는 글이 이어집니다.`), '둘째 장'].join(NL),
  );
  const document = new Document(doc);
  const ps = () => doc.paragraphs();
  doc.setParaAttr(0, 'style', 'h1');
  doc.setParaAttr(3, 'style', 'h2');
  doc.setParaAttr(ps().length - 1, 'style', 'h1');
  doc.format(ps()[2]!.start, ps()[2]!.start + 2, 'bold', true);
  doc.format(ps()[2]!.start + 6, ps()[2]!.start + 8, 'link', 'https://example.com/문서');
  doc.insertObject(ps()[4]!.start, { id: 'img1', kind: 'image', asset: 'a'.repeat(32), w: 30000, h: 15000 });
  doc.insertObject(ps()[5]!.start, { id: 'img2', kind: 'image', asset: 'b'.repeat(32), w: 30000, h: 15000 });
  doc.takeParagraphChanges();

  const setup = defaultPageSetup(16);
  const fmt = new Formatter(() => document, setup, 16);
  const pre = loadShapingFont(regular, 'Pretendard');
  const slot0 = { ...slotOf(pre), bold: slotOf(loadShapingFont(bold, 'Pretendard Bold')) };
  const slots = [slot0, slotOf(loadShapingFont(noto, 'Noto Sans KR'))];
  const shaper = new HbShaper(slots, { size: 16 });
  fmt.reset(shaper, new LayoutCache(5000));
  fmt.syncSections();
  setup.ascent = pre.metrics.ascent;
  setup.descent = pre.metrics.descent;
  const layout = new PagedLayout(setup, shaper, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  document.body.takeParagraphChanges();
  layout.update(document.body.paragraphs(), null, Infinity, null);
  layout.finish();
  const env = {
    fmt, document, layout, setup, fontSize: 16, family: 'sans-serif', metrics: { ...DEFAULT_METRICS, ...pre.metrics },
    shapedFonts: ['f0', 'f1'], boldFonts: ['f0b', null], today: '2026. 11. 20.', images: { state: () => 'ready' as const },
  };
  const fonts: PdfFontSource = {
    count: 2,
    face: (s, b) => (s === 0 ? (b ? { bytes: bold, name: 'Pretendard-Bold' } : { bytes: regular, name: 'Pretendard-Regular' }) : s === 1 && !b ? { bytes: noto, name: 'NotoSansKR-Regular' } : null),
  };
  return { env, fonts, layout };
}

const latin = new TextDecoder('latin1');

/** 간접 개체들과 (압축을 푼) 스트림 */
async function parse(bytes: Uint8Array) {
  const s = latin.decode(bytes);
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)![1]);
  const xref = s.slice(startxref);
  const [, first, n] = /^xref\n(\d+) (\d+)\n/.exec(xref)!;
  expect(Number(first)).toBe(0);
  const entries = xref.split('\n').slice(2, 2 + Number(n));
  const objs = new Map<number, { dict: string; stream: Uint8Array | null }>();
  for (let i = 1; i < entries.length; i++) {
    const [off, , kind] = entries[i]!.trim().split(' ');
    if (kind !== 'n') continue;
    const at = Number(off);
    expect(s.startsWith(`${i} 0 obj\n`, at)).toBe(true);
    const end = s.indexOf('\nendobj\n', at);
    const body = s.slice(at + `${i} 0 obj\n`.length, end);
    const si = body.indexOf('\nstream\n');
    if (si < 0) {
      objs.set(i, { dict: body, stream: null });
      continue;
    }
    const dict = body.slice(0, si);
    const len = Number(/\/Length (\d+)/.exec(dict)![1]);
    const dataAt = at + `${i} 0 obj\n`.length + si + '\nstream\n'.length;
    let data = bytes.subarray(dataAt, dataAt + len);
    expect(s.startsWith('\nendstream', dataAt + len)).toBe(true);
    if (dict.includes('/Filter /FlateDecode') && !dict.includes('/DecodeParms')) data = await streamInflate(data);
    objs.set(i, { dict, stream: data });
  }
  return objs;
}

describe('PDF export (15 §5.2)', () => {
  it('writes a valid PDF with subset CID fonts, positioned glyphs, outline, links and images', async () => {
    const { env, fonts, layout } = build();
    const subsetter = await loadSubsetter(wasm);
    const solid = await png(4, 2, 2, (x) => [x * 60, 100, 200]);
    const alpha = await png(4, 2, 6, (x, y) => [255, 0, 0, (x + y) * 40]);
    const r = await exportPdf({ env, fonts, subsetter, title: '시험 문서', asset: async (id) => (id.startsWith('a') ? solid : alpha) });
    // 눈으로 볼 때: QUIRE_PDF_OUT=경로
    if (process.env.QUIRE_PDF_OUT) writeFileSync(process.env.QUIRE_PDF_OUT, r.bytes);
    expect(r.pages).toBe(layout.pageCount);
    expect(r.pages).toBeGreaterThan(1);
    expect(r.missingGlyphs).toBe(0);
    expect(r.images).toBe(2);
    // Pretendard 보통·굵게, Noto Sans KR (漢字)
    expect(r.fonts).toBe(3);
    // 부분화: 원본 글꼴(1.5 MB × 2 + 4 MB)보다 훨씬 작다
    expect(r.bytes.length).toBeLessThan(300_000);

    const objs = await parse(r.bytes);
    const dicts = [...objs.values()].map((o) => o.dict);
    const pages = dicts.filter((d) => d.includes('/Type /Page '));
    expect(pages.length).toBe(r.pages);
    expect(dicts.filter((d) => d.includes('/Subtype /Type0')).length).toBe(3);
    expect(dicts.filter((d) => d.includes('/Subtype /CIDFontType0')).length).toBe(3);
    // 링크 (퍼센트 인코딩), 책갈피 3개 (h1 › h2, h1)
    expect(dicts.some((d) => d.includes('/S /URI /URI (https://example.com/%EB%AC%B8%EC%84%9C)'))).toBe(true);
    expect(dicts.find((d) => d.includes('/Type /Outlines'))).toContain('/Count 3');
    // 알파 PNG → SMask
    expect(dicts.some((d) => d.includes('/SMask'))).toBe(true);
    expect(dicts.some((d) => d.includes('/Predictor 15'))).toBe(true);

    // ToUnicode: 쪽 내용의 글자를 되살린다
    const cmaps = [...objs.values()].filter((o) => o.stream && latin.decode(o.stream).includes('beginbfchar')).map((o) => latin.decode(o.stream!));
    const toText = new Map<string, string>();
    for (const c of cmaps)
      for (const m of c.matchAll(/<([0-9A-F]{4})> <([0-9A-F]+)>/g)) {
        const hex = m[2]!;
        let t = '';
        for (let i = 0; i < hex.length; i += 4) t += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
        toText.set(m[1]!, (toText.get(m[1]!) ?? '') || t);
      }
    const content = [...objs.values()].filter((o) => o.stream && /\bTJ\b/.test(latin.decode(o.stream))).map((o) => latin.decode(o.stream!));
    expect(content.length).toBe(r.pages);
    const words = content[0]!.match(/\[[^\]]*\] TJ/g)!.map((tj) => [...tj.matchAll(/<([0-9A-F]+)>/g)].map((m) => m[1]!.match(/.{4}/g)!.map((c) => toText.get(c) ?? '?').join('')).join(''));
    // 조각은 어절·글꼴·서식 경계에서 나뉜다: 이어 붙여 본다
    const text = words.join('');
    expect(text).toContain('첫째장제목');
    expect(text).toContain('본문은Pretendard로,漢字는대체글꼴로그립니다.');
    expect(text).toContain('굵은글과링크가있는문단');
    // 굵은 얼굴 (합성 굵게가 아님): 2 Tr 없음
    expect(content[0]).not.toContain('2 Tr');
    // 이미지를 그렸다
    expect(content[0]).toMatch(/\/Im1 Do/);
  }, 60_000);

  it('is deterministic', async () => {
    const subsetter = await loadSubsetter(wasm);
    const a = await exportPdf({ ...build(), subsetter, asset: async () => null });
    const b = await exportPdf({ ...build(), subsetter, asset: async () => null });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  }, 60_000);
});
