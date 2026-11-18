/**
 * 떠 있는 개체와 어울림 (11 §4.2, 2-9): 자리 계산, 배제 영역, 어울림 줄바꿈, 증분 레이아웃 = 처음부터 레이아웃
 */
import { describe, expect, it } from 'vitest';
import {
  LayoutCache,
  PLAIN_STYLE,
  PagedLayout,
  lineX,
  type FloatSpec,
  type FormatSource,
  type Measurer,
  type PageSetup,
  type ParaInput,
} from './index';

const O = '￼';
/** 모든 grapheme 폭 10 */
const mono: Measurer = { width: () => 10 };
/** 본문 폭 200, 줄 높이 20, 문단 간격 5, 본문 높이 300 */
const SETUP: PageSetup = { width: 300, height: 400, margin: 50, gap: 10, lineHeight: 20, paraSpacing: 5, fontSize: 12 };
const spec = (s: Partial<FloatSpec>): FloatSpec => ({ w: 80, h: 50, relX: 'column', relY: 'paragraph', x: 'right', y: 0, wrap: 'square', side: 'largest', gap: 0, behind: false, ...s });

/** 문단 id → 그 문단의 떠 있는 개체 (앵커 위치 0) */
function source(map: Record<string, FloatSpec>): FormatSource {
  return (info) => (map[info.id] ? { fmt: null, mark: 0, style: () => PLAIN_STYLE, floats: new Map([[0, map[info.id]!]]) } : null);
}

function place(paras: ParaInput[], map: Record<string, FloatSpec>, setup = SETUP) {
  const pl = new PagedLayout(setup, mono, new LayoutCache(), source(map));
  pl.update(paras);
  pl.finish();
  return pl;
}

const words = (n: number) => Array.from({ length: n }, (_, k) => `가나${k % 10}`).join(' ');

