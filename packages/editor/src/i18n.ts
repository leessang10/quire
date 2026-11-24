/**
 * UI 다국어 (18): 메시지 키 → 그 언어의 문장. 편집기 화면 문자열(캔버스 표시, 접근성 이름, 메뉴)은 모두 여기를 거친다.
 * 문서는 바꾸지 않는다: 저장되는 이름(스타일 h1, 구역 시작 방식)은 키이고, 보일 때만 번역한다 (18 §2).
 */
import { ko, type MessageKey } from './i18n/ko';

export type { MessageKey };

/** 한 언어의 메시지 (키 단위 덮어쓰기: 일부만 줘도 된다) */
export type MessageTable = Partial<Record<MessageKey, string>> & Record<string, string>;
/** 자리표시 값 */
export type MessageParams = Record<string, string | number>;
/** 번역 함수 (앱·플러그인이 같은 번역을 쓸 때) */
export type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * 불러온 내장 언어 (18 §5). 한국어만 편집기 묶음에 들어 있고, 다른 언어는 필요할 때 따로 받는다
 * (`loadMessages`: 번들러가 언어마다 조각을 나눈다) 또는 앱이 직접 넣는다 (`registerMessages`, `@quire/editor/i18n/en`).
 */
const registry: Record<string, Readonly<Record<string, string>>> = { ko };
/** 내장 언어 표가 바뀐 횟수 (이미 만든 Messages가 찾는 순서를 다시 만든다) */
let registryVersion = 0;
export const BUILTIN_MESSAGES: Readonly<Record<string, Readonly<Record<string, string>>>> = registry;

/** 따로 받는 내장 언어 */
const LOADERS: Record<string, () => Promise<Readonly<Record<string, string>>>> = {
  en: () => import('./i18n/en').then((m) => m.en),
};
const loading = new Map<string, Promise<void>>();

/** 내장 언어 표를 넣는다 (정적으로 가져온 `@quire/editor/i18n/en` 등). 이미 만든 편집기·Messages도 다음 번역부터 쓴다 */
export function registerMessages(locale: string, table: Readonly<Record<string, string>>): void {
  registry[candidates(locale)[0]!] = table;
  registryVersion++;
}

/**
 * 이 언어에 필요한 내장 표: 그 언어(앞부분까지) 중 따로 받는 것. 편집기가 싣지 않는 언어(fr 등)는 빠진 키를 영어로 채우므로
 * 영어도. 한국어는 한국어 표만 (영어를 받지 않는다)
 */
function needed(locale: string): string[] {
  const tags = candidates(locale);
  const known = tags.some((l) => l === DEFAULT_LOCALE || LOADERS[l]);
  return [...new Set(known ? tags : [...tags, FALLBACK_LOCALE])].filter((l) => LOADERS[l]);
}

/** 이 언어에 필요한 내장 표를 다 받았는가 */
export function messagesLoaded(locale: string): boolean {
  return needed(locale).every((l) => registry[l]);
}

/**
 * 이 언어의 내장 표를 받는다 (없으면 그대로). 새로 받은 것이 있으면 true.
 * 편집기는 `locale`·`setLocale`에서 알아서 부르고 다 받으면 다시 그린다. 앱 UI가 편집기 키를 같이 쓸 때 앱이 불러 기다린다
 */
export async function loadMessages(locale: string): Promise<boolean> {
  const need = needed(locale).filter((l) => !registry[l]);
  if (!need.length) return false;
  await Promise.all(
    need.map((l) => {
      let p = loading.get(l);
      if (!p) {
        p = LOADERS[l]!().then((t) => {
          if (!registry[l]) registerMessages(l, t);
        });
        p.catch(() => loading.delete(l)); // 실패하면 다음에 다시
        loading.set(l, p);
      }
      return p;
    }),
  );
  return true;
}
/** 기본 UI 언어 (정하지 않으면 navigator.language가 아니라 이것: 언어는 임베드하는 앱이 정한다, 18 §5) */
export const DEFAULT_LOCALE = 'ko';
/** 빠진 키의 두 번째 후보 */
const FALLBACK_LOCALE = 'en';

const warned = new Set<string>();

/** 언어 태그의 후보: en-GB → en-GB, en (대소문자는 표준 모양으로) */
function candidates(locale: string): string[] {
  let tag = locale;
  try {
    tag = Intl.getCanonicalLocales(locale)[0] ?? locale;
  } catch {
    // 잘못된 태그면 그대로 찾는다
  }
  const out = [tag];
  const base = tag.split('-')[0]!;
  if (base !== tag) out.push(base);
  return out;
}

/**
 * 메시지 사전: 언어를 고르고 키를 문장으로 바꾼다.
 * 찾는 순서 (18 §2): 그 언어(덮어쓰기 → 내장) → 앞부분 언어(en-GB → en) → 영어 → 한국어 → 키 이름.
 */
