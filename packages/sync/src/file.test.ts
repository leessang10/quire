/**
 * 정본 JSON·.quire 파일 시험 (07, 09 §9)
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '@quire/model';
import { canonicalJson, displayText, migrateQuire, quireFromText, stateHash, textFromQuire } from './canonical';
import { openQuire, packQuire } from './quire-file';
import { LoroWriter, initLoro, newLoro, readRaw, readState } from './shape';
import { crc32, readZip, writeZip } from './zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('canonical JSON', () => {
  it('serializes with fixed key order regardless of insertion order', () => {
    const a = canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: 'é' } });
    const b = canonicalJson({ a: { c: 'é', d: [1, { x: 1, y: 2 }] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{\n  "a": {\n    "c": "é",\n    "d": [\n      1,\n      {\n        "x": 1,\n        "y": 2\n      }\n    ]\n  },\n  "b": 1\n}\n');
  });

  it('round-trips paragraphs, empty paragraphs and astral characters', () => {
    for (const text of ['\n', '가\n', '첫 문단\n\n셋째 😀 문단\n', '\n\n\n']) {
      const q = quireFromText(text);
      expect(textFromQuire(q)).toBe(text);
      expect(textFromQuire(JSON.parse(canonicalJson(q)))).toBe(text);
    }
    expect(quireFromText('가\n\n').stories.body).toEqual([{ p: {}, c: [{ t: '가' }] }, { p: {}, c: [] }]);
  });

  it('joins runs and rejects content the model cannot hold', () => {
    const q = quireFromText('x\n');
    q.stories.body[0]!.c = [{ t: '굵' }, { t: '게' }];
    expect(textFromQuire(q)).toBe('굵게\n');
    const table = { ...q, stories: { body: [{ table: {} }] } } as unknown as Parameters<typeof textFromQuire>[0];
    expect(() => textFromQuire(table)).toThrow(/not a paragraph/);
    const field = { ...q, stories: { body: [{ p: {}, c: [{ field: 'pageNumber' }] }] } } as unknown as Parameters<typeof textFromQuire>[0];
    expect(() => textFromQuire(field)).toThrow(/not a text run/);
  });

  it('opens a newer schema read-only', () => {
    expect(migrateQuire({ ...quireFromText('a\n'), version: 2 }).readOnly).toBe(true);
    expect(() => migrateQuire({ format: 'docx', version: 1 })).toThrow();
  });

  it('hashes equal documents equally', async () => {
    expect(await stateHash(quireFromText('가\n나\n'))).toBe(await stateHash(JSON.parse(canonicalJson(quireFromText('가\n나\n')))));
    expect(await stateHash(quireFromText('가\n나\n'))).not.toBe(await stateHash(quireFromText('가\n다\n')));
  });
});

describe('zip', () => {
  it('writes and reads stored and deflated entries in order, deterministically', async () => {
    const entries = [
      { name: 'mimetype', data: enc.encode('application/vnd.quire') },
      { name: '한글/이름.bin', data: new Uint8Array([0, 1, 2, 255]) },
      { name: 'empty', data: new Uint8Array() },
      { name: 'text.txt', data: enc.encode('반복 '.repeat(500)), deflate: true },
    ];
    const z = await writeZip(entries);
    expect(await writeZip(entries)).toEqual(z);
    expect((await readZip(z)).map(({ name, data }) => ({ name, data }))).toEqual(entries.map(({ name, data }) => ({ name, data })));
    expect((await readZip(z)).map((e) => e.method)).toEqual([0, 0, 0, 8]);
    expect(z.length).toBeLessThan(1000);
    // mimetype은 첫 항목이고 압축하지 않아 파일 30바이트 뒤에 그대로 있다
    expect(dec.decode(z.subarray(38, 38 + 21))).toBe('application/vnd.quire');
  });

  it('detects damage', async () => {
    const z = await writeZip([{ name: 'a', data: enc.encode('hello') }]);
    z[31] ^= 1; // 데이터 한 바이트
    await expect(readZip(z)).rejects.toThrow(/crc/);
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });
});

/** 이동·숨김이 있어 구획이 여럿인 Loro 문서 */
function editedLoro(): ReturnType<typeof newLoro> {
  const loro = newLoro(7);
  initLoro(loro, '첫째\n둘째\n셋째\n넷째', 7);
  const { raw, keys } = readRaw(loro);
  const doc = Doc.fromRaw(raw, keys, readState(loro), loro.peerIdStr);
  const w = new LoroWriter(loro, () => doc.segmentOrder());
  doc.observe((c) => w.apply(c));
  doc.moveParagraphs(0, 0, 4);
  doc.hideParagraphs(1, 1);
  doc.insertText(0, '가');
  loro.commit();
  return loro;
}

