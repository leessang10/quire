/**
 * 쪽 조립과 위치 질의 (02 §6–7, 03 §5)
 *
 * 0단계 단순화: 구역 1개, 고정 용지, 머리말·각주·다단 없음
 *
 * PagedLayout은 상태를 가진 증분 레이아웃이다.
 *
 * 1. update(): 이전 결과와 새 문단 목록을 앞뒤에서 비교해 바뀐 구간 [lo, hi)를 찾는다.
 *    문단 객체가 같으면(모델이 바뀌지 않은 문단은 같은 객체를 유지) 내용도 같다.
 * 2. lo부터 순서대로 배치한다. 텍스트가 바뀐 문단은 줄을 다시 나누고(reflow),
 *    그대로인 문단은 줄 나눔을 재사용해 위치만 다시 놓는다(reposition).
 *    그대로인 문단의 시작 상태(쪽, y)가 이전과 같으면 그 뒤는 전부 이전 결과와 같으므로 멈춘다(수렴).
 * 3. 수렴하지 않으면(앞 문단 높이가 바뀌어 뒤가 전부 밀림) 화면 근처까지만 즉시 배치하고
 *    나머지는 pending으로 남겨 step()으로 유휴 시간에 처리한다 (지연 쪽 조립).
 * 4. 위치 질의 메서드는 필요한 구간이 아직 배치되지 않았으면 먼저 그 구간까지 배치한다.
 *
 * 불변식: [0, validCount) 문단은 현재 문서 기준으로 정확하다.
 * [validCount, staleFrom) 문단은 직전 레이아웃에서 정확했던 결과다 (수렴 판단에 쓸 수 있음).
 * [staleFrom, 끝) 문단은 줄 나눔만 믿을 수 있고 위치는 믿을 수 없다.
 */
import {
  breakFrom,
  cpSlice,
  layoutParagraph,
  lineMetrics,
  type FloatSpec,
  type Measurer,
  type ParaBox,
  type ParaFormat,
  type ParaLayout,
  type Preedit,
  type RunStyle,
} from './paragraph';

/**
 * 문단 → 레이아웃 서식 (편집기가 서식 묶음·스타일·문단 속성에서 만든다). null이면 서식 없는 문단.
 * force면 조합 문자열에 보류 서식이 있으니 서식 없는 문단이라도 ParaFormat을 돌려야 한다.
 */
export type FormatSource = (info: ParaInput, force: boolean) => ParaFormat | null;

/** 글자 서식만 쓰는 FormatSource (서식 번호 → 영향) */
export function charFormats(style: (id: number) => RunStyle): FormatSource {
  return (info, force) => (info.fmt || info.mark || force ? { fmt: info.fmt ?? null, mark: info.mark ?? 0, style } : null);
}

export interface PageSetup {
  width: number;
  height: number;
  margin: number;
  /** 쪽 사이 간격 (화면 표시용) */
  gap: number;
  lineHeight: number;
  paraSpacing: number;
  /** 기본 글자 크기 (px, 기준선 계산). 없으면 lineHeight ÷ 1.7 */
  fontSize?: number;
  /** 글꼴 ascent·descent (em 비율, 기준선 계산). 없으면 0.8·0.2 */
  ascent?: number;
  descent?: number;
  /**
   * 좌표 원점 (표 셀 레이아웃, 11 §4.3): 줄 x·y에 더한다. 셀은 쪽 하나(높이 무한)로 조판하고 원점을 셀 자리로 옮겨,
   * 본문과 같은 좌표계에서 캐럿·hit-test·그리기를 한다. PagedLayout.setOrigin으로 바꾼다
   */
  originX?: number;
  originY?: number;
}

/** 모델의 문단 객체. 바뀌지 않은 문단은 같은 객체여야 하며, start는 제자리에서 갱신될 수 있다 */
export interface ParaInput {
  readonly id: string;
  readonly start: number;
  readonly text: string;
  /** 글자마다 서식 번호 (없거나 null이면 모두 0, 10 §2.1) */
  readonly fmt?: Uint16Array | null;
  /** ¶의 서식 번호 */
  readonly mark?: number;
}

export interface PlacedLine {
  /** 문단 내 줄 번호 */
  index: number;
  /** 표시 코드포인트 인덱스 [start, end) */
  start: number;
  end: number;
  page: number;
  /** 쪽 왼쪽 기준 x (본문 시작) */
  x: number;
  /** 문서 전체 기준 y (줄 위쪽) */
  y: number;
  height: number;
  /** 문서 전체 기준 기준선 y */
  baseline: number;
  /**
   * 양쪽 맞춤의 추가 폭 (lineX가 더한다): adj[d - start] = 줄 시작부터 d 앞까지 늘린 폭 합. 없으면 null.
   * xs에 더하지 않으므로 문단 레이아웃 캐시(폭과 무관한 xs)를 그대로 쓴다 (10 §4)
   */
  adj: Float32Array | null;
  /** adj가 글자 사이에 나눠졌다 (공백 없는 줄): 그리기를 글자마다 나눠야 한다 */
  adjChars: boolean;
}

/** 줄 안 표시 인덱스 d의 x (쪽 왼쪽 기준): 줄 시작 x + 셰이핑 위치 + 양쪽 맞춤 추가 폭 */
export function lineX(pl: ParaLayout, ln: PlacedLine, d: number): number {
  const x = ln.x + pl.xs[d]! - pl.xs[ln.start]!;
  if (!ln.adj) return x;
  const k = Math.max(0, Math.min(ln.adj.length - 1, d - ln.start));
  return x + ln.adj[k]!;
}

const isJustifySpace = (c: string) => c === ' ' || c === '　';
/** 글자 사이 맞춤의 글자당 상한 (em 비율) */
const MAX_CHAR_STRETCH = 0.3;

/** 줄 끝 공백을 뺀 끝 인덱스 */
function trimEnd(pl: ParaLayout, start: number, end: number): number {
  while (end > start) {
    const c = cpSlice(pl, end - 1, end);
    if (c !== ' ' && c !== '\t' && c !== '　') break;
    end--;
  }
  return end;
}

interface Geometry {
  setup: PageSetup;
  /** 본문을 흘려 넣는 프레임 열 (12 §2) */
  frames: FrameSource;
  /** 프레임 k의 높이 */
  h: (k: number) => number;
  floats: FloatRegistry;
}

/**
 * 본문을 흘려 넣는 직사각형 하나 (12 §2): 쪽의 본문 영역, 다단이면 단 하나. 문서 좌표.
 * 배치 상태는 (프레임 번호, 프레임 안 y)다. PlacedPara.pageBefore·pageAfter와 FloatRegistry의 "쪽"은 프레임 번호다.
 */
