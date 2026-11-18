import { describe, expect, it } from 'vitest';
import { Doc } from '@quire/model';
import { LayoutCache, PagedLayout, SectionFrames, geomKey, type Measurer, type PageSetup, type SectionGeom, type SectionSource } from './index';

/** 모든 grapheme 폭 10 */
const mono: Measurer = { width: () => 10 };
const setup = (): PageSetup => ({ width: 200, height: 300, margin: 20, gap: 10, lineHeight: 20, paraSpacing: 0 });

const geom = (width: number, height: number, start: SectionGeom['start'] = 'nextPage', m = 20, left = m): SectionGeom => {
  const g = { width, height, top: m, right: m, bottom: m, left, start };
  return { ...g, key: geomKey(g) };
};
const PORTRAIT = geom(200, 300);
const LANDSCAPE = geom(300, 200);

/** 구역 나눔 문단 번호와 구역 모양 (바꿀 수 있게 함수로) */
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

function build(doc: Doc, st: { breaks: number[]; geoms: SectionGeom[] }) {
  const s = setup();
  const layout = new PagedLayout(s, mono, new LayoutCache(), null, new SectionFrames(s, source(st)));
  layout.update(doc.paragraphs());
  doc.takeParagraphChanges();
  layout.finish();
  return layout;
}

/** 모든 줄의 (쪽, x, y, 글자 범위) */
function dump(layout: PagedLayout) {
  layout.finish();
  const out: Array<[number, number, number, number, number, number]> = [];
  for (let i = 0; i < layout.model.length; i++)
    for (const ln of layout.para(i).lines) out.push([i, ln.page, ln.x, ln.y, ln.start, ln.end]);
  return { pages: layout.pageCount, lines: out, boxes: Array.from({ length: layout.pageCount }, (_, p) => layout.pageBox(p)) };
}

/** 줄 n개짜리 문단 (본문 폭 160 = 16글자) */
const para = (k: number, chars = 16) => '가'.repeat(chars) + ` ${k}`;

