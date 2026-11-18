/**
 * 문단 레이아웃: 글자 폭 측정 → 줄바꿈 (02 §4–5)
 *
 * 폭 측정 (ADR-0002)
 * - 셰이퍼(Measurer.advances가 있음): 공백으로 나뉜 조각(어절)마다 셰이핑해 코드포인트별 진행폭을 받는다. 커닝·합자가
 *   반영되고, 조각 안의 위치는 셰이퍼가 정한다 (합자는 grapheme마다 나눔). 어절 경계를 넘는 커닝은 없다.
 * - 셰이퍼가 없으면 grapheme 단위 폭 합산 (커닝·합자 무시, 0단계 방식)
 * - 줄바꿈: 한글 어절(공백) 단위. 한 어절이 줄보다 길면 글자 단위로 끊음
 * - 금칙: 글자 단위로 끊을 때 닫는 문장부호가 줄 앞에 오지 않게 한 글자 당김
 * - 왼쪽 정렬만
 * - 서식 (10 §4): 글자마다 서식 번호(fmt)를 받아 얼굴(굵게)·크기 배율로 잰다. 조각은 서식 번호가 바뀌는 곳에서도 나눈다.
 *   줄마다 높이 배율(그 줄 글자의 가장 큰 크기)을 낸다. fmt가 없으면 서식 없는 경로와 같다
 *
 * 메모리: 결과는 문자열 1개 + typed array로만 보관한다 (글자별 객체·문자열 없음)
 */

/** 서식 번호 하나가 레이아웃에 주는 영향 (편집기가 서식 묶음에서 만든다) */
export interface RunStyle {
  /** 글꼴 얼굴: 0 보통, 1 굵게 */
  face: number;
  /** 진행폭 배율 = 글자 크기 ÷ 기본 크기 (첨자는 0.65배 더) */
  scale: number;
  /** 줄 높이 배율 (첨자는 바탕 크기) */
  line: number;
}

export const PLAIN_STYLE: RunStyle = Object.freeze({ face: 0, scale: 1, line: 1 });

/** 문단의 서식 (레이아웃 입력) */
export interface ParaFormat {
  /** 글자(코드포인트)마다 서식 번호. null이면 모두 0 */
  fmt: Uint16Array | null;
  /** 문단 ¶의 서식 번호 (빈 줄·마지막 줄 높이) */
  mark: number;
  /** 서식 번호 → 영향. 0번은 PLAIN_STYLE이어야 한다 */
  style(id: number): RunStyle;
}

export interface Measurer {
  /** grapheme 하나의 진행폭 (px, 기본 크기). face: 글꼴 얼굴 (0 보통, 1 굵게) */
  width(grapheme: string, face?: number): number;
  /**
   * 셰이퍼: 공백·탭이 없는 조각(어절)의 코드포인트별 진행폭 (px, 길이 = 코드포인트 수). 같은 조각이면 같은 결과.
   * 있으면 레이아웃이 width 대신 쓴다. 공백·탭·전각 공백 하나는 width로 잰다.
   */
  advances?(chunk: string, face?: number): Float32Array;
  /** 셰이퍼: 조각의 코드포인트별 글꼴 번호 (그리기용). 모두 0번 글꼴이면 null */
  fontsOf?(chunk: string, face?: number): Uint8Array | null;
}

export interface Preedit {
  /** 문단 내 코드포인트 인덱스 (조합 문자열이 들어갈 자리) */
  at: number;
  text: string;
  /** 조합 문자열의 서식 번호 (편집기의 보류 서식). 없으면 앞 글자 서식 */
  fmt?: number;
}

export interface LineBox {
  /** 표시 코드포인트 인덱스 [start, end) */
  start: number;
  end: number;
  /** 줄 높이 배율 (그 줄에서 가장 큰 글자, 서식 없으면 1) */
  scale: number;
}

export interface ParaLayout {
  /** 표시 텍스트 (조합 중이면 preedit 포함) */
  text: string;
  /** 표시 텍스트의 코드포인트 수 */
  n: number;
  /** 코드포인트 인덱스 → UTF-16 오프셋 (길이 n+1). 모두 BMP 문자면 null (항등) */
  u16: Uint32Array | null;
  /** xs[i] = i번째 코드포인트 앞의 x (문단 기준, 길이 n+1) */
  xs: Float32Array;
  /** stops[i] = 1이면 i가 grapheme 경계(캐럿이 설 수 있는 곳) */
  stops: Uint8Array;
  /** 표시 인덱스 기준 조합 문자열 구간 [start, end), 없으면 null */
  preedit: [number, number] | null;
  lines: LineBox[];
  /** 코드포인트별 글꼴 번호 (셰이퍼가 준 것). 모두 0번이면 null */
  fonts: Uint8Array | null;
  /** 표시 코드포인트별 서식 번호 (조합 문자열 포함). 모두 0이면 null */
  fmt: Uint16Array | null;
}

