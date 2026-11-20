/**
 * UI 다국어 (18): 키 집합, 찾는 순서, 자리표시·복수형, 편집기 소스에 화면 문자열이 남지 않았는지 (L1).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_MESSAGES, Messages, formatMessage } from './i18n';
import { en } from './i18n/en';
import { ko } from './i18n/ko';

afterEach(() => vi.restoreAllMocks());

describe('메시지 파일', () => {
  it('언어마다 키 집합이 같다', () => {
    const keys = Object.keys(ko).sort();
    for (const [locale, table] of Object.entries(BUILTIN_MESSAGES)) expect(Object.keys(table).sort(), locale).toEqual(keys);
  });

  it('키는 점으로 나눈 영어 이름이다', () => {
    for (const k of Object.keys(ko)) expect(k).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
  });

  it('설계 문서의 키 표(18 §9.1)가 메시지 파일과 같다 (L-4)', () => {
    const doc = readFileSync('docs/design/18-i18n.md', 'utf8');
    const table = doc.slice(doc.indexOf('### 9.1'));
    const keys = [...table.matchAll(/^\| `([\w.]+)` \|/gm)].map((m) => m[1]);
    expect(keys).toEqual(Object.keys(ko));
  });

  it('언어마다 자리표시 이름이 같다', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(ko) as Array<keyof typeof ko>) expect(names(en[k]), k).toEqual(names(ko[k]));
  });
});

describe('Messages', () => {
  it('기본 언어는 한국어', () => {
    const m = new Messages();
    expect(m.locale).toBe('ko');
    expect(m.t('break.page')).toBe('쪽 나눔');
  });

  it('언어를 바꾸면 그 언어로, 바뀌었는지 알려 준다', () => {
    const m = new Messages('ko');
    expect(m.setLocale('en')).toBe(true);
    expect(m.t('break.page')).toBe('Page break');
    expect(m.setLocale('en')).toBe(false);
  });

  it('정확한 언어가 없으면 앞부분으로 (en-GB → en), 태그는 표준 모양으로', () => {
    const m = new Messages('en-gb');
    expect(m.locale).toBe('en-GB');
    expect(m.t('break.page')).toBe('Page break');
  });

  it('덮어쓰기는 키 단위, 지역 언어의 덮어쓰기가 앞부분 언어보다 먼저', () => {
    const m = new Messages('en-GB', { en: { 'break.page': 'Page Break' }, 'en-GB': { 'image.loading': 'Loading (GB)…' } });
    expect(m.t('break.page')).toBe('Page Break');
    expect(m.t('image.loading')).toBe('Loading (GB)…');
    expect(m.t('break.column')).toBe('Column break');
  });

  it('없는 언어는 영어로 대신하고 키마다 한 번 경고한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = new Messages('xx');
    expect(m.t('break.page')).toBe('Page break');
    m.t('break.page');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('추가 언어: 빠진 키만 영어로', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = new Messages('ja', { ja: { 'break.page': '改ページ' } });
    expect(m.t('break.page')).toBe('改ページ');
    expect(m.t('break.column')).toBe('Column break');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('어디에도 없는 키는 키 이름 그대로', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(new Messages().t('no.such.key' as never)).toBe('no.such.key');
  });

  it('t는 떼어 써도 된다', () => {
    const { t } = new Messages('en');
    expect(t('break.section', { start: 'Next page' })).toBe('Section break (Next page)');
  });
});

describe('formatMessage', () => {
  it('자리표시를 채우고, 없는 값은 그대로 둔다', () => {
    expect(formatMessage('{a} · {b}', { a: '가' })).toBe('가 · {b}');
  });

  it('숫자는 그 언어의 숫자 모양으로', () => {
    expect(formatMessage('{n}', { n: 12345 }, 'en')).toBe('12,345');
    expect(formatMessage('{n}', { n: 12345 }, 'de')).toBe('12.345');
  });

  it('복수형: 그 언어의 범주, 정확한 값 갈래, # 은 그 수', () => {
    const msg = '{count, plural, =0 {no pages} one {# page} other {# pages}}';
    expect(formatMessage(msg, { count: 0 }, 'en')).toBe('no pages');
    expect(formatMessage(msg, { count: 1 }, 'en')).toBe('1 page');
    expect(formatMessage(msg, { count: 1200 }, 'en')).toBe('1,200 pages');
    // 한국어는 복수형이 없어 other
    expect(formatMessage('{count, plural, one {#쪽 (하나)} other {#쪽}}', { count: 1 }, 'ko')).toBe('1쪽');
  });

  it('복수형 갈래 안에서도 자리표시를 채운다', () => {
    expect(formatMessage('{n, plural, one {# {what}} other {# {what}s}}', { n: 2, what: 'table' }, 'en')).toBe('2 tables');
  });
});

/** 주석을 건너뛴 문자열 리터럴 (따옴표·템플릿 조각, ${…} 안도). 정규식 리터럴은 건너뛴다 */
function literals(src: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const regexCanStart = (at: number) => {
    let j = at - 1;
    while (j >= 0 && /\s/.test(src[j]!)) j--;
    if (j < 0 || '(,=:[!&|?{};+-*%<>~^'.includes(src[j]!)) return true;
    const word = /[A-Za-z_$]+$/.exec(src.slice(Math.max(0, j - 10), j + 1));
    return !!word && ['return', 'typeof', 'case', 'of', 'in', 'void', 'yield', 'await', 'delete'].includes(word[0]);
  };
  const scan = (stop: string | null): void => {
    while (i < n) {
      const c = src[i]!;
      if (stop === '}' && c === '}') return;
      if (c === '\n') line++;
      if (c === '{' && stop === '}') {
        i++;
        scan('}');
        i++;
        continue;
      }
      if (c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) if (src[i++] === '\n') line++;
        i += 2;
        continue;
      }
      if (c === '/' && regexCanStart(i)) {
        let cls = false;
        i++;
        while (i < n && src[i] !== '\n') {
          if (src[i] === '\\') i += 2;
          else if (src[i] === '[') (cls = true), i++;
          else if (src[i] === ']') (cls = false), i++;
          else if (src[i] === '/' && !cls) break;
          else i++;
        }
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const start = line;
        let s = '';
        i++;
        while (i < n && src[i] !== c) {
          if (src[i] === '\\') {
            s += src.slice(i, i + 2);
            i += 2;
          } else if (c === '`' && src[i] === '$' && src[i + 1] === '{') {
            i += 2;
            s += '{}';
            scan('}');
            i++;
          } else {
            if (src[i] === '\n') line++;
            s += src[i++];
          }
        }
        i++;
        out.push({ line: start, text: s });
        continue;
      }
      i++;
    }
  };
  scan(null);
  return out;
}

