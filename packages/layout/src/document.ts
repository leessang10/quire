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

/** 모델의 문단 객체. 바뀌지 않은 문단은 같은 객체여야 하며, start는 제자리에서 갱신될 수 있다 */
export interface ParaInput {
  readonly id: string;
  readonly start: number;
  readonly text: string;
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
  info: ParaInput;
  /** 원래(조합 전) 문단 길이 (코드포인트) */
  length: number;
  layout: ParaLayout;
  lines: PlacedLine[];
  /** 배치 직전·직후 상태 (문단 간격 적용 전). 수렴 판단에 쓴다 */
  pageBefore: number;
  yBefore: number;
  pageAfter: number;
  yAfter: number;
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
  private preedit: { offset: number; text: string } | null = null;
  private preeditPara = -1;
  private readonly contentWidth: number;
  private readonly contentHeight: number;

  constructor(
    readonly setup: PageSetup,
    private readonly measurer: Measurer,
    private readonly cache: LayoutCache = new LayoutCache(),
  ) {
    this.contentWidth = setup.width - setup.margin * 2;
    this.contentHeight = setup.height - setup.margin * 2;
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
    const lastPage = this.paras[valid - 1]!.pageAfter + 1;
    if (!this.pending) return lastPage;
    return Math.max(lastPage, Math.ceil((lastPage * this.paras.length) / valid));
  }

  get totalHeight(): number {
    return pageTop(this.setup, this.pageCount);
  }

  /**
   * 문서가 바뀐 뒤 호출한다.
   * @param syncUntilY 이 문서 y까지는 즉시 배치한다 (나머지는 step()/질의 시 배치)
   */
  update(
    model: readonly ParaInput[],
    preedit: { offset: number; text: string } | null = null,
    syncUntilY = Infinity,
  ): void {
    this.counts = { reflowed: 0, repositioned: 0, reused: 0 };
    const old = this.paras;
    const oldLen = old.length;
    const newLen = model.length;
    const oldValid = this.validCount;
    const oldPending = this.pending;

    this.model = model;
    this.preedit = preedit;
    const pi = preedit ? findByStart(model, preedit.offset) : -1;
    this.preeditPara = pi;

    const same = (o: PlacedPara | null, n: ParaInput, idx: number) =>
      o !== null && o.info === n && o.layout.preedit === null && idx !== pi;

    // 앞쪽 공통 구간 (정확한 구간 안에서만)
    const lim = Math.min(oldLen, newLen);
    let lo = 0;
    while (lo < lim && lo < oldValid && same(old[lo]!, model[lo]!, lo)) lo++;
    // 뒤쪽 공통 구간
    let s = 0;
    while (s < lim - lo && same(old[oldLen - 1 - s]!, model[newLen - 1 - s]!, newLen - 1 - s)) s++;
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

    // 바뀐 구간을 비우고 lo부터 다시 배치
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

  /** 문서 y까지 배치를 끝낸다 */
  ensureThroughY(y: number): void {
    if (this.pending) this.run((_m, top) => top > y);
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

  /** 아래쪽 끝이 y보다 큰 첫 줄 (화면 그리기·hit-test 시작점) */
  firstLineBelow(y: number): LineRef {
    this.ensureThroughY(y);
    const ps = this.paras;
    let lo = 0;
    let hi = this.validCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const lines = ps[mid]!.lines;
      const last = lines[lines.length - 1]!;
      if (last.y + last.height <= y) lo = mid + 1;
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
    const xs = para.layout.xs;
    return { page: ln.page, x: ln.x + xs[d]! - xs[ln.start]!, y: ln.y, height: ln.height, ref };
  }

  /** 줄 안에서 x에 가장 가까운 캐럿 오프셋 */
  offsetInLine(ref: LineRef, x: number): number {
    const para = this.para(ref.para);
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

  // ── 내부 ──────────────────────────────────────────────

  /** pending에서 시작해 stop이 true가 될 때까지(또는 끝까지) 배치한다 */
  private run(stop: (m: number, nextTopY: number) => boolean): void {
    const { setup, model, paras } = this;
    const len = model.length;
    while (this.pending) {
      let { next: m, page, y } = this.pending;
      if (m >= len) {
        this.pending = null;
        this.staleFrom = Infinity;
        break;
      }
      if (stop(m, pageTop(setup, page) + setup.margin + y)) break;

      const info = model[m]!;
      const pp = paras[m] ?? null;
      let layout: ParaLayout;
      if (pp && pp.info === info && pp.layout.preedit === null && m !== this.preeditPara) {
        if (m < this.staleFrom && pp.pageBefore === page && pp.yBefore === y) {
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
        layout = pp.layout;
        this.counts.repositioned++;
      } else {
        let pe: Preedit | null = null;
        if (m === this.preeditPara && this.preedit) {
          pe = { at: this.preedit.offset - info.start, text: this.preedit.text };
        }
        layout = this.cache.get(info.text, this.contentWidth, this.measurer, pe);
        this.counts.reflowed++;
      }

      const placed = this.place(info, layout, m, page, y, pp && pp.info === info ? pp.length : -1);
      paras[m] = placed;
      page = placed.pageAfter;
      y = placed.yAfter;
      this.pending = { next: m + 1, page, y };
    }
  }

  private place(
    info: ParaInput,
    layout: ParaLayout,
    index: number,
    page: number,
    y: number,
    knownLength: number,
  ): PlacedPara {
    const { setup, contentHeight } = this;
    const pageBefore = page;
    const yBefore = y;
    if (index > 0 && y > 0) y += setup.paraSpacing;
    const src = layout.lines;
    const lines: PlacedLine[] = new Array(src.length);
    for (let k = 0; k < src.length; k++) {
      const ln = src[k]!;
      if (y + setup.lineHeight > contentHeight && y > 0) {
        page++;
        y = 0;
      }
      lines[k] = {
        index: k,
        start: ln.start,
        end: ln.end,
        page,
        x: setup.margin,
        y: pageTop(setup, page) + setup.margin + y,
        height: setup.lineHeight,
      };
      y += setup.lineHeight;
    }
    const length = knownLength >= 0 ? knownLength : layout.n - (layout.preedit ? layout.preedit[1] - layout.preedit[0] : 0);
    return { info, length, layout, lines, pageBefore, yBefore, pageAfter: page, yAfter: y };
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