export interface Frame {
  /** 이 프레임이 있는 쪽 */
  page: number;
  /** 같은 쪽에서 몇 번째 단 */
  column: number;
  /** 왼쪽 (쪽 그리기 기준 x, PlacedLine.x와 같은 기준) */
  x: number;
  /** 위쪽 (문서 y) */
  top: number;
  width: number;
  height: number;
}

/** 쪽 상자 (문서 좌표): 그리기·스크롤 */
export interface PageBox {
  x: number;
  top: number;
  width: number;
  height: number;
}

/** 프레임 열: k번째 프레임과 쪽 상자 (필요할 때 만든다) */
export interface FrameSource {
  frame(k: number): Frame;
  page(p: number): PageBox;
  /** 문서 y가 든 쪽 (쪽 사이 틈은 아래 쪽) */
  pageAt(y: number): number;
  /** 쪽 n개의 전체 높이 (마지막 쪽 아래 틈까지) */
  height(pages: number): number;
}

/**
 * 모든 쪽이 같고 쪽마다 본문 영역 하나 (2단계까지의 모양). 프레임 k = 쪽 k. 원점(PageSetup.originX/Y, 표 셀)이 바뀌면
 * 캐시를 비운다
 */
export class UniformFrames implements FrameSource {
  private cache: Frame[] = [];
  private ox = 0;
  private oy = 0;

  constructor(private readonly setup: PageSetup) {}

  private check(): void {
    const s = this.setup;
    if ((s.originX ?? 0) !== this.ox || (s.originY ?? 0) !== this.oy) {
      this.ox = s.originX ?? 0;
      this.oy = s.originY ?? 0;
      this.cache = [];
    }
  }

  frame(k: number): Frame {
    this.check();
    let f = this.cache[k];
    if (!f) {
      const s = this.setup;
      f = { page: k, column: 0, x: leftOf(s), top: pageTop(s, k) + s.margin, width: s.width - s.margin * 2, height: s.height - s.margin * 2 };
      if (k < 1 << 20) this.cache[k] = f;
    }
    return f;
  }

  page(p: number): PageBox {
    const s = this.setup;
    return { x: s.originX ?? 0, top: pageTop(s, p), width: s.width, height: s.height };
  }

  pageAt(y: number): number {
    const s = this.setup;
    return Math.max(0, Math.floor((y - (s.originY ?? 0) - s.gap) / (s.height + s.gap)));
  }

  height(pages: number): number {
    return pageTop(this.setup, pages);
  }
}

/** 놓인 떠 있는 개체 (그리기·누르기용) */
export interface PlacedFloat {
  /** 앵커의 표시 코드포인트 위치 (문단 안) */
  k: number;
  page: number;
  /** 쪽 왼쪽 기준 x (PlacedLine.x와 같은 기준), 문서 y */
  x: number;
  y: number;
  w: number;
  h: number;
  spec: FloatSpec;
}

/** 배제 영역 (본문 영역 기준 좌표: x는 본문 왼쪽, y는 본문 위에서) */
interface Excl {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  side: FloatSpec['side'];
  /** 이 영역을 만든 문단 (앞 문단의 개체만 뒤 문단에 영향을 준다) */
  owner: PlacedPara;
}

/** 쪽마다 배제 영역 (11 §4.2). 문단이 다시 놓이면 그 문단 것을 지우고 다시 넣는다 */
class FloatRegistry {
  private readonly byPage = new Map<number, Map<PlacedPara, Excl[]>>();
  private readonly pagesOf = new Map<PlacedPara, number[]>();
  /** 떠 있는 개체를 가진 문단 (글 앞·뒤 개체 포함: 그리기용) */
  readonly owners = new Set<PlacedPara>();

  remove(owner: PlacedPara): void {
    this.owners.delete(owner);
    const pages = this.pagesOf.get(owner);
    if (!pages) return;
    for (const pg of pages) {
      const m = this.byPage.get(pg);
      m?.delete(owner);
      if (m && m.size === 0) this.byPage.delete(pg);
    }
    this.pagesOf.delete(owner);
  }

  add(owner: PlacedPara, page: number, ex: Excl): void {
    let m = this.byPage.get(page);
    if (!m) this.byPage.set(page, (m = new Map()));
    let list = m.get(owner);
    if (!list) m.set(owner, (list = []));
    list.push(ex);
    const pages = this.pagesOf.get(owner) ?? [];
    if (!pages.includes(page)) pages.push(page);
    this.pagesOf.set(owner, pages);
  }

  /** 쪽 page에서 문단 para에 영향을 주는 배제 영역 (para와 그 앞 문단이 만든 것) */
  forPage(page: number, para: PlacedPara): Excl[] {
    const m = this.byPage.get(page);
    if (!m) return NO_EXCL;
    const out: Excl[] = [];
    const at = para.info.start;
    for (const [owner, list] of m) if (owner === para || owner.info.start < at) out.push(...list);
    return out;
  }

  clear(): void {
    this.byPage.clear();
    this.pagesOf.clear();
    this.owners.clear();
  }

  hasAny(): boolean {
    return this.byPage.size > 0;
  }

  /** 문단 para가 쪽 p0–p1에서 본 배제 영역의 서명 (수렴 판단) */
  sig(para: PlacedPara, p0: number, p1: number): string {
    if (this.byPage.size === 0) return '';
    let sig = '';
    for (let pg = p0; pg <= p1; pg++) {
      const ex = this.forPage(pg, para);
      if (ex.length) sig += `${pg}:${ex.map((e) => `${e.x0},${e.x1},${e.y0},${e.y1}`).join(';')}|`;
    }
    return sig;
  }
}

const NO_EXCL: Excl[] = [];
const NO_BOX: ParaBox = { align: 'left', left: 0, right: 0, first: 0, before: 0, after: 0, line: null };
const NO_FLOATS: PlacedFloat[] = [];

/** 어울림으로 새로 나눈 줄 (쪽·y까지 정해진 것) */
interface WrapLine {
  start: number;
  end: number;
  scale: number;
  objH?: number;
  page: number;
  /** 본문 영역 기준 줄 위쪽 */
  y: number;
  /** 빈 구간 시작 (본문 왼쪽 기준), 줄에 쓸 수 있는 폭 (들여쓰기 빼기 전) */
  slotX: number;
  slotW: number;
}