describe('편집기 소스 (L1)', () => {
  /** 화면 문자열이 아닌 한글 (파일: 글) */
  const ALLOWED = new Set([
    'editor.ts:가', // 글꼴 상자를 재는 글자
    'reference.ts:[표]', // 레이아웃 요약(시험 기준 파일)의 표 줄 표시
    // 가져오기 보고(@quire/convert와 같은 문구)는 변환 패키지와 함께 옮긴다 (18 §7 L-5)
    'clipboard.ts:위험한 링크',
    'clipboard.ts:이미지 (외부 주소)',
    ...['가로줄', '내장 문서', '동영상', '소리', 'SVG 그림', '캔버스', '내장 개체', '입력 양식', '수식'].map((w) => `clipboard.ts:${w}`),
  ]);

  it('literals는 주석·정규식을 건너뛰고 템플릿 안까지 본다', () => {
    const src = "// '주석'\nconst a = /'[가]/; /* '여기도' */\nconst b = `x ${c ? '안' : 'y'} z`;\n";
    expect(literals(src).map((l) => l.text)).toEqual(['안', 'y', 'x {} z']);
  });

  it('한글 화면 문자열 리터럴이 없다 (메시지 키로)', () => {
    const dir = 'packages/editor/src';
    const found: string[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      for (const l of literals(readFileSync(join(dir, f), 'utf8')))
        if (/[가-힣]/.test(l.text) && !ALLOWED.has(`${f}:${l.text}`)) found.push(`${f}:${l.line}: ${l.text}`);
    }
    expect(found).toEqual([]);
  });
});
