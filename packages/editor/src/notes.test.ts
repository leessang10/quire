/**
 * 각주 (12 §6) 서식 경로: 참조 폭(번호 자릿수), 각주 내용 높이가 바뀌면 그 참조 문단을 다시 조판하고 (syncNotes) 증분 결과 =
 * 처음부터 조판한 결과
 */
import { describe, expect, it } from 'vitest';
import { Doc, Document, noteStoryId } from '@quire/model';
import { LayoutCache, PagedLayout, SectionFrames, type Measurer } from '@quire/layout';
import { Formatter, defaultPageSetup } from './formatter';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };

function make(n: number) {
  const text = Array.from({ length: n }, (_, i) => `${i + 1}. 각주가 있는 문단입니다. 줄을 채우는 글이 이어집니다.`).join('\n');
  const doc = Doc.fromText(text);
  const document = new Document(doc);
  for (let i = 0; i < n; i += 3) {
    const p = doc.paragraphs()[i]!;
    doc.insertObject(p.start + 3, { id: `n${i}`, kind: 'note' });
    document.story(noteStoryId(`n${i}`)).insertText(0, `각주 ${i}: 짧은 설명.`);
  }
  doc.takeParagraphChanges();
  return document;
}

function compose(document: Document) {
  const setup = defaultPageSetup(16);
  const fmt = new Formatter(() => document, setup, 16);
  fmt.reset(measurer, new LayoutCache(5000));
  const layout = new PagedLayout(setup, measurer, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  document.body.takeParagraphChanges();
  layout.update(document.body.paragraphs(), null, Infinity, null);
  layout.finish();
  return { fmt, layout };
}

/** 줄 자리와 쪽마다 각주 (번호[줄 범위]) */
function dump(c: ReturnType<typeof compose>) {
  c.layout.finish();
  return {
    lines: c.layout.paras.flatMap((p) => p!.lines.map((ln) => `${ln.page}:${ln.y}:${ln.start}-${ln.end}`)),
    notes: Array.from({ length: c.layout.pageCount }, (_, p) => c.layout.notesOnPage(p).map((n) => `${c.fmt.noteNumber(n.id)}[${n.from},${n.to})`).join(' ')),
  };
}

/** 편집기처럼: 바뀐 참조 문단을 다시 조판하게 한 뒤 증분 조립 */
function relayout(document: Document, c: ReturnType<typeof compose>) {
  for (const i of c.fmt.syncNotes()) document.body.touchParagraph(i);
  c.layout.update(document.body.paragraphs(), null, Infinity, document.body.takeParagraphChanges());
  c.layout.finish();
}

describe('footnotes through the formatter (12 §6)', () => {
  it('numbers notes by reference order and lays out references as superscript numbers', () => {
    const document = make(30);
    const c = compose(document);
    expect(c.fmt.noteList().map((n) => c.fmt.noteNumber(n.id))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const notes = dump(c).notes.join(' ').split(' ').filter(Boolean);
    expect(notes.length).toBe(10);
    const ref = c.layout.para(27).layout.objs!.get(3)!;
    const one = c.layout.para(0).layout.objs!.get(3)!;
    expect(ref.w).toBeGreaterThan(one.w); // "10"이 "1"보다 넓다
  });

  it('relays out the referencing paragraph when a note grows, and matches a fresh layout', () => {
    const document = make(60);
    const c = compose(document);
    const s = document.story(noteStoryId('n12'));
    s.insertText(s.maxCaret, '\n' + '긴 설명이 붙습니다. '.repeat(40));
    relayout(document, c);
    expect(dump(c)).toEqual(dump(compose(document)));
    // 줄이면 다시
    s.deleteRange(10, s.maxCaret);
    relayout(document, c);
    expect(dump(c)).toEqual(dump(compose(document)));
  });

  it('relays out references whose number gains a digit when a note is inserted before them', () => {
    const document = make(27); // 각주 9개
    const c = compose(document);
    const body = document.body;
    body.insertObject(1, { id: 'first', kind: 'note' });
    document.story(noteStoryId('first')).insertText(0, '맨 앞 각주');
    relayout(document, c);
    expect(c.fmt.noteNumber('n24')).toBe(10);
    expect(dump(c)).toEqual(dump(compose(document)));
  });
});