/** [y0, y1)에서 줄이 들어갈 빈 구간. 막혔으면 null과 막힌 영역의 아래 끝 */
function slotAt(ex: Excl[], width: number, y0: number, y1: number): { x: number; w: number } | { blockedUntil: number } {
  const hits = ex.filter((e) => e.y0 < y1 && e.y1 > y0);
  if (hits.length === 0) return { x: 0, w: width };
  // 빈 구간들 = [0, width]에서 배제 x 범위를 뺀 것
  let free: Array<[number, number]> = [[0, width]];
  for (const e of hits) {
    const next: Array<[number, number]> = [];
    for (const [a, b] of free) {
      if (e.x1 <= a || e.x0 >= b) next.push([a, b]);
      else {
        if (e.x0 > a) next.push([a, e.x0]);
        if (e.x1 < b) next.push([e.x1, b]);
      }
    }
    free = next;
  }
  // 글이 흐를 쪽 (첫 개체의 side): 왼쪽만·오른쪽만·넓은 쪽 (both는 2단계에서 넓은 쪽)
  const side = hits[0]!.side;
  const ex0 = Math.min(...hits.map((e) => e.x0));
  const ex1 = Math.max(...hits.map((e) => e.x1));
  if (side === 'left') free = free.filter(([, b]) => b <= ex0);
  else if (side === 'right') free = free.filter(([a]) => a >= ex1);
  const best = free.reduce<[number, number] | null>((m, f) => (!m || f[1] - f[0] > m[1] - m[0] ? f : m), null);
  const MIN = 24; // 이보다 좁은 구간에는 글을 넣지 않는다 (px)
  if (!best || best[1] - best[0] < MIN) return { blockedUntil: Math.min(...hits.map((e) => e.y1)) };
  return { x: best[0], w: best[1] - best[0] };
}

/**
 * 배치된 문단. 위치는 시작 상태(쪽, y)와 끝 상태만 숫자로 들고 있고,
 * 줄별 위치(lines)는 읽을 때 계산해 캐시한다. 다시 배치할 때 객체를 새로 만들지 않고 숫자만 바꾼다
 * → 앞 문단 높이 변화로 문서 전체가 밀려도 문단당 할당이 없다.
 */
export class PlacedPara {
  /** 배치 직전·직후 상태 (문단 간격 적용 전). 수렴 판단에 쓴다 */
  pageBefore = 0;
  yBefore = 0;
  pageAfter = 0;
  yAfter = 0;
  private first = false;
  private _lines: PlacedLine[] | null = null;
  /** 이 문단의 떠 있는 개체 (놓인 자리) */
  floats: PlacedFloat[] = NO_FLOATS;
  /** 어울림으로 다시 나눈 줄 (배제 영역과 겹치지 않으면 null: 캐시한 줄 나눔을 그대로) */
  private wrapped: WrapLine[] | null = null;
  /** 놓을 때 본 배제 영역 (수렴 판단: 같은 자리라도 영역이 바뀌면 다시 놓는다) */
  exclSig = '';

  constructor(
    readonly info: ParaInput,
    /** 원래(조합 전) 문단 길이 (코드포인트) */
    readonly length: number,
    readonly layout: ParaLayout,
    private readonly geo: Geometry,
  ) {}

  /** 시작 상태를 정하고 끝 상태를 계산한다 (줄 객체는 만들지 않음) */
  placeAt(page: number, y: number, first: boolean): void {
    this.pageBefore = page;
    this.yBefore = y;
    this.first = first;
    this._lines = null;
    this.wrapped = null;
    const { setup, floats: reg } = this.geo;
    const H = this.geo.h;
    reg.remove(this);
    this.floats = NO_FLOATS;
    const box = this.layout.box;
    if (!first && y > 0) y += box ? box.before : setup.paraSpacing;
    const src = this.layout.lines;
    const tbl = this.layout.table;
    if (tbl) {
      // 표: 행마다 (쪽은 행 사이에서만 나눈다)
      for (const rh of tbl.rows) {
        if (y + rh > H(page) && y > 0) {
          page++;
          y = 0;
        }
        y += rh;
      }
      if (box && box.after > 0) y += box.after;
      this.exclSig = reg.sig(this, this.pageBefore, page);
      this.pageAfter = page;
      this.yAfter = y;
      return;
    }
    // 이 문단의 떠 있는 개체: 문단 첫 줄이 놓일 쪽·y 기준으로 자리를 정하고 배제 영역을 넣는다
    if (this.layout.floats) {
      const lh0 = src.length ? lineHeight(setup, src[0]!.scale, box?.line) + objExtra(setup, src[0]!, box?.line) : setup.lineHeight;
      let pg = page;
      let top = y;
      if (top + lh0 > H(pg) && top > 0) {
        pg++;
        top = 0;
      }
      this.placeFloats(pg, top);
    }
    for (let k = 0; k < src.length; k++) {
      const lh = lineHeight(setup, src[k]!.scale, box?.line) + objExtra(setup, src[k]!, box?.line);
      if (y + lh > H(page) && y > 0) {
        page++;
        y = 0;
      }
      const ex = reg.forPage(page, this);
      if (ex.length && ex.some((e) => e.y0 < y + lh && e.y1 > y)) {
        // 여기서부터 어울림 줄바꿈
        [page, y] = this.wrapFrom(k, page, y);
        break;
      }
      y += lh;
    }
    if (box && box.after > 0) y += box.after;
    this.exclSig = reg.sig(this, this.pageBefore, page);
    this.pageAfter = page;
    this.yAfter = y;
  }

  /** 떠 있는 개체의 자리 (11 §2.3): 문단 위쪽 (pg, top) 기준. 배제 영역을 등록한다 */
  private placeFloats(pg: number, top: number): void {
    const { floats: reg, frames } = this.geo;
    const fr = frames.frame(pg);
    const pb = frames.page(fr.page);
    const cw = fr.width;
    const out: PlacedFloat[] = [];
    for (const [k, f] of this.layout.floats!) {
      const baseW = f.relX === 'page' ? pb.width : cw;
      const x0 = f.relX === 'page' ? pb.x - fr.x : 0;
      const x = x0 + (f.x === 'left' ? 0 : f.x === 'center' ? (baseW - f.w) / 2 : f.x === 'right' ? baseW - f.w : f.x);
      const y = f.relY === 'paragraph' ? top + f.y : f.relY === 'margin' ? f.y : f.y - (fr.top - pb.top);
      out.push({ k, page: pg, x: fr.x + x, y: fr.top + y, w: f.w, h: f.h, spec: f });
      if (f.wrap === 'none') continue;
      const g = f.gap;
      reg.add(this, pg, {
        x0: f.wrap === 'topBottom' ? -Infinity : x - g,
        x1: f.wrap === 'topBottom' ? Infinity : x + f.w + g,
        y0: y - g,
        y1: y + f.h + g,
        side: f.side,
        owner: this,
      });
    }
    this.floats = out;
    if (out.length) reg.owners.add(this);
  }

