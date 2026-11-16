/**
 * 쪽 조립과 위치 질의 (02 §6–7, 03 §5)
 *
 * 0단계 단순화: 구역 1개, 고정 용지, 머리말·각주·다단 없음
 *
 * 증분 레이아웃
 * - 문단마다 배치 결과(PlacedPara)를 이전 레이아웃에서 문단 ID로 찾는다
 * - 텍스트가 같고(같은 문자열) 시작 상태(쪽, y)가 같으면 배치를 그대로 재사용한다 → 문단당 O(1)
 * - 텍스트만 같고 시작 상태가 다르면(앞 문단 높이 변화) 줄 나눔은 재사용하고 줄 위치만 다시 놓는다
 * - 텍스트가 바뀐 문단만 줄을 다시 나눈다
 */
import { layoutParagraph, type Measurer, type ParaLayout, type Preedit } from './paragraph';

export interface PageSetup {
  width: number;
  height: number;
  margin: number;
  /** 쪽 사이 간격 (화면 표시용) */
  gap: number;
  lineHeight: number;
  paraSpacing: number;
}

export interface ParaInput {
  id: string;
  /** 문단 첫 원소의 문서 오프셋 */
  start: number;
  text: string;
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
}

export interface PlacedPara {
  id: string;
  /** 문서 오프셋 (재사용 시 갱신됨) */
  start: number;
  /** 원래(조합 전) 문단 길이 (코드포인트) */
  length: number;
  text: string;
  layout: ParaLayout;
  lines: PlacedLine[];
  /** 배치 전·후 상태 (재사용 판단) */
  pageBefore: number;
  yBefore: number;
  pageAfter: number;
  yAfter: number;
}

export interface DocLayout {
  setup: PageSetup;
  paras: PlacedPara[];
  byId: Map<string, PlacedPara>;
  pageCount: number;
  totalHeight: number;
  /** 이번 레이아웃에서 줄을 다시 나눈 / 다시 놓은 / 그대로 쓴 문단 수 */
  counts: { reflowed: number; repositioned: number; reused: number };
}

/** 위치 질의 결과에서 줄을 가리키는 참조 */
export interface LineRef {
  para: number;
  line: number;
}

export function pageTop(setup: PageSetup, page: number): number {
  return setup.gap + page * (setup.height + setup.gap);
}

export class LayoutCache {
  private map = new Map<string, ParaLayout>();
  hits = 0;
  misses = 0;

  constructor(private readonly maxEntries = 4000) {}

