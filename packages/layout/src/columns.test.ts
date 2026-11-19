/**
 * 다단 (12 §7): 쪽마다 단 프레임, 단 나눔, 이어지는 구역의 띠, 다단 구역 끝의 단 균형, 다단 찾기, 증분 = 처음부터.
 * 문단 글의 "|"는 앞에서 단 나눔, "#"은 앞에서 쪽 나눔.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '@quire/model';
import { LayoutCache, PagedLayout, SectionFrames, geomKey, type FormatSource, type Measurer, type PageSetup, type SectionGeom, type SectionSource } from './index';

/** 모든 grapheme 폭 10 */
const mono: Measurer = { width: () => 10 };
/** 쪽 300×400, 여백 20 → 본문 260×360 (줄 20이면 18줄) */
const setup = (): PageSetup => ({ width: 300, height: 400, margin: 20, gap: 10, lineHeight: 20, paraSpacing: 0 });

const geom = (cols = 1, start: SectionGeom['start'] = 'nextPage', sep = false): SectionGeom => {
  const g = { width: 300, height: 400, top: 20, right: 20, bottom: 20, left: 20, start, cols, gap: 20, sep };
  return { ...g, key: geomKey(g) };
};

function source(st: { breaks: number[]; geoms: SectionGeom[] }): SectionSource {
  return {
    sectionOf(m) {
      let i = 0;
      while (i < st.breaks.length && st.breaks[i]! < m) i++;
      return { index: i, geom: st.geoms[i]! };
    },
    count: () => st.breaks.length + 1,
  };
}

const keeps: FormatSource = (info) => {
  const column = info.text.startsWith('|');
  const page = info.text.startsWith('#');
  if (!column && !page) return null;
  return {
    fmt: null,
    mark: 0,
    style: () => ({ face: 0, scale: 1, line: 1 }),
    box: { align: 'left', left: 0, right: 0, first: 0, before: 0, after: 0, line: null, keep: column ? { column: true } : { breakBefore: true } },
  };
};

function build(doc: Doc, st: { breaks: number[]; geoms: SectionGeom[] }) {
  const s = setup();
  const L = new PagedLayout(s, mono, new LayoutCache(), keeps, new SectionFrames(s, source(st)));
  L.update(doc.paragraphs());
  doc.takeParagraphChanges();
  L.finish();
  return L;
}

/** 모든 줄 (문단.줄 @ 쪽: x, y, 폭 기준 끝) */
function dump(L: PagedLayout) {
  L.finish();
  return { pages: L.pageCount, lines: L.paras.flatMap((p, i) => p!.lines.map((ln) => `${i}.${ln.index}@${ln.page}:${ln.x},${ln.y}`)) };
}

const para = (n: number) => '가'.repeat(n);
/** 단 폭 = (260 − 20) / 2 = 120 → 한 줄 12글자. 첫 쪽 본문 위 = 쪽 사이 틈 10 + 여백 20 */
const COL_X = [20, 160];
const TOP = 30;