  /**
   * 줄 k부터 배제 영역을 피해 다시 나눈다 (11 §4.2): 줄마다 그 y의 빈 구간 폭으로 breakFrom. 빈 구간을 찾을 때는 기본 줄 높이로
   * 보고, 나눈 뒤 실제 높이를 쓴다. 막힌 y는 배제 영역 아래로 건너뛴다.
   * @returns 끝 쪽, 끝 y
   */
  private wrapFrom(k0: number, page: number, y: number): [number, number] {
    const { setup, floats: reg } = this.geo;
    const H = this.geo.h;
    const pl = this.layout;
    const box = pl.box;
    const src = pl.lines;
    const cw = this.geo.frames.frame(this.pageBefore).width;
    const lines: WrapLine[] = [];
    // 앞 줄들은 캐시한 줄 나눔 그대로 (쪽·y를 다시 계산)
    {
      let pg = this.pageBefore;
      let yy = this.yBefore;
      if (!this.first && yy > 0) yy += box ? box.before : setup.paraSpacing;
      for (let k = 0; k < k0; k++) {
        const ln = src[k]!;
        const lh = lineHeight(setup, ln.scale, box?.line) + objExtra(setup, ln, box?.line);
        if (yy + lh > H(pg) && yy > 0) {
          pg++;
          yy = 0;
        }
        lines.push({ start: ln.start, end: ln.end, scale: ln.scale, objH: ln.objH, page: pg, y: yy, slotX: 0, slotW: cw });
        yy += lh;
      }
    }
    let start = src[k0]!.start;
    const n = pl.n;
    let guard = 0;
    do {
      const probe = lineHeight(setup, 1, box?.line);
      if (y + probe > H(page) && y > 0) {
        page++;
        y = 0;
      }
      const slot = slotAt(reg.forPage(page, this), cw, y, y + probe);
      if ('blockedUntil' in slot) {
        y = Math.max(y + 1, slot.blockedUntil);
        if (++guard > 10_000) break;
        continue;
      }
      const firstLine = lines.length === 0;
      const indent = (box?.left ?? 0) + (box?.right ?? 0) + (firstLine ? (box?.first ?? 0) + (pl.marker?.shift ?? 0) : 0);
      const avail = Math.max(1, slot.w - indent);
      let end = breakFrom(pl, start, avail);
      if (end <= start && start < n) end = start + 1;
      const last = end >= n;
      const m = lineMetrics(pl, start, end, last);
      const ln = { scale: m.scale, objH: m.objH || undefined };
      const lh = lineHeight(setup, m.scale, box?.line) + objExtra(setup, ln, box?.line);
      if (y + lh > H(page) && y > 0) {
        page++;
        y = 0;
        continue; // 새 쪽에서 빈 구간을 다시 본다
      }
      lines.push({ start, end, scale: m.scale, objH: ln.objH, page, y, slotX: slot.x, slotW: slot.w });
      y += lh;
      start = end;
    } while (start < n && ++guard < 100_000);
    this.wrapped = lines;
    return [page, y];
  }

  /** 문서 기준 마지막 줄 아래쪽 y */
  get bottom(): number {
    return this.geo.frames.frame(this.pageAfter).top + this.yAfter;
  }

  /** 원점이 바뀌었다: 줄 위치를 다시 계산하게 한다 */
  dropLines(): void {
    this._lines = null;
  }

  /** 표 문단의 행 = 줄 (표시 인덱스는 모두 [0, 1): 표 원소 하나) */
  private tableLines(): PlacedLine[] {
    const { setup, frames } = this.geo;
    const H = this.geo.h;
    const tbl = this.layout.table!;
    const box = this.layout.box;
    let page = this.pageBefore;
    let y = this.yBefore;
    if (!this.first && y > 0) y += box ? box.before : setup.paraSpacing;
    return tbl.rows.map((rh, k) => {
      if (y + rh > H(page) && y > 0) {
        page++;
        y = 0;
      }
      const fr = frames.frame(page);
      const free = Math.max(0, fr.width - (box?.left ?? 0) - (box?.right ?? 0) - tbl.width);
      const x = fr.x + (box?.left ?? 0) + (box?.align === 'center' ? free / 2 : box?.align === 'right' ? free : 0);
      const top = fr.top + y;
      y += rh;
      return { index: k, start: 0, end: 1, page: fr.page, x, y: top, height: rh, baseline: top + rh, adj: null, adjChars: false };
    });
  }

  get lines(): PlacedLine[] {
    if (this._lines) return this._lines;
    if (this.layout.table) return (this._lines = this.tableLines());
    if (this.wrapped) return (this._lines = this.wrappedLines(this.wrapped));
    const { setup, frames } = this.geo;
    const H = this.geo.h;
    let page = this.pageBefore;
    let y = this.yBefore;
    const pl = this.layout;
    const box = pl.box;
    if (!this.first && y > 0) y += box ? box.before : setup.paraSpacing;
    const src = pl.lines;
    const lines: PlacedLine[] = new Array(src.length);
    for (let k = 0; k < src.length; k++) {
      const ln = src[k]!;
      const extra = objExtra(setup, ln, box?.line);
      const lh = lineHeight(setup, ln.scale, box?.line) + extra;
      if (y + lh > H(page) && y > 0) {
        page++;
        y = 0;
      }
      const fr = frames.frame(page);
      const top = fr.top + y;
      lines[k] = {
        index: k,
        start: ln.start,
        end: ln.end,
        page: fr.page,
        x: fr.x,
        y: top,
        height: lh,
        baseline: top + baselineOffset(setup, lh - extra, ln.scale) + extra,
        adj: null,
        adjChars: false,
      };
      if (box) this.alignLine(lines[k]!, k === src.length - 1);
      y += lh;
    }
    this._lines = lines;
    return lines;
  }

  private wrappedLines(src: WrapLine[]): PlacedLine[] {
    const { setup } = this.geo;
    const box = this.layout.box;
    return src.map((w, k) => {
      const extra = objExtra(setup, w, box?.line);
      const lh = lineHeight(setup, w.scale, box?.line) + extra;
      const fr = this.geo.frames.frame(w.page);
      const top = fr.top + w.y;
      const line: PlacedLine = {
        index: k,
        start: w.start,
        end: w.end,
        page: fr.page,
        x: fr.x + w.slotX,
        y: top,
        height: lh,
        baseline: top + baselineOffset(setup, lh - extra, w.scale) + extra,
        adj: null,
        adjChars: false,
      };
      const indent = (box?.left ?? 0) + (box?.right ?? 0) + (k === 0 ? (box?.first ?? 0) + (this.layout.marker?.shift ?? 0) : 0);
      this.alignLine(line, k === src.length - 1, Math.max(1, w.slotW - indent));
      return line;
    });
  }

