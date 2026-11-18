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
 * 굵게 (10 §4): 글꼴 자리마다 굵은 얼굴(bold 자리)을 둘 수 있다. 글꼴 고르기는 보통 굵기의 범위로 하고, 셰이핑은 그 자리의
 * 굵은 얼굴로 한다 (굵은 얼굴이 없으면 보통 굵기로 재고 그리기에서 합성 굵게). 크기는 셰이핑하지 않고 레이아웃이 배율을 곱한다.
 *
 * 결과는 (얼굴, 조각 문자열)로 캐시한다. 결정성: 같은 글꼴 파일·같은 WASM이면 글꼴 단위 정수가 같고, px 변환은 같은 산술이다.
 * 대체 측정기로 잰 글자(엔진이 불러오지 않은 글꼴)는 기기마다 다를 수 있다.
 */
import * as hb from 'harfbuzzjs';
import type { Measurer } from '@quire/layout';

/** 대체 측정기로 잰 글자의 글꼴 번호 */
export const FALLBACK_FONT = 255;

/** 글꼴 치수 (em 비율, 위가 양수) */
export interface FontMetrics {
  ascent: number;
  descent: number;
  /** 밑줄 위치 (기준선 기준, 보통 음수 = 아래)·두께 */
  underlinePosition: number;
  underlineThickness: number;
  /** 취소선 위치 (기준선 위)·두께 */
  strikePosition: number;
  strikeThickness: number;
}

export interface ShapingFont {
  name: string;
  upem: number;
  metrics: FontMetrics;
  hb: hb.Font;
  /** 옛 kern 표의 쌍 (왼쪽 글리프 × 65536 + 오른쪽 → 값). GPOS kern이 있거나 표가 없으면 null */
  legacyKern: Map<number, number> | null;
  /** 글자가 있는가 (캐시) */
  has(cp: number): boolean;
}

/**
 * 글꼴 목록의 한 자리. 부분 로드(02 §4)에서는 글꼴 조각마다 하나이고, 불러오기 전에도 어떤 글자를 가졌는지 안다
 * (조각 목록의 범위). font가 null이면 아직 불러오지 않았다.
 */
export interface FontSlot {
  name: string;
  covers(cp: number): boolean;
  font: ShapingFont | null;
  /** 같은 범위의 굵은 얼굴 (없으면 보통 굵기로 재고 합성 굵게로 그린다) */
  bold?: FontSlot | null;
}

export function slotOf(font: ShapingFont): FontSlot {
  return { name: font.name, covers: (cp) => font.has(cp), font };
}

