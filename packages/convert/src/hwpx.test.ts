/**
 * HWPX (15 §6.4): 주요 요소 문서를 HWPX로 내보냈다 가져오면 HWPX 열의 요소가 그대로다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetIdOf, documentFromQuire, readZip } from '@quire/sync';
import { SUPPORT, elementsDocument, exportHwpx, firstDifference, importHwpx, project, type ImportedAsset } from './index';
import { parseXml } from './xml';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGNgYGD4z8DAAAAEAwEAmEtrpQAAAABJRU5ErkJggg==';
const png = () => Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));

async function fixture() {
  const bytes = png();
  const asset = await assetIdOf(bytes);
  const q = elementsDocument({ asset, w: 96 * 750, h: 48 * 750 });
  const read = async (id: string): Promise<ImportedAsset | null> => (id === asset ? { bytes, type: 'image/png' } : null);
  return { q, asset, read };
}

describe('HWPX export (15 §6.4)', () => {
  it('writes the OWPML package', async () => {
    const { q, read } = await fixture();
    const hwpx = await exportHwpx(q, { asset: read, title: '주요 요소' });
    if (process.env.QUIRE_HWPX_OUT) writeFileSync(process.env.QUIRE_HWPX_OUT, hwpx);
    const entries = await readZip(hwpx);
    expect(entries[0]).toMatchObject({ name: 'mimetype', method: 0 });
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('application/hwp+zip');
    const names = entries.map((e) => e.name);
    for (const n of ['Contents/header.xml', 'Contents/section0.xml', 'Contents/section1.xml', 'Contents/content.hpf', 'META-INF/container.xml', 'BinData/image1.png']) expect(names).toContain(n);
    for (const e of entries.filter((e) => e.name.endsWith('.xml') || e.name.endsWith('.hpf') || e.name.endsWith('.rdf'))) expect(parseXml(new TextDecoder().decode(e.data)).name, e.name).not.toBe('#root');
  });

  it('round-trips the major elements (HWPX column)', async () => {
    const { q, asset, read } = await fixture();
    const hwpx = await exportHwpx(q, { asset: read, title: '주요 요소' });
    const r = await importHwpx(hwpx);
    expect(r.report.dropped).toEqual({});
    expect(firstDifference(project(q, SUPPORT.hwpx), project(r.doc, SUPPORT.hwpx))).toBeNull();
    expect([...r.assets.keys()]).toEqual([asset]);
    expect(Buffer.from(await exportHwpx(q, { asset: read, title: '주요 요소' })).equals(Buffer.from(hwpx))).toBe(true);
    const { document } = documentFromQuire(r.doc);
    expect(document.threads()).toHaveLength(2);
  });

  // 한글로 열어 다시 저장한 파일 (한글이 있는 기기에서만): QUIRE_HWP_RESAVED=경로
  it.skipIf(!process.env.QUIRE_HWP_RESAVED)('reads the file Hangul resaved', async () => {
    const { q, asset } = await fixture();
    const r = await importHwpx(new Uint8Array(readFileSync(process.env.QUIRE_HWP_RESAVED!)));
    expect(r.report.dropped).toEqual({});
    expect(firstDifference(project(q, SUPPORT.hwpx), project(r.doc, SUPPORT.hwpx))).toBeNull();
    expect([...r.assets.keys()]).toEqual([asset]);
  });
});
