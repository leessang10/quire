/**
 * 화면 테마 (17): 캔버스가 그리는 색을 CSS 변수(`--quire-*`)에서 읽는다. 테마는 변수 값 묶음이고 문서를 바꾸지 않는다
 * (레이아웃·쪽 나눔 그대로). PDF는 테마를 따르지 않는다 (문서 그대로).
 *
 * - 호스트 요소에 `.quire` 클래스와 `data-quire-theme`(classic·minimal·modern), `data-quire-scheme`(light·dark),
 *   `data-quire-page-view`(print·continuous)를 단다. 기본 테마 값은 한 번 넣는 스타일시트에 있다 (앱 CSS가 이긴다: `:where`).
 * - 캔버스에는 계산된 색만 넘긴다: 숨긴 요소의 `color`에 값을 넣어 `rgb()`로 풀어 쓴다 (`color-mix()`·`var()`도 된다).
 */

export type ThemeName = 'classic' | 'minimal' | 'modern';
export type ColorScheme = 'light' | 'dark' | 'auto';
export type PageView = 'print' | 'continuous';

/** 캔버스·캐럿이 쓰는 색 (계산된 값) */
export interface ThemeColors {
  desk: string;
  page: string;
  /** 쪽 그림자: 없으면 null */
  pageShadow: { color: string; blur: number; offsetY: number } | null;
  /** 쪽 테두리 색: 없으면 null */
  pageBorder: string | null;
  text: string;
  caret: string;
  selection: string;
  selectionInactive: string;
  preedit: string;
  /** 쪽·구역 나눔 점선, 단 구분선 */
  mark: string;
  field: string;
  grip: string;
  gripActive: string;
  dropLine: string;
  dragSource: string;
  tableBorder: string;
  placeholder: string;
  placeholderText: string;
  accent: string;
}

/** 변수 이름과 기본값 (클래식 라이트: 테마를 넣기 전 화면과 같은 색) */
export const THEME_TOKENS: Record<Exclude<keyof ThemeColors, 'pageShadow' | 'pageBorder'>, [string, string]> = {
  desk: ['--quire-desk', '#e9e9ec'],
  page: ['--quire-page', '#ffffff'],
  text: ['--quire-text', '#1d1d1f'],
  caret: ['--quire-caret', '#1d1d1f'],
  selection: ['--quire-selection', 'rgba(56, 132, 255, 0.28)'],
  selectionInactive: ['--quire-selection-inactive', 'rgba(0, 0, 0, 0.12)'],
  preedit: ['--quire-preedit', '#1d1d1f'],
  mark: ['--quire-mark', '#9a9aa2'],
  field: ['--quire-field', '#e4e4ea'],
  grip: ['--quire-grip', '#a1a1a6'],
  gripActive: ['--quire-grip-active', '#3884ff'],
  dropLine: ['--quire-drop-line', '#3884ff'],
  dragSource: ['--quire-drag-source', 'rgba(56, 132, 255, 0.10)'],
  tableBorder: ['--quire-table-border', '#8e8e93'],
  placeholder: ['--quire-placeholder', '#e9e9ec'],
  placeholderText: ['--quire-placeholder-text', '#6e6e73'],
  accent: ['--quire-accent', '#3884ff'],
};
export const PAGE_SHADOW_VAR = '--quire-page-shadow';
export const PAGE_BORDER_VAR = '--quire-page-border';

/**
 * 기본 테마들 (변수 값만). 클래식 = 쪽 중심 워드프로세서, 미니멀 = 장식 없는 편집기, 모던 = 얇은 테두리와 약한 그림자.
 * 다크에서도 쪽은 흰 종이다 (문서에 저장된 색을 그대로 그려도 읽힌다). `:where`로 특이도를 0으로 두어 앱 CSS가 이긴다
 */
