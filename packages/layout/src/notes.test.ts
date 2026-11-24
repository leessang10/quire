/**
 * 각주 배치 (12 §6.2): 줄과 그 각주가 같은 프레임에 들어가야 하고, 빈 프레임의 절반보다 큰 각주는 줄 경계에서 나눠 이어 쓴다.
 * 각주는 글에 "*n"으로 적는다 (n줄짜리 각주, 줄 높이 20).
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '@quiredoc/model';
import { LayoutCache, PagedLayout, type FormatSource, type Measurer, type NoteSpec, type PageSetup } from './index';

/** 모든 grapheme 폭 10 */
const mono: Measurer = { width: () => 10 };
/** 쪽 높이 300, 여백 20 → 본문 260 (줄 20이면 13줄) */
const setup = (): PageSetup => ({ width: 200, height: 300, margin: 20, gap: 10, lineHeight: 20, paraSpacing: 0, noteSeparator: 10 });

const notesOf: FormatSource = (info) => {
  const notes = new Map<number, NoteSpec>();
  const cps = Array.from(info.text);
  cps.forEach((c, k) => {
    if (c === '*') notes.set(k, { id: `${info.id}:${k}`, lines: Array.from({ length: Number(cps[k + 1]) || 1 }, () => 20) });
  });
  return notes.size ? { fmt: null, mark: 0, style: () => ({ face: 0, scale: 1, line: 1 }), notes } : null;
};

function build(doc: Doc) {
  const layout = new PagedLayout(setup(), mono, new LayoutCache(), notesOf);
  layout.update(doc.paragraphs());
  doc.takeParagraphChanges();
  layout.finish();
  return layout;
}

/** 모든 줄 (쪽, y)과 쪽마다 각주 조각 */
function dump(L: PagedLayout) {
  L.finish();
  const lines = L.paras.flatMap((p, i) => p!.lines.map((ln) => `${i}.${ln.index}@${ln.page}:${ln.y}`));
  const notes = Array.from({ length: L.pageCount }, (_, p) => L.notesOnPage(p).map((n) => `${n.id}[${n.from},${n.to})${n.cont ? '+' : ''}`).join(' '));
  return { lines, notes, pages: L.pageCount };
}

/** 쪽 p 본문의 아래 끝 + 각주 영역이 본문 높이를 넘지 않는다 */
function checkFits(L: PagedLayout) {
  for (let p = 0; p < L.pageCount; p++) {
    const notes = L.notesOnPage(p);
    const area = notes.length ? 10 + notes.reduce((a, n) => a + n.h, 0) : 0;
    const top = L.pageBox(p).top + 20;
    let bottom = top;
    for (const pp of L.paras) for (const ln of pp!.lines) if (ln.page === p) bottom = Math.max(bottom, ln.y + ln.height);
    expect(bottom - top + area).toBeLessThanOrEqual(260 + 1e-6);
  }
}

const para = (n: number) => '가'.repeat(n);

/** 증분 결과 = 처음부터 조판한 결과 (새 문서는 문단 ID가 달라 각주 ID의 문단 부분을 차례로 바꿔 비교한다) */
function same(L: PagedLayout, doc: Doc) {
  const fresh = build(Doc.fromText(doc.text().slice(0, -1)));
  const norm = (x: ReturnType<typeof dump>, ids: string[]) => ({
    ...x,
    notes: x.notes.map((t) => ids.reduce((acc, id, i) => acc.split(`${id}:`).join(`P${i}:`), t)),
  });
  expect(norm(dump(L), doc.paragraphs().map((p) => p.id))).toEqual(norm(dump(fresh), fresh.paras.map((p) => p!.info.id)));
}

