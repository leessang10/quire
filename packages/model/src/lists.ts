/**
 * 목록 (10 §2.4). 문단 속성 list: {id, level}과 문서의 목록 정의(lists[id].levels[n])로 표현한다. 중첩 노드는 없다.
 *
 * 번호는 파생 값이다: 화면 순서로 같은 id의 문단을 세어 수준별 번호를 매긴다. 문서에 저장하지 않으므로 구획 이동·동시 편집
 * 뒤에도 늘 화면 순서대로다.
 */
import type { ParagraphInfo } from './doc';

export type NumberFormat = 'bullet' | 'decimal' | 'hangul' | 'hangulJamo' | 'circled' | 'lowerAlpha' | 'upperAlpha' | 'lowerRoman' | 'upperRoman';

export interface ListLevel {
  format: NumberFormat;
  /**
   * 표시 모양. %1–%9는 그 수준의 번호 (예: "%1.", "(%2)", "%1.%2."). bullet이면 글머리 기호 그대로
   */
  text: string;
  /** 본문 왼쪽 들여쓰기 (1/1000pt) */
  indent: number;
  /** 번호 자리: 본문 왼쪽에서 이만큼 내어 번호를 둔다 (1/1000pt) */
  hanging: number;
  /** 첫 번호 (기본 1) */
  start?: number;
}

export interface ListDef {
  id: string;
  kind: 'bullet' | 'number';
  levels: ListLevel[];
}

export const MAX_LIST_LEVEL = 8;

const STEP = 24000; // 수준마다 24pt
const HANG = 18000;

const BULLETS = ['•', '◦', '▪'];
/** 한국 문서 관행: 1. → 가. → 1) → 가) → (1) → (가) → ① → ㉮ → i. */
const NUMBER_LEVELS: Array<[NumberFormat, string]> = [
  ['decimal', '%1.'],
  ['hangul', '%2.'],
  ['decimal', '%3)'],
  ['hangul', '%4)'],
  ['decimal', '(%5)'],
  ['hangul', '(%6)'],
  ['circled', '%7'],
  ['hangulJamo', '%8'],
  ['lowerRoman', '%9.'],
];

/** 기본 목록 정의 (수준 9개) */
export function defaultListDef(id: string, kind: 'bullet' | 'number'): ListDef {
  const levels: ListLevel[] = [];
  for (let l = 0; l <= MAX_LIST_LEVEL; l++) {
    const indent = STEP * (l + 1);
    if (kind === 'bullet') levels.push({ format: 'bullet', text: BULLETS[l % BULLETS.length]!, indent, hanging: HANG });
    else levels.push({ format: NUMBER_LEVELS[l]![0], text: NUMBER_LEVELS[l]![1], indent, hanging: HANG });
  }
  return { id, kind, levels };
}

const HANGUL = '가나다라마바사아자차카타파하';
const JAMO = '㉮㉯㉰㉱㉲㉳㉴㉵㉶㉷㉸㉹㉺㉻';