  /** 들여쓰기·정렬·양쪽 맞춤 (10 §4). avail: 줄에 쓸 수 있는 폭 (어울림 줄이면 빈 구간에서 들여쓰기를 뺀 것) */
  private alignLine(line: PlacedLine, last: boolean, availOverride?: number): void {
    const pl = this.layout;
    const box = pl.box ?? NO_BOX;
    const avail = availOverride ?? pl.widths[line.index === 0 ? 0 : 1];
    line.x += box.left + (line.index === 0 ? box.first + (pl.marker?.shift ?? 0) : 0);
    const end = trimEnd(pl, line.start, line.end);
    const free = avail - (pl.xs[end]! - pl.xs[line.start]!);
    if (free <= 0) return;
    if (box.align === 'center') line.x += free / 2;
    else if (box.align === 'right') line.x += free;
    else if (box.align === 'justify' && !last) {
      // 공백(어간)에 나눈다. 공백이 없으면 글자 사이에 나누되 글자당 상한을 둔다
      const n = end - line.start;
      const spaces: number[] = [];
      for (let d = line.start; d < end; d++) if (isJustifySpace(cpSlice(pl, d, d + 1))) spaces.push(d);
      const adj = new Float32Array(n + 1);
      if (spaces.length > 0) {
        const each = free / spaces.length;
        let acc = 0;
        let s = 0;
        for (let d = line.start; d <= end; d++) {
          adj[d - line.start] = acc;
          if (s < spaces.length && spaces[s] === d) {
            acc += each;
            s++;
          }
        }
      } else {
        const gaps: number[] = [];
        for (let d = line.start + 1; d < end; d++) if (pl.stops[d]) gaps.push(d);
        if (gaps.length === 0) return;
        const em = this.geo.setup.fontSize ?? this.geo.setup.lineHeight / 1.7;
        const each = Math.min(free / gaps.length, em * MAX_CHAR_STRETCH);
        let acc = 0;
        let g = 0;
        for (let d = line.start; d <= end; d++) {
          if (g < gaps.length && gaps[g] === d) {
            acc += each;
            g++;
          }
          adj[d - line.start] = acc;
        }
        line.adjChars = true;
      }
      line.adj = adj;
    }
  }
}

export interface LineRef {
  para: number;
  line: number;
}

export interface CaretRect {
  page: number;
  x: number;
  y: number;
  height: number;
  ref: LineRef;
}

export interface LayoutCounts {
  /** 줄을 다시 나눈 문단 수 */
  reflowed: number;
  /** 줄 나눔을 재사용하고 위치만 다시 놓은 문단 수 */
  repositioned: number;
  /** 수렴해서 건너뛴(그대로 쓴) 문단 수 */
  reused: number;
}

/** 줄 높이 배율 → 줄 높이 (px). 배율 1이면 setup.lineHeight 그대로 */
export function lineHeight(setup: PageSetup, scale: number, rule?: ParaBox['line']): number {
  const natural = scale === 1 ? setup.lineHeight : Math.round(setup.lineHeight * scale);
  if (!rule) return natural;
  if (rule.rule === 'multiple') return rule.value === 1 ? natural : Math.round(setup.lineHeight * scale * rule.value);
  if (rule.rule === 'exact') return Math.round(rule.value);
  return Math.max(natural, Math.round(rule.value));
}

/**
 * 개체가 글자보다 높으면 줄을 그만큼 늘린다 (11 §4.1): 개체는 기준선 위에 서므로 늘어나는 몫 = 개체 높이 − 글자 ascent.
 * 고정 줄 간격(exact)은 늘리지 않는다
 */
export function objExtra(setup: PageSetup, ln: { scale: number; objH?: number }, rule?: ParaBox['line']): number {
  if (!ln.objH || rule?.rule === 'exact') return 0;
  const em = (setup.fontSize ?? setup.lineHeight / 1.7) * ln.scale;
  return Math.max(0, Math.round(ln.objH - (setup.ascent ?? 0.8) * em));
}

/**
 * 줄 위쪽에서 기준선까지 (10 §4): 줄 가운데에 그 줄 가장 큰 글자의 글꼴 상자(ascent + descent)를 세운다.
 * 크기가 섞인 줄도 기준선 하나에 모든 글자를 놓는다.
 */
export function baselineOffset(setup: PageSetup, height: number, scale: number): number {
  const em = (setup.fontSize ?? setup.lineHeight / 1.7) * scale;
  const asc = setup.ascent ?? 0.8;
  const desc = setup.descent ?? 0.2;
  return height / 2 + ((asc - desc) / 2) * em;
}

export function pageTop(setup: PageSetup, page: number): number {
  return (setup.originY ?? 0) + setup.gap + page * (setup.height + setup.gap);
}

/** 줄 x의 기준 (쪽 왼쪽 기준 본문 시작) */
function leftOf(setup: PageSetup): number {
  return setup.margin + (setup.originX ?? 0);
}

export class LayoutCache {
  private map = new Map<string, ParaLayout>();
  hits = 0;
  misses = 0;

  constructor(private readonly maxEntries = 4000) {}

  get(text: string, width: number, measurer: Measurer, preedit: Preedit | null, format: ParaFormat | null = null): ParaLayout {
    if (preedit) {
      // 조합 중 레이아웃은 일회성이므로 캐시하지 않는다
      this.misses++;
      return layoutParagraph(text, width, measurer, preedit, format);
    }
    // 서식이 있으면 키에 서식 번호 런을 넣는다 (번호의 뜻은 문서마다 다르므로 문서를 바꾸면 clear)
    const key = format ? `${width}|${formatKey(format)}|${text}` : `${width}|${text}`;
    let hit = this.map.get(key);
    if (hit) {
      this.hits++;
      return hit;
    }
    this.misses++;
    hit = layoutParagraph(text, width, measurer, null, format);
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, hit);
    return hit;
  }

  clear(): void {
    this.map.clear();
  }
}