/** 표시 텍스트의 코드포인트 구간 [a, b) */
export function cpSlice(pl: ParaLayout, a: number, b: number): string {
  if (!pl.u16) return pl.text.slice(a, b);
  return pl.text.slice(pl.u16[a], pl.u16[b]);
}

const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

/**
 * 모든 글자가 그 자체로 grapheme 하나인 텍스트 (결합 문자·서로게이트·ZWJ·이형 선택자 없음).
 * 이 범위만 쓴 문단은 Intl.Segmenter를 건너뛴다.
 * 탭, ASCII, Latin-1, 일반 문장부호(ZW* 제외), CJK 기호, 한글 호환 자모, 한글 음절, CJK 통합 한자, 전각 형태
 */
const SIMPLE_TEXT =
  /^[\t\x20-\x7e -ÿ‐-‧‰-⁞　-〿㄰-㆏가-힣一-鿿！-￯]*$/;

/** 줄 앞에 올 수 없는 문자 (금칙, 0단계 최소 목록) */
const NO_LINE_START = new Set(Array.from('.,!?:;)]}>、。，．・」』】〉》”’…%'));

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '　';
}

export function layoutParagraph(
  text: string,
  width: number,
  measurer: Measurer,
  preedit: Preedit | null = null,
  format: ParaFormat | null = null,
): ParaLayout {
  let display = text;
  let pre: [number, number] | null = null;
  let fmt = format?.fmt ?? null;
  if (preedit && preedit.text) {
    const base = Array.from(text);
    const plen = Array.from(preedit.text).length;
    display = base.slice(0, preedit.at).join('') + preedit.text + base.slice(preedit.at).join('');
    pre = [preedit.at, preedit.at + plen];
    // 조합 문자열은 앞 글자(문단 첫머리면 그 자리 글자, 빈 문단이면 ¶)의 서식으로 보인다
    const id = preedit.fmt ?? (fmt ? (fmt[preedit.at - 1] ?? fmt[preedit.at] ?? 0) : base.length === 0 ? (format?.mark ?? 0) : 0);
    if (fmt || id !== 0) {
      const f = new Uint16Array(base.length + plen);
      if (fmt) {
        f.set(fmt.subarray(0, preedit.at));
        f.set(fmt.subarray(preedit.at), preedit.at + plen);
      }
      f.fill(id, preedit.at, preedit.at + plen);
      fmt = f;
    }
  }
  const style = format?.style;
  const dfmt = fmt;
  const st = dfmt && style ? (k: number) => style(dfmt[k]!) : null;

  // 코드포인트 수와 UTF-16 매핑 (서로게이트 쌍이 있을 때만)
  let n = 0;
  let hasAstral = false;
  for (let i = 0; i < display.length; i++) {
    const c = display.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < display.length) {
      hasAstral = true;
      i++;
    }
    n++;
  }
  let u16: Uint32Array | null = null;
  if (hasAstral) {
    u16 = new Uint32Array(n + 1);
    let cp = 0;
    for (let i = 0; i < display.length; i++) {
      u16[cp++] = i;
      const c = display.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < display.length) i++;
    }
    u16[n] = display.length;
  }

  const xs = new Float32Array(n + 1);
  const stops = new Uint8Array(n + 1);
  stops[n] = 1;

  // grapheme 단위로 폭 측정 (임시 배열은 문단 하나 동안만 존재)
  const gStart: number[] = []; // grapheme 시작 코드포인트
  const gFirst: string[] = []; // grapheme의 첫 글자 (공백·금칙 판단용)
  let cp = 0;
  let x = 0;
  if (SIMPLE_TEXT.test(display)) {
    // 빠른 경로: 결합 문자가 없는 텍스트는 UTF-16 단위 하나가 grapheme 하나
    for (let i = 0; i < display.length; i++) {
      const ch = display[i]!;
      gStart.push(i);
      gFirst.push(ch);
      stops[i] = 1;
      xs[i] = x;
      if (!measurer.advances) {
        if (st) {
          const r = st(i);
          x += measurer.width(ch, r.face) * r.scale;
        } else x += measurer.width(ch);
      }
    }
    xs[n] = x;
    const fonts = measurer.advances ? shapeXs(display, n, null, xs, measurer, fmt, st) : null;
    const lines = breakLines(n, xs, gStart, gFirst, width);
    lineScales(lines, st, format);
    return { text: display, n, u16: null, xs, stops, preedit: pre, lines, fonts, fmt };
  }
  for (const seg of segmenter.segment(display)) {
    const s = seg.segment;
    let len = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) i++;
      len++;
    }
    gStart.push(cp);
    gFirst.push(String.fromCodePoint(s.codePointAt(0)!));
    stops[cp] = 1;
    for (let k = 0; k < len; k++) xs[cp + k] = x;
    if (!measurer.advances) {
      if (st) {
        const r = st(cp);
        x += measurer.width(s, r.face) * r.scale;
      } else x += measurer.width(s);
    }
    cp += len;
  }
  xs[n] = x;
  const fonts = measurer.advances ? shapeXs(display, n, u16, xs, measurer, fmt, st) : null;

  const lines = breakLines(n, xs, gStart, gFirst, width);
  lineScales(lines, st, format);
  return { text: display, n, u16, xs, stops, preedit: pre, lines, fonts, fmt };
}

