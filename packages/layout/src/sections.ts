/**
 * 구역 프레임 열 (12 §2, §3.3): 구역마다 용지·여백이 다르고 구역 나눔으로 새 쪽(또는 같은 쪽)에서 시작한다.
 *
 * 구역 하나는 런 하나다: 첫 프레임 k0, 그 프레임의 쪽 p0, 이 구역이 쪽 모양을 정하는 첫 쪽 own과 그 위쪽 y.
 * 프레임 k(런 r 안) = 쪽 r.p0 + (k − r.k0). 쪽의 모양(용지·위아래 여백)은 그 쪽을 가진 구역, 줄 폭(좌우 여백)은 프레임의 구역.
 *
 * - nextPage: 앞 프레임 다음 쪽. evenPage·oddPage: 쪽 번호(1부터)가 짝·홀이 되게 빈 쪽을 하나 둘 수 있다 (빈 쪽은 새 구역의 쪽,
 *   프레임 없음).
 * - continuous: 용지가 같으면 같은 쪽 같은 y에서 이어서 (프레임은 새로, 위아래는 그 쪽 주인 구역). 용지가 다르면 nextPage.
 *
 * 증분 (02 §7): 레이아웃이 구역 첫 문단을 놓기 전에 enter()로 런을 다시 정한다. 런이 옛 런과 같으면 뒤 런들도 옛 결과와 맞으므로
 * 수렴할 수 있다(stable). 다르면 다음 구역의 런이 다시 같아질 때까지 뒤 런은 찾기에 쓰지 않고(옛 값은 비교에만), 수렴하지 않는다.
 */
import type { Frame, FrameSource, PageBox, PageSetup } from './document';

/** 구역 하나의 쪽 모양 (px). key가 같으면 모양이 같다 */
export interface SectionGeom {
  key: string;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  start: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage';
}

/** 문단 → 구역 */
export interface SectionSource {
  /** 문단 m이 든 구역의 차례(0부터)와 쪽 모양 */
  sectionOf(m: number): { index: number; geom: SectionGeom };
  /** 구역 수 */
  count(): number;
}

interface Run {
  index: number;
  geom: SectionGeom;
  /** 첫 프레임 */
  k0: number;
  /** 첫 프레임의 쪽 */
  p0: number;
  /** 이 구역이 쪽 모양을 정하는 첫 쪽 (continuous면 p0 + 1, 빈 쪽이 있으면 p0 − 1) */
  own: number;
  /** 쪽 own의 위쪽 (문서 y) */
  ownTop: number;
  /** 첫 쪽을 앞 구역과 나눠 쓰면(continuous) 그 쪽 주인의 모양 키: 첫 쪽 위아래 여백이 거기서 온다 */
  shared: string;
  frames: Frame[];
}

/** 구역 모양 (px) → 키 */
export function geomKey(g: Omit<SectionGeom, 'key'>): string {
  return `${g.width}x${g.height}|${g.top},${g.right},${g.bottom},${g.left}|${g.start}`;
}

export class SectionFrames implements FrameSource {
  private runs: Run[] = [];
  /** 이 차례부터의 런은 이번 배치에서 아직 다시 정하지 않았고 앞 런이 바뀌어 믿을 수 없다 (비교에만 쓴다) */
  private dirtyFrom = Infinity;
  /** 지금 배치 중인 문단의 구역: 뒤 구역의 런은 아직 이번 배치에서 정하지 않았으므로 찾기에 쓰지 않는다 (다 배치하면 Infinity) */
  private cur = Infinity;

  constructor(
    private readonly setup: PageSetup,
    private readonly source: SectionSource,
  ) {}

  /** 찾기에 쓸 수 있는 런 수 */
  private get live(): number {
    return Math.min(this.runs.length, this.dirtyFrom, this.cur + 1);
  }

  /** 런이 없을 때 (배치 전): 첫 구역 */
  private first(): Run {
    const r = this.runs[0];
    if (r) return r;
    const g = this.source.sectionOf(0).geom;
    return this.mk(0, g, 0, 0, 0, (this.setup.originY ?? 0) + this.setup.gap);
  }

  private mk(index: number, geom: SectionGeom, k0: number, p0: number, own: number, ownTop: number, shared = ''): Run {
    return { index, geom, k0, p0, own, ownTop, shared, frames: [] };
  }