/** 서식 번호 열을 런으로 줄인 문자열 ("번호x길이," … "¶번호") */
function formatKey(f: ParaFormat): string {
  let out = '';
  const fmt = f.fmt;
  if (fmt) {
    let k = 0;
    while (k < fmt.length) {
      let j = k + 1;
      while (j < fmt.length && fmt[j] === fmt[k]) j++;
      out += `${fmt[k]}x${j - k},`;
      k = j;
    }
  }
  const b = f.box;
  const bk =
    (b ? `|${JSON.stringify(b)}` : '') +
    (f.marker ? `|#${f.marker.id},${f.marker.hanging},${f.marker.text}` : '') +
    (f.objs && f.objs.size ? `|o${[...f.objs].map(([k, o]) => `${k}:${o.w}x${o.h}`).join(',')}` : '') +
    (f.floats && f.floats.size ? `|f${JSON.stringify([...f.floats])}` : '') +
    (f.table ? `|t${f.table.width}:${f.table.rows.join(',')}` : '');
  return `${out}¶${f.mark}${bk}${f.key ? `|${f.key}` : ""}`;
}

interface Pending {
  next: number;
  page: number;
  y: number;
}

export class PagedLayout {
  /** 현재 문서의 문단 목록 (모델 소유, 읽기만 함) */
  model: readonly ParaInput[] = [];
  /** 문단별 배치 결과. pending 이후는 낡았거나(null 포함) 아직 계산되지 않았다 */
  paras: Array<PlacedPara | null> = [];
  counts: LayoutCounts = { reflowed: 0, repositioned: 0, reused: 0 };

  private pending: Pending | null = null;
  private staleFrom = Infinity;
  private preedit: { offset: number; text: string; fmt?: number } | null = null;
  private preeditPara = -1;
  private readonly contentWidth: number;
  private readonly geo: Geometry;

  constructor(
    readonly setup: PageSetup,
    private readonly measurer: Measurer,
    private readonly cache: LayoutCache = new LayoutCache(),
    /** 문단 → 레이아웃 서식 (없으면 서식을 무시). charFormats(style)이면 글자 서식만 */
    private readonly format: FormatSource | null = null,
    /** 프레임 열 (12 §2). 없으면 모든 쪽이 같은 UniformFrames */
    readonly frames: FrameSource = new UniformFrames(setup),
  ) {
    this.contentWidth = frames.frame(0).width;
    this.geo = { setup, frames, h: (k) => frames.frame(k).height, floats: new FloatRegistry() };
  }

  /** 쪽 p의 상자 (문서 좌표) */
  pageBox(p: number): PageBox {
    return this.frames.page(p);
  }

  /** 문서 y가 든 쪽 */
  pageAt(y: number): number {
    return this.frames.pageAt(y);
  }

  /** 좌표 원점을 옮긴다 (표 셀, PageSetup.originX/Y). 배치는 그대로, 줄 위치만 다시 계산한다 */
  setOrigin(x: number, y: number): void {
    const s = this.setup as { originX?: number; originY?: number };
    if ((s.originX ?? 0) === x && (s.originY ?? 0) === y) return;
    s.originX = x;
    s.originY = y;
    for (const pp of this.paras) pp?.dropLines();
  }

  /** 내용 높이 (모두 배치한 뒤, 쪽 하나로 조판한 셀에서): 마지막 문단 아래 끝 */
  get contentBottom(): number {
    this.finish();
    const last = this.paras[this.paras.length - 1];
    return last ? last.yAfter : 0;
  }

  /** 모든 문단이 배치되었는가 */
  get complete(): boolean {
    return this.pending === null;
  }

  /** 정확하게 배치된 앞쪽 문단 수 */
  get validCount(): number {
    return this.pending ? this.pending.next : this.paras.length;
  }

  /** 쪽 수. 배치 중이면 지금까지의 비율로 추정한다 */
  get pageCount(): number {
    const valid = this.validCount;
    if (valid === 0) return 1;
    const lastPage = this.frames.frame(this.paras[valid - 1]!.pageAfter).page + 1;
    if (!this.pending) return lastPage;
    return Math.max(lastPage, Math.ceil((lastPage * this.paras.length) / valid));
  }

  get totalHeight(): number {
    return this.frames.height(this.pageCount);
  }

  /**
   * 문서가 바뀐 뒤 호출한다.
   * @param syncUntilY 이 문서 y까지는 즉시 배치한다 (나머지는 step()/질의 시 배치)
   */
  update(
    model: readonly ParaInput[],
    preedit: { offset: number; text: string; fmt?: number } | null = null,
    syncUntilY = Infinity,
    /** 모델이 알려 주는 바뀐 구간 (Doc.takeParagraphChanges). 없으면 문단 목록을 앞뒤에서 비교해 찾는다 */
    changes: { from: number; suffix: number } | null = null,
  ): void {
    this.counts = { reflowed: 0, repositioned: 0, reused: 0 };
    const old = this.paras;
    const oldLen = old.length;
    const newLen = model.length;
    const oldValid = this.validCount;
    const oldPending = this.pending;
    const prevPi = this.preeditPara;

    this.model = model;
    this.preedit = preedit;
    const pi = preedit ? findByStart(model, preedit.offset) : -1;
    this.preeditPara = pi;

    let lo: number;
    let s: number;
    if (changes) {
      // 힌트 사용: O(1)
      lo = Math.min(changes.from, oldValid, oldLen, newLen);
      s = Math.min(changes.suffix, oldLen - lo, newLen - lo);
      // 조합 문자열이 있던/생긴 문단도 다시 배치
      const delta = newLen - oldLen;
      for (const [idx, isOld] of [[prevPi, true], [pi, false]] as const) {
        if (idx < 0) continue;
        let n = idx;
        if (isOld) {
          if (idx >= oldLen - s) n = idx + delta; // 뒤쪽 공통 구간 → 새 인덱스
          else if (idx >= lo) continue; // 이미 바뀐 구간 안
        }
        if (n < lo) lo = Math.min(n, oldValid);
        if (n >= newLen - s) s = Math.max(0, newLen - n - 1);
      }
      s = Math.min(s, oldLen - lo, newLen - lo);
    } else {
      const same = (o: PlacedPara | null, n: ParaInput, idx: number) =>
        o !== null && o.info === n && o.layout.preedit === null && idx !== pi;
      // 앞쪽 공통 구간 (정확한 구간 안에서만)
      const lim = Math.min(oldLen, newLen);
      lo = 0;
      while (lo < lim && lo < oldValid && same(old[lo]!, model[lo]!, lo)) lo++;
      // 뒤쪽 공통 구간
      s = 0;
      while (s < lim - lo && same(old[oldLen - 1 - s]!, model[newLen - 1 - s]!, newLen - 1 - s)) s++;
    }
    const hi = newLen - s;
    const oldHi = oldLen - s;

    if (lo === hi && lo === oldHi) {
      // 바뀐 것 없음. 남은 배치가 있으면 요청 범위까지만 진행
      this.run((_m, y) => y > syncUntilY);
      return;
    }

    // 수렴 판단에 쓸 수 있는 구간 [hi, staleFrom)을 정한다.
    // 이 구간의 문단들은 하나의 직전 레이아웃에서 서로 일관되게 배치된 결과여야 한다.
    // 배치 중이던 상태(pending)에서는 pending 앞(직전 문서 기준으로 정확)과
    // pending 뒤(더 오래된 레이아웃)가 서로 다른 레이아웃이므로 그 경계를 넘지 않는다.
    const delta = newLen - oldLen;
    if (oldPending === null) {
      this.staleFrom = Infinity;
    } else if (oldPending.next >= oldHi) {
      this.staleFrom = oldPending.next + delta;
    } else {
      const oldStale = this.staleFrom;
      this.staleFrom = Math.max(hi, oldStale >= oldHi ? oldStale + delta : hi);
    }

    // 바뀐 구간을 비우고 lo부터 다시 배치 (지우는 문단의 배제 영역도 뺀다)
    for (let k = lo; k < oldHi; k++) {
      const o = old[k];
      if (o) this.geo.floats.remove(o);
    }
    spliceFill(old, lo, oldHi - lo, hi - lo);
    const prev = lo > 0 ? old[lo - 1]! : null;
    this.pending = { next: lo, page: prev ? prev.pageAfter : 0, y: prev ? prev.yAfter : 0 };
    this.run((_m, y) => y > syncUntilY);
  }

