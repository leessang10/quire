/**
 * 서식 있는 복사·붙여넣기: 조각 만들기, 붙이기 규칙 (Google Docs와 같은 문단 속성 규칙), 목록·표·이미지, HTML 읽기·쓰기
 */
import { describe, expect, it } from 'vitest';
import { Doc, Document, History, cellStoryId, defaultListDef, normalizeTable, type Op } from '@quire/model';
import { FRAGMENT_MIME, fragmentOf, fragmentToHtml, fragmentToText, htmlToFragment, parseHtml, pasteFragment, type Fragment } from './clipboard';

const NL = '\n';
let seq = 0;
const target = (document: Document, doc = document.body) => ({ document, doc, inCell: doc !== document.body, newId: () => `n${++seq}` });

/** 문단마다 [번호, 스타일, 글(굵은 글자는 *로 감쌈)] */
function view(document: Document, doc = document.body): string[] {
  return doc.paragraphs().map((p) => {
    const l = doc.listLabel(p);
    const cps = Array.from(p.text);
    let s = '';
    let bold = false;
    cps.forEach((c, k) => {
      const b = !!(p.fmt && doc.markSet(p.fmt[k]!).bold);
      if (b !== bold) s += '*';
      bold = b;
      s += c === '￼' ? (p.objs?.get(k)?.kind === 'table' ? '[표]' : '[그림]') : c;
    });
    if (bold) s += '*';
    return `${l ? `${l.text} ` : ''}${p.attrs.style ? `<${p.attrs.style}>` : ''}${p.attrs.align ? `{${p.attrs.align}}` : ''}${s}`;
  });
}

function build(): Document {
  const d = new Document(Doc.fromText(['제목 줄', '굵은 글자와 보통', '항목 하나', '항목 둘', '끝'].join(NL)));
  const b = d.body;
  b.setParaAttr(0, 'style', 'h1');
  b.format(5, 7, 'bold', true); // "굵은"
  const [id] = b.createList('number');
  b.setParaAttr(2, 'list', { id, level: 0 });
  b.setParaAttr(3, 'list', { id, level: 0 });
  b.setParaAttr(4, 'align', 'center');
  return d;
}

describe('copy (fragment)', () => {
  it('keeps marks, paragraph attributes, lists and whether the last ¶ was copied', () => {
    const d = build();
    const b = d.body;
    const ps = b.paragraphs();
    // "은 글자와 보통" … "항목 하나¶" (끝이 다음 문단 첫머리)
    const f = fragmentOf(d, b, ps[1]!.start + 1, ps[3]!.start);
    expect(f.closed).toBe(true);
    expect(f.blocks.length).toBe(2);
    expect(f.blocks[0]).toEqual({ p: {}, c: [{ t: '은', m: { bold: true } }, { t: ' 글자와 보통' }], end: true });
    expect(f.blocks[1]).toMatchObject({ p: { list: { level: 0 } }, start: true, end: true, c: [{ t: '항목 하나' }] });
    expect(Object.values(f.lists)[0]!.kind).toBe('number');
    expect(fragmentToText(f)).toBe(`은 글자와 보통${NL}항목 하나${NL}`);
    // 문단 가운데만: 닫히지 않음
    expect(fragmentOf(d, b, ps[0]!.start, ps[0]!.start + 2).closed).toBe(false);
  });

  it('writes HTML with headings, marks, nested lists and alignment', () => {
    const d = build();
    const b = d.body;
    const h = fragmentToHtml(fragmentOf(d, b, 0, b.maxCaret));
    expect(h).toContain('<h1>제목 줄</h1>');
    expect(h).toContain('<p><b>굵은</b> 글자와 보통</p>');
    expect(h).toContain('<ol><li>항목 하나</li><li>항목 둘</li></ol>');
    expect(h).toContain('<p style="text-align:center">끝</p>');
  });
});