/** 줄마다 높이 배율: 줄 글자의 가장 큰 line 배율. 마지막 줄은 ¶도 센다 (빈 줄은 ¶만) */
function lineScales(lines: LineBox[], st: ((k: number) => RunStyle) | null, format: ParaFormat | null): void {
  const markScale = format && format.mark !== 0 ? format.style(format.mark).line : 1;
  if (!st && markScale === 1) return;
  for (let l = 0; l < lines.length; l++) {
    const ln = lines[l]!;
    let m = l === lines.length - 1 ? markScale : 0;
    if (st) for (let k = ln.start; k < ln.end; k++) m = Math.max(m, st(k).line);
    else if (ln.end > ln.start) m = Math.max(m, 1);
    ln.scale = m > 0 ? m : 1;
  }
}

/**
 * 셰이퍼로 xs를 채운다: 공백·탭이 아닌 글자가 이어진 조각마다 advances, 공백·탭은 width.
 * (빠른 경로에서 width로 채운 값은 덮어쓴다. 빠른 경로의 width 호출은 grapheme 판정용이 아니므로 셰이퍼 쪽에서는 쓰지 않음)
 */
function shapeXs(
  display: string,
  n: number,
  u16: Uint32Array | null,
  xs: Float32Array,
  m: Measurer,
  fmt: Uint16Array | null,
  st: ((k: number) => RunStyle) | null,
): Uint8Array | null {
  let fonts: Uint8Array | null = null;
  let x = 0;
  let cp = 0;
  const at = (k: number) => (u16 ? u16[k]! : k);
  while (cp < n) {
    const ch = display[at(cp)]!;
    const r = st ? st(cp) : PLAIN_STYLE;
    if (isSpace(ch)) {
      xs[cp] = x;
      x += r === PLAIN_STYLE ? m.width(ch) : m.width(ch, r.face) * r.scale;
      cp++;
      continue;
    }
    // 조각: 공백이 아니고 서식 번호가 같은 글자들
    let end = cp + 1;
    while (end < n) {
      const c = display[at(end)]!;
      if (isSpace(c) || (fmt && fmt[end] !== fmt[cp])) break;
      end++;
    }
    const chunk = display.slice(at(cp), at(end));
    const adv = r.face === 0 ? m.advances!(chunk) : m.advances!(chunk, r.face);
    const f = (r.face === 0 ? m.fontsOf?.(chunk) : m.fontsOf?.(chunk, r.face)) ?? null;
    const scale = r.scale;
    for (let k = 0; k < end - cp; k++) {
      xs[cp + k] = x;
      x += scale === 1 ? (adv[k] ?? 0) : (adv[k] ?? 0) * scale;
    }
    if (f) {
      fonts ??= new Uint8Array(n);
      fonts.set(f.subarray(0, end - cp), cp);
    }
    cp = end;
  }
  xs[n] = x;
  return fonts;
}

function breakLines(n: number, xs: Float32Array, starts: number[], first: string[], width: number): LineBox[] {
  if (n === 0) return [{ start: 0, end: 0, scale: 1 }];

  const lines: LineBox[] = [];
  let lineStart = 0;
  let lastBreak = -1; // 이 인덱스에서 끊을 수 있음 (공백 다음)
  let lastBreakG = -1; // 그 위치의 grapheme 번호
  let g = 0;

  while (g < starts.length) {
    const i = starts[g]!;
    const next = g + 1 < starts.length ? starts[g + 1]! : n;
    const ch = first[g]!;

    // 공백은 줄 끝에 매달릴 수 있으므로 넘침 판정에서 제외
    if (!isSpace(ch) && xs[next]! - xs[lineStart]! > width && i > lineStart) {
      let breakAt: number;
      let bg: number;
      if (lastBreak > lineStart) {
        breakAt = lastBreak; // 어절 단위
        bg = lastBreakG;
      } else {
        breakAt = i; // 글자 단위 (어절이 줄보다 김)
        bg = g;
        // 금칙: 줄 앞에 올 수 없는 글자면 한 글자 앞에서 끊는다
        if (NO_LINE_START.has(first[bg]!) && bg > 0 && starts[bg - 1]! > lineStart) {
          bg--;
          breakAt = starts[bg]!;
        }
      }
      lines.push({ start: lineStart, end: breakAt, scale: 1 });
      lineStart = breakAt;
      lastBreak = -1;
      g = bg;
      continue;
    }

    if (isSpace(ch)) {
      lastBreak = next;
      lastBreakG = g + 1;
    }
    g++;
  }
  lines.push({ start: lineStart, end: n, scale: 1 });
  return lines;
}
