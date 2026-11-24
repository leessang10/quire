/**
 * 보안·견고성 (16 §6, R4): 위험한 링크를 가져오기·내보내기에서 막고, 압축 폭탄·깊은 중첩·망가진 파일에서
 * 멈추거나(무한 루프·스택 넘침) 엉뚱한 예외 없이 끝난다. 가져오기에 성공한 정본은 편집 문서로 열린다.
 */
import { describe, expect, it } from 'vitest';
import { safeLink } from '@quiredoc/model';
import { assetIdOf, documentFromQuire, migrateQuire, openQuire, packQuire, readZip, writeZip, type QuireDoc } from '@quiredoc/model';
import { elementsDocument, exportDocx, exportHtml, exportHwpx, exportMarkdown, importDocx, importHtml, importHwpx, importMarkdown, type ImportedAsset } from './index';
import { parseXml } from './xml';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 2×1 PNG */
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGNgYGD4z8DAAAAEAwEAmEtrpQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

async function fixture() {
  const asset = await assetIdOf(PNG);
  const q = elementsDocument({ asset, w: 96 * 750, h: 48 * 750 });
  const read = async (id: string): Promise<ImportedAsset | null> => (id === asset ? { bytes: PNG, type: 'image/png' } : null);
  return { q, read };
}

/** 본문 첫 문단에 링크 런을 더한 정본 */
function withLinks(q: QuireDoc, links: string[]): QuireDoc {
  const c = structuredClone(q);
  const p = c.stories.body.find((b) => 'c' in b) as { c: Array<{ t?: string; m?: Record<string, unknown> }> };
  for (const href of links) p.c.push({ t: ` 링크(${links.indexOf(href)})`, m: { link: href } });
  return c;
}

const DANGEROUS = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', '\u0001javascript:x', 'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd'];
const SAFE = ['https://example.com/a?b=c#d', 'http://example.com', 'mailto:a@example.com', 'tel:+82-2-123-4567', '#section-2', 'docs/page.html', '//example.com/x'];

/** 정본 안 모든 링크 */
function linksOf(q: QuireDoc): string[] {
  const out: string[] = [];
  for (const story of Object.values(q.stories)) {
    if (!Array.isArray(story)) continue;
    for (const b of story) if (b && typeof b === 'object' && 'c' in b) for (const r of (b as { c: Array<{ m?: { link?: string } }> }).c) if (r.m?.link) out.push(r.m.link);
  }
  return out;
}

/** zip 안 모든 텍스트 항목을 이어 붙인 것 */
async function zipText(bytes: Uint8Array): Promise<string> {
  return (await readZip(bytes)).map((e) => dec.decode(e.data)).join('\n');
}

