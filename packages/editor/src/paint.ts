/**
 * 그리기 대상 (15 §5.1): 쪽 그리기기(PagePainter)가 그리는 곳. Canvas 2D의 부분집합이라 화면은 캔버스에 그대로,
 * PDF(5-4)는 글꼴 조각과 글리프로, 시험은 명령 기록과 지문으로 받는다. DOM에 의존하지 않는다 (CanvasTarget만 캔버스를 쓴다).
 */

/** 글자 그리기의 글꼴: CSS font(화면), 글꼴 슬롯(셰이핑 글꼴 번호, -1이면 시스템 글꼴), 크기(px), 굵게 */
export interface FontRef {
  readonly css: string;
  readonly slot: number;
  readonly size: number;
  readonly bold: boolean;
}

/** 글자 조각: 같은 글꼴·서식, 한 번에 그린다 */
export interface TextRun {
  readonly text: string;
  readonly font: FontRef;
  /** 기울임 (x 기울기, 기준선 기준) */
  readonly skew?: number;
  /** 이 폭을 넘으면 줄여 그린다 (자리표시 글) */
  readonly maxWidth?: number;
  /** 커닝 (셰이핑한 글꼴이면 켠다: 레이아웃이 HarfBuzz로 잰 폭과 같게) */
  readonly kern: boolean;
  /** 코드포인트마다 레이아웃 x (조각 시작 기준). 대상이 wantsPositions일 때만 채운다 */
  readonly positions?: readonly number[];
}

export interface PaintTarget {
  /**
   * 글자열을 한 번에 그려도 레이아웃 위치와 같은가 (커닝을 끌 수 있다). false면 그리기기가 글자(그래핌)마다 나눠 그린다
   */
  readonly exactRuns: boolean;
  /** 글자 조각에 코드포인트별 레이아웃 위치를 받을까 (PDF: 글리프를 레이아웃 자리에 놓는다) */
  readonly wantsPositions?: boolean;
  save(): void;
  restore(): void;
  /** 투명도를 곱한다 (restore까지) */
  alpha(a: number): void;
  clip(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number, color: string): void;
  strokeRect(x: number, y: number, w: number, h: number, color: string, width: number): void;
  /** 기준선 (x, y)에 글자 조각 */
  text(run: TextRun, x: number, y: number, color: string): void;
  /** 글자 조각의 폭 (목록 기호처럼 레이아웃이 위치를 두지 않은 글자) */
  measure(text: string, font: FontRef): number;
  /** 자산 이미지 (준비된 것만 부른다: ImageSource.state가 'ready') */
  image(asset: string, x: number, y: number, w: number, h: number): void;
  /** 링크 영역 (PDF 링크 주석). 화면은 없다 */
  link?(x: number, y: number, w: number, h: number, href: string): void;
}

/** 이미지 준비 상태: 화면은 비동기로 디코드하고, PDF는 미리 모은다 */
export interface ImageSource {
  state(asset: string): 'ready' | 'loading' | 'error';
}

/** 화면: 캔버스 2D에 그린다. 글꼴·커닝·기준선은 바뀔 때만 설정한다 (restore하면 다시 설정) */
export class CanvasTarget implements PaintTarget {
  readonly exactRuns: boolean;
  private font = '';
  private kern: boolean | null = null;

  constructor(
    readonly ctx: CanvasRenderingContext2D,
    private readonly bitmap: (asset: string) => CanvasImageSource | null,
  ) {
    this.exactRuns = 'fontKerning' in ctx;
  }

  /** 그리기를 시작할 때 (편집기가 캔버스 상태를 바꿨을 수 있다) */
  begin(): void {
    this.font = '';
    this.kern = null;
  }

  save(): void {
    this.ctx.save();
  }

  restore(): void {
    this.ctx.restore();
    this.font = '';
    this.kern = null;
  }

  alpha(a: number): void {
    this.ctx.globalAlpha *= a;
  }

  clip(x: number, y: number, w: number, h: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  strokeRect(x: number, y: number, w: number, h: number, color: string, width: number): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(x, y, w, h);
  }

