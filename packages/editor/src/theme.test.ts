/**
 * 화면 테마 (17): 기본 색은 테마를 넣기 전 화면 색 그대로이고, 그림자 문법 한 겹을 캔버스 그림자로 읽는다.
 * (변수를 읽는 길은 브라우저에서 본다: getComputedStyle)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEME_ATTRIBUTES, THEME_CLASSES, THEME_CSS, THEME_TOKENS, THEME_VARIABLES, defaultThemeColors, parseShadow, remoteColorSlot, themeDeclarations } from './theme';

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

/** 기본 테마의 변수 → 값 (`:where(.quire)` 블록) */
function baseDeclarations(): Map<string, string> {
  const base = /:where\(\.quire\) \{([^}]*)\}/.exec(THEME_CSS)![1]!;
  const out = new Map<string, string>();
  for (const d of base.split(';')) {
    const m = /(--quire-[a-z0-9-]+)\s*:\s*(.+)/.exec(d.trim());
    if (m) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

describe('공개 이름 (17 §10.1, T-3)', () => {
  it('변수 이름이 고정 목록 그대로다 (바꾸면 판 올림과 옛 이름 읽기: §9 O-45)', () => {
    expect([...THEME_VARIABLES]).toEqual([
      '--quire-desk', '--quire-page', '--quire-page-shadow', '--quire-page-border', '--quire-text', '--quire-caret', '--quire-preedit',
      '--quire-accent', '--quire-selection', '--quire-selection-inactive', '--quire-mark', '--quire-field', '--quire-grip', '--quire-grip-active',
      '--quire-drop-line', '--quire-drag-source', '--quire-table-border', '--quire-placeholder', '--quire-placeholder-text',
      '--quire-remote-1', '--quire-remote-2', '--quire-remote-3', '--quire-remote-4', '--quire-remote-5', '--quire-remote-6', '--quire-remote-7', '--quire-remote-8',
    ]);
    expect(Object.values(THEME_CLASSES)).toEqual(['quire', 'quire-scroller', 'quire-canvas', 'quire-caret']);
    expect(Object.values(THEME_ATTRIBUTES)).toEqual(['data-quire-theme', 'data-quire-scheme', 'data-quire-page-view']);
  });

  it('편집기가 읽고 정의하는 변수는 모두 공개 목록에 있다', () => {
    const pub = new Set<string>(THEME_VARIABLES);
    for (const [name] of Object.values(THEME_TOKENS)) expect(pub.has(name), name).toBe(true);
    for (const m of THEME_CSS.matchAll(/(--quire-[a-z0-9-]+)\s*:/g)) expect(pub.has(m[1]!), m[1]).toBe(true);
    expect([...baseDeclarations().keys()].sort()).toEqual([...THEME_VARIABLES].sort());
  });

  it('tokens.scss의 맵이 공개 목록·기본값과 같다', () => {
    const scss = readFileSync('packages/editor/tokens.scss', 'utf8');
    const map = /\$quire-tokens: \(\n([\s\S]*?)\n\);/.exec(scss)![1]!;
    const entries = map.split('\n').map((l) => /^\s*([a-z0-9-]+): (.*),$/.exec(l)!).map((m) => [`--quire-${m[1]}`, m[2]!.replace(/^\((.*)\)$/, '$1')]);
    expect(entries.map(([k]) => k)).toEqual([...THEME_VARIABLES]);
    const base = baseDeclarations();
    for (const [k, v] of entries) expect(v, k).toBe(base.get(k!));
  });

  it('설계 문서 표가 공개 목록과 같다', () => {
    const doc = readFileSync('docs/design/17-themes.md', 'utf8');
    const sec = doc.slice(doc.indexOf('### 10.1'));
    const rows = [...sec.matchAll(/^\| `(--quire-[a-z0-9-]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual([...THEME_VARIABLES]);
  });

  it('themeDeclarations', () => {
    expect(themeDeclarations({ '--quire-accent': '#e11d48', '--quire-page': '', '--quire-text': undefined })).toBe('--quire-accent: #e11d48;');
  });
});

describe('협업 팔레트 (O-42)', () => {
  it('번호 1–8의 변수가 있고, 라이트·다크 둘 다 정의한다', () => {
    const base = baseDeclarations();
    const dark = /:where\(\.quire\[data-quire-scheme='dark'\]\) \{([^}]*)\}/.exec(THEME_CSS)![1]!;
    for (let i = 1; i <= 8; i++) {
      expect(base.get(`--quire-remote-${i}`), `light ${i}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark, `dark ${i}`).toContain(`--quire-remote-${i}:`);
    }
    expect(defaultThemeColors().remote).toHaveLength(8);
  });

  it('remoteColorSlot: 같은 id는 늘 같은 번호, 1–8에 고루 퍼진다', () => {
    expect(remoteColorSlot('alice')).toBe(remoteColorSlot('alice'));
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const n = remoteColorSlot(`user-${i}`);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(8);
      seen.add(n);
    }
    expect(seen.size).toBe(8);
  });
});