export const THEME_CSS = `
:where(.quire) {
  --quire-desk: #e9e9ec; --quire-page: #ffffff; --quire-page-shadow: 0 1px 8px rgba(0, 0, 0, 0.12); --quire-page-border: none;
  --quire-text: #1d1d1f; --quire-caret: var(--quire-text); --quire-preedit: var(--quire-text);
  --quire-accent: #3884ff; --quire-selection: rgba(56, 132, 255, 0.28); --quire-selection-inactive: rgba(0, 0, 0, 0.12);
  --quire-mark: #9a9aa2; --quire-field: #e4e4ea; --quire-grip: #a1a1a6; --quire-grip-active: var(--quire-accent);
  --quire-drop-line: var(--quire-accent); --quire-drag-source: rgba(56, 132, 255, 0.10); --quire-table-border: #8e8e93;
  --quire-placeholder: #e9e9ec; --quire-placeholder-text: #6e6e73;
}
:where(.quire[data-quire-theme='minimal']) {
  --quire-desk: var(--quire-page); --quire-page-shadow: none; --quire-page-border: #e4e4e7;
  --quire-accent: #2f6feb; --quire-grip: #c4c4c8;
}
:where(.quire[data-quire-theme='modern']) {
  --quire-desk: #f4f4f5; --quire-page-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); --quire-page-border: #e4e4e7;
  --quire-accent: #18181b; --quire-selection: rgba(24, 24, 27, 0.14); --quire-table-border: #a1a1aa;
}
:where(.quire[data-quire-scheme='dark']) {
  --quire-desk: #1f1f23; --quire-page-shadow: 0 1px 10px rgba(0, 0, 0, 0.6); --quire-selection-inactive: rgba(0, 0, 0, 0.18);
  --quire-grip: #6e6e76; --quire-placeholder: #2a2a30; --quire-placeholder-text: #a1a1aa;
}
:where(.quire[data-quire-theme='minimal'][data-quire-scheme='dark']) { --quire-page-border: #3f3f46; --quire-desk: #18181b; }
:where(.quire[data-quire-theme='modern'][data-quire-scheme='dark']) { --quire-desk: #18181b; --quire-page-border: #3f3f46; --quire-accent: #fafafa; --quire-selection: rgba(56, 132, 255, 0.28); }
`;

/** 기본 테마 스타일시트를 문서에 한 번 넣는다 (맨 앞: 앱 스타일시트가 뒤에 와서 이긴다) */
export function ensureThemeStyles(doc: Document = document): void {
  if (doc.querySelector('style[data-quire-themes]')) return;
  const style = doc.createElement('style');
  style.setAttribute('data-quire-themes', '');
  style.textContent = THEME_CSS;
  doc.head.prepend(style);
}

/** 호스트의 계산된 변수에서 색을 읽는다. probe는 색을 풀어 쓰는 숨긴 요소 */
export function readThemeColors(host: HTMLElement, probe: HTMLElement): ThemeColors {
  const cs = getComputedStyle(host);
  const raw = (name: string) => cs.getPropertyValue(name).trim();
  const resolve = (value: string, fallback: string): string => {
    if (!value) return fallback;
    probe.style.color = '';
    probe.style.color = value;
    if (!probe.style.color) return fallback; // 색이 아닌 값
    return getComputedStyle(probe).color || fallback;
  };
  const out = {} as ThemeColors;
  for (const [key, [name, def]] of Object.entries(THEME_TOKENS)) (out as unknown as Record<string, string>)[key] = resolve(raw(name), def);
  out.pageShadow = parseShadow(raw(PAGE_SHADOW_VAR), resolve) ?? (raw(PAGE_SHADOW_VAR) ? null : { color: 'rgba(0, 0, 0, 0.12)', blur: 8, offsetY: 1 });
  const border = raw(PAGE_BORDER_VAR);
  out.pageBorder = !border || border === 'none' ? null : resolve(border, '#d4d4d8');
  return out;
}

/** box-shadow 하나 (`x y blur color`, 여러 겹이면 첫 번째)를 캔버스 그림자로. none이면 null */
export function parseShadow(value: string, resolve: (v: string, fallback: string) => string): ThemeColors['pageShadow'] {
  const v = value.trim();
  if (!v || v === 'none') return null;
  const first = splitTopLevel(v)[0]!;
  // 색 부분: 함수(rgb(...) 등)나 #hex나 이름. 길이 부분: 숫자px
  const color = /(rgba?\([^)]*\)|hsla?\([^)]*\)|color-mix\(.*\)|oklch\([^)]*\)|#[0-9a-fA-F]{3,8}|\b[a-z]+\b)\s*$/.exec(first)?.[1] ?? /^(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/.exec(first)?.[1] ?? 'rgba(0,0,0,0.12)';
  const lengths = (first.replace(color, '').match(/-?\d*\.?\d+(px)?/g) ?? []).map((n) => parseFloat(n));
  return { color: resolve(color, 'rgba(0,0,0,0.12)'), offsetY: lengths[1] ?? 1, blur: lengths[2] ?? 8 };
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 변수를 읽기 전의 기본 색 (클래식 라이트) */
export function defaultThemeColors(): ThemeColors {
  const out = {} as ThemeColors;
  for (const [key, [, def]] of Object.entries(THEME_TOKENS)) (out as unknown as Record<string, string>)[key] = def;
  out.pageShadow = { color: 'rgba(0, 0, 0, 0.12)', blur: 8, offsetY: 1 };
  out.pageBorder = null;
  return out;
}

export function sameColors(a: ThemeColors | null, b: ThemeColors): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}
