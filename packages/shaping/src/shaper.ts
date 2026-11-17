/**
 * HarfBuzz 셰이퍼 (ADR-0002, 02 §4 ①–②). 레이아웃의 Measurer를 구현한다 (advances·fontsOf).
 *
 * 조각(어절) 하나를 받으면
 * 1. grapheme으로 나누고, grapheme마다 글꼴을 고른다: 글꼴 목록에서 그 grapheme의 글자(ZWJ·이형 선택자 제외)를 모두 가진
 *    첫 글꼴 → 없으면 첫 글자를 가진 첫 글꼴 → 없으면 대체 측정기(FALLBACK, 예: 캔버스의 시스템 글꼴).
 * 2. 같은 글꼴·같은 스크립트(한글, 한자, 가나, 라틴, 기타 문자)가 이어진 grapheme을 한 런으로 묶는다. 문장부호·숫자·기호
 *    (공통 스크립트)는 앞 런에 붙는다. 한글·라틴이 섞인 어절은 런이 나뉘어 각각 맞는 기능(커닝 등)으로 셰이핑된다.
 * 3. 런을 HarfBuzz로 셰이핑(커닝·합자 켬)하고, 글리프 진행폭을 클러스터별로 모아 grapheme 첫 코드포인트에 둔다.
 *    클러스터 하나에 grapheme이 여럿이면(합자 fi, ffi) 진행폭을 grapheme 수로 똑같이 나눈다 (캐럿이 합자 안에 설 자리).
 *
 * 옛 kern 표: harfbuzzjs는 HB_TINY 빌드라 GPOS가 아닌 옛 'kern' 표를 적용하지 않는다. 맑은 고딕처럼 GPOS 없이 kern 표만
 * 있는 글꼴은 브라우저(전체 HarfBuzz)와 폭이 달라지므로, GPOS에 kern 기능이 없을 때 kern 표(형식 0)를 직접 적용한다
 * (HarfBuzz와 같은 규칙: GPOS kern이 있으면 옛 표는 쓰지 않음).
 *
 * 결과는 조각 문자열로 캐시한다. 결정성: 같은 글꼴 파일·같은 WASM이면 글꼴 단위 정수가 같고, px 변환은 같은 산술이다.
 * 대체 측정기로 잰 글자(엔진이 불러오지 않은 글꼴)는 기기마다 다를 수 있다.
 */
import * as hb from 'harfbuzzjs';
import type { Measurer } from '@quire/layout';

/** 대체 측정기로 잰 글자의 글꼴 번호 */
export const FALLBACK_FONT = 255;

export interface ShapingFont {
  name: string;
  upem: number;
  hb: hb.Font;
  /** 옛 kern 표의 쌍 (왼쪽 글리프 × 65536 + 오른쪽 → 값). GPOS kern이 있거나 표가 없으면 null */
  legacyKern: Map<number, number> | null;
  /** 글자가 있는가 (캐시) */
  has(cp: number): boolean;
}

export function loadShapingFont(bytes: Uint8Array | ArrayBuffer, name: string): ShapingFont {
  const face = new hb.Face(new hb.Blob(bytes));
  const font = new hb.Font(face);
  const cache = new Map<number, boolean>();
  const gposKern = face.getTableFeatureTags('GPOS').includes('kern');
  return {
    name,
    upem: face.upem,
    hb: font,
    legacyKern: gposKern ? null : parseKern(face.referenceTable('kern')),
    has(cp) {
      let v = cache.get(cp);
      if (v === undefined) {
        const g = font.nominalGlyph(cp);
        v = g !== undefined && g !== 0;
        cache.set(cp, v);
      }
      return v;
    },
  };
}

/** Microsoft 'kern' 표 (버전 0)의 가로·형식 0 하위 표를 읽는다. 없거나 다른 형식이면 null */
export function parseKern(t: Uint8Array | undefined): Map<number, number> | null {
  if (!t || t.length < 4) return null;
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  if (v.getUint16(0) !== 0) return null; // Apple 형식(버전 1)은 다루지 않음
  const n = v.getUint16(2);
  const pairs = new Map<number, number>();
  let at = 4;
  for (let k = 0; k < n && at + 6 <= t.length; k++) {
    const len = v.getUint16(at + 2);
    const coverage = v.getUint16(at + 4);
    const horizontal = (coverage & 1) !== 0;
    const minimum = (coverage & 2) !== 0;
    const cross = (coverage & 4) !== 0;
    const format = coverage >> 8;
    if (horizontal && !minimum && !cross && format === 0 && at + 14 <= t.length) {
      const count = v.getUint16(at + 6);
      let q = at + 14;
      for (let i = 0; i < count && q + 6 <= t.length; i++, q += 6) {
        pairs.set(v.getUint16(q) * 65536 + v.getUint16(q + 2), v.getInt16(q + 4));
      }
    }
    if (len < 6) break;
    at += len;
  }
  return pairs.size > 0 ? pairs : null;
}