function roman(n: number): string {
  const table: Array<[number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let out = '';
  for (const [v, s] of table)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out;
}

/** 1부터 세는 알파벳·한글 순서 (넘으면 두 글자: 가가, 가나 …) */
function alpha(n: number, letters: string): string {
  const cs = Array.from(letters);
  let out = '';
  while (n > 0) {
    n--;
    out = cs[n % cs.length]! + out;
    n = Math.floor(n / cs.length);
  }
  return out;
}

/** 번호 하나를 형식대로 */
export function formatNumber(n: number, format: NumberFormat): string {
  switch (format) {
    case 'bullet':
      return '';
    case 'decimal':
      return String(n);
    case 'hangul':
      return alpha(n, HANGUL);
    case 'hangulJamo':
      return n <= JAMO.length ? Array.from(JAMO)[n - 1]! : String(n);
    case 'circled':
      return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : String(n);
    case 'lowerAlpha':
      return alpha(n, 'abcdefghijklmnopqrstuvwxyz');
    case 'upperAlpha':
      return alpha(n, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    case 'lowerRoman':
      return roman(n);
    case 'upperRoman':
      return roman(n).toUpperCase();
  }
}

/** 목록 문단 하나의 번호 (표시용) */
export interface ListLabel {
  /** 번호·글머리 문자열 */
  text: string;
  level: number;
  def: ListDef;
}

/**
 * 화면 순서의 문단들 → 문단 ID별 번호. 같은 id의 문단을 세고, 수준 L의 문단이 나오면 L보다 깊은 수준의 번호를 다시 1부터.
 * 정의가 없는 목록(지워진 id)은 번호를 매기지 않는다.
 *
 * **붙은 목록은 하나로 잇는다** (Word·Google Docs·Notion과 같다): 목록 문단이 끊기지 않고 이어지는 동안, 같은 종류(번호·글머리)의
 * 다른 목록은 그 이어짐에서 먼저 나온 목록의 번호를 잇는다. 따로 번호를 매긴 문단 셋이 붙으면 1, 1, 1이 아니라 1, 2, 3이다.
 * 목록이 아닌 문단이 끼면 이어짐이 끝나고, 같은 id는 사이에 다른 문단이 있어도 번호를 잇는다 (지금과 같다).
 * 한 번 이어진 목록은 뒤에서 따로 나와도 이은 목록의 번호를 잇는다 (표 뒤의 같은 목록 항목 등). 편집기는 붙은 목록을 문서에서도
 * 합치지만 (Editor.joinTouchingLists), 동시 편집으로 붙은 것은 여기서만 합쳐진다.
 */
export function numberLists(paras: readonly ParagraphInfo[], defs: ReadonlyMap<string, ListDef>): Map<string, ListLabel> {
  const out = new Map<string, ListLabel>();
  const counters = new Map<string, number[]>();
  /** 지금 이어지는 목록 문단들에서 종류마다 먼저 나온 목록 (번호를 이을 목록) */
  let run: Map<string, ListDef> | null = null;
  /** 이어진 적이 있는 목록 → 이은 목록 */
  const alias = new Map<string, ListDef>();
  for (const p of paras) {
    const li = p.attrs.list;
    const own = li ? defs.get(li.id) : undefined;
    if (!li || !own) {
      run = null;
      continue;
    }
    run ??= new Map();
    let def = run.get(own.kind);
    if (!def) run.set(own.kind, (def = alias.get(own.id) ?? own));
    else if (def !== own && !alias.has(own.id)) alias.set(own.id, def);
    const level = Math.max(0, Math.min(MAX_LIST_LEVEL, li.level | 0, def.levels.length - 1));
    let c = counters.get(def.id);
    if (!c) {
      c = new Array<number>(def.levels.length).fill(0);
      counters.set(def.id, c);
    }
    c[level] = (c[level] || (def.levels[level]!.start ?? 1) - 1) + 1;
    for (let k = level + 1; k < c.length; k++) c[k] = 0;
    const lv = def.levels[level]!;
    let text: string;
    if (lv.format === 'bullet') text = lv.text;
    else {
      text = '';
      for (const part of compiled(def)[level]!) {
        if (typeof part === 'string') text += part;
        else {
          const n = part === level ? c[part]! : c[part] || (def.levels[part]?.start ?? 1);
          const f = def.levels[part]?.format ?? 'decimal';
          text += formatNumber(n, f === 'bullet' ? 'decimal' : f);
        }
      }
    }
    out.set(p.id, { text, level, def });
  }
  return out;
}

/** 수준마다 표시 모양을 조각으로: 글자 또는 번호 자리(수준 번호) */
const templates = new WeakMap<ListDef, Array<Array<string | number>>>();
function compiled(def: ListDef): Array<Array<string | number>> {
  let t = templates.get(def);
  if (!t) {
    t = def.levels.map((lv) => lv.text.split(/(%[1-9])/).filter(Boolean).map((x) => (/^%[1-9]$/.test(x) ? Number(x[1]) - 1 : x)));
    templates.set(def, t);
  }
  return t;
}