describe('paste (fragment)', () => {
  const copyPaste = (d: Document, from: number, to: number, at: number, into = d) => {
    const f: Fragment = JSON.parse(JSON.stringify(fragmentOf(d, d.body, from, to)));
    return pasteFragment(target(into), at, f);
  };

  it('pastes inline text with its marks into a paragraph, keeping the destination paragraph', () => {
    const d = build();
    const ps = d.body.paragraphs();
    const end0 = ps[0]!.end;
    // "굵은 글" → 제목 줄 끝
    const r = copyPaste(d, ps[1]!.start, ps[1]!.start + 4, end0);
    expect(view(d)[0]).toBe('<h1>제목 줄*굵은* 글');
    expect(r.caret).toBe(end0 + 4);
  });

  it('whole paragraphs keep their own attributes; partial first and last paragraphs take the destination ones', () => {
    const d = build();
    const ps = d.body.paragraphs();
    // "목 줄¶굵은 글자와 보통¶항목" (제목의 일부 + 온전한 문단 + 목록 항목의 일부) → "끝" 문단 가운데
    copyPaste(d, ps[0]!.start + 1, ps[2]!.start + 2, ps[4]!.start + 1);
    expect(view(d).slice(4)).toEqual([
      '{center}끝목 줄', // 첫 조각: 붙인 자리(가운데 정렬) 그대로
      '*굵은* 글자와 보통', // 온전한 문단: 자기 속성
      '{center}항목', // 끝 조각: 붙인 자리 문단의 뒤와 합침
    ]);
  });

  it('pastes whole list items next to the list: same list, numbering continues', () => {
    const d = build();
    const ps = d.body.paragraphs();
    // "항목 하나¶항목 둘¶" → "끝" 첫머리 (빈 자리에 온전한 문단)
    copyPaste(d, ps[2]!.start, ps[4]!.start, ps[4]!.start);
    expect(view(d).slice(2)).toEqual(['1. 항목 하나', '2. 항목 둘', '3. 항목 하나', '4. 항목 둘', '{center}끝']);
  });

  it('pastes into another document: list definitions are copied, headings kept', () => {
    const d = build();
    const other = new Document(Doc.fromText(''));
    const f: Fragment = JSON.parse(JSON.stringify(fragmentOf(d, d.body, 0, d.body.maxCaret)));
    pasteFragment(target(other), 0, f);
    expect(view(other)).toEqual(['<h1>제목 줄', '*굵은* 글자와 보통', '1. 항목 하나', '2. 항목 둘', '{center}끝']);
  });

  it('copies and pastes a table (record, spans, cell text) and undoes it in one step', () => {
    const d = new Document(Doc.fromText(`앞${NL}뒤`));
    const { id } = d.insertTable(2, 2, 2, 200000);
    const t = d.table(id)!;
    d.story(cellStoryId(id, t.rows[0]!, t.cols[0]!)).insertText(0, '셀 가');
    d.story(cellStoryId(id, t.rows[0]!, t.cols[0]!)).format(0, 1, 'bold', true);
    d.story(cellStoryId(id, t.rows[1]!, t.cols[1]!)).insertText(0, '셀 라');
    d.mergeCells(id, t.rows[0]!, t.cols[0]!, [], [t.cols[1]!]);
    const ps = d.body.paragraphs();
    const f: Fragment = JSON.parse(JSON.stringify(fragmentOf(d, d.body, ps[1]!.start, ps[2]!.start)));
    expect(f.blocks.length).toBe(1);
    const h = new History(0);
    const s = { anchor: d.body.positionAt(0), head: d.body.positionAt(0) };
    const r = pasteFragment(target(d), d.body.paragraphs()[2]!.end, f); // "뒤" 끝에
    h.record({ ops: r.ops, before: s, after: s, time: 0 });
    expect(view(d)).toEqual(['앞', '[표]', '뒤', '[표]', '']);
    const id2 = d.tableIds().find((x) => x !== id)!;
    const g = normalizeTable(d.table(id2)!);
    expect(g.cells[0]![0]!.span).toEqual([1, 2]);
    expect(view(d, d.story(g.cells[0]![0]!.story))).toEqual(['*셀* 가']);
    expect(d.story(g.cells[1]![1]!.story).text()).toBe(`셀 라${NL}`);
    h.undo(d);
    expect(view(d)).toEqual(['앞', '[표]', '뒤']);
  });

  it('flattens a table into paragraphs when pasting inside a cell', () => {
    const d = new Document(Doc.fromText(''));
    const { id } = d.insertTable(0, 1, 2, 200000);
    const t = d.table(id)!;
    d.story(cellStoryId(id, t.rows[0]!, t.cols[0]!)).insertText(0, '왼');
    d.story(cellStoryId(id, t.rows[0]!, t.cols[1]!)).insertText(0, '오른');
    const f = fragmentOf(d, d.body, 0, d.body.paragraphs()[1]!.start);
    const cell = d.story(cellStoryId(id, t.rows[0]!, t.cols[0]!));
    pasteFragment({ ...target(d, cell), inCell: true }, cell.maxCaret, JSON.parse(JSON.stringify(f)));
    expect(cell.text()).toBe(`왼왼${NL}오른${NL}${NL}`);
  });

  it('gives pasted images new ids (no duplicate object ids)', () => {
    const d = new Document(Doc.fromText('가'));
    d.body.insertObject(0, { id: 'img1', kind: 'image', asset: 'a'.repeat(32), w: 1000, h: 1000 });
    const f = fragmentOf(d, d.body, 0, 2);
    pasteFragment(target(d), 2, JSON.parse(JSON.stringify(f)));
    const ids = [...d.body.paragraphs()[0]!.objs!.values()].map((o) => o.id);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('HTML in (Word, Google Docs, web)', () => {
  it('parses loose HTML (unclosed p and li, entities, comments)', () => {
    const root = parseHtml('<!--StartFragment--><p>가&nbsp;나 &amp; &#xAC00;<p>둘<ul><li>하나<li>둘</ul>');
    expect(root.children.filter((c) => typeof c !== 'string').map((c) => (c as { tag: string }).tag)).toEqual(['p', 'p', 'ul']);
  });

  it('reads Google Docs HTML (bold wrapper with font-weight:normal, spans with styles, lists)', () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><h2 dir="ltr"><span style="font-size:16pt;font-weight:400;">제목</span></h2>' +
      '<p dir="ltr" style="text-align: center;"><span style="font-weight:700;">굵게</span><span style="font-weight:400;"> 보통 </span><span style="font-style:italic;color:#ff0000;">빨강</span></p>' +
      '<ol><li dir="ltr"><p dir="ltr"><span>하나</span></p></li><li dir="ltr"><p dir="ltr"><span>둘</span></p><ul><li><p><span>점</span></p></li></ul></li></ol></b>';
    const f = htmlToFragment(html);
    const d = new Document(Doc.fromText(''));
    pasteFragment(target(d), 0, f);
    expect(view(d)).toEqual(['<h2>제목', '{center}*굵게* 보통 빨강', '1. 하나', '2. 둘', '◦ 점']);
    const p1 = d.body.paragraphs()[1]!;
    const m = d.body.markSet(p1.fmt![Array.from(p1.text).length - 1]!);
    expect(m).toEqual({ italic: true, color: '#ff0000' });
  });

  it('reads Word HTML lists (mso-list with the fake number skipped) and tables with spans', () => {
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{margin:0}</style></head><body>' +
      "<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>1.<span style='font:7.0pt'>&nbsp;&nbsp; </span></span><![endif]>첫 항목<o:p></o:p></p>" +
      "<p class=MsoListParagraph style='mso-list:l0 level2 lfo1'><span style='mso-list:Ignore'>a.</span>둘째 수준<o:p></o:p></p>" +
      '<table><tr><td colspan=2 style="background-color:#eeeeee">합친 칸</td></tr><tr><td>왼</td><td><b>오른</b></td></tr></table></body></html>';
    const f = htmlToFragment(html);
    const d = new Document(Doc.fromText(''));
    pasteFragment(target(d), 0, f);
    expect(view(d)).toEqual(['1. 첫 항목', '가. 둘째 수준', '[표]', '']);
    const id = d.tableIds()[0]!;
    const g = normalizeTable(d.table(id)!);
    expect(g.cells[0]![0]!.span).toEqual([1, 2]);
    expect(d.table(id)!.cellAttrs[`${g.rows[0]}|${g.cols[0]}`]).toEqual({ fill: '#eeeeee' });
    expect(view(d, d.story(g.cells[1]![1]!.story))).toEqual(['*오른*']);
  });

  it('collapses whitespace like a browser and turns <br> into paragraphs', () => {
    const f = htmlToFragment('<div>  가   나\n  다<br>라 </div>');
    expect(fragmentToText(f)).toBe(`가 나 다${NL}라`);
  });

  it('round-trips its own HTML', () => {
    const d = build();
    const html = fragmentToHtml(fragmentOf(d, d.body, 0, d.body.maxCaret));
    const other = new Document(Doc.fromText(''));
    other.body.setList('x', defaultListDef('x', 'number'));
    pasteFragment(target(other), 0, htmlToFragment(html));
    expect(view(other)).toEqual(['<h1>제목 줄', '*굵은* 글자와 보통', '1. 항목 하나', '2. 항목 둘', '{center}끝']);
  });

  it('uses the right MIME name', () => {
    expect(FRAGMENT_MIME).toBe('application/x-quire-fragment');
    void ([] as Op[]);
  });
});