describe('footnotes (12 §6.2)', () => {
  it('without notes the layout is as before; a note takes room from the body on its page', () => {
    // 한 줄 = 18글자 (폭 180)
    const plain = Doc.fromText(Array.from({ length: 20 }, () => para(10)).join('\n'));
    expect(dump(build(plain)).lines.filter((l) => l.includes('@0:')).length).toBe(13);
    const doc = Doc.fromText(Array.from({ length: 20 }, (_, i) => (i === 2 ? `${para(5)}*3` : para(10))).join('\n'));
    const L = build(doc);
    const d = dump(L);
    // 쪽 0: 각주 3줄(60) + 구분선 10 → 본문 190 → 9줄
    expect(d.lines.filter((l) => l.includes('@0:')).length).toBe(9);
    expect(d.notes[0]).toBe(`${doc.paragraphs()[2]!.id}:5[0,3)`);
    checkFits(L);
  });

  it('moves a line to the next page when the line and its note do not fit', () => {
    // 쪽 0의 12번째 줄(문단 11)에 2줄 각주: 줄 + 10 + 40 > 남은 높이 → 문단 11은 쪽 1로, 각주도 쪽 1
    const doc = Doc.fromText(Array.from({ length: 20 }, (_, i) => (i === 11 ? `${para(3)}*2` : para(10))).join('\n'));
    const L = build(doc);
    expect(L.para(11).lines[0]!.page).toBe(1);
    expect(L.notesOnPage(0)).toEqual([]);
    expect(L.notesOnPage(1).map((n) => n.id)).toEqual([`${doc.paragraphs()[11]!.id}:3`]);
    checkFits(L);
  });

  it('splits a note larger than half a frame at a line boundary and continues it on the next page', () => {
    // 10줄 각주 (200) > 260 / 2: 참조 줄은 제자리, 들어가는 줄만 놓고 나머지는 다음 쪽 맨 위에 이어 쓴다
    const doc = Doc.fromText(Array.from({ length: 30 }, (_, i) => (i === 6 ? `${para(3)}*9` : para(10))).join('\n'));
    // 9줄짜리 + 다음 문단도 각주 (차례가 유지되는지)
    const L = build(doc);
    expect(L.para(6).lines[0]!.page).toBe(0);
    const p0 = L.notesOnPage(0);
    const p1 = L.notesOnPage(1);
    expect(p0.length).toBe(1);
    expect(p0[0]!.from).toBe(0);
    expect(p0[0]!.to).toBeLessThan(9);
    expect(p1[0]!.cont).toBe(true);
    expect(p1[0]!.from).toBe(p0[0]!.to);
    expect(p1[0]!.to).toBe(9);
    checkFits(L);
  });

  it('keeps notes in reference order when one is being continued, and flushes the rest after the last paragraph', () => {
    const doc = Doc.fromText([para(10), para(10), `${para(2)}*9`, `${para(2)}*9`, `${para(2)}*9`].join('\n'));
    const L = build(doc);
    const all = Array.from({ length: L.pageCount }, (_, p) => L.notesOnPage(p)).flat();
    const ids = doc.paragraphs().slice(2).map((p) => `${p.id}:2`);
    // 각주마다 줄이 빠짐없이 차례대로
    for (const id of ids) {
      const parts = all.filter((n) => n.id === id);
      expect(parts[0]!.from).toBe(0);
      for (let k = 1; k < parts.length; k++) expect(parts[k]!.from).toBe(parts[k - 1]!.to);
      expect(parts.at(-1)!.to).toBe(9);
    }
    expect(all.map((n) => n.id).filter((id, k, a) => a.indexOf(id) === k)).toEqual(ids);
    // 마지막 문단 뒤에 각주만 있는 쪽이 생긴다
    expect(L.pageCount).toBeGreaterThan(L.para(4).lines.at(-1)!.page + 1);
    checkFits(L);
  });

  for (const seed of [1, 2, 3, 4]) {
    it(`incremental relayout equals a fresh layout under random edits (seed ${seed})`, () => {
      let s = seed * 7919;
      const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 0x100000000);
      const doc = Doc.fromText(Array.from({ length: 40 }, (_, i) => (i % 5 === 2 ? `${para(4)}*${1 + (i % 9)}${para(6)}` : para(5 + (i % 30)))).join('\n'));
      const L = build(doc);
      for (let step = 0; step < 60; step++) {
        const paras = doc.paragraphs();
        const p = paras[Math.floor(rnd() * paras.length)]!;
        const r = rnd();
        if (r < 0.35) doc.insertText(p.start, para(1 + Math.floor(rnd() * 20)));
        else if (r < 0.55) doc.insertText(p.start + Math.floor(rnd() * (p.end - p.start)), `*${1 + Math.floor(rnd() * 9)}`);
        else if (r < 0.7) doc.insertText(p.end, '\n' + para(Math.floor(rnd() * 25)));
        else if (p.end > p.start) doc.deleteRange(p.start, p.start + 1 + Math.floor(rnd() * (p.end - p.start)));
        else if (paras.length > 2) doc.deleteRange(p.start, p.end + 1);
        L.update(doc.paragraphs(), null, rnd() < 0.5 ? Infinity : 400, doc.takeParagraphChanges());
        if (step % 6 === 5) same(L, doc);
      }
      same(L, doc);
      checkFits(L);
    });
  }
});
