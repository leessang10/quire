/**
 * PDF 쪽 그리기 대상 (15 §5.2): 쪽 그리기기의 명령을 PDF 내용 스트림 연산자로 바꾼다. 좌표는 px(96dpi) → pt(72dpi),
 * y축을 뒤집는다. 글자는 글꼴 얼굴로 셰이핑해 글리프를 레이아웃 자리(코드포인트별 위치)에 TJ로 놓는다.
 * 글리프 → CID는 글꼴을 부분화한 뒤에 정해지므로, 글자 부분은 구조로 두었다가 serialize에서 쓴다.
 */
import type { FontRef, PaintTarget, TextRun } from '@quiredoc/editor';
import { safeLink } from '@quiredoc/model';
import { shapeText, type PdfFace, type PdfFonts } from './fonts';
import { num } from './writer';

export const PT = 0.75;

/** CSS 색 → [r, g, b, a] (0–1). 모르는 색은 검정 */
export function parseColor(c: string): [number, number, number, number] {
  const s = c.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s.startsWith('#')) {
    const h = s.slice(1);
    const full = h.length === 3 || h.length === 4 ? Array.from(h, (x) => x + x).join('') : h;
    const v = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
    if (full.length === 6 || full.length === 8) return [v(0), v(2), v(4), full.length === 8 ? v(6) : 1];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1]!.split(/[\s,/]+/).filter(Boolean);
    const ch = (x: string | undefined) => (x === undefined ? 0 : x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x) / 255);
    const a = p[3] === undefined ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    return [ch(p[0]), ch(p[1]), ch(p[2]), a];
  }
  const named: Record<string, string> = { black: '#000', white: '#fff', red: '#f00', green: '#008000', blue: '#00f', gray: '#808080', grey: '#808080', yellow: '#ff0' };
  return named[s] ? parseColor(named[s]) : [0, 0, 0, 1];
}

/** 글자 부분: 글리프는 CID로 바꿔 쓴다 */
interface TextPart {
  face: PdfFace;
  /** BT 다음, TJ 앞 (글꼴·행렬) */
  head: string;
  glyphs: number[];
  /** 글리프 앞 조정 (TJ 수, 0이면 없음) */
  adj: number[];
}

export interface PdfLink {
  rect: [number, number, number, number];
  href: string;
}

/** 문서 전체가 함께 쓰는 자원: 투명도 상태 (ca 값 → 이름) */
export class PdfResources {
  readonly alphas = new Map<number, string>();
  /** 자산 → 이미지 자원 이름 */
  readonly images = new Map<string, string>();

  gs(a: number): string {
    const k = Math.round(a * 1000) / 1000;
    let n = this.alphas.get(k);
    if (!n) {
      n = `GS${this.alphas.size + 1}`;
      this.alphas.set(k, n);
    }
    return n;
  }
}

export class PdfPage implements PaintTarget {
  readonly exactRuns = true;
  readonly wantsPositions = true;
  readonly links: PdfLink[] = [];
  /** 그리지 못한 글자 (얼굴이 없음) */
  missing = 0;
  private readonly parts: Array<string | TextPart> = [];
  private alphaNow = 1;
  private readonly stack: number[] = [];

  constructor(
    /** 쪽 크기 (pt) */
    readonly width: number,
    readonly height: number,
    private readonly fonts: PdfFonts,
    private readonly res: PdfResources,
  ) {}

  private op(s: string): void {
    this.parts.push(s);
  }

  private y(v: number): number {
    return this.height - v * PT;
  }

  save(): void {
    this.stack.push(this.alphaNow);
    this.op('q\n');
  }

  restore(): void {
    this.alphaNow = this.stack.pop() ?? 1;
    this.op('Q\n');
  }

  alpha(a: number): void {
    this.alphaNow *= a;
    this.op(`/${this.res.gs(this.alphaNow)} gs\n`);
  }

  clip(x: number, y: number, w: number, h: number): void {
    this.op(`${num(x * PT)} ${num(this.y(y + h))} ${num(w * PT)} ${num(h * PT)} re W n\n`);
  }

  /** 색을 채우기(rg)·선(RG)으로. 색의 알파가 있으면 상태를 바꾸고 true (호출한 쪽이 q…Q로 감싼다) */
  private color(c: string, stroke: boolean): { ops: string; alpha: boolean } {
    const [r, g, b, a] = parseColor(c);
    let ops = `${num(r)} ${num(g)} ${num(b)} ${stroke ? 'RG' : 'rg'}\n`;
    if (a < 1) ops = `/${this.res.gs(this.alphaNow * a)} gs\n${ops}`;
    return { ops, alpha: a < 1 };
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    const c = this.color(color, false);
    const r = `${num(x * PT)} ${num(this.y(y + h))} ${num(w * PT)} ${num(h * PT)} re f\n`;
    this.op(c.alpha ? `q\n${c.ops}${r}Q\n` : c.ops + r);
  }

  strokeRect(x: number, y: number, w: number, h: number, color: string, width: number): void {
    const c = this.color(color, true);
    this.op(`q\n${c.ops}${num(width * PT)} w\n${num(x * PT)} ${num(this.y(y + h))} ${num(w * PT)} ${num(h * PT)} re S\nQ\n`);
  }