export class Messages {
  private chain: Array<Readonly<Record<string, string>>> = [];
  private tag = DEFAULT_LOCALE;
  private builtAt = -1;

  constructor(
    locale: string = DEFAULT_LOCALE,
    private readonly extra: Readonly<Record<string, MessageTable>> = {},
  ) {
    this.setLocale(locale);
  }

  /** 지금 언어 (BCP 47) */
  get locale(): string {
    return this.tag;
  }

  /** 언어를 바꾼다. 실제로 바뀌었으면 true */
  setLocale(locale: string): boolean {
    const tags = candidates(locale || DEFAULT_LOCALE);
    const changed = tags[0] !== this.tag || !this.chain.length;
    this.tag = tags[0]!;
    const order = [...tags, FALLBACK_LOCALE, DEFAULT_LOCALE];
    const chain: Array<Readonly<Record<string, string>>> = [];
    for (const l of order) {
      const add = this.extra[l];
      if (add && !chain.includes(add)) chain.push(add);
      const builtin = BUILTIN_MESSAGES[l];
      if (builtin && !chain.includes(builtin)) chain.push(builtin);
    }
    this.chain = chain;
    this.builtAt = registryVersion;
    return changed;
  }

  /** 지금 언어(앞부분까지)에 이 키가 있는가 */
  has(key: string): boolean {
    return candidates(this.tag).some((l) => key in (this.extra[l] ?? {}) || key in (BUILTIN_MESSAGES[l] ?? {}));
  }

  /** 키 → 문장. 지금 언어에 없으면 대신한 언어로 (개발자 콘솔에 키마다 한 번 경고) */
  t = (key: MessageKey | string, params?: MessageParams): string => {
    if (this.builtAt !== registryVersion) this.setLocale(this.tag); // 그 사이 받은 언어를 찾는 순서에 넣는다
    let template: string | undefined;
    for (const table of this.chain) {
      const v = table[key];
      if (typeof v === 'string') {
        template = v;
        break;
      }
    }
    if (!this.has(key) && messagesLoaded(this.tag)) {
      const id = `${this.tag}:${key}`;
      if (!warned.has(id)) {
        warned.add(id);
        console.warn(`[quire] missing message "${key}" for locale "${this.tag}"${template === undefined ? '' : ' (using a fallback)'}`);
      }
    }
    return template === undefined ? key : formatMessage(template, params, this.tag);
  };
}

/**
 * 자리표시 채우기: {name}은 값으로 (숫자는 그 언어의 숫자 모양), {n, plural, one {…} other {…}}는 Intl.PluralRules로
 * 고른 갈래 (=0 같은 정확한 값 갈래도 된다), 갈래 안의 #은 그 수. 값이 없는 자리표시는 그대로 둔다.
 */
export function formatMessage(template: string, params: MessageParams = {}, locale: string = DEFAULT_LOCALE): string {
  const num = (v: number) => {
    try {
      return new Intl.NumberFormat(locale).format(v);
    } catch {
      return String(v);
    }
  };
  const show = (v: string | number) => (typeof v === 'number' ? num(v) : v);
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const close = matching(template, open);
    if (close < 0) {
      out += template.slice(open);
      break;
    }
    const body = template.slice(open + 1, close);
    const plural = /^\s*(\w+)\s*,\s*plural\s*,/.exec(body);
    if (plural) {
      const name = plural[1]!;
      const value = Number(params[name]);
      const branch = pluralBranch(body.slice(plural[0].length), value, locale);
      out += branch === null ? template.slice(open, close + 1) : formatMessage(branch.replace(/#/g, num(value)), params, locale);
    } else {
      const name = body.trim();
      out += name in params ? show(params[name]!) : template.slice(open, close + 1);
    }
    i = close + 1;
  }
  return out;
}

/** 여는 중괄호의 짝 (없으면 -1) */
function matching(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** 복수형 갈래들("one {…} other {…}")에서 값에 맞는 것: =값 → 그 언어의 범주 → other */
function pluralBranch(cases: string, value: number, locale: string): string | null {
  const branches = new Map<string, string>();
  let i = 0;
  while (i < cases.length) {
    const m = /\s*(=?[\w.-]+)\s*\{/y;
    m.lastIndex = i;
    const hit = m.exec(cases);
    if (!hit) break;
    const open = m.lastIndex - 1;
    const close = matching(cases, open);
    if (close < 0) break;
    branches.set(hit[1]!, cases.slice(open + 1, close));
    i = close + 1;
  }
  if (!Number.isFinite(value)) return branches.get('other') ?? null;
  let category = 'other';
  try {
    category = new Intl.PluralRules(locale).select(value);
  } catch {
    // 모르는 언어면 other
  }
  return branches.get(`=${value}`) ?? branches.get(category) ?? branches.get('other') ?? null;
}
