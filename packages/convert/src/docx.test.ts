/**
 * DOCX (15 §6.3): 주요 요소 문서를 DOCX로 내보냈다 가져오면 DOCX 열의 요소(구역·머리말·떠 있는 그림·댓글·제안 포함)가 그대로다.
 * Word가 쓰는 모양(스타일 상속, 문서 기본값, 복합 필드, 세로 병합, 링크 관계, 답글 확장, 끝주석)도 읽는다.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetIdOf, documentFromQuire, readZip, writeZip, type QuireParagraph } from '@quiredoc/sync';
import { SUPPORT, elementsDocument, exportDocx, firstDifference, importDocx, project, type ImportedAsset } from './index';
import { parseXml } from './xml';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGNgYGD4z8DAAAAEAwEAmEtrpQAAAABJRU5ErkJggg==';
const png = () => Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));

describe('DOCX export/import (15 §6.3)', () => {
  it('round-trips the major elements (DOCX column)', async () => {
    const bytes = png();
    const asset = await assetIdOf(bytes);
    const q = elementsDocument({ asset, w: 96 * 750, h: 48 * 750 });
    const read = async (id: string): Promise<ImportedAsset | null> => (id === asset ? { bytes, type: 'image/png' } : null);
    const docx = await exportDocx(q, { asset: read, title: '주요 요소' });
    // Word로 열어 볼 때: QUIRE_DOCX_OUT=경로
    if (process.env.QUIRE_DOCX_OUT) writeFileSync(process.env.QUIRE_DOCX_OUT, docx);
    // 패키지: 필요한 부분이 있고 XML이 닫혀 있다
    const entries = await readZip(docx);
    const names = entries.map((e) => e.name);
    expect(names.slice(0, 2)).toEqual(['[Content_Types].xml', '_rels/.rels']);
    for (const n of ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/footnotes.xml', 'word/comments.xml', 'word/commentsExtended.xml', 'word/header1.xml', 'word/footer2.xml', 'word/media/image1.png'])
      expect(names).toContain(n);
    for (const e of entries.filter((e) => e.name.endsWith('.xml') || e.name.endsWith('.rels'))) {
      const xml = new TextDecoder().decode(e.data);
      expect(balanced(xml), e.name).toBe(true);
    }
    const r = await importDocx(docx);
    expect(r.report.dropped).toEqual({});
    expect(firstDifference(project(q, SUPPORT.docx), project(r.doc, SUPPORT.docx))).toBeNull();
    expect([...r.assets.keys()]).toEqual([asset]);
    // 같은 문서는 같은 바이트 (결정성)
    expect(Buffer.from(await exportDocx(q, { asset: read, title: '주요 요소' })).equals(Buffer.from(docx))).toBe(true);
    const { document } = documentFromQuire(r.doc);
    expect(document.threads()).toHaveLength(2);
    expect(document.body.text()).toContain('주요 요소 문서');
  });

  it('reads Word-style packages: inherited styles, defaults, complex fields, merges, replies, endnotes', async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';
    // 다른 접두사(ns0)를 써도 읽는다
    const doc = `<?xml version="1.0"?><ns0:document xmlns:ns0="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><ns0:body>
      <ns0:p><ns0:pPr><ns0:pStyle ns0:val="Title"/></ns0:pPr><ns0:r><ns0:t>문서 제목</ns0:t></ns0:r></ns0:p>
      <ns0:p><ns0:pPr><ns0:pStyle ns0:val="1"/></ns0:pPr><ns0:r><ns0:t>제목 하나</ns0:t></ns0:r></ns0:p>
      <ns0:p><ns0:r><ns0:rPr><ns0:rStyle ns0:val="Strong"/></ns0:rPr><ns0:t xml:space="preserve">강한 </ns0:t></ns0:r><ns0:commentRangeStart ns0:id="0"/><ns0:r><ns0:rPr><ns0:b ns0:val="0"/><ns0:sz ns0:val="22"/><ns0:highlight ns0:val="yellow"/></ns0:rPr><ns0:t>보통</ns0:t></ns0:r><ns0:commentRangeEnd ns0:id="0"/>
        <ns0:hyperlink r:id="rIdLink"><ns0:r><ns0:rPr><ns0:rStyle ns0:val="Hyperlink"/></ns0:rPr><ns0:t>링크</ns0:t></ns0:r></ns0:hyperlink>
        <ns0:r><ns0:t xml:space="preserve"> 쪽 </ns0:t></ns0:r><ns0:r><ns0:fldChar ns0:fldCharType="begin"/></ns0:r><ns0:r><ns0:instrText xml:space="preserve"> PAGE \\* MERGEFORMAT </ns0:instrText></ns0:r><ns0:r><ns0:fldChar ns0:fldCharType="separate"/></ns0:r><ns0:r><ns0:t>3</ns0:t></ns0:r><ns0:r><ns0:fldChar ns0:fldCharType="end"/></ns0:r>
        <ns0:r><ns0:t xml:space="preserve"> 끝</ns0:t></ns0:r><ns0:r><ns0:endnoteReference ns0:id="1"/></ns0:r><ns0:r><ns0:br/><ns0:t>둘째 줄</ns0:t></ns0:r></ns0:p>
      <ns0:p><ns0:pPr><ns0:pStyle ns0:val="ListBullet"/></ns0:pPr><ns0:r><ns0:t>스타일 목록</ns0:t></ns0:r></ns0:p>
      <ns0:tbl><ns0:tblGrid><ns0:gridCol ns0:w="2000"/><ns0:gridCol ns0:w="3000"/></ns0:tblGrid>
        <ns0:tr><ns0:tc><ns0:tcPr><ns0:vMerge ns0:val="restart"/></ns0:tcPr><ns0:p><ns0:r><ns0:t>세로</ns0:t></ns0:r></ns0:p></ns0:tc><ns0:tc><ns0:p><ns0:r><ns0:t>B1</ns0:t></ns0:r></ns0:p></ns0:tc></ns0:tr>
        <ns0:tr><ns0:tc><ns0:tcPr><ns0:vMerge/></ns0:tcPr><ns0:p/></ns0:tc><ns0:tc><ns0:p><ns0:r><ns0:t>B2</ns0:t></ns0:r></ns0:p></ns0:tc></ns0:tr>
      </ns0:tbl>
      <ns0:p><ns0:r><ns0:pict/></ns0:r><ns0:r><ns0:t>VML 뒤</ns0:t></ns0:r></ns0:p>
      <ns0:sectPr><ns0:pgSz ns0:w="16838" ns0:h="11906" ns0:orient="landscape"/><ns0:pgMar ns0:top="1000" ns0:right="1000" ns0:bottom="1000" ns0:left="1000" ns0:header="851" ns0:footer="992"/></ns0:sectPr>
    </ns0:body></ns0:document>`;
    const styles = `<?xml version="1.0"?><w:styles ${W}>
      <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="맑은 고딕"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style>
      <w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:rPr><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="a"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="a"/><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style>
      <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
      <w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
    </w:styles>`;
    const numbering = `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="●"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num></w:numbering>`;
    const comments = `<?xml version="1.0"?><w:comments ${W}>
      <w:comment w:id="0" w:author="Kim" w:date="2026-03-01T10:00:00Z"><w:p w14:paraId="0A000001"><w:r><w:t>첫 댓글</w:t></w:r></w:p></w:comment>
      <w:comment w:id="1" w:author="Lee" w:date="2026-03-01T11:00:00Z"><w:p w14:paraId="0A000002"><w:r><w:t>답글</w:t></w:r></w:p></w:comment>
    </w:comments>`;
    const ext = `<?xml version="1.0"?><w15:commentsEx ${W}><w15:commentEx w15:paraId="0A000001" w15:done="1"/><w15:commentEx w15:paraId="0A000002" w15:paraIdParent="0A000001" w15:done="0"/></w15:commentsEx>`;
    const endnotes = `<?xml version="1.0"?><w:endnotes ${W}><w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote><w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> 끝주석 내용</w:t></w:r></w:p></w:endnote></w:endnotes>`;
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rS" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rN" Type="${REL}/numbering" Target="numbering.xml"/>
      <Relationship Id="rC" Type="${REL}/comments" Target="comments.xml"/><Relationship Id="rX" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>
      <Relationship Id="rE" Type="${REL}/endnotes" Target="endnotes.xml"/><Relationship Id="rIdLink" Type="${REL}/hyperlink" Target="https://example.com/x" TargetMode="External"/></Relationships>`;
    const enc = (s: string) => new TextEncoder().encode(s);
    const pkg = await writeZip([
      { name: '_rels/.rels', data: enc(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${REL}/officeDocument" Target="/word/document.xml"/></Relationships>`) },
      { name: 'word/document.xml', data: enc(doc) },
      { name: 'word/_rels/document.xml.rels', data: enc(rels) },
      { name: 'word/styles.xml', data: enc(styles) },
      { name: 'word/numbering.xml', data: enc(numbering) },
      { name: 'word/comments.xml', data: enc(comments) },
      { name: 'word/commentsExtended.xml', data: enc(ext) },
      { name: 'word/endnotes.xml', data: enc(endnotes) },
    ]);
    const r = await importDocx(pkg);
    expect(r.report.dropped).toEqual({ vml: 1 });
    const body = r.doc.stories.body as QuireParagraph[];
    const texts = body.map((b) => ('c' in b ? b.c.map((x) => x.t ?? (x.img?.kind === 'field' ? `{${x.img.field}}` : x.img ? '¤' : '')).join('') : '[표]'));
    expect(texts).toEqual(['문서 제목', '제목 하나', '강한 보통링크 쪽 {page} 끝¤', '둘째 줄', '스타일 목록', '[표]', 'VML 뒤']);
    // Title은 상속을 푼 새 스타일, heading 1은 우리 제목 1
    expect(body[0]!.p.style).toBe('Title');
    expect(r.doc.styles.Title).toMatchObject({ label: 'Title', basedOn: 'body', para: { align: 'center' }, marks: { size: 28000 } });
    expect(body[1]!.p.style).toBe('h1');
    // 문서 기본값 (11pt, 맑은 고딕, 간격) → 본문 스타일. 그 크기·글꼴의 글자는 서식 없음
    expect(r.doc.styles.body).toMatchObject({ marks: { size: 11000, font: '맑은 고딕' }, para: { space: { after: 8000 }, line: { rule: 'multiple', value: 1.08 } } });
    const runs = body[2]!.c;
    expect(runs[0]).toEqual({ t: '강한 ', m: { bold: true } });
    expect(runs[1]).toEqual({ t: '보통', m: { highlight: '#ffff00' } });
    expect(runs[2]).toEqual({ t: '링크', m: { link: 'https://example.com/x' } });
    expect(body[4]!.p.list).toEqual({ id: 'w7', level: 0 });
    expect((r.doc.settings.lists as Record<string, { kind: string; levels: Array<{ text: string }> }>).w7).toMatchObject({ kind: 'bullet' });
    // 세로 병합
    const t = r.doc.stories.body[5] as unknown as { table: { cols: number[]; rows: Array<{ cells: Array<{ span?: number[] }> }> } };
    expect(t.table.cols).toEqual([100000, 150000]);
    expect(t.table.rows[0]!.cells[0]!.span).toEqual([2, 1]);
    expect(t.table.rows[1]!.cells).toHaveLength(1);
    // 끝주석은 각주로
    const note = runs.find((x) => x.img?.kind === 'note')!;
    expect((r.doc.stories[`fn|${note.img!.id}`] as QuireParagraph[])[0]!.c).toEqual([{ t: '끝주석 내용' }]);
    // 댓글: 답글이 스레드로, 해결 표시, 범위는 '보통'
    expect(r.doc.threads).toHaveLength(1);
    const th = r.doc.threads![0] as { resolved: boolean; messages: Array<{ author: { name: string }; text: string }> };
    expect(th.resolved).toBe(true);
    expect(th.messages.map((m) => `${m.author.name}:${m.text}`)).toEqual(['Kim:첫 댓글', 'Lee:답글']);
    const ann = (r.doc.annotations as Array<{ start: { offset: number }; end: { offset: number } }>)[0]!;
    // 본문: '문서 제목¶제목 하나¶강한 ' = 6 + 6 + 3 = 15
    expect([ann.start.offset, ann.end.offset]).toEqual([15, 17]);
    // 가로 용지
    expect(r.doc.sections[0]).toMatchObject({ page: { width: 841890, height: 595276 }, headerDistance: 42550, footerDistance: 49600 });
    documentFromQuire(r.doc);
  });
});

/** XML이 닫혀 있는가 (우리 파서로 뿌리가 하나, 열린 태그 수 = 닫힌 태그 수) */
function balanced(xml: string): boolean {
  const body = xml.replace(/<\?[\s\S]*?\?>/g, '');
  const open = (body.match(/<[A-Za-z][^>]*[^/]>|<[A-Za-z][^>/]*>/g) ?? []).length;
  const close = (body.match(/<\/[^>]+>/g) ?? []).length;
  return open === close && parseXml(xml).name !== '#root';
}
