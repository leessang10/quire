/**
 * 문단 레이아웃: 글자 폭 측정 → 줄바꿈 (02 §4–5)
 *
 * 0단계 단순화
 * - 셰이핑 대신 grapheme 단위 폭 합산 (Measurer). 커닝·합자 무시 (ADR-0002)
 * - 줄바꿈: 한글 어절(공백) 단위. 한 어절이 줄보다 길면 글자 단위로 끊음
 * - 금칙: 글자 단위로 끊을 때 닫는 문장부호가 줄 앞에 오지 않게 한 글자 당김
 * - 왼쪽 정렬만
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
  /** 표시 텍스트 (조합 중이면 preedit 포함)의 코드포인트 */
  cps: string[];
  /** xs[i] = i번째 코드포인트 앞의 x (문단 기준, 길이 cps.length + 1) */
  xs: number[];
  /** stops[i] = i가 grapheme 경계(캐럿이 설 수 있는 곳)인지 */
  stops: boolean[];
  /** 표시 인덱스 기준 조합 문자열 구간 [start, end), 없으면 null */
  preedit: [number, number] | null;
  lines: LineBox[];
}

const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

/** 줄 앞에 올 수 없는 문자 (금칙, 0단계 최소 목록) */
const NO_LINE_START = new Set(Array.from('.,!?:;)]}>、。，．・」』】〉》”’…%'));

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
    const pcs = Array.from(preedit.text);
    display = base.slice(0, preedit.at).join('') + preedit.text + base.slice(preedit.at).join('');
    pre = [preedit.at, preedit.at + pcs.length];
  }

  const cps = Array.from(display);
  const n = cps.length;
  const xs = new Array<number>(n + 1).fill(0);
  const stops = new Array<boolean>(n + 1).fill(false);
  stops[n] = true;

  // grapheme 시작 코드포인트 인덱스 목록
  const graphemeStarts: number[] = [];
  let cp = 0;
  let x = 0;
  for (const seg of segmenter.segment(display)) {
    const len = Array.from(seg.segment).length;
    graphemeStarts.push(cp);
    stops[cp] = true;
    const w = measurer.width(seg.segment);
    for (let k = 0; k < len; k++) xs[cp + k] = x;
    x += w;
    cp += len;
  }
  xs[n] = x;

  const lines = breakLines(cps, xs, graphemeStarts, width);
  return { cps, xs, stops, preedit: pre, lines };
}

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '　';
}

function breakLines(cps: string[], xs: number[], starts: number[], width: number): LineBox[] {
  const n = cps.length;
  if (n === 0) return [{ start: 0, end: 0 }];

  const lines: LineBox[] = [];
  let lineStart = 0;
  let lastBreak = -1; // 이 인덱스에서 끊을 수 있음 (공백 다음)
  let g = 0; // starts 인덱스

  while (g < starts.length) {
    const i = starts[g]!;
    const next = g + 1 < starts.length ? starts[g + 1]! : n;
    const ch = cps[i];

    // 공백은 줄 끝에 매달릴 수 있으므로 넘침 판정에서 제외
    if (!isSpace(ch) && xs[next]! - xs[lineStart]! > width && i > lineStart) {
      let breakAt: number;
      if (lastBreak > lineStart) {
        breakAt = lastBreak; // 어절 단위
      } else {
        breakAt = i; // 글자 단위 (어절이 줄보다 김)
        // 금칙: 줄 앞에 올 수 없는 글자면 한 글자 앞에서 끊는다
        if (NO_LINE_START.has(cps[breakAt]!)) {
          const prev = prevStart(starts, breakAt);
          if (prev > lineStart) breakAt = prev;
        }
      }
      lines.push({ start: lineStart, end: breakAt });
      lineStart = breakAt;
      lastBreak = -1;
      g = starts.indexOf(breakAt);
      continue;
    }

    if (isSpace(ch)) lastBreak = next;
    g++;
  }
  lines.push({ start: lineStart, end: n });
  return lines;
}

function prevStart(starts: number[], i: number): number {
  const k = starts.indexOf(i);
  return k > 0 ? starts[k - 1]! : i;
}