const enum Script {
  Common = 0,
  Hangul,
  Han,
  Kana,
  Latin,
  Other,
}

const LETTER = /\p{L}/u;

function scriptOf(cp: number): Script {
  if (cp < 0x80) return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) ? Script.Latin : Script.Common;
  if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xd7b0 && cp <= 0xd7ff))
    return Script.Hangul;
  if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x3134f)) return Script.Han;
  if (cp >= 0x3040 && cp <= 0x30ff) return Script.Kana;
  if ((cp >= 0xc0 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff)) return Script.Latin;
  return LETTER.test(String.fromCodePoint(cp)) ? Script.Other : Script.Common;
}

/** grapheme 안에서 글꼴 판정에서 빼는 글자: ZWJ, ZWNJ, 이형 선택자 */
const isJoiner = (cp: number) => cp === 0x200d || cp === 0x200c || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);

/** 한 글자가 한 grapheme인 텍스트 (레이아웃의 빠른 경로와 같은 범위) */
const SIMPLE = /^[\x20-\x7e -ÿ‐-‧‰-⁞　-〿㄰-㆏가-힣一-鿿！-￯]*$/;
const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

interface Grapheme {
  /** 조각 안 UTF-16 시작, 코드포인트 시작 */
  u: number;
  cp: number;
  text: string;
  font: number;
  script: Script;
}

interface Shaped {
  adv: Float32Array;
  fonts: Uint8Array | null;
}

export interface ShaperOptions {
  /** 글자 크기 (px) */
  size: number;
  /** 어느 글꼴에도 없는 글자를 잴 측정기 (예: 시스템 글꼴의 캔버스). 없으면 0번 글꼴로 셰이핑(.notdef) */
  fallback?: Measurer;
  /** 캐시 항목 수 상한 (넘으면 비운다). 기본 100,000 */
  cacheLimit?: number;
}

export class HbShaper implements Measurer {
  private readonly cache = new Map<string, Shaped>();
  private readonly buffer = new hb.Buffer();
  private readonly size: number;
  private readonly fallback: Measurer | undefined;
  private readonly cacheLimit: number;
  private spaceW = -1;
  /** 통계 */
  shapedRuns = 0;
  cacheHits = 0;

  constructor(
    readonly fonts: ShapingFont[],
    opts: ShaperOptions,
  ) {
    if (fonts.length === 0) throw new Error('HbShaper: no fonts');
    this.size = opts.size;
    this.fallback = opts.fallback;
    this.cacheLimit = opts.cacheLimit ?? 100_000;
  }

  width(g: string): number {
    if (g === ' ') return this.space();
    if (g === '\t') return this.space() * 4;
    const a = this.advances(g);
    let w = 0;
    for (let i = 0; i < a.length; i++) w += a[i]!;
    return w;
  }

  advances(chunk: string): Float32Array {
    return this.get(chunk).adv;
  }

  fontsOf(chunk: string): Uint8Array | null {
    return this.get(chunk).fonts;
  }

  private space(): number {
    if (this.spaceW < 0) {
      const f = this.fonts[0]!;
      this.spaceW = this.px(f, this.runUnits(f, ' ').reduce((s, g) => s + g.ax, 0));
    }
    return this.spaceW;
  }

  private px(f: ShapingFont, units: number): number {
    return (units * this.size) / f.upem;
  }

  private get(chunk: string): Shaped {
    const hit = this.cache.get(chunk);
    if (hit) {
      this.cacheHits++;
      return hit;
    }
    const r = this.shapeChunk(chunk);
    if (this.cache.size >= this.cacheLimit) this.cache.clear();
    this.cache.set(chunk, r);
    return r;
  }

