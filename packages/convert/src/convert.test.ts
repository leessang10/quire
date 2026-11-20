/**
 * 교환 포맷 (15 §6): 주요 요소 문서를 HTML·Markdown으로 내보냈다 가져오면, 그 포맷이 담는 요소(§6.1의 열)가 그대로다.
 * 다른 도구가 만든 HTML·Markdown도 읽고, 담지 못한 요소는 보고한다. 가져온 정본은 편집 문서로 열린다.
 */
import { describe, expect, it } from 'vitest';
import { documentFromQuire, assetIdOf, type QuireDoc, type QuireParagraph } from '@quire/sync';
import { SUPPORT, elementsDocument, exportHtml, exportMarkdown, firstDifference, importHtml, importMarkdown, project, toDataUrl, type ImportedAsset } from './index';

/** 2×1 PNG (검정·빨강) */
async function png(): Promise<Uint8Array> {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGNgYGD4z8DAAAAEAwEAmEtrpQAAAABJRU5ErkJggg==';
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function fixture() {
  const bytes = await png();
  const asset = await assetIdOf(bytes);
  const q = elementsDocument({ asset, w: 96 * 750, h: 48 * 750 });
  const read = async (id: string): Promise<ImportedAsset | null> => (id === asset ? { bytes, type: 'image/png' } : null);
  return { q, asset, bytes, read };
}

const bodyText = (q: QuireDoc) => q.stories.body.map((b) => ('c' in b ? (b as QuireParagraph).c.map((r) => r.t ?? '').join('') : '[표]'));

describe('HTML (15 §6.1)', () => {
  it('round-trips the major elements', async () => {
    const { q, asset, read } = await fixture();
    const html = await exportHtml(q, { asset: read, title: '주요 요소' });
    expect(html).toContain('<title>주요 요소</title>');
    expect(html).toContain('data:image/png;base64,');
    const r = await importHtml(html);
    expect(r.report.dropped).toEqual({});
    expect(firstDifference(project(q, SUPPORT.html), project(r.doc, SUPPORT.html))).toBeNull();
    // 이미지는 같은 자산 (같은 바이트 → 같은 ID)
    expect([...r.assets.keys()]).toEqual([asset]);
    // 제목 4–6과 코드 스타일이 정의된다
    expect(Object.keys(r.doc.styles).sort()).toEqual(['code', 'h4', 'h5', 'h6']);
    // 편집 문서로 열린다
    const { document } = documentFromQuire(r.doc);
    expect(document.body.text()).toContain('주요 요소 문서');
  });

  it('reads HTML from other tools and reports what it drops', async () => {
    const html = `<!doctype html><html><head><style>p{}</style><title>t</title></head><body>
      <h4>소제목</h4>
      <p style="text-align:center;line-height:150%;margin-left:24pt">가운데 <span style="font-family:'맑은 고딕',sans-serif;font-size:11pt">글꼴</span>
      <img src="https://example.com/a.png" alt="바깥 그림"><sup><a href="#fn1" id="fnref1">1</a></sup></p>
      <hr><video src="x.mp4"></video>
      <pre><code>if (a) {
  b();
}</code></pre>
      <table><colgroup><col width="100"><col width="200"></colgroup><tr><td valign="middle">가</td><td>나</td></tr></table>
      <section class="footnotes"><ol><li id="fn1"><p>각주 <b>본문</b> <a href="#fnref1">↩</a></p></li></ol></section>
      </body></html>`;
    const r = await importHtml(html);
    expect(r.report.dropped).toEqual({ '이미지 (외부 주소)': 1, 가로줄: 1, 동영상: 1 });
    const body = r.doc.stories.body;
    expect(bodyText(r.doc)).toEqual(['소제목', '가운데 글꼴 바깥 그림', 'if (a) {', '  b();', '}', '[표]']);
    expect((body[0] as QuireParagraph).p.style).toBe('h4');
    const p = body[1] as QuireParagraph;
    expect(p.p).toEqual({ align: 'center', line: { rule: 'multiple', value: 1.5 }, indent: { left: 24000 } });
    expect(p.c[1]!.m).toEqual({ font: '맑은 고딕', size: 11000 });
    const note = p.c.find((x) => x.img?.kind === 'note')!;
    const story = r.doc.stories[`fn|${note.img!.id}`] as QuireParagraph[];
    expect(story.map((s) => s.c.map((x) => x.t).join(''))).toEqual(['각주 본문']);
    expect((body[2] as QuireParagraph).p.style).toBe('code');
    const t = body[5] as { table: { cols: number[]; rows: Array<{ cells: Array<{ valign?: string }> }> } };
    expect(t.table.cols).toEqual([75000, 150000]);
    expect(t.table.rows[0]!.cells[0]!.valign).toBe('middle');
  });
});

describe('Markdown (15 §6.5)', () => {
  it('round-trips the major elements (Markdown column)', async () => {
    const { q, asset } = await fixture();
    const md = exportMarkdown(q);
    expect(md).toContain('###### 제목 6');
    expect(md).toContain('***굵은 기울임***');
    expect(md).toContain('[**굵은 링크**](https://example.com/b)');
    expect(md).toContain(`![파란 상자](assets/${asset})`);
    expect(md).toContain('    - 글머리 둘 (수준 2)');
    expect(md).toContain('```\nconst a = 1;\n  return a * 2;\n```');
    expect(md).toContain('[^1]: 각주 내용 **굵게**.');
    const r = await importMarkdown(md);
    expect(r.report.dropped).toEqual({});
    expect(firstDifference(project(q, SUPPORT.markdown), project(r.doc, SUPPORT.markdown))).toBeNull();
    // 내보낸 Markdown을 다시 내보내면 같다 (고정점)
    expect(exportMarkdown(r.doc)).toBe(md);
    documentFromQuire(r.doc);
  });

  it('parses common GFM', async () => {
    const md = [
      'Title',
      '=====',
      '',
      'Some *em* and __strong__ text with `code`, a <https://quire.dev> link,',
      'and a soft break. Escaped \\*star\\*.',
      '',
      '* one',
      '* two',
      '  * nested',
      '',
      '1) first',
      '2) second',
      '',
      '> quoted *line*',
      '',
      '---',
      '',
      '| A | B |',
      '|:--|--:|',
      '| a \\| b | ~~c~~ |',
      '',
      'Note here[^x] and ![remote](https://example.com/i.png).',
      '',
      '[^x]: The note.',
      '[^unused]: Never referenced.',
      '',
    ].join('\n');
    const r = await importMarkdown(md);
    expect(r.report.dropped).toEqual({ 가로줄: 1, '이미지 (외부 주소)': 1, '참조 없는 각주': 1 });
    const q = r.doc;
    expect(bodyText(q)).toEqual([
      'Title',
      'Some em and strong text with code, a https://quire.dev link, and a soft break. Escaped *star*.',
      'one',
      'two',
      'nested',
      'first',
      'second',
      'quoted line',
      '[표]',
      'Note here and remote.',
    ]);
    const p = q.stories.body as QuireParagraph[];
    expect(p[0]!.p.style).toBe('h1');
    expect(p[1]!.c.map((x) => x.m ?? {})).toEqual([{}, { italic: true }, {}, { bold: true }, {}, { font: 'monospace' }, {}, { link: 'https://quire.dev' }, {}]);
    expect(p[4]!.p.list).toMatchObject({ level: 1 });
    expect(p[7]!.p.style).toBe('quote');
    const cells = (q.stories.body[8] as unknown as { table: { rows: Array<{ cells: Array<{ story: string }> }> } }).table.rows[1]!.cells;
    expect((q.stories[cells[0]!.story] as QuireParagraph[])[0]!.c[0]!.t).toBe('a | b');
    expect((q.stories[cells[1]!.story] as QuireParagraph[])[0]!.c[0]).toEqual({ t: 'c', m: { strike: true } });
    expect(Object.keys(q.stories).filter((k) => k.startsWith('fn|'))).toHaveLength(1);
  });

  it('reads data URL images as assets with their size', async () => {
    const bytes = await png();
    const r = await importMarkdown(`![작은 그림](${toDataUrl({ bytes, type: 'image/png' })})\n`);
    const img = (r.doc.stories.body[0] as QuireParagraph).c[0]!.img!;
    expect(img).toMatchObject({ kind: 'image', alt: '작은 그림', w: 1500, h: 750 });
    expect(r.assets.get(img.asset!)?.bytes).toEqual(bytes);
  });
});
