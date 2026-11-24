/**
 * HarfBuzz(WASM) 셰이핑 도우미 (ADR-0002 검증). Node와 브라우저에서 같은 코드가 돈다.
 *
 * - 결과는 글꼴 단위(정수)다. 화면 px·내부 단위(1/1000pt)로 바꾸는 반올림은 여기서 한 번만 정한다 (02 §2).
 * - harfbuzzjs 객체는 WASM 메모리를 쓰므로 Buffer는 다 쓰면 destroy가 필요한지 확인한다 (v1: FinalizationRegistry).
 */
import * as hb from 'harfbuzzjs';
import type { Measurer } from '@quiredoc/layout';

export interface Glyph {
  /** 글리프 ID */
  g: number;
  /** 클러스터: 원문 UTF-16 위치 */
  cl: number;
  /** 진행폭·오프셋 (글꼴 단위, 정수) */
  ax: number;
  dx: number;
  dy: number;
}

export interface HbFont {
  font: hb.Font;
  face: hb.Face;
  upem: number;
  name: string;
}

export function loadFont(bytes: Uint8Array | ArrayBuffer, name = 'font'): HbFont {
  const face = new hb.Face(new hb.Blob(bytes));
  const font = new hb.Font(face);
  return { font, face, upem: face.upem, name };
}

const buffer = new hb.Buffer();

/** 텍스트 한 런을 셰이핑한다. features 예: ['-kern', '-liga'] */
export function shape(f: HbFont, text: string, features: string[] = []): Glyph[] {
  buffer.reset();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(f.font, buffer, features.length ? features.map((s) => hb.Feature.fromString(s)!) : undefined);
  return buffer.getGlyphInfosAndPositions().map((p) => ({ g: p.codepoint, cl: p.cluster, ax: p.xAdvance ?? 0, dx: p.xOffset ?? 0, dy: p.yOffset ?? 0 }));
}

/** 글꼴 단위 진행폭 합 */
export function advance(glyphs: Glyph[]): number {
  let w = 0;
  for (const g of glyphs) w += g.ax;
  return w;
}

/** 글꼴 단위 → px */
export const toPx = (f: HbFont, units: number, sizePx: number) => (units * sizePx) / f.upem;

/**
 * 글꼴 단위 → 내부 단위(1/1000pt, 정수). 02 §2 R1: 반올림 규칙을 고정해 기기마다 같은 정수가 나오게 한다.
 * size는 1/1000pt. 정수 곱셈·나눗셈만 쓴다 (부동소수점 차이 없음, 2^53 안).
 */
export function toUnit(f: HbFont, units: number, size: number): number {
  const n = units * size;
  const q = Math.trunc(n / f.upem);
  const r = n - q * f.upem;
  // 반올림: 절반은 0에서 먼 쪽
  return 2 * Math.abs(r) >= f.upem ? q + Math.sign(n) : q;
}

/**
 * 지금 레이아웃의 Measurer(grapheme 하나씩 폭)를 HarfBuzz로. grapheme을 따로 셰이핑하므로 커닝·합자는 빠진다
 * (fontKerning = 'none'인 지금 캔버스 측정과 같은 조건).
 */
export class HbMeasurer implements Measurer {
  private cache = new Map<string, number>();
  shaped = 0;

  constructor(
    private readonly f: HbFont,
    private readonly sizePx: number,
    private readonly features: string[] = ['-kern', '-liga', '-clig'],
  ) {}

  width(g: string): number {
    let w = this.cache.get(g);
    if (w === undefined) {
      this.shaped++;
      w = toPx(this.f, advance(shape(this.f, g === '\t' ? '    ' : g, this.features)), this.sizePx);
      this.cache.set(g, w);
    }
    return w;
  }
}

/** 셰이핑 결과의 지문 (Node·브라우저 비교용) */
export function fingerprint(rows: Glyph[][]): string {
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= v & 0xffff;
    h = Math.imul(h, 16777619);
    h ^= v >>> 16;
    h = Math.imul(h, 16777619);
  };
  for (const r of rows) {
    mix(r.length);
    for (const g of r) {
      mix(g.g);
      mix(g.cl);
      mix(g.ax);
      mix(g.dx);
      mix(g.dy);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const hbVersion = () => hb.versionString();
