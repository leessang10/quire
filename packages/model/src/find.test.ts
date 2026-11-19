import { describe, expect, it } from 'vitest';
import { Doc } from './doc';
import { Document } from './document';
import { FindCache, compileFind, findInDocument, replaceMatches, replacementFor } from './find';
import { History } from './history';
import type { FindQuery, Matcher } from './find';
import { noteStoryId } from './notes';
import { fullSection, hfStoryId, LAST_SECTION } from './sections';
import { normalizeTable } from './tables';

function run(text: string, q: FindQuery): string[] {
  const c = compileFind(q);
  if ('error' in c) throw new Error(c.error);
  return c.matcher(text).map(([a, b]) => Array.from(text).slice(a, b).join(''));
}

describe('find (15 §3)', () => {
  it('plain text, case, whole word', () => {
    expect(run('Apple apple APPLE', { text: 'apple' })).toEqual(['Apple', 'apple', 'APPLE']);
    expect(run('Apple apple APPLE', { text: 'apple', caseSensitive: true })).toEqual(['apple']);
    expect(run('학교 학교에 학교', { text: '학교', wholeWord: true })).toEqual(['학교', '학교']);
    expect(run('a.b axb', { text: 'a.b' })).toEqual(['a.b']);
  });

  it('regex, empty matches skipped, bad regex is an error', () => {
    expect(run('ab12cd345', { text: '\\d+', regex: true })).toEqual(['12', '345']);
    expect(run('abc', { text: 'x*', regex: true })).toEqual([]);
    expect('error' in compileFind({ text: '(', regex: true })).toBe(true);
    expect('error' in compileFind({ text: '' })).toBe(true);
  });

  it('offsets are code points (astral characters before a match)', () => {
    const c = compileFind({ text: '가' });
    if ('error' in c) throw new Error();
    expect(c.matcher('😀😀가')).toEqual([[2, 3]]);
  });

  it('a match does not cover an object character', () => {
    expect(run('a￼b ab', { text: 'a.b', regex: true })).toEqual([]);
    expect(run('a￼b a-b', { text: 'a.b', regex: true })).toEqual(['a-b']);
  });

  it('whole document: body, table cells at the table, notes, then headers', () => {
    const d = new Document(Doc.fromText('하나 찾기\n둘'));
    const { id: table } = d.insertTable(d.body.paragraphs()[1]!.start, 2, 2, 200000);
    const g = normalizeTable(d.table(table)!);
    d.story(g.cells[1]![0]!.story).insertText(0, '셀 찾기');
    d.body.insertObject(2, { id: 'n1', kind: 'note' });
    d.story(noteStoryId('n1')).insertText(0, '각주 찾기');
    const hdr = hfStoryId('header', LAST_SECTION, 'default');
    d.body.setSection(LAST_SECTION, { ...fullSection(undefined), header: { default: hdr } });
    d.story(hdr).insertText(0, '머리 찾기');
    d.body.insertText(d.body.maxCaret - 1, ' 찾기 끝');
    const cache = new FindCache((compileFind({ text: "찾기" }) as { matcher: Matcher }).matcher);
    const { matches, truncated } = findInDocument(d, cache);
    expect(truncated).toBe(false);
    const name = (s: string | null) => (s === null ? 'body' : s === hdr ? 'hdr' : s.startsWith('fn|') ? 'note' : 'cell');
    expect(matches.map((m) => name(m.story))).toEqual(['body', 'cell', 'body', 'note', 'hdr']);
    for (const m of matches) expect(Array.from(d.docOf(m.story).text()).slice(m.from, m.to).join('')).toBe('찾기');
    expect(findInDocument(d, cache, { stories: 'body' }).matches.length).toBe(3);
    expect(findInDocument(d, cache, { limit: 2 })).toMatchObject({ truncated: true });
  });

  it('regex replacement uses groups', () => {
    const c = compileFind({ text: '(\\d+)년', regex: true }) as { regex: RegExp };
    expect(replacementFor(c.regex, '2026년', '$1해')).toBe('2026해');
    expect(replacementFor(null, 'x', '$1')).toBe('$1');
  });
});

describe('replace (15 §3.3)', () => {
  const author = { id: 'ua', name: '가영', color: '#2563eb' };
  const compile = (q: FindQuery) => compileFind(q) as { matcher: Matcher; regex: RegExp };

  it('replace all: every story, keeps the first character format, one undo step', () => {
    const d = new Document(Doc.fromText('사과 하나 사과\n배'));
    d.body.format(0, 2, 'bold', true);
    const { id: table } = d.insertTable(d.body.paragraphs()[1]!.start, 1, 1, 200000);
    const cell = normalizeTable(d.table(table)!).cells[0]![0]!.story;
    d.story(cell).insertText(0, '셀 사과');
    const original = { body: d.body.text(), cell: d.story(cell).text() };
    const c = compile({ text: '사과' });
    const { matches } = findInDocument(d, new FindCache(c.matcher));
    expect(matches.length).toBe(3);
    const { ops, count } = replaceMatches(d, matches, c.matcher, null, '감');
    expect(count).toBe(3);
    expect(d.body.text().startsWith('감 하나 감')).toBe(true);
    expect(d.story(cell).text()).toBe('셀 감\n');
    expect(d.body.marksAt(0).bold).toBe(true); // 첫 글자 서식
    expect(d.body.marksAt(5).bold).toBeUndefined();
    const h = new History();
    const pos = { anchor: d.body.positionAt(0), head: d.body.positionAt(0) };
    h.record({ ops, before: pos, after: pos, time: 0 });
    h.undo(d);
    expect(d.body.text()).toBe(original.body);
    expect(d.story(cell).text()).toBe(original.cell);
  });

  it('a match whose text changed since finding is skipped; regex groups', () => {
    const d = new Document(Doc.fromText('2025년 2026년'));
    const c = compile({ text: '(\\d+)년', regex: true });
    const { matches } = findInDocument(d, new FindCache(c.matcher));
    d.body.deleteRange(0, 1);
    d.body.insertText(0, 'x'); // 'x025년 2026년': 첫 결과 [0, 5)는 더 맞지 않는다
    const { count } = replaceMatches(d, matches, c.matcher, c.regex, '$1해');
    expect(count).toBe(1);
    expect(d.body.text()).toBe('x025년 2026해\n');
  });

  it('in suggestion mode the replacement is a suggestion; rejecting it restores the text', () => {
    const d = new Document(Doc.fromText('사과 배 사과'));
    d.setSuggesting({ author, now: () => 1 });
    const c = compile({ text: '사과' });
    const { matches } = findInDocument(d, new FindCache(c.matcher));
    replaceMatches(d, matches, c.matcher, null, '감');
    d.setSuggesting(null);
    expect(d.annotationRanges().map((r) => r.data.kind).sort()).toEqual(['delete', 'delete', 'insert', 'insert']);
    d.resolveAll(false);
    expect(d.body.text()).toBe('사과 배 사과\n');
  });
});