  /** 남은 배치를 시간 예산만큼 진행한다. 남은 일이 있으면 true */
  step(budgetMs: number): boolean {
    const end = performance.now() + budgetMs;
    this.run((m) => (m & 15) === 0 && performance.now() > end);
    return !this.complete;
  }

  /**
   * 문서 y까지 배치를 끝낸다. 시간 예산을 주면 그 안에서만 진행한다.
   * @returns y까지 배치가 끝났으면 true
   */
  ensureThroughY(y: number, budgetMs = Infinity): boolean {
    if (!this.pending) return true;
    if (budgetMs === Infinity) {
      this.run((_m, top) => top > y);
    } else {
      const end = performance.now() + budgetMs;
      let timedOut = false;
      this.run((m, top) => {
        if (top > y) return true;
        if ((m & 15) === 0 && performance.now() > end) timedOut = true;
        return timedOut;
      });
      if (timedOut) return false;
    }
    return true;
  }

  /** 정확하게 배치된 영역의 아래쪽 끝 (문서 y). 모두 배치되었으면 Infinity */
  get validBottom(): number {
    if (!this.pending) return Infinity;
    const v = this.validCount;
    return v === 0 ? 0 : this.paras[v - 1]!.bottom;
  }

  /** 문단 p까지 배치를 끝낸다 */
  ensureThroughPara(p: number): void {
    if (this.pending && this.pending.next <= p) this.run((m) => m > p);
  }

  finish(): void {
    if (this.pending) this.run(() => false);
  }

  // ── 질의 (필요한 구간을 먼저 배치) ─────────────────────

  /** 오프셋이 속한 문단 번호 (문단 끝 ¶ 위치 포함) */
  paraIndexAt(offset: number): number {
    return findByStart(this.model, offset);
  }

  para(p: number): PlacedPara {
    this.ensureThroughPara(p);
    return this.paras[p]!;
  }

  lineAt(offset: number): LineRef {
    const p = this.paraIndexAt(offset);
    const para = this.para(p);
    const d = docToDisplay(para, offset);
    const lines = para.lines;
    for (let k = 0; k < lines.length; k++) {
      if (d < lines[k]!.end || k === lines.length - 1) return { para: p, line: k };
    }
    return { para: p, line: 0 };
  }

  line(ref: LineRef): PlacedLine {
    return this.para(ref.para).lines[ref.line]!;
  }

  /** 다음/이전 줄 (문단 경계를 넘음). 범위를 벗어나면 null */
  stepLine(ref: LineRef, dir: number): LineRef | null {
    let { para, line } = ref;
    let n = Math.abs(dir);
    const s = Math.sign(dir);
    while (n-- > 0) {
      line += s;
      if (line < 0) {
        para--;
        if (para < 0) return null;
        line = this.para(para).lines.length - 1;
      } else if (line >= this.para(para).lines.length) {
        para++;
        if (para >= this.model.length) return null;
        line = 0;
      }
    }
    return { para, line };
  }