describe('section frames (12 §3.3)', () => {
  it('starts a next-page section on a new page with its own paper size and line width', () => {
    const doc = Doc.fromText(['짧은 글', '둘째', '가로 쪽의 긴 문단 ' + '나'.repeat(40)].join('\n'));
    const layout = build(doc, { breaks: [1], geoms: [PORTRAIT, LANDSCAPE] });
    const d = dump(layout);
    expect(d.pages).toBe(2);
    expect(d.boxes[0]).toMatchObject({ width: 200, height: 300 });
    expect(d.boxes[1]).toMatchObject({ width: 300, height: 200, top: 10 + 300 + 10 });
    const p2 = layout.para(2);
    expect(p2.lines[0]!.page).toBe(1);
    expect(p2.lines[0]!.y).toBe(d.boxes[1]!.top + 20);
    // 가로 쪽 본문 폭 260 = 26글자: 앞 어절 + 긴 낱말 40글자가 세 줄 (세로 쪽이면 네 줄)
    expect(p2.lines.length).toBe(3);
    // 쪽들은 기본 용지 폭의 가운데 축에 맞춘다: 가로 쪽 x = (200 − 300) / 2
    expect(d.boxes[1]!.x).toBe(-50);
    expect(p2.lines[0]!.x).toBe(-50 + 20);
  });

  it('inserts a blank page before an odd-page section that would start on an even page', () => {
    const doc = Doc.fromText(['첫 구역', '둘째 구역'].join('\n'));
    const layout = build(doc, { breaks: [0], geoms: [PORTRAIT, geom(200, 300, 'oddPage')] });
    const d = dump(layout);
    // 1쪽 = 첫 구역, 2쪽 = 빈 쪽, 3쪽 = 둘째 구역
    expect(d.pages).toBe(3);
    expect(layout.para(1).lines[0]!.page).toBe(2);
    const even = build(Doc.fromText(['첫 구역', '둘째 구역'].join('\n')), { breaks: [0], geoms: [PORTRAIT, geom(200, 300, 'evenPage')] });
    expect(even.para(1).lines[0]!.page).toBe(1);
  });

  it('continues a continuous section on the same page below the previous one, with its own margins', () => {
    const doc = Doc.fromText(['위', '아래 구역은 왼쪽 여백이 넓다'].join('\n'));
    const layout = build(doc, { breaks: [0], geoms: [PORTRAIT, geom(200, 300, 'continuous', 20, 60)] });
    const a = layout.para(0).lines[0]!;
    const b = layout.para(1).lines[0]!;
    expect(layout.pageCount).toBe(1);
    expect(b.page).toBe(0);
    expect(b.y).toBe(a.y + 20);
    expect(b.x).toBe(60);
    // 용지가 다르면 이어서 시작할 수 없다: 새 쪽
    const other = build(Doc.fromText(['위', '아래'].join('\n')), { breaks: [0], geoms: [PORTRAIT, geom(300, 200, 'continuous')] });
    expect(other.para(1).lines[0]!.page).toBe(1);
  });

  it('relayouts incrementally to the same result as a fresh layout (edits that move a section start, margins)', () => {
    const lines = Array.from({ length: 40 }, (_, k) => para(k, k % 3 === 0 ? 30 : 8));
    const st = { breaks: [12, 25], geoms: [PORTRAIT, LANDSCAPE, geom(200, 300, 'oddPage')] };
    const doc = Doc.fromText(lines.join('\n'));
    const s = setup();
    const layout = new PagedLayout(s, mono, new LayoutCache(), null, new SectionFrames(s, source(st)));
    layout.update(doc.paragraphs());
    doc.takeParagraphChanges();
    const fresh = () => dump(build(Doc.fromText(doc.text().slice(0, -1)), st));
    const apply = () => {
      layout.update(doc.paragraphs(), null, Infinity, doc.takeParagraphChanges());
      expect(dump(layout)).toEqual(fresh());
    };
    expect(dump(layout)).toEqual(fresh());
    // 첫 구역에 한 글자: 쪽이 그대로면 둘째 구역에서 수렴한다
    doc.insertText(doc.paragraphs()[3]!.start, '가');
    layout.update(doc.paragraphs(), null, Infinity, doc.takeParagraphChanges());
    expect(layout.counts.reused).toBeGreaterThan(20);
    expect(dump(layout)).toEqual(fresh());
    // 첫 구역에 긴 글: 둘째·셋째 구역 시작이 뒤로 밀린다
    doc.insertText(doc.paragraphs()[5]!.start, '다'.repeat(400));
    apply();
    // 지우면 돌아온다
    const p5 = doc.paragraphs()[5]!;
    doc.deleteRange(p5.start, p5.start + 400);
    apply();
    // 둘째 구역의 여백만 바꾼다 (모델이 그 구역 문단을 바뀐 것으로 알린다)
    st.geoms[1] = geom(300, 200, 'nextPage', 30);
    layout.update(doc.paragraphs(), null, Infinity, { from: 13, suffix: doc.paragraphs().length - 26 });
    expect(dump(layout)).toEqual(fresh());
    // 구역 나눔을 없앤다: 첫 구역이 둘째 구역 설정을 쓴다 (모델이 첫 구역부터 바뀐 것으로 알린다)
    st.breaks = [25];
    st.geoms = [st.geoms[1]!, st.geoms[2]!];
    layout.update(doc.paragraphs(), null, Infinity, { from: 0, suffix: doc.paragraphs().length - 26 });
    expect(dump(layout)).toEqual(fresh());
  });

  it.each([2, 7, 13, 29])('matches a fresh layout after random edits, section changes and lazy layouts (seed %i)', (seed0) => {
    let seed = seed0;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const kinds: SectionGeom[] = [PORTRAIT, LANDSCAPE, geom(200, 300, 'continuous', 20, 50), geom(200, 300, 'oddPage'), geom(200, 300, 'evenPage', 30), geom(300, 200, 'continuous')];
    const doc = Doc.fromText(Array.from({ length: 30 }, (_, k) => para(k, rnd(40))).join(String.fromCharCode(10)));
    const st = { breaks: [5, 12, 20], geoms: [PORTRAIT, LANDSCAPE, kinds[2]!, kinds[3]!] };
    const s = setup();
    const layout = new PagedLayout(s, mono, new LayoutCache(), null, new SectionFrames(s, source(st)));
    layout.update(doc.paragraphs());
    doc.takeParagraphChanges();
    for (let step = 0; step < 150; step++) {
      const n = doc.paragraphs().length;
      const op = rnd(5);
      let hint: { from: number; suffix: number } | null = null;
      if (op === 0) {
        const p = doc.paragraphs()[rnd(n)]!;
        doc.insertText(p.start, '다'.repeat(1 + rnd(60)));
      } else if (op === 1) {
        const p = doc.paragraphs()[rnd(n)]!;
        if (p.end > p.start) doc.deleteRange(p.start, p.start + 1 + rnd(p.end - p.start));
      } else if (op === 2) {
        // 구역 하나의 모양을 바꾼다: 그 구역 문단이 바뀐 것
        const i = rnd(st.geoms.length);
        st.geoms[i] = kinds[rnd(kinds.length)]!;
        const lo = i > 0 ? st.breaks[i - 1]! + 1 : 0;
        const hi = i < st.breaks.length ? st.breaks[i]! : n - 1;
        hint = { from: lo, suffix: n - 1 - hi };
      } else if (op === 3 && st.breaks.length > 0) {
        // 구역 나눔 하나를 없앤다: 앞 구역이 뒤 구역 설정을 쓴다
        const i = rnd(st.breaks.length);
        const lo = i > 0 ? st.breaks[i - 1]! + 1 : 0;
        st.breaks.splice(i, 1);
        st.geoms.splice(i, 1);
        const hi = i < st.breaks.length ? st.breaks[i]! : n - 1;
        hint = { from: lo, suffix: n - 1 - hi };
      } else {
        // 구역 나눔을 넣는다 (문단 b에서 끝나는 구역)
        const b = rnd(n - 1);
        if (!st.breaks.includes(b)) {
          let i = 0;
          while (i < st.breaks.length && st.breaks[i]! < b) i++;
          const lo = i > 0 ? st.breaks[i - 1]! + 1 : 0;
          st.breaks.splice(i, 0, b);
          st.geoms.splice(i, 0, kinds[rnd(kinds.length)]!);
          hint = { from: lo, suffix: n - 1 - b };
        }
      }
      const changes = doc.takeParagraphChanges();
      if (hint && changes) hint = { from: Math.min(hint.from, changes.from), suffix: Math.min(hint.suffix, changes.suffix) };
      // 절반은 화면 근처까지만 배치하고 넘어간다 (지연 쪽 조립)
      layout.update(doc.paragraphs(), null, rnd(2) ? Infinity : rnd(2000), hint ?? changes);
      if (step % 3 === 2) expect(dump(layout)).toEqual(dump(build(Doc.fromText(doc.text().slice(0, -1)), st)));
    }
  });
});
