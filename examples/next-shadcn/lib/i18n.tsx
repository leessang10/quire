'use client';
/**
 * 앱 다국어: 편집기의 메시지 장치(Messages)에 앱 메시지 표를 덧붙여 쓴다 (설계 18 §5).
 * 그래서 t()는 앱 키와 편집기 키(attr.bold, section.nextPage 등)를 모두 안다. 언어는 이 예제가 정하고
 * (편집기 기본은 ko), 고른 언어는 브라우저에 기억한다. 편집기 쪽은 QuireApp이 setLocale로 맞춘다.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Messages, type MessageKey, type MessageParams } from '@quire/editor';
import { en, ko, type AppMessageKey } from './messages';

export type Locale = 'ko' | 'en';
export const LOCALES: Array<{ id: Locale; label: string }> = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
];
export type T = (key: AppMessageKey | MessageKey, params?: MessageParams) => string;

const STORE = 'quire-example-locale';

/** 처음 언어: 기억한 것, 없으면 ?lang=, 없으면 한국어 */
export function initialLocale(): Locale {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'ko' || q === 'en') return q;
    const s = localStorage.getItem(STORE);
    if (s === 'ko' || s === 'en') return s;
  } catch {
    // 저장소를 못 쓰면 기본
  }
  return 'ko';
}

interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: T;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ locale, onChange, children }: { locale: Locale; onChange: (l: Locale) => void; children: ReactNode }) {
  const messages = useMemo(() => new Messages(locale, { ko, en }), [locale]);
  const t = useCallback<T>((key, params) => messages.t(key, params), [messages]);
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORE, locale);
    } catch {
      // 기억하지 못해도 화면은 바뀐다
    }
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale: onChange, t }), [locale, onChange, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n: I18nProvider 밖');
  return v;
}

export const useT = (): T => useI18n().t;