  private graphemes(chunk: string): Grapheme[] {
    const out: Grapheme[] = [];
    let cp = 0;
    const push = (text: string, u: number) => {
      out.push({ u, cp, text, font: this.pickFont(text), script: Script.Common });
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) i++;
        cp++;
      }
    };
    if (SIMPLE.test(chunk)) for (let i = 0; i < chunk.length; i++) push(chunk[i]!, i);
    else for (const s of segmenter.segment(chunk)) push(s.segment, s.index);
    // 스크립트: 공통 글자는 앞(없으면 뒤) grapheme의 스크립트를 따른다
    let last = Script.Common;
    for (const g of out) {
      const sc = scriptOf(g.text.codePointAt(0)!);
      g.script = sc === Script.Common ? last : sc;
      if (g.script !== Script.Common) last = g.script;
    }
    let next = Script.Common;
    for (let k = out.length - 1; k >= 0; k--) {
      if (out[k]!.script === Script.Common) out[k]!.script = next;
      else next = out[k]!.script;
    }
    return out;
  }

  private pickFont(text: string): number {
    const cps: number[] = [];
    for (const ch of text) {
      const c = ch.codePointAt(0)!;
      if (!isJoiner(c)) cps.push(c);
    }
    if (cps.length === 0) return 0;
    for (let i = 0; i < this.fonts.length; i++) if (cps.every((c) => this.fonts[i]!.has(c))) return i;
    for (let i = 0; i < this.fonts.length; i++) if (this.fonts[i]!.has(cps[0]!)) return i;
    return this.fallback ? FALLBACK_FONT : 0;
  }

  private shapeChunk(chunk: string): Shaped {
    const gs = this.graphemes(chunk);
    const n = gs.length === 0 ? 0 : gs[gs.length - 1]!.cp + cpLen(gs[gs.length - 1]!.text);
    const adv = new Float32Array(n);
    let fonts: Uint8Array | null = null;
    let a = 0;
    while (a < gs.length) {
      let b = a + 1;
      while (b < gs.length && gs[b]!.font === gs[a]!.font && gs[b]!.script === gs[a]!.script) b++;
      const font = gs[a]!.font;
      if (font !== 0) {
        fonts ??= new Uint8Array(n);
        const endCp = b < gs.length ? gs[b]!.cp : n;
        fonts.fill(font, gs[a]!.cp, endCp);
      }
      if (font === FALLBACK_FONT) {
        for (let k = a; k < b; k++) adv[gs[k]!.cp] = this.fallback!.width(gs[k]!.text);
      } else {
        this.shapeRun(this.fonts[font]!, chunk, gs, a, b, adv);
      }
      a = b;
    }
    return { adv, fonts };
  }

  private runUnits(f: ShapingFont, text: string): Array<{ g: number; cl: number; ax: number }> {
    const buf = this.buffer;
    buf.reset();
    buf.addText(text);
    buf.guessSegmentProperties();
    hb.shape(f.hb, buf);
    this.shapedRuns++;
    const glyphs = buf.getGlyphInfosAndPositions().map((g) => ({ g: g.codepoint, cl: g.cluster, ax: g.xAdvance ?? 0 }));
    const kern = f.legacyKern;
    if (kern) for (let i = 0; i + 1 < glyphs.length; i++) glyphs[i]!.ax += kern.get(glyphs[i]!.g * 65536 + glyphs[i + 1]!.g) ?? 0;
    return glyphs;
  }

  /** graphemes [a, b)를 한 런으로 셰이핑해 adv(조각 코드포인트별)에 채운다 */
  private shapeRun(f: ShapingFont, chunk: string, gs: Grapheme[], a: number, b: number, adv: Float32Array): void {
    const u0 = gs[a]!.u;
    const u1 = b < gs.length ? gs[b]!.u : chunk.length;
    const glyphs = this.runUnits(f, chunk.slice(u0, u1));
    // 클러스터(런 안 UTF-16) → 진행폭 합
    const byCluster = new Map<number, number>();
    for (const g of glyphs) byCluster.set(g.cl, (byCluster.get(g.cl) ?? 0) + g.ax);
    const starts = [...byCluster.keys()].sort((x, y) => x - y);
    let k = a; // 지금 보는 grapheme
    for (let c = 0; c < starts.length; c++) {
      const cs = starts[c]!;
      const ce = c + 1 < starts.length ? starts[c + 1]! : u1 - u0;
      // 이 클러스터에서 시작하는 grapheme들
      while (k + 1 < b && gs[k + 1]!.u - u0 <= cs) k++;
      const owners: number[] = [];
      for (let j = k; j < b && gs[j]!.u - u0 < ce; j++) if (gs[j]!.u - u0 >= cs) owners.push(j);
      const w = this.px(f, byCluster.get(cs)!);
      if (owners.length === 0) {
        // 클러스터가 grapheme 안에서 시작 (HarfBuzz가 grapheme을 쪼갬): 그 grapheme에 더한다
        adv[gs[k]!.cp] += w;
        continue;
      }
      const each = w / owners.length;
      for (const j of owners) adv[gs[j]!.cp] += each;
    }
  }
}

function cpLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) i++;
    n++;
  }
  return n;
}
