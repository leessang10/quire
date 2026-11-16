/**
 * 쪽 조립과 위치 질의 (02 §6, 03 §5)
 *
 * 0단계 단순화
 * - 구역 1개, 고정 용지, 머리말·각주·다단 없음
 * - 증분: 문단 레이아웃은 (텍스트, 폭, 조합 문자열) 키로 캐시. 쪽 조립은 매번 전체 (O(줄 수))
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

export interface PlacedPara {
  id: string;
  start: number;
  /** 원래(조합 전) 문단 길이 */
  length: number;
  layout: ParaLayout;
  firstLine: number;
  lineCount: number;
}

export interface PlacedLine {
  para: number;
  /** 문단 내 줄 번호 */
  index: number;
  start: number;
  end: number;
  page: number;
  /** 쪽 왼쪽 기준 x (본문 시작) */
  x: number;
  /** 문서 전체 기준 y (줄 위쪽) */
  y: number;
  height: number;
}

export interface DocLayout {
  setup: PageSetup;
  paras: PlacedPara[];
  lines: PlacedLine[];
  pageCount: number;
  totalHeight: number;
}

export function pageTop(setup: PageSetup, page: number): number {
  return setup.gap + page * (setup.height + setup.gap);
}

export class LayoutCache {
  private map = new Map<string, ParaLayout>();
  hits = 0;
  misses = 0;

  get(text: string, width: number, measurer: Measurer, preedit: Preedit | null): ParaLayout {
    const key = preedit ? `${width}|${preedit.at}|${preedit.text}|${text}` : `${width}||${text}`;
    let hit = this.map.get(key);
    if (hit) {
      this.hits++;
      return hit;
    }
    this.misses++;
    hit = layoutParagraph(text, width, measurer, preedit);
    // 조합 중 레이아웃은 일회성이므로 캐시하지 않는다
    if (!preedit) this.map.set(key, hit);
    return hit;
  }

  clear(): void {
    this.map.clear();
  }
}

export function layoutDocument(
  paras: ParaInput[],
  setup: PageSetup,
  measurer: Measurer,
  cache: LayoutCache,
  preedit: { offset: number; text: string } | null = null,
): DocLayout {
  const contentWidth = setup.width - setup.margin * 2;
  const contentHeight = setup.height - setup.margin * 2;
  const placed: PlacedPara[] = [];
  const lines: PlacedLine[] = [];
  let page = 0;
  let y = 0; // 쪽 본문 기준

  for (let p = 0; p < paras.length; p++) {
    const para = paras[p]!;
    const len = Array.from(para.text).length;
    let pe: Preedit | null = null;
    if (preedit && preedit.offset >= para.start && preedit.offset <= para.start + len) {
      pe = { at: preedit.offset - para.start, text: preedit.text };
    }
    const layout = cache.get(para.text, contentWidth, measurer, pe);
    const firstLine = lines.length;

    if (p > 0 && y > 0) y += setup.paraSpacing;
    layout.lines.forEach((ln, index) => {
      if (y + setup.lineHeight > contentHeight && y > 0) {
        page++;
        y = 0;
      }
      lines.push({
        para: p,
        index,
        start: ln.start,
        end: ln.end,
        page,
        x: setup.margin,
        y: pageTop(setup, page) + setup.margin + y,
        height: setup.lineHeight,
      });
      y += setup.lineHeight;
    });

    placed.push({ id: para.id, start: para.start, length: len, layout, firstLine, lineCount: layout.lines.length });
  }

  const pageCount = page + 1;
  return { setup, paras: placed, lines, pageCount, totalHeight: pageTop(setup, pageCount) };
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

/** 오프셋의 캐럿이 놓이는 줄 번호 (전체 줄 기준) */
export function lineIndexAt(layout: DocLayout, offset: number): number {
  const p = paraIndexAt(layout, offset);
  const para = layout.paras[p]!;
  const d = docToDisplay(para, offset);
  for (let k = 0; k < para.lineCount; k++) {
    const ln = layout.lines[para.firstLine + k]!;
    if (d < ln.end || k === para.lineCount - 1) return para.firstLine + k;
  }
  return para.firstLine;
}

export interface CaretRect {
  page: number;
  x: number;
  y: number;
  height: number;
  line: number;
}

export function caretRect(layout: DocLayout, offset: number): CaretRect {
  const li = lineIndexAt(layout, offset);
  const ln = layout.lines[li]!;
  const para = layout.paras[ln.para]!;
  const d = Math.min(docToDisplay(para, offset), ln.end);
  const xs = para.layout.xs;
  return { page: ln.page, x: ln.x + xs[d]! - xs[ln.start]!, y: ln.y, height: ln.height, line: li };
}

/** 줄 안에서 x에 가장 가까운 캐럿 오프셋 */
export function offsetInLine(layout: DocLayout, lineIndex: number, x: number): number {
  const ln = layout.lines[lineIndex]!;
  const para = layout.paras[ln.para]!;
  const { xs, stops } = para.layout;
  const isLastLine = ln.index === para.lineCount - 1;
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
  const lines = layout.lines;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid]!.y <= y) lo = mid;
    else hi = mid - 1;
  }
  let li = lo;
  const cur = lines[li]!;
  const next = lines[li + 1];
  if (next && y > cur.y + cur.height && next.y - y < y - (cur.y + cur.height)) li++;
  return offsetInLine(layout, li, x);
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