export function loadShapingFont(bytes: Uint8Array | ArrayBuffer, name: string): ShapingFont {
  const face = new hb.Face(new hb.Blob(bytes));
  const font = new hb.Font(face);
  const cache = new Map<number, boolean>();
  const gposKern = face.getTableFeatureTags('GPOS').includes('kern');
  return {
    name,
    upem: face.upem,
    metrics: readMetrics(face, face.upem),
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

/** hhea·post·OS/2 표에서 치수를 읽는다 (없으면 크기 비례 기본값) */
function readMetrics(face: hb.Face, upem: number): FontMetrics {
  const view = (t: Uint8Array | undefined, need: number) => (t && t.length >= need ? new DataView(t.buffer, t.byteOffset, t.byteLength) : null);
  const hhea = view(face.referenceTable('hhea'), 8);
  const post = view(face.referenceTable('post'), 12);
  const os2 = view(face.referenceTable('OS/2'), 30);
  const m: FontMetrics = {
    ascent: hhea ? hhea.getInt16(4) / upem : 0.8,
    descent: hhea ? -hhea.getInt16(6) / upem : 0.2,
    underlinePosition: post ? post.getInt16(8) / upem : -0.1,
    underlineThickness: post ? post.getInt16(10) / upem : 0.05,
    strikePosition: os2 ? os2.getInt16(28) / upem : 0.3,
    strikeThickness: os2 ? os2.getInt16(26) / upem : 0.05,
  };
  if (!(m.underlineThickness > 0)) m.underlineThickness = 0.05;
  if (!(m.strikeThickness > 0)) m.strikeThickness = m.underlineThickness;
  return m;
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
  /** 글꼴 자리 번호 (FALLBACK_FONT면 대체 측정기) */
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
  /**
   * 아직 불러오지 않은 글꼴 자리의 글자를 만났다 (자리마다 한 번). 그 글자는 불러올 때까지 대체 측정기로 재고 캐시하지 않는다.
   * 불러오면 loaded(i, font, face)를 부르고 다시 조판한다. face 1이면 그 자리의 굵은 얼굴이다.
   */
  onMissing?: (slot: number, face: number) => void;
}

export class HbShaper implements Measurer {
  private readonly cache = new Map<string, Shaped>();
  private readonly buffer = new hb.Buffer();
  private readonly size: number;
  private readonly fallback: Measurer | undefined;
  private readonly cacheLimit: number;
  private spaceW = [-1, -1];
  readonly slots: FontSlot[];
  private readonly onMissing: ((slot: number, face: number) => void) | undefined;
  private readonly requested = new Set<number>();
  /** 지금 셰이핑하는 조각에 아직 없는 글꼴이 쓰였다 (캐시하지 않음) */
  private pending = false;
  /** 통계 */
  shapedRuns = 0;
  cacheHits = 0;

  constructor(fonts: Array<ShapingFont | FontSlot>, opts: ShaperOptions) {
    if (fonts.length === 0) throw new Error('HbShaper: no fonts');
    if (fonts.length >= FALLBACK_FONT) throw new Error(`HbShaper: at most ${FALLBACK_FONT - 1} font slots`);
    this.slots = fonts.map((f) => ('hb' in f ? slotOf(f) : f));
    this.size = opts.size;
    this.fallback = opts.fallback;
    this.cacheLimit = opts.cacheLimit ?? 100_000;
    this.onMissing = opts.onMissing;
    if (this.slots.some((s) => !s.font) && !this.fallback) throw new Error('HbShaper: lazy font slots need a fallback measurer');
  }

  /** 자리 i의 글꼴(face 1이면 굵은 얼굴)을 불러왔다. 그 자리를 쓰는 글자는 다음 셰이핑부터 이 글꼴로 잰다 (편집기가 다시 조판한다) */
  loaded(i: number, font: ShapingFont, face = 0): void {
    const slot = this.slots[i]!;
    if (face === 1) {
      if (!slot.bold) throw new Error(`HbShaper.loaded: slot ${i} has no bold face`);
      slot.bold.font = font;
    } else slot.font = font;
    this.requested.delete(face * 256 + i);
    this.spaceW[face] = -1;
  }

  /** 불러오기를 요청했지만 아직 안 온 자리 (얼굴 × 256 + 자리) */
  get waiting(): number[] {
    return [...this.requested];
  }

  width(g: string, face = 0): number {
    if (g === ' ') return this.space(face);
    if (g === '\t') return this.space(face) * 4;
    const a = this.advances(g, face);
    let w = 0;
    for (let i = 0; i < a.length; i++) w += a[i]!;
    return w;
  }

  advances(chunk: string, face = 0): Float32Array {
    return this.get(chunk, face).adv;
  }

  fontsOf(chunk: string, face = 0): Uint8Array | null {
    return this.get(chunk, face).fonts;
  }

  /** 자리 i의 얼굴 face를 셰이핑할 글꼴. 굵은 얼굴이 없으면 보통 굵기. 아직 안 불러왔으면 null (요청함) */
  private faceFont(i: number, face: number): ShapingFont | null {
    const slot = this.slots[i]!;
    const target = face === 1 && slot.bold ? slot.bold : slot;
    if (!target.font) this.request(i, target === slot ? 0 : 1);
    return target.font;
  }

  private space(face: number): number {
    if (this.spaceW[face]! < 0) {
      const slot = this.slots.findIndex((s) => s.covers(0x20));
      const f = slot >= 0 ? this.faceFont(slot, face) : null;
      if (!f) return this.fallback ? this.fallback.width(' ', face) : 0;
      this.spaceW[face] = this.px(f, this.runUnits(f, ' ').reduce((s, g) => s + g.ax, 0));
    }
    return this.spaceW[face]!;
  }

  private request(i: number, face: number): void {
    const key = face * 256 + i;
    if (this.requested.has(key)) return;
    this.requested.add(key);
    this.onMissing?.(i, face);
  }

  private px(f: ShapingFont, units: number): number {
    return (units * this.size) / f.upem;
  }

  private get(chunk: string, face: number): Shaped {
    const key = face === 0 ? chunk : `\u0001${chunk}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cacheHits++;
      return hit;
    }
    this.pending = false;
    const r = this.shapeChunk(chunk, face);
    if (this.pending) return r; // 아직 없는 글꼴을 대신 잰 결과: 불러오면 달라진다
    if (this.cache.size >= this.cacheLimit) this.cache.clear();
    this.cache.set(key, r);
    return r;
  }

  private graphemes(chunk: string, face: number): Grapheme[] {
    const out: Grapheme[] = [];
    let cp = 0;
    const push = (text: string, u: number) => {
      out.push({ u, cp, text, font: this.pickFont(text, face), script: Script.Common });
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

  private pickFont(text: string, face: number): number {
    const cps: number[] = [];
    for (const ch of text) {
      const c = ch.codePointAt(0)!;
      if (!isJoiner(c)) cps.push(c);
    }
    if (cps.length === 0) return 0;
    let pick = -1;
    for (let i = 0; i < this.slots.length && pick < 0; i++) if (cps.every((c) => this.slots[i]!.covers(c))) pick = i;
    for (let i = 0; i < this.slots.length && pick < 0; i++) if (this.slots[i]!.covers(cps[0]!)) pick = i;
    if (pick < 0) return this.fallback ? FALLBACK_FONT : 0;
    if (!this.faceFont(pick, face)) {
      this.pending = true;
      return FALLBACK_FONT;
    }
    return pick;
  }

  private shapeChunk(chunk: string, face: number): Shaped {
    const gs = this.graphemes(chunk, face);
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
        for (let k = a; k < b; k++) adv[gs[k]!.cp] = this.fallback!.width(gs[k]!.text, face);
      } else {
        this.shapeRun(this.faceFont(font, face)!, chunk, gs, a, b, adv);
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