  text(run: TextRun, x: number, y: number, color: string): void {
    const first = run.text.codePointAt(0) ?? 0x20;
    const pick = this.fonts.pick(run.font.slot, run.font.bold, first);
    if (!pick) {
      this.missing += Array.from(run.text).length;
      return;
    }
    const { face, synthetic } = pick;
    const glyphs = shapeText(face, run.text);
    if (!glyphs.length) return;
    const sizePx = run.font.size;
    // 1/1000 em 단위: 글꼴 단위 → u, px → u
    const fu = 1000 / face.upem;
    const pu = 1000 / sizePx;
    // UTF-16 위치 → 코드포인트 번호
    const cpAt = new Int32Array(run.text.length + 1);
    for (let u = 0, cp = 0; u < run.text.length; cp++) {
      const c = run.text.charCodeAt(u);
      const n = c >= 0xd800 && c <= 0xdbff && u + 1 < run.text.length ? 2 : 1;
      for (let k = 0; k < n; k++) cpAt[u + k] = cp;
      u += n;
    }
    // 글리프마다 바라는 x (u): 위치가 있으면 클러스터 첫 코드포인트의 레이아웃 x + 클러스터 안 앞 글리프 진행폭
    const want: number[] = [];
    let pen = 0;
    let clusterStart = -1;
    let inCluster = 0;
    for (const g of glyphs) {
      if (run.positions) {
        if (g.cl !== clusterStart) {
          clusterStart = g.cl;
          inCluster = 0;
        }
        const base = (run.positions[cpAt[g.cl]!] ?? 0) * pu;
        want.push(base + (inCluster + g.dx) * fu);
        inCluster += g.ax;
      } else {
        want.push(pen + g.dx * fu);
        pen += g.ax * fu;
      }
    }
    // 바라는 x와 PDF 진행폭(W)의 차이를 TJ 조정으로
    const ids: number[] = [];
    const adj: number[] = [];
    let at = 0;
    let natural = 0;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i]!;
      const d = at - want[i]!;
      adj.push(Math.abs(d) < 0.05 ? 0 : Math.round(d * 100) / 100);
      ids.push(g.g);
      const wd = face.width(g.g);
      at = want[i]! + wd;
      natural = Math.max(natural, at);
      // 글자 (ToUnicode): 클러스터의 글자를 첫 글리프에
      if (!face.used.get(g.g)) {
        const firstOfCluster = i === 0 || glyphs[i - 1]!.cl !== g.cl;
        const t = firstOfCluster ? run.text.slice(g.cl, cluster(run.text, g.cl, glyphs)) : '';
        if (t || !face.used.has(g.g)) face.used.set(g.g, t);
      }
    }
    const sizePt = sizePx * PT;
    // 줄여 그리기 (자리표시 글): 가로 배율
    const widthPx = (natural / 1000) * sizePx;
    const sx = run.maxWidth !== undefined && widthPx > run.maxWidth && widthPx > 0 ? Math.max(0, run.maxWidth) / widthPx : 1;
    const c = this.color(color, false);
    let head = `/${face.res} ${num(sizePt)} Tf\n`;
    if (synthetic) head += `2 Tr ${num(sizePt * 0.03)} w\n${c.ops.replace(/rg\n$/, 'RG\n')}`;
    head += `${num(sx)} 0 ${num(run.skew ?? 0)} 1 ${num(x * PT)} ${num(this.y(y))} Tm\n`;
    if (c.alpha) this.op('q\n');
    this.op(c.ops);
    this.parts.push({ face, head, glyphs: ids, adj });
    if (c.alpha) this.op('Q\n');
  }

  measure(text: string, font: FontRef): number {
    const pick = this.fonts.pick(font.slot, font.bold, text.codePointAt(0) ?? 0x20);
    if (!pick) return Array.from(text).length * font.size * 0.5;
    let sum = 0;
    for (const g of shapeText(pick.face, text)) sum += g.ax;
    return (sum / pick.face.upem) * font.size;
  }

  image(asset: string, x: number, y: number, w: number, h: number): void {
    const n = this.res.images.get(asset);
    if (!n) return;
    this.op(`q\n${num(w * PT)} 0 0 ${num(h * PT)} ${num(x * PT)} ${num(this.y(y + h))} cm\n/${n} Do\nQ\n`);
  }

  link(x: number, y: number, w: number, h: number, href: string): void {
    // 위험한 스킴(javascript: 등)은 링크 주석을 만들지 않는다 (16 §6)
    const safe = safeLink(href);
    if (safe === null) return;
    this.links.push({ rect: [x * PT, this.y(y + h), (x + w) * PT, this.y(y)], href: safe });
  }

  /** 내용 스트림 (글꼴을 쓴 뒤: 글리프 → CID) */
  serialize(): string {
    let s = '';
    for (const p of this.parts) {
      if (typeof p === 'string') {
        s += p;
        continue;
      }
      let tj = '';
      let run = '';
      for (let i = 0; i < p.glyphs.length; i++) {
        if (p.adj[i]) {
          if (run) tj += `<${run}>`;
          run = '';
          tj += num(p.adj[i]!);
        }
        run += p.face.cid(p.glyphs[i]!).toString(16).toUpperCase().padStart(4, '0');
      }
      if (run) tj += `<${run}>`;
      s += `BT\n${p.head}[${tj}] TJ\nET\n`;
    }
    return s;
  }
}

/** 클러스터 cl이 끝나는 UTF-16 위치 (다음 클러스터의 시작; RTL처럼 순서가 거꾸로면 그 다음 큰 값) */
function cluster(text: string, cl: number, glyphs: readonly { cl: number }[]): number {
  let end = text.length;
  for (const g of glyphs) if (g.cl > cl && g.cl < end) end = g.cl;
  return end;
}