  get(text: string, width: number, measurer: Measurer, preedit: Preedit | null): ParaLayout {
    if (preedit) {
      // 조합 중 레이아웃은 일회성이므로 캐시하지 않는다
      this.misses++;
      return layoutParagraph(text, width, measurer, preedit);
    }
    const key = `${width}|${text}`;
    let hit = this.map.get(key);
    if (hit) {
      this.hits++;
      return hit;
    }
    this.misses++;
    hit = layoutParagraph(text, width, measurer, null);
    if (this.map.size >= this.maxEntries) {
      // 가장 오래된 항목부터 제거 (Map은 삽입 순서 유지)
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

export function layoutDocument(
  paras: readonly ParaInput[],
  setup: PageSetup,
  measurer: Measurer,
  cache: LayoutCache,
  preedit: { offset: number; text: string } | null = null,
  prev: DocLayout | null = null,
): DocLayout {
  const contentWidth = setup.width - setup.margin * 2;
  const contentHeight = setup.height - setup.margin * 2;
  const reusable = prev && prev.setup === setup ? prev.byId : null;
  const placed: PlacedPara[] = new Array(paras.length);
  const byId = new Map<string, PlacedPara>();
  const counts = { reflowed: 0, repositioned: 0, reused: 0 };
  let page = 0;
  let y = 0; // 쪽 본문 기준

  for (let p = 0; p < paras.length; p++) {
    const para = paras[p]!;
    if (p > 0 && y > 0) y += setup.paraSpacing;

    let pe: Preedit | null = null;
    if (preedit && preedit.offset >= para.start) {
      const end = p + 1 < paras.length ? paras[p + 1]!.start - 1 : Infinity;
      if (preedit.offset <= end) pe = { at: preedit.offset - para.start, text: preedit.text };
    }

    const old = reusable?.get(para.id);
    const sameText = !!old && old.text === para.text && !old.layout.preedit && !pe;

    if (sameText && old.pageBefore === page && old.yBefore === y) {
      // 그대로 재사용
      old.start = para.start;
      placed[p] = old;
      byId.set(para.id, old);
      page = old.pageAfter;
      y = old.yAfter;
      counts.reused++;
      continue;
    }

    let layout: ParaLayout;
    if (sameText) {
      layout = old.layout;
      counts.repositioned++;
    } else {
      layout = cache.get(para.text, contentWidth, measurer, pe);
      counts.reflowed++;
    }

    const pageBefore = page;
    const yBefore = y;
    const lines: PlacedLine[] = new Array(layout.lines.length);
    for (let index = 0; index < layout.lines.length; index++) {
      const ln = layout.lines[index]!;
      if (y + setup.lineHeight > contentHeight && y > 0) {
        page++;
        y = 0;
      }
      lines[index] = {
        index,
        start: ln.start,
        end: ln.end,
        page,
        x: setup.margin,
        y: pageTop(setup, page) + setup.margin + y,
        height: setup.lineHeight,
      };
      y += setup.lineHeight;
    }

    const pp: PlacedPara = {
      id: para.id,
      start: para.start,
      length: sameText ? old.length : Array.from(para.text).length,
      text: para.text,
      layout,
      lines,
      pageBefore,
      yBefore,
      pageAfter: page,
      yAfter: y,
    };
    placed[p] = pp;
    byId.set(para.id, pp);
  }

  const pageCount = page + 1;
  return { setup, paras: placed, byId, pageCount, totalHeight: pageTop(setup, pageCount), counts };
}

// ── 표시 인덱스 ↔ 문서 오프셋 ──────────────────────────────

export function displayToDoc(para: PlacedPara, d: number): number {
  const pre = para.layout.preedit;
  if (!pre) return para.start + d;
  if (d <= pre[0]) return para.start + d;
  if (d >= pre[1]) return para.start + d - (pre[1] - pre[0]);
  return para.start + pre[0];
}

export function docToDisplay(para: PlacedPara, offset: number): number {
  const d = offset - para.start;
  const pre = para.layout.preedit;
  if (pre && d >= pre[0]) return d + (pre[1] - pre[0]); // 캐럿은 조합 문자열 뒤
  return d;
}

// ── 줄 탐색 ────────────────────────────────────────────────

/** 오프셋이 속한 문단 번호 (문단 끝 ¶ 위치 포함) */
export function paraIndexAt(layout: DocLayout, offset: number): number {
  const ps = layout.paras;
  let lo = 0;
  let hi = ps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ps[mid]!.start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 오프셋의 캐럿이 놓이는 줄 */
export function lineAt(layout: DocLayout, offset: number): LineRef {
  const p = paraIndexAt(layout, offset);
  const para = layout.paras[p]!;
  const d = docToDisplay(para, offset);
  for (let k = 0; k < para.lines.length; k++) {
    if (d < para.lines[k]!.end || k === para.lines.length - 1) return { para: p, line: k };
  }
  return { para: p, line: 0 };
}

/** 다음/이전 줄 (문단 경계를 넘음). 범위를 벗어나면 null */
export function stepLine(layout: DocLayout, ref: LineRef, dir: number): LineRef | null {
  let { para, line } = ref;
  let n = Math.abs(dir);
  const s = Math.sign(dir);
  while (n-- > 0) {
    line += s;
    if (line < 0) {
      para--;
      if (para < 0) return null;
      line = layout.paras[para]!.lines.length - 1;
    } else if (line >= layout.paras[para]!.lines.length) {
      para++;
      if (para >= layout.paras.length) return null;
      line = 0;
    }
  }
  return { para, line };
}

export function getLine(layout: DocLayout, ref: LineRef): PlacedLine {
  return layout.paras[ref.para]!.lines[ref.line]!;
}

/** 문서 y에서 아래쪽 끝이 y보다 큰 첫 줄 (화면 그리기 시작점) */
export function firstLineBelow(layout: DocLayout, y: number): LineRef {
  const ps = layout.paras;
  let lo = 0;
  let hi = ps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const last = ps[mid]!.lines[ps[mid]!.lines.length - 1]!;
    if (last.y + last.height <= y) lo = mid + 1;
    else hi = mid;
  }
  const lines = ps[lo]!.lines;
  let k = 0;
  while (k < lines.length - 1 && lines[k]!.y + lines[k]!.height <= y) k++;
  return { para: lo, line: k };
}

export interface CaretRect {
  page: number;
  x: number;
  y: number;
  height: number;
  ref: LineRef;
}

export function caretRect(layout: DocLayout, offset: number): CaretRect {
  const ref = lineAt(layout, offset);
  const para = layout.paras[ref.para]!;
  const ln = para.lines[ref.line]!;
  const d = Math.min(docToDisplay(para, offset), ln.end);
  const xs = para.layout.xs;
  return { page: ln.page, x: ln.x + xs[d]! - xs[ln.start]!, y: ln.y, height: ln.height, ref };
}

/** 줄 안에서 x에 가장 가까운 캐럿 오프셋 */
export function offsetInLine(layout: DocLayout, ref: LineRef, x: number): number {
  const para = layout.paras[ref.para]!;
  const ln = para.lines[ref.line]!;
  const { xs, stops } = para.layout;
  const isLastLine = ref.line === para.lines.length - 1;
  // 줄바꿈된 줄의 끝(=다음 줄 시작)에는 캐럿을 두지 않는다
  const maxD = isLastLine ? ln.end : ln.end - 1;
  const local = x - ln.x + xs[ln.start]!;
  let best = ln.start;
  let bestDist = Infinity;
  for (let d = ln.start; d <= Math.max(ln.start, maxD); d++) {
    if (!stops[d]) continue;
    const dist = Math.abs(xs[d]! - local);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return displayToDoc(para, best);
}

/** 문서 좌표 (쪽 왼쪽 기준 x, 문서 y) → 캐럿 오프셋 */
export function hitTest(layout: DocLayout, x: number, y: number): number {
  // y를 포함하거나 y 아래에 있는 첫 줄과 그 앞 줄 중 가까운 쪽
  let ref = firstLineBelow(layout, y);
  const cur = getLine(layout, ref);
  if (y < cur.y) {
    const prevRef = stepLine(layout, ref, -1);
    if (prevRef) {
      const prev = getLine(layout, prevRef);
      if (y - (prev.y + prev.height) < cur.y - y) ref = prevRef;
    }
  }
  return offsetInLine(layout, ref, x);
}

/** 이전·다음 grapheme 경계 (문단 경계를 넘으면 ¶ 한 칸) */
export function prevStop(layout: DocLayout, offset: number): number {
  const para = layout.paras[paraIndexAt(layout, offset)]!;
  const d = offset - para.start;
  if (d <= 0) return Math.max(0, offset - 1);
  const stops = para.layout.preedit ? null : para.layout.stops;
  let k = d - 1;
  while (stops && k > 0 && !stops[k]) k--;
  return para.start + k;
}

export function nextStop(layout: DocLayout, offset: number): number {
  const para = layout.paras[paraIndexAt(layout, offset)]!;
  const d = offset - para.start;
  if (d >= para.length) return offset + 1;
  const stops = para.layout.preedit ? null : para.layout.stops;
  let k = d + 1;
  while (stops && k < para.length && !stops[k]) k++;
  return para.start + k;
}