  /**
   * 아래쪽 끝이 y보다 큰 첫 줄 (화면 그리기·hit-test 시작점).
   * ensure가 false면 이미 배치된 영역에서만 찾고, y가 그 밖이면 null
   */
  firstLineBelow(y: number): LineRef;
  firstLineBelow(y: number, ensure: false): LineRef | null;
  firstLineBelow(y: number, ensure = true): LineRef | null {
    if (ensure) this.ensureThroughY(y);
    else if (y >= this.validBottom || this.validCount === 0) return null;
    const ps = this.paras;
    let lo = 0;
    let hi = this.validCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ps[mid]!.bottom <= y) lo = mid + 1;
      else hi = mid;
    }
    const lines = ps[lo]!.lines;
    let k = 0;
    while (k < lines.length - 1 && lines[k]!.y + lines[k]!.height <= y) k++;
    return { para: lo, line: k };
  }

  caretRect(offset: number): CaretRect {
    const ref = this.lineAt(offset);
    const para = this.paras[ref.para]!;
    const ln = para.lines[ref.line]!;
    const d = Math.min(docToDisplay(para, offset), ln.end);
    return { page: ln.page, x: lineX(para.layout, ln, d), y: ln.y, height: ln.height, ref };
  }

  /** 줄 안에서 x에 가장 가까운 캐럿 오프셋 */
  offsetInLine(ref: LineRef, x: number): number {
    const para = this.para(ref.para);
    const ln = para.lines[ref.line]!;
    const { stops } = para.layout;
    const isLastLine = ref.line === para.lines.length - 1;
    // 줄바꿈된 줄의 끝(=다음 줄 시작)에는 캐럿을 두지 않는다
    const maxD = isLastLine ? ln.end : ln.end - 1;
    let best = ln.start;
    let bestDist = Infinity;
    for (let d = ln.start; d <= Math.max(ln.start, maxD); d++) {
      if (!stops[d]) continue;
      const dist = Math.abs(lineX(para.layout, ln, d) - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return displayToDoc(para, best);
  }

  /** 문서 좌표 (쪽 왼쪽 기준 x, 문서 y) → 캐럿 오프셋 */
  hitTest(x: number, y: number): number {
    let ref = this.firstLineBelow(y);
    const cur = this.line(ref);
    if (y < cur.y) {
      const prevRef = this.stepLine(ref, -1);
      if (prevRef) {
        const prev = this.line(prevRef);
        if (y - (prev.y + prev.height) < cur.y - y) ref = prevRef;
      }
    }
    return this.offsetInLine(ref, x);
  }

  /** 이전 grapheme 경계 (문단 경계를 넘으면 ¶ 한 칸) */
  prevStop(offset: number): number {
    const para = this.para(this.paraIndexAt(offset));
    const start = para.info.start;
    const d = offset - start;
    if (d <= 0) return Math.max(0, offset - 1);
    const stops = para.layout.preedit ? null : para.layout.stops;
    let k = d - 1;
    while (stops && k > 0 && !stops[k]) k--;
    return start + k;
  }

  /** 다음 grapheme 경계 */
  nextStop(offset: number): number {
    const para = this.para(this.paraIndexAt(offset));
    const start = para.info.start;
    const d = offset - start;
    if (d >= para.length) return offset + 1;
    const stops = para.layout.preedit ? null : para.layout.stops;
    let k = d + 1;
    while (stops && k < para.length && !stops[k]) k++;
    return start + k;
  }

  /** 수렴 판단: pp가 놓일 때 본 배제 영역이 지금도 같은가 (떠 있는 개체가 없는 쪽은 늘 같다) */
  private sameExclusions(pp: PlacedPara): boolean {
    if (pp.exclSig === '' && !this.geo.floats.hasAny()) return true;
    return pp.exclSig === this.geo.floats.sig(pp, pp.pageBefore, pp.pageAfter);
  }

  /** 문서 y 범위 [y0, y1)에 걸친 쪽의 떠 있는 개체와 그 문단 */
  floatsIn(y0: number, y1: number): Array<{ para: PlacedPara; float: PlacedFloat }> {
    const out: Array<{ para: PlacedPara; float: PlacedFloat }> = [];
    for (const pp of this.geo.floats.owners) for (const f of pp.floats) if (f.y < y1 && f.y + f.h > y0) out.push({ para: pp, float: f });
    // 문서 순서 (앞 문단의 개체를 먼저 그린다)
    return out.sort((a, b) => a.para.info.start - b.para.info.start || a.float.k - b.float.k);
  }

  // ── 내부 ──────────────────────────────────────────────

  /** pending에서 시작해 stop이 true가 될 때까지(또는 끝까지) 배치한다 */
  private run(stop: (m: number, nextTopY: number) => boolean): void {
    const { model, paras } = this;
    const len = model.length;
    while (this.pending) {
      let { next: m, page, y } = this.pending;
      if (m >= len) {
        this.pending = null;
        this.staleFrom = Infinity;
        break;
      }
      if (stop(m, this.geo.frames.frame(page).top + y)) break;

      const info = model[m]!;
      const pp = paras[m] ?? null;
      let layout: ParaLayout;
      if (pp && pp.info === info && pp.layout.preedit === null && m !== this.preeditPara) {
        if (m < this.staleFrom && pp.pageBefore === page && pp.yBefore === y && this.sameExclusions(pp)) {
          // 수렴: [m, staleFrom)은 이전 결과 그대로
          const until = Math.min(this.staleFrom, len);
          this.counts.reused += until - m;
          if (until >= len) {
            this.pending = null;
            this.staleFrom = Infinity;
            break;
          }
          const last = paras[until - 1]!;
          this.pending = { next: until, page: last.pageAfter, y: last.yAfter };
          // until 이후는 다른(더 오래된) 레이아웃의 결과이므로 이번 배치가 끝날 때까지 수렴 판단에 쓰지 않는다
          this.staleFrom = until;
          continue;
        }
        // 줄 나눔은 그대로, 위치만 다시 (할당 없음)
        pp.placeAt(page, y, m === 0);
        this.counts.repositioned++;
        this.pending = { next: m + 1, page: pp.pageAfter, y: pp.yAfter };
        continue;
      } else {
        let pe: Preedit | null = null;
        if (m === this.preeditPara && this.preedit) {
          pe = { at: this.preedit.offset - info.start, text: this.preedit.text, fmt: this.preedit.fmt };
        }
        const format: ParaFormat | null = this.format ? this.format(info, pe?.fmt !== undefined) : null;
        layout = this.cache.get(info.text, this.contentWidth, this.measurer, pe, format);
        this.counts.reflowed++;
      }

      const length =
        pp && pp.info === info
          ? pp.length
          : layout.n - (layout.preedit ? layout.preedit[1] - layout.preedit[0] : 0);
      if (pp) this.geo.floats.remove(pp);
      const placed = new PlacedPara(info, length, layout, this.geo);
      placed.placeAt(page, y, m === 0);
      paras[m] = placed;
      this.pending = { next: m + 1, page: placed.pageAfter, y: placed.yAfter };
    }
  }

}

// ── 표시 인덱스 ↔ 문서 오프셋 ──────────────────────────────

export function displayToDoc(para: PlacedPara, d: number): number {
  const start = para.info.start;
  const pre = para.layout.preedit;
  if (!pre) return start + d;
  if (d <= pre[0]) return start + d;
  if (d >= pre[1]) return start + d - (pre[1] - pre[0]);
  return start + pre[0];
}

export function docToDisplay(para: PlacedPara, offset: number): number {
  const d = offset - para.info.start;
  const pre = para.layout.preedit;
  if (pre && d >= pre[0]) return d + (pre[1] - pre[0]); // 캐럿은 조합 문자열 뒤
  return d;
}

// ── 유틸 ─────────────────────────────────────────────────

/** start ≤ offset인 마지막 문단 */
function findByStart(paras: readonly ParaInput[], offset: number): number {
  let lo = 0;
  let hi = paras.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (paras[mid]!.start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** arr[at, at+remove)를 null fill개로 바꾼다 (큰 배열에서도 인자 수 제한 없이) */
function spliceFill<T>(arr: Array<T | null>, at: number, remove: number, fill: number): void {
  if (remove === fill) {
    for (let k = 0; k < fill; k++) arr[at + k] = null;
    return;
  }
  const tail = arr.slice(at + remove);
  arr.length = at;
  for (let k = 0; k < fill; k++) arr.push(null);
  for (let k = 0; k < tail.length; k++) arr.push(tail[k]!);
}
