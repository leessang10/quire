/**
 * .quire 파일을 협업(CRDT) 없이 (19 §4.1, P-1): 문서 JSON·자산 왕복, 이력(history/crdt.bin)은 열어 보지 않고 바이트 그대로 싣는다.
 * 그리고 core가 될 패키지들이 Loro·sync를 가져오지 않는지 (저장·불러오기만 하는 앱에 Loro가 묶이지 않게).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Document } from './document';
import { Doc } from './doc';
import { documentFromQuire, quireFromDocument, canonicalJson } from './canonical';
import { assetIdOf, openQuire, packQuire } from './quire-file';
import { readZip } from './zip';

const docOf = (text: string) => new Document(Doc.fromText(text));

describe('.quire without the CRDT', () => {
  it('saves and opens a document with formatting and assets', async () => {
    const document = docOf('첫 문단\n둘째');
    document.body.format(0, 1, 'bold', true);
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const id = await assetIdOf(bytes);
    const file = await packQuire({ document, assets: [{ id, mime: 'image/png', bytes }] });
    const names = (await readZip(file)).map((e) => e.name);
    expect(names).toEqual(['mimetype', 'manifest.json', 'document.json', `assets/${id}.png`]);
    const opened = await openQuire(file);
    expect(opened.text).toBe('첫 문단\n둘째\n');
    expect(opened.history).toBeNull();
    expect(opened.assets.map((a) => a.id)).toEqual([id]);
    expect(canonicalJson(quireFromDocument(documentFromQuire(opened.doc).document))).toBe(canonicalJson(quireFromDocument(document)));
  });

  it('keeps history bytes untouched through open → save (it does not read them)', async () => {
    const history = new Uint8Array([1, 2, 3, 250, 0, 7]); // core에게는 불투명한 바이트
    const first = await packQuire({ text: '하나\n둘\n', history });
    const opened = await openQuire(first);
    expect(opened.history).toEqual(history);
    expect(opened.notes).toEqual([]);
    const again = await packQuire({ document: documentFromQuire(opened.doc).document, history: opened.history! });
    expect((await openQuire(again)).history).toEqual(history);
    const manifest = JSON.parse(new TextDecoder().decode((await readZip(again)).find((e) => e.name === 'manifest.json')!.data));
    expect(manifest.files['history/crdt.bin'].stateHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('core does not depend on the CRDT (19 §4.1)', () => {
  it('model, layout, shaping, editor, sdk, convert, pdf sources import neither loro-crdt nor @quiredoc/sync', () => {
    const found: string[] = [];
    for (const p of ['model', 'layout', 'shaping', 'editor', 'sdk', 'convert', 'pdf']) {
      const dir = join('packages', p, 'src');
      for (const f of readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.|test-util/.test(f))) {
        const s = readFileSync(join(dir, f), 'utf8');
        if (/from '(loro-crdt|@quiredoc\/sync)[^']*'|import\('(loro-crdt|@quiredoc\/sync)/.test(s)) found.push(`${p}/${f}`);
      }
      const deps = JSON.parse(readFileSync(join('packages', p, 'package.json'), 'utf8')).dependencies ?? {};
      for (const d of ['loro-crdt', '@quiredoc/sync']) if (d in deps) found.push(`${p}/package.json: ${d}`);
    }
    expect(found).toEqual([]);
  });
});