describe('links (16 §6)', () => {
  it('allows web, mail, phone and relative links and blocks other schemes', () => {
    for (const u of SAFE) expect(safeLink(u), u).toBe(u);
    for (const u of DANGEROUS) expect(safeLink(u), JSON.stringify(u)).toBeNull();
    expect(safeLink('  https://example.com  ')).toBe('https://example.com');
    expect(safeLink('')).toBeNull();
    expect(safeLink(42)).toBeNull();
  });

  it('exports never write dangerous links (HTML, Markdown, DOCX, HWPX)', async () => {
    const { q, read } = await fixture();
    const doc = withLinks(q, [...DANGEROUS, 'https://ok.example.com/']);
    const before = JSON.stringify(doc);
    const html = await exportHtml(doc, { asset: read });
    const md = exportMarkdown(doc);
    const docx = await zipText(await exportDocx(doc, { asset: read }));
    const hwpx = await zipText(await exportHwpx(doc, { asset: read }));
    for (const [name, out] of [['html', html], ['md', md], ['docx', docx], ['hwpx', hwpx]] as const) {
      expect(out, name).not.toMatch(/javascript|vbscript|data:text\/html|file:\/\/\//i);
      expect(out, name).toContain('https://ok.example.com/');
    }
    // 부른 쪽 정본은 그대로
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('imports drop dangerous links and report them', async () => {
    const html = `<p><a href="javascript:alert(1)">가</a> <a href="https://ok.example.com/">나</a> <a href=" JAVA&#9;SCRIPT:x">다</a></p>`;
    const h = await importHtml(html);
    expect(linksOf(h.doc)).toEqual(['https://ok.example.com/']);
    expect(h.report.dropped.unsafeLink).toBe(2);
    const m = await importMarkdown('[가](javascript:alert(1)) [나](https://ok.example.com/) <vbscript:x>\n');
    expect(linksOf(m.doc)).toEqual(['https://ok.example.com/']);
    expect(m.report.dropped.unsafeLink).toBeGreaterThanOrEqual(1);
    // DOCX·HWPX: 다른 도구가 위험한 링크를 넣은 파일 (우리 내보내기는 쓰지 않으므로 바이트를 고친다)
    const { q, read } = await fixture();
    const marked = withLinks(q, ['https://evil.example.invalid/']);
    for (const [exp, imp] of [[exportDocx, importDocx], [exportHwpx, importHwpx]] as const) {
      const entries = await readZip(await exp(marked, { asset: read }));
      const patched: Array<{ name: string; data: Uint8Array; deflate: boolean }> = entries.map((e) => ({ name: e.name, data: enc.encode(dec.decode(e.data).replaceAll('https://evil.example.invalid/', 'javascript:alert(1)')), deflate: true }));
      // 그림 같은 바이너리 항목은 그대로
      for (let i = 0; i < entries.length; i++) if (!/\.(xml|rels|hpf|txt)$|mimetype/.test(entries[i]!.name)) patched[i]!.data = entries[i]!.data;
      const r = await imp(await writeZip(patched));
      expect(linksOf(r.doc).some((l) => /javascript/i.test(l))).toBe(false);
      expect(r.report.dropped.unsafeLink).toBe(1);
    }
  });
});

describe('size limits (16 §6)', () => {
  it('stops inflating an entry that grows past its declared size (zip bomb)', async () => {
    const big = new Uint8Array(4 * 2 ** 20); // 4 MiB of zeros → a few KB deflated
    const z = await writeZip([{ name: 'a.xml', data: big, deflate: true }]);
    // 중앙 디렉터리의 풀린 크기를 1 KiB로 속인다
    const view = new DataView(z.buffer, z.byteOffset, z.byteLength);
    for (let i = z.length - 22; i >= 0; i--)
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 1024, true);
        break;
      }
    await expect(readZip(z)).rejects.toThrow(/zip: a\.xml is damaged/);
  });

  it('refuses entries and archives over the limits before inflating', async () => {
    const z = await writeZip([{ name: 'a.xml', data: new Uint8Array(2 * 2 ** 20), deflate: true }, { name: 'b.xml', data: new Uint8Array(2 * 2 ** 20), deflate: true }]);
    await expect(readZip(z, { maxEntryBytes: 2 ** 20 })).rejects.toThrow(/too large/);
    await expect(readZip(z, { maxTotalBytes: 3 * 2 ** 20 })).rejects.toThrow(/contents too large/);
    await expect(readZip(z, { maxEntries: 1 })).rejects.toThrow(/too many entries/);
    expect(await readZip(z)).toHaveLength(2);
  });

  it('reports truncated or garbage zips as damaged files', async () => {
    const z = await writeZip([{ name: 'a.xml', data: enc.encode('<a/>'.repeat(1000)), deflate: true }]);
    for (const bad of [z.slice(0, z.length - 30), z.slice(10), new Uint8Array(100), new Uint8Array(0)]) await expect(readZip(bad)).rejects.toThrow(/^zip: /);
  });
});

describe('deep nesting (16 §6)', () => {
  const N = 100_000;
  it('XML deeper than the limit is a described error, not a stack overflow', async () => {
    expect(() => parseXml('<a>'.repeat(N) + '</a>'.repeat(N))).toThrow(/nested too deeply/);
    expect(() => parseXml('<a>'.repeat(200) + 'x' + '</a>'.repeat(200))).not.toThrow();
    const { q, read } = await fixture();
    const entries = await readZip(await exportDocx(q, { asset: read }));
    const patched = entries.map((e) =>
      e.name === 'word/document.xml' ? { name: e.name, data: enc.encode(dec.decode(e.data).replace('<w:body>', `<w:body>${'<w:sdt><w:sdtContent>'.repeat(N)}${'</w:sdtContent></w:sdt>'.repeat(N)}`)), deflate: true } : { name: e.name, data: e.data, deflate: true },
    );
    await expect(importDocx(await writeZip(patched))).rejects.toThrow(/nested too deeply/);
  });

  it('deeply nested HTML and Markdown import without overflowing the stack', async () => {
    const html = await importHtml('<div>'.repeat(N) + '깊은 글' + '</div>'.repeat(N));
    expect(JSON.stringify(html.doc)).toContain('깊은 글');
    for (const md of ['['.repeat(N) + '가' + '](x)'.repeat(N), '*'.repeat(N) + '가' + '*'.repeat(N), '> '.repeat(N) + '인용', '- '.repeat(N) + '목록', '`'.repeat(N)]) {
      const r = await importMarkdown(md);
      documentFromQuire(r.doc);
    }
  });
});

/** 시드 고정 난수 (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 바이트 망가뜨리기: 뒤집기·자르기·덧붙이기·구간 지우기 */
function mutateBytes(b: Uint8Array, r: () => number): Uint8Array {
  const out = Array.from(b);
  const ops = 1 + Math.floor(r() * 8);
  for (let k = 0; k < ops; k++) {
    const at = Math.floor(r() * out.length);
    const kind = r();
    if (kind < 0.5) out[at] = Math.floor(r() * 256);
    else if (kind < 0.7) out.splice(at, Math.floor(r() * 64));
    else if (kind < 0.85) out.splice(at, 0, ...Array.from({ length: Math.floor(r() * 32) }, () => Math.floor(r() * 256)));
    else out.length = Math.max(0, at);
  }
  return Uint8Array.from(out);
}

/** 글 망가뜨리기 (zip 안 XML·JSON, HTML, Markdown): 구간 지우기·복제·꺾쇠·따옴표 넣기 */
function mutateText(s: string, r: () => number): string {
  let out = s;
  const ops = 1 + Math.floor(r() * 6);
  for (let k = 0; k < ops; k++) {
    const at = Math.floor(r() * out.length);
    const len = Math.floor(r() * 80);
    const kind = r();
    if (kind < 0.35) out = out.slice(0, at) + out.slice(at + len);
    else if (kind < 0.6) out = out.slice(0, at) + out.slice(at, at + len) + out.slice(at);
    else if (kind < 0.8) out = out.slice(0, at) + ['<', '>', '"', "'", '&', '</', '/>', '[', ']', '(', '*', '`', '|', '\n', '<a>', '&#0;', '&#xFFFFFF;'][Math.floor(r() * 17)] + out.slice(at);
    else out = out.slice(0, at) + out.slice(at).replace(/\d+/, () => String(Math.floor(r() * 1e9) - 1e8));
  }
  return out;
}

/** JSON 구조 망가뜨리기: 아무 자리의 값을 엉뚱한 타입·큰 수로 바꾸거나 키를 지우거나 배열 항목을 복제 */
function mutateJson(src: unknown, r: () => number): unknown {
  const root = structuredClone(src) as Record<string, unknown>;
  const JUNK = [null, -1, 0, 1e9, -1e9, 3.5, NaN, '', 'x', ' ', [], {}, [[]], { c: 1 }, true, 'javascript:x'];
  const ops = 1 + Math.floor(r() * 5);
  for (let k = 0; k < ops; k++) {
    // 뿌리에서 무작위로 내려간다
    let parent: Record<string, unknown> | unknown[] = root;
    let key: string | number = Object.keys(root)[Math.floor(r() * Object.keys(root).length)]!;
    for (let d = 0; d < 12; d++) {
      const v: unknown = (parent as Record<string, unknown>)[key];
      if (!v || typeof v !== 'object' || r() < 0.15) break;
      const keys: Array<string | number> = Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v);
      if (!keys.length) break;
      parent = v as Record<string, unknown>;
      key = keys[Math.floor(r() * keys.length)]!;
    }
    const kind = r();
    if (kind < 0.6) (parent as Record<string, unknown>)[key] = JUNK[Math.floor(r() * JUNK.length)];
    else if (kind < 0.8) {
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete (parent as Record<string, unknown>)[key];
    } else if (Array.isArray(parent)) parent.splice(Number(key), 0, structuredClone(parent[Number(key)]));
  }
  return root;
}