describe('floats and wrapping', () => {
  it('places a float relative to its paragraph and wraps the lines beside it (largest side)', () => {
    const paras: ParaInput[] = [{ id: 'a', start: 0, text: O + words(20) }];
    const pl = place(paras, { a: spec({}) });
    const pp = pl.para(0);
    expect(pp.floats).toHaveLength(1);
    const f = pp.floats[0]!;
    expect([f.x, f.y - pp.lines[0]!.y, f.w, f.h]).toEqual([50 + 120, 0, 80, 50]);
    // 개체 높이 50 = 줄 2.5개: 처음 세 줄은 폭 120, 그 뒤는 200
    const widths = pp.lines.map((ln) => lineX(pp.layout, ln, ln.end) - ln.x);
    expect(widths.slice(0, 3).every((w) => w <= 120)).toBe(true);
    expect(widths[3]!).toBeGreaterThan(120);
    expect(pp.lines.every((ln) => ln.x === 50)).toBe(true);
  });

  it('flows text on the right of a left float, only on the left with side left, and below with topBottom', () => {
    const text = O + words(20);
    const left = place([{ id: 'a', start: 0, text }], { a: spec({ x: 'left' }) }).para(0);
    expect(left.lines[0]!.x).toBe(50 + 80);
    const onlyLeft = place([{ id: 'a', start: 0, text }], { a: spec({ x: 40, side: 'left' }) }).para(0);
    expect(lineX(onlyLeft.layout, onlyLeft.lines[0]!, onlyLeft.lines[0]!.end) - 50).toBeLessThanOrEqual(40);
    const below = place([{ id: 'a', start: 0, text }], { a: spec({ wrap: 'topBottom' }) }).para(0);
    expect(below.lines[0]!.y - below.floats[0]!.y).toBe(50);
    const none = place([{ id: 'a', start: 0, text }], { a: spec({ wrap: 'none' }) }).para(0);
    expect(none.lines[0]!.y).toBe(none.floats[0]!.y);
    expect(lineX(none.layout, none.lines[0]!, none.lines[0]!.end) - 50).toBeGreaterThan(120);
  });

  it('wraps the following paragraphs on the same page, but not earlier ones', () => {
    const paras: ParaInput[] = [
      { id: 'p', start: 0, text: words(8) },
      { id: 'a', start: 100, text: `${O}짧다` },
      { id: 'b', start: 200, text: words(12) },
    ];
    // a의 개체는 a 위쪽에서 40 위로 (앞 문단 자리에 겹침), 높이 100
    const pl = place(paras, { a: spec({ y: -40, h: 100 }) });
    const p0 = pl.para(0);
    expect(p0.lines.every((ln) => lineX(p0.layout, ln, ln.end) - ln.x > 120 || ln.end - ln.start < 12)).toBe(true);
    const b = pl.para(2);
    expect(lineX(b.layout, b.lines[0]!, b.lines[0]!.end) - 50).toBeLessThanOrEqual(120);
  });

  it('keeps incremental layout equal to a fresh layout through random edits (floats moving, text growing)', () => {
    let s = 7;
    const rnd = (n: number) => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s % n;
    };
    const setup: PageSetup = { ...SETUP, height: 260 };
    for (let seed = 0; seed < 30; seed++) {
      let paras: ParaInput[] = Array.from({ length: 12 }, (_, k) => ({ id: `p${k}`, start: 0, text: (k % 3 === 0 ? O : '') + words(3 + rnd(12)) }));
      let map: Record<string, FloatSpec> = {};
      for (const p of paras) if (p.text.startsWith(O)) map[p.id] = spec({ x: rnd(2) ? 'left' : 'right', y: rnd(60) - 20, h: 30 + rnd(80), wrap: rnd(5) === 0 ? 'topBottom' : 'square' });
      const fix = (ps: ParaInput[]) => {
        let start = 0;
        return ps.map((p) => {
          const q = { ...p, start };
          start += Array.from(p.text).length + 1;
          return q;
        });
      };
      paras = fix(paras);
      // 같은 FormatSource가 바뀐 map을 읽도록 (문단 객체가 바뀌면 다시 묻는다)
      const src: FormatSource = (info) => source(map)(info, false);
      const inc = new PagedLayout(setup, mono, new LayoutCache(), src);
      inc.update(paras);
      inc.finish();
      for (let step = 0; step < 20; step++) {
        const i = rnd(paras.length);
        const r = rnd(4);
        const next = [...paras];
        if (r === 0) next[i] = { ...next[i]!, text: next[i]!.text + ' 더' };
        else if (r === 1 && map[next[i]!.id]) {
          map = { ...map, [next[i]!.id]: { ...map[next[i]!.id]!, y: rnd(80) - 30, h: 30 + rnd(90) } };
          next[i] = { ...next[i]! }; // 문단 객체가 바뀌어야 다시 묻는다 (모델이 그렇게 한다)
        } else if (r === 2 && next.length > 4) next.splice(i, 1);
        else next.splice(i, 0, { id: `n${seed}-${step}`, start: 0, text: words(2 + rnd(8)) });
        paras = fix(next).map((p, k) => (p.start === next[k]!.start && p === next[k] ? p : Object.assign(next[k]!, { start: p.start })));
        inc.update(paras);
        inc.finish();
        const fresh = new PagedLayout(setup, mono, new LayoutCache(), src);
        fresh.update(paras);
        fresh.finish();
        const view = (pl: PagedLayout) =>
          paras.map((_, k) => {
            const pp = pl.para(k);
            return {
              lines: pp.lines.map((ln) => [ln.start, ln.end, ln.page, Math.round(ln.y), Math.round(ln.x), Math.round(lineX(pp.layout, ln, ln.end))]),
              floats: pp.floats.map((f) => [f.page, Math.round(f.x), Math.round(f.y)]),
            };
          });
        expect(view(inc), `seed ${seed} step ${step}`).toEqual(view(fresh));
      }
    }
  });
});