describe('columns (12 §7)', () => {
  it('fills the first column, then the second, then the next page; lines are column-wide', () => {
    const doc = Doc.fromText(Array.from({ length: 40 }, () => para(12)).join('\n'));
    const L = build(doc, { breaks: [], geoms: [geom(2)] });
    expect(L.frames.widthOf!(0)).toBe(120);
    const at = (i: number) => L.para(i).lines[0]!;
    expect([at(0).page, at(0).x, at(0).y]).toEqual([0, COL_X[0], TOP]);
    expect([at(17).page, at(17).x]).toEqual([0, COL_X[0]]);
    expect([at(18).page, at(18).x, at(18).y]).toEqual([0, COL_X[1], TOP]);
    expect([at(36).page, at(36).x]).toEqual([1, COL_X[0]]);
    expect(L.pageCount).toBe(2);
  });

  it('a column break starts the next column; a page break starts the next page in its first column', () => {
    const doc = Doc.fromText([para(12), para(12), '|' + para(5), para(12), '#' + para(3), para(12)].join('\n'));
    const L = build(doc, { breaks: [], geoms: [geom(2)] });
    expect([L.para(2).lines[0]!.page, L.para(2).lines[0]!.x, L.para(2).lines[0]!.y]).toEqual([0, COL_X[1], TOP]);
    expect([L.para(4).lines[0]!.page, L.para(4).lines[0]!.x, L.para(4).lines[0]!.y - L.pageBox(1).top]).toEqual([1, COL_X[0], 20]);
  });

  it('a continuous section with more columns starts in a band below the previous one', () => {
    const doc = Doc.fromText([para(52), para(52), ...Array.from({ length: 30 }, () => para(12))].join('\n'));
    // 구역 0 (1단): 문단 0–1 = 4줄 = 80px, 구역 1 (2단, 이어서): 그 아래 띠
    const L = build(doc, { breaks: [1], geoms: [geom(1), geom(2, 'continuous')] });
    const a = L.para(2).lines[0]!;
    expect([a.page, a.x, a.y]).toEqual([0, COL_X[0], TOP + 80]);
    // 띠의 둘째 단도 같은 위에서
    const second = L.paras.flatMap((p) => p!.lines).find((ln) => ln.page === 0 && ln.x === COL_X[1])!;
    expect(second.y).toBe(TOP + 80);
    // 앞 구역(1단) 프레임은 쪽 끝까지 이어져 띠와 겹친다: 누르면 띠의 단으로
    const hit = L.paraIndexAt(L.hitTest(COL_X[1]! + 5, second.y + 5));
    expect(L.para(hit).lines.some((l) => l.x === COL_X[1] && l.y === second.y)).toBe(true);
  });

  it('balances the last page of a multi-column section before a continuous section', () => {
    // 2단 구역: 11줄 → 균형이면 6 + 5, 뒤 1단 구역은 그 아래 (6줄 = 120px)
    const doc = Doc.fromText([...Array.from({ length: 11 }, () => para(12)), para(20), para(20)].join('\n'));
    const L = build(doc, { breaks: [10], geoms: [geom(2), geom(1, 'continuous')] });
    const lines = L.paras.slice(0, 11).flatMap((p) => p!.lines);
    const c0 = lines.filter((ln) => ln.x === COL_X[0]).length;
    const c1 = lines.filter((ln) => ln.x === COL_X[1]).length;
    expect([c0, c1]).toEqual([6, 5]);
    const next = L.para(11).lines[0]!;
    expect([next.page, next.x, next.y]).toEqual([0, 20, TOP + 120]);
    // 다단 구역이 문서 끝이면 균형을 맞추지 않는다
    const end = build(Doc.fromText(Array.from({ length: 11 }, () => para(12)).join('\n')), { breaks: [], geoms: [geom(2)] });
    expect(end.paras.flatMap((p) => p!.lines).filter((ln) => ln.x === COL_X[1]).length).toBe(0);
  });

  it('hit-tests the column under the point, and finds lines by page', () => {
    const doc = Doc.fromText(Array.from({ length: 40 }, (_, i) => `${String(i).padStart(2, '0')}${para(10)}`).join('\n'));
    const L = build(doc, { breaks: [], geoms: [geom(2)] });
    // 둘째 단 첫 줄 (문단 18)
    const off = L.hitTest(COL_X[1]! + 5, TOP + 5);
    expect(L.paraIndexAt(off)).toBe(18);
    expect(L.paraIndexAt(L.hitTest(COL_X[0]! + 5, TOP + 5))).toBe(0);
    const ref = L.firstLineBelow(L.pageBox(1).top + 30);
    expect(L.line(ref).page).toBe(1);
  });

  for (const seed of [1, 2, 3, 4]) {
    it(`incremental relayout equals a fresh layout under random edits with mixed columns (seed ${seed})`, () => {
      let s = seed * 104729;
      const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 0x100000000);
      const doc = Doc.fromText(Array.from({ length: 60 }, (_, i) => (i % 13 === 7 ? '|' : '') + para(3 + ((i * 7) % 40))).join('\n'));
      const st = { breaks: [14, 29, 44], geoms: [geom(1), geom(2, 'continuous', true), geom(3, 'continuous'), geom(1, 'continuous')] };
      const L = build(doc, st);
      for (let step = 0; step < 50; step++) {
        const paras = doc.paragraphs();
        const i = Math.floor(rnd() * (paras.length - 1));
        const p = paras[i]!;
        const r = rnd();
        if (r < 0.4) doc.insertText(p.end, para(1 + Math.floor(rnd() * 30)));
        else if (r < 0.7 && p.end > p.start) doc.deleteRange(p.start, p.start + 1 + Math.floor(rnd() * (p.end - p.start)));
        else if (r < 0.85) {
          doc.insertText(p.end, '\n' + para(Math.floor(rnd() * 20)));
          st.breaks = st.breaks.map((b) => (b >= i ? b + 1 : b));
        } else if (i > 0 && !st.breaks.includes(i - 1) && !st.breaks.includes(i)) {
          doc.deleteRange(p.start - 1, p.start);
          st.breaks = st.breaks.map((b) => (b >= i ? b - 1 : b));
        }
        L.update(doc.paragraphs(), null, rnd() < 0.5 ? Infinity : 500, doc.takeParagraphChanges());
        if (step % 5 === 4) expect(dump(L)).toEqual(dump(build(Doc.fromText(doc.text().slice(0, -1)), st)));
      }
      expect(dump(L)).toEqual(dump(build(Doc.fromText(doc.text().slice(0, -1)), st)));
    });
  }
});