/** 오류 종류별 수 (시험 끝에 찍는다) */
const errorKinds = new Map<string, number>();

/** 망가진 입력 하나: 끝나야 하고, 실패하면 Error, 성공하면 편집 문서로 열린다 */
async function survive(what: string, run: () => Promise<{ doc: QuireDoc }>, tally: Record<string, number>): Promise<void> {
  const t0 = performance.now();
  try {
    const r = await run();
    documentFromQuire(r.doc);
    tally.ok = (tally.ok ?? 0) + 1;
  } catch (e) {
    if (!(e instanceof Error)) throw new Error(`${what}: Error가 아닌 것을 던짐: ${String(e)}`);
    if (/Maximum call stack/i.test(e.message)) throw new Error(`${what}: 스택 넘침`);
    tally.error = (tally.error ?? 0) + 1;
    const kind = `${e.constructor.name}: ${e.message.replace(/\d+/g, 'N').slice(0, 70)}`;
    errorKinds.set(kind, (errorKinds.get(kind) ?? 0) + 1);
  }
  const ms = performance.now() - t0;
  if (ms > 5000) throw new Error(`${what}: ${Math.round(ms)} ms (멈춤에 가까움)`);
}

describe('fuzzing imports (16 §6)', () => {
  const CASES = 150;

  it('survives corrupted DOCX, HWPX and .quire files (bytes and inner XML/JSON)', async () => {
    const { q, read } = await fixture();
    const files = {
      docx: [await exportDocx(q, { asset: read }), importDocx] as const,
      hwpx: [await exportHwpx(q, { asset: read }), importHwpx] as const,
      quire: [await packQuire({ document: documentFromQuire(q).document, assets: [{ id: await assetIdOf(PNG), mime: 'image/png', bytes: PNG }] }), async (b: Uint8Array) => ({ doc: (await openQuire(b)).doc })] as const,
    };
    const tally: Record<string, Record<string, number>> = {};
    for (const [name, [bytes, open]] of Object.entries(files)) {
      const r = rng(name.length * 7919);
      const t = (tally[name] = {});
      const entries = await readZip(bytes);
      for (let i = 0; i < CASES; i++) {
        let input: Uint8Array;
        if (i % 2 === 0) input = mutateBytes(bytes, r);
        else {
          // 압축을 푼 XML·JSON을 망가뜨려 다시 묶는다 (zip 검사 너머의 읽기를 시험)
          const k = Math.floor(r() * entries.length);
          input = await writeZip(entries.map((e, j) => ({ name: e.name, data: j === k && !/\.(png|jpe?g|bin)$/.test(e.name) ? enc.encode(mutateText(dec.decode(e.data), r)) : e.data, deflate: e.method === 8 })));
        }
        await survive(`${name} #${i}`, () => open(input), t);
      }
    }
    // 망가뜨린 것 중 일부는 여전히 열리고 일부는 오류여야 시험이 양쪽 길을 탄다
    for (const t of Object.values(tally)) expect((t.ok ?? 0) + (t.error ?? 0)).toBe(CASES);
    console.log('퍼즈 (zip):', JSON.stringify(tally));
  }, 120_000);

  it('survives corrupted canonical JSON (.quire document.json past the hash check)', async () => {
    const { q } = await fixture();
    errorKinds.clear();
    const r = rng(7);
    const tally: Record<string, number> = {};
    for (let i = 0; i < CASES * 2; i++) {
      const raw = mutateJson(q, r);
      await survive(`json #${i}`, async () => ({ doc: migrateQuire(raw as QuireDoc).doc }), tally);
    }
    expect((tally.ok ?? 0) + (tally.error ?? 0)).toBe(CASES * 2);
    console.log('퍼즈 (정본 JSON):', JSON.stringify(tally));
    // 망가진 정본은 설명 있는 오류로 (내부 TypeError가 새어 나오지 않는다)
    expect([...errorKinds.keys()].filter((k) => !k.startsWith('Error: '))).toEqual([]);
    console.log([...errorKinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}\t${k}`).join('\n'));
  }, 120_000);

  it('survives corrupted HTML and Markdown', async () => {
    const { q, read } = await fixture();
    const html = await exportHtml(q, { asset: read });
    const md = exportMarkdown(q);
    const tally: Record<string, Record<string, number>> = { html: {}, md: {} };
    const r = rng(2026);
    for (let i = 0; i < CASES; i++) {
      await survive(`html #${i}`, () => importHtml(mutateText(html, r)), tally.html!);
      await survive(`md #${i}`, () => importMarkdown(mutateText(md, r)), tally.md!);
    }
    console.log('퍼즈 (글):', JSON.stringify(tally));
  }, 120_000);
});