  private applyFont(css: string): void {
    if (this.font === css) return;
    this.ctx.font = css;
    this.ctx.textBaseline = 'alphabetic';
    this.font = css;
  }

  private setFont(run: TextRun): void {
    const { ctx } = this;
    this.applyFont(run.font.css);
    if (this.exactRuns && this.kern !== run.kern) {
      ctx.fontKerning = run.kern ? 'normal' : 'none';
      this.kern = run.kern;
    }
  }

  text(run: TextRun, x: number, y: number, color: string): void {
    const { ctx } = this;
    this.setFont(run);
    ctx.fillStyle = color;
    if (run.skew) {
      ctx.save();
      ctx.translate(x, y);
      ctx.transform(1, 0, -run.skew, 1, 0, 0);
      ctx.fillText(run.text, 0, 0);
      ctx.restore();
    } else if (run.maxWidth !== undefined) ctx.fillText(run.text, x, y, run.maxWidth);
    else ctx.fillText(run.text, x, y);
  }

  measure(text: string, font: FontRef): number {
    this.applyFont(font.css);
    return this.ctx.measureText(text).width;
  }

  image(asset: string, x: number, y: number, w: number, h: number): void {
    const img = this.bitmap(asset);
    if (img) this.ctx.drawImage(img, x, y, w, h);
  }
}

/** 기록한 그리기 명령 하나 */
export type PaintCommand = readonly [op: string, ...args: Array<string | number | boolean>];

/**
 * 시험용: 그리기 명령을 모은다. 좌표는 1/100로 반올림해 기록한다 (부동소수점 순서 차이를 지문에서 뺀다).
 * 글자 폭은 주어진 함수로 잰다 (기본: 코드포인트마다 글자 크기의 절반)
 */
export class RecordingTarget implements PaintTarget {
  readonly exactRuns = true;
  readonly commands: PaintCommand[] = [];

  constructor(private readonly widthOf: (text: string, font: FontRef) => number = (t, f) => Array.from(t).length * f.size * 0.5) {}

  private r(v: number): number {
    return Math.round(v * 100) / 100;
  }

  save(): void {
    this.commands.push(['save']);
  }
  restore(): void {
    this.commands.push(['restore']);
  }
  alpha(a: number): void {
    this.commands.push(['alpha', a]);
  }
  clip(x: number, y: number, w: number, h: number): void {
    this.commands.push(['clip', this.r(x), this.r(y), this.r(w), this.r(h)]);
  }
  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.commands.push(['fillRect', this.r(x), this.r(y), this.r(w), this.r(h), color]);
  }
  strokeRect(x: number, y: number, w: number, h: number, color: string, width: number): void {
    this.commands.push(['strokeRect', this.r(x), this.r(y), this.r(w), this.r(h), color, width]);
  }
  text(run: TextRun, x: number, y: number, color: string): void {
    this.commands.push(['text', run.text, run.font.slot, this.r(run.font.size), run.font.bold, run.skew ?? 0, run.kern, this.r(x), this.r(y), color]);
  }
  measure(text: string, font: FontRef): number {
    return this.widthOf(text, font);
  }
  image(asset: string, x: number, y: number, w: number, h: number): void {
    this.commands.push(['image', asset, this.r(x), this.r(y), this.r(w), this.r(h)]);
  }

  /** 명령 열의 지문 (FNV-1a 64비트, 16진수) */
  fingerprint(): string {
    let h = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    for (const c of this.commands) {
      const s = JSON.stringify(c);
      for (let i = 0; i < s.length; i++) {
        h ^= BigInt(s.charCodeAt(i));
        h = (h * prime) & mask;
      }
      h ^= 10n;
      h = (h * prime) & mask;
    }
    return h.toString(16).padStart(16, '0');
  }

  /** 그린 글자 (시험에서 읽기 쉽게) */
  texts(): string[] {
    return this.commands.filter((c) => c[0] === 'text').map((c) => c[1] as string);
  }
}
