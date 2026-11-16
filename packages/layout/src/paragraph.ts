/**
 * 문단 레이아웃: 글자 폭 측정 → 줄바꿈 (02 §4–5)
 *
 * 0단계 단순화
 * - 셰이핑 대신 grapheme 단위 폭 합산 (Measurer). 커닝·합자 무시 (ADR-0002)
 * - 줄바꿈: 한글 어절(공백) 단위. 한 어절이 줄보다 길면 글자 단위로 끊음
 * - 금칙: 글자 단위로 끊을 때 닫는 문장부호가 줄 앞에 오지 않게 한 글자 당김
 * - 왼쪽 정렬만
 *
 * 메모리: 결과는 문자열 1개 + typed array로만 보관한다 (글자별 객체·문자열 없음)
 */

export interface Measurer {
  /** grapheme 하나의 진행폭 (px) */
  width(grapheme: string): number;
}

export interface Preedit {
  /** 문단 내 코드포인트 인덱스 (조합 문자열이 들어갈 자리) */
  at: number;
  text: string;
}

export interface LineBox {
  /** 표시 코드포인트 인덱스 [start, end) */
  start: number;
  end: number;
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
}

/** 표시 텍스트의 코드포인트 구간 [a, b) */
export function cpSlice(pl: ParaLayout, a: number, b: number): string {
  if (!pl.u16) return pl.text.slice(a, b);
  return pl.text.slice(pl.u16[a], pl.u16[b]);
}

const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

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
): ParaLayout {
  let display = text;
  let pre: [number, number] | null = null;
  if (preedit && preedit.text) {
    const base = Array.from(text);
    const plen = Array.from(preedit.text).length;
    display = base.slice(0, preedit.at).join('') + preedit.text + base.slice(preedit.at).join('');
    pre = [preedit.at, preedit.at + plen];
  }

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
    x += measurer.width(s);
    cp += len;
  }
  xs[n] = x;

  const lines = breakLines(n, xs, gStart, gFirst, width);
  return { text: display, n, u16, xs, stops, preedit: pre, lines };
}

function breakLines(n: number, xs: Float32Array, starts: number[], first: string[], width: number): LineBox[] {
  if (n === 0) return [{ start: 0, end: 0 }];

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
      lines.push({ start: lineStart, end: breakAt });
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
  lines.push({ start: lineStart, end: n });
  return lines;
}