describe('.quire file', () => {
  it('saves and opens with history when document.json matches crdt.bin', async () => {
    const loro = editedLoro();
    const text = displayText(loro);
    expect(text).toBe('가둘째\n넷째\n첫째\n');
    const bytes = await packQuire({ loro });
    const names = (await readZip(bytes)).map((e) => e.name);
    expect(names).toEqual(['mimetype', 'manifest.json', 'document.json', 'history/crdt.bin']);
    const opened = await openQuire(bytes);
    expect(opened.text).toBe(text);
    expect(opened.readOnly).toBe(false);
    expect(opened.notes).toEqual([]);
    expect(opened.crdt).not.toBeNull();
    const back = newLoro(8);
    back.import(opened.crdt!);
    expect(displayText(back)).toBe(text);
    // 같은 문서는 같은 바이트열
    expect(await packQuire({ loro })).toEqual(bytes);
  });

  it('drops crdt.bin when document.json was edited outside', async () => {
    const entries = await readZip(await packQuire({ loro: editedLoro() }));
    const doc = JSON.parse(dec.decode(entries[2]!.data));
    doc.stories.body[0].c[0].t = '고친 문단';
    entries[2]!.data = enc.encode(JSON.stringify(doc)); // 키 순서·공백도 다름
    const opened = await openQuire(await writeZip(entries));
    expect(opened.text).toBe('고친 문단\n넷째\n첫째\n');
    expect(opened.crdt).toBeNull();
    expect(opened.notes.join(' ')).toMatch(/history dropped/);
  });

  it('keeps crdt.bin when document.json was only reformatted', async () => {
    const entries = await readZip(await packQuire({ loro: editedLoro() }));
    entries[2]!.data = enc.encode(JSON.stringify(JSON.parse(dec.decode(entries[2]!.data))));
    const opened = await openQuire(await writeZip(entries));
    expect(opened.crdt).not.toBeNull();
  });

  it('opens a text-only file, and newer formats read-only', async () => {
    const bytes = await packQuire({ text: '하나\n둘\n' });
    expect((await readZip(bytes)).map((e) => e.name)).toEqual(['mimetype', 'manifest.json', 'document.json']);
    const opened = await openQuire(bytes);
    expect(opened).toMatchObject({ text: '하나\n둘\n', crdt: null, readOnly: false });
    const entries = await readZip(bytes);
    const m = JSON.parse(dec.decode(entries[1]!.data));
    m.formatVersion = 9;
    entries[1]!.data = enc.encode(JSON.stringify(m));
    expect((await openQuire(await writeZip(entries))).readOnly).toBe(true);
  });

  it('rejects files whose first entry is not the mimetype', async () => {
    const entries = await readZip(await packQuire({ text: 'a\n' }));
    await expect(openQuire(await writeZip([entries[1]!, entries[0]!, entries[2]!]))).rejects.toThrow(/mimetype/);
  });
});

describe('canonical JSON with formatting (10, step 2-2)', () => {
  it('round-trips marks and paragraph attributes through document.json', async () => {
    const { Doc } = await import('@quire/model');
    const { quireFromDoc, docFromQuire } = await import('./canonical');
    const doc = Doc.fromText('제목\n본문은 굵게, 이건 링크\n');
    doc.setParaAttr(0, 'style', 'Heading1');
    doc.setParaAttr(1, 'align', 'justify');
    doc.format(7, 9, 'bold', true);
    doc.format(11, 13, 'link', 'https://quire.dev');
    doc.format(11, 13, 'color', '#2563eb');
    const json = canonicalJson(quireFromDoc(doc));
    const q = JSON.parse(json);
    expect(q.stories.body[0]).toEqual({ p: { style: 'Heading1' }, c: [{ t: '제목' }] });
    expect(q.stories.body[1].c).toEqual([
      { t: '본문은 ' },
      { t: '굵게', m: { bold: true } },
      { t: ', ' },
      { t: '이건', m: { color: '#2563eb', link: 'https://quire.dev' } },
      { t: ' 링크' },
    ]);
    const { doc: back, notes } = docFromQuire(q);
    expect(notes).toEqual([]);
    expect(back.paragraphRuns()).toEqual(doc.paragraphRuns());
    // 같은 문서는 같은 바이트열
    expect(canonicalJson(quireFromDoc(back))).toBe(json);
  });

  it('drops keys this engine does not know, with notes', async () => {
    const { docFromQuire } = await import('./canonical');
    const q = quireFromText('가나\n');
    q.stories.body[0] = { p: { align: 'center', mystery: 1 }, c: [{ t: '가나', m: { bold: true, sparkle: true } as never }] };
    const { doc, notes } = docFromQuire(q);
    expect(doc.paraAttrs(0)).toEqual({ align: 'center' });
    expect(doc.marksAt(0)).toEqual({ bold: true });
    expect(notes.length).toBe(2);
  });
});
