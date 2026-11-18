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
import { layoutParagraph, type Measurer, type ParaFormat, type ParaLayout, type Preedit, type RunStyle } from './paragraph';

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
}

interface Geometry {
  setup: PageSetup;
  contentHeight: number;
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
    const { setup, contentHeight } = this.geo;
    if (!first && y > 0) y += setup.paraSpacing;
    const src = this.layout.lines;
    for (let k = 0; k < src.length; k++) {
      const lh = lineHeight(setup, src[k]!.scale);
      if (y + lh > contentHeight && y > 0) {
        page++;
        y = 0;
      }
      y += lh;
    }
    this.pageAfter = page;
    this.yAfter = y;
  }

  /** 문서 기준 마지막 줄 아래쪽 y */
  get bottom(): number {
    const { setup } = this.geo;
    return pageTop(setup, this.pageAfter) + setup.margin + this.yAfter;
  }

  get lines(): PlacedLine[] {
    if (this._lines) return this._lines;
    const { setup, contentHeight } = this.geo;
    let page = this.pageBefore;
    let y = this.yBefore;
    if (!this.first && y > 0) y += setup.paraSpacing;
    const src = this.layout.lines;
    const lines: PlacedLine[] = new Array(src.length);
    for (let k = 0; k < src.length; k++) {
      const ln = src[k]!;
      const lh = lineHeight(setup, ln.scale);
      if (y + lh > contentHeight && y > 0) {
        page++;
        y = 0;
      }
      const top = pageTop(setup, page) + setup.margin + y;
      lines[k] = {
        index: k,
        start: ln.start,
        end: ln.end,
        page,
        x: setup.margin,
        y: top,
        height: lh,
        baseline: top + baselineOffset(setup, lh, ln.scale),
      };
      y += lh;
    }
    this._lines = lines;
    return lines;
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
export function lineHeight(setup: PageSetup, scale: number): number {
  return scale === 1 ? setup.lineHeight : Math.round(setup.lineHeight * scale);
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
  return setup.gap + page * (setup.height + setup.gap);
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
  return `${out}¶${f.mark}`;
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
    /** 서식 번호 → 레이아웃 영향 (없으면 서식을 무시) */
    private readonly style: ((id: number) => RunStyle) | null = null,
  ) {
    this.contentWidth = setup.width - setup.margin * 2;
    this.geo = { setup, contentHeight: setup.height - setup.margin * 2 };
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
        const format: ParaFormat | null =
          this.style && (info.fmt || info.mark || pe?.fmt) ? { fmt: info.fmt ?? null, mark: info.mark ?? 0, style: this.style } : null;
        layout = this.cache.get(info.text, this.contentWidth, this.measurer, pe, format);
        this.counts.reflowed++;
      }

      const length =
        pp && pp.info === info
          ? pp.length
          : layout.n - (layout.preedit ? layout.preedit[1] - layout.preedit[0] : 0);
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