  /** 프레임 k가 든 런 */
  private runOfFrame(k: number): Run {
    const n = this.live;
    if (n === 0) return this.first();
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.runs[mid]!.k0 <= k) lo = mid;
      else hi = mid - 1;
    }
    return this.runs[lo]!;
  }

  /** 쪽 p의 주인 런 (쪽 모양을 정하는 구역) */
  private ownerOf(p: number): Run {
    const n = this.live;
    if (n === 0) return this.first();
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.runs[mid]!.own <= p) lo = mid;
      else hi = mid - 1;
    }
    return this.runs[lo]!;
  }

  private topOf(p: number): number {
    const r = this.ownerOf(p);
    return r.ownTop + (p - r.own) * (r.geom.height + this.setup.gap);
  }

  private pageX(g: SectionGeom): number {
    // 쪽들을 기본 용지 폭의 가운데 축에 맞춘다
    return (this.setup.originX ?? 0) + (this.setup.width - g.width) / 2;
  }

  frame(k: number): Frame {
    const r = this.runOfFrame(k);
    const i = k - r.k0;
    let f = r.frames[i];
    if (f) return f;
    const page = r.p0 + i;
    const o = this.ownerOf(page).geom;
    const g = r.geom;
    f = {
      page,
      column: 0,
      x: this.pageX(o) + g.left,
      top: this.topOf(page) + o.top,
      width: g.width - g.left - g.right,
      height: o.height - o.top - o.bottom,
    };
    if (i < 1 << 20) r.frames[i] = f;
    return f;
  }

  page(p: number): PageBox {
    const o = this.ownerOf(p).geom;
    return { x: this.pageX(o), top: this.topOf(p), width: o.width, height: o.height };
  }

  pageAt(y: number): number {
    const n = this.live;
    if (n === 0) {
      const r = this.first();
      return Math.max(0, Math.floor((y - r.ownTop) / (r.geom.height + this.setup.gap)));
    }
    // y가 든 런 (ownTop 순)
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.runs[mid]!.ownTop <= y) lo = mid;
      else hi = mid - 1;
    }
    let r = this.runs[lo]!;
    // 같은 쪽에서 시작한 구역(continuous)이 아직 자기 쪽에 닿지 않았으면 앞 런
    while (lo > 0 && r.ownTop > y) r = this.runs[--lo]!;
    return Math.max(0, r.own + Math.floor((y - r.ownTop) / (r.geom.height + this.setup.gap)));
  }

  height(pages: number): number {
    return this.topOf(pages);
  }

  startsSection(m: number): boolean {
    return m > 0 && this.source.sectionOf(m - 1).index !== this.source.sectionOf(m).index;
  }

  widthOf(m: number): number {
    const g = this.source.sectionOf(m).geom;
    return g.width - g.left - g.right;
  }

  stable(): boolean {
    return this.dirtyFrom === Infinity;
  }

  /** 모두 배치했다: 없어진 구역의 런을 버린다 */
  done(): void {
    const n = this.source.count();
    if (this.runs.length > n) this.runs.length = n;
    if (this.dirtyFrom >= this.runs.length) this.dirtyFrom = Infinity;
    this.cur = Infinity;
  }

  /**
   * 문단 m을 놓기 전: m이 구역의 첫 문단이면 그 구역의 런을 정하고 첫 배치 상태를 돌려준다. (frame, y)는 앞 문단이 끝난 상태
   */
  enter(m: number, frame: number, y: number): { frame: number; y: number } | null {
    const s = this.source.sectionOf(m);
    if (m > 0 && this.source.sectionOf(m - 1).index === s.index) {
      this.cur = s.index;
      return null;
    }
    // 앞 구역들만 보고 이 구역의 런을 정한다
    this.cur = s.index - 1;
    const g = s.geom;
    let run: Run;
    let out: { frame: number; y: number };
    if (m === 0) {
      run = this.mk(s.index, g, 0, 0, 0, (this.setup.originY ?? 0) + this.setup.gap);
      out = { frame, y };
    } else {
      const prevPage = this.frame(frame).page;
      const o = this.ownerOf(prevPage).geom;
      const nextTop = this.topOf(prevPage) + o.height + this.setup.gap;
      if (g.start === 'continuous' && o.width === g.width && o.height === g.height) {
        run = this.mk(s.index, g, frame + 1, prevPage, prevPage + 1, nextTop, o.key);
        out = { frame: frame + 1, y };
      } else {
        let p = prevPage + 1;
        if (g.start === 'evenPage' && (p + 1) % 2 !== 0) p++;
        if (g.start === 'oddPage' && (p + 1) % 2 !== 1) p++;
        run = this.mk(s.index, g, frame + 1, p, prevPage + 1, nextTop);
        out = { frame: frame + 1, y: 0 };
      }
    }
    const old = this.runs[s.index];
    const same = !!old && old.geom.key === g.key && old.k0 === run.k0 && old.p0 === run.p0 && old.own === run.own && old.ownTop === run.ownTop && old.shared === run.shared;
    if (same) {
      // 이 구역부터는 옛 런 그대로 (뒤 런도 옛 배치와 맞다)
      this.dirtyFrom = Infinity;
    } else {
      // 구역은 문단 순서대로 들어오므로 앞 구역의 런은 늘 있다 (차례가 어긋나면 끝에 잇는다)
      if (s.index <= this.runs.length) this.runs[s.index] = run;
      else this.runs.push(run);
      this.dirtyFrom = Math.min(s.index, this.runs.length - 1) + 1;
    }
    this.cur = s.index;
    return out;
  }
}
