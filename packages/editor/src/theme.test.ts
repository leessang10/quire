/**
 * 화면 테마 (17): 기본 색은 테마를 넣기 전 화면 색 그대로이고, 그림자 문법 한 겹을 캔버스 그림자로 읽는다.
 * (변수를 읽는 길은 브라우저에서 본다: getComputedStyle)
 */
import { describe, expect, it } from 'vitest';
import { THEME_CSS, THEME_TOKENS, defaultThemeColors, parseShadow } from './theme';

const id = (v: string) => v;

describe('theme (17)', () => {
  it('defaults are the colors the editor drew before themes', () => {
    const c = defaultThemeColors();
    expect([c.desk, c.page, c.text, c.selection, c.selectionInactive]).toEqual(['#e9e9ec', '#ffffff', '#1d1d1f', 'rgba(56, 132, 255, 0.28)', 'rgba(0, 0, 0, 0.12)']);
    expect(c.pageShadow).toEqual({ color: 'rgba(0, 0, 0, 0.12)', blur: 8, offsetY: 1 });
    expect(c.pageBorder).toBeNull();
  });

  it('reads one box-shadow layer', () => {
    expect(parseShadow('none', id)).toBeNull();
    expect(parseShadow('', id)).toBeNull();
    expect(parseShadow('0 1px 8px rgba(0, 0, 0, 0.12)', id)).toEqual({ color: 'rgba(0, 0, 0, 0.12)', offsetY: 1, blur: 8 });
    expect(parseShadow('0 2px 6px #00000033, 0 0 1px red', id)).toEqual({ color: '#00000033', offsetY: 2, blur: 6 });
    expect(parseShadow('rgb(0 0 0 / .2) 0 4px 12px', id)).toEqual({ color: 'rgb(0 0 0 / .2)', offsetY: 4, blur: 12 });
  });

  it('the built-in stylesheet defines every token for the default theme', () => {
    const base = /:where\(\.quire\) \{([^}]*)\}/.exec(THEME_CSS)![1]!;
    for (const [name] of Object.values(THEME_TOKENS)) if (name !== '--quire-accent' || base.includes(name)) expect(base, name).toContain(name);
    expect(base).toContain('--quire-page-shadow');
    // 테마는 문서 모양(글꼴·크기·여백)을 열지 않는다 (17 §2)
    expect(THEME_CSS).not.toMatch(/font-size|margin|line-height/);
  });
});
