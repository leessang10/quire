export type Lang = 'ko' | 'en';

/** 언어별 경로: 한국어는 /, 영어는 /en */
export const href = (lang: Lang, path: string) => (lang === 'en' ? `/en${path === '/' ? '' : path}` || '/en' : path);

/** 지금 경로의 다른 언어 경로 */
export function counterpart(pathname: string): { lang: Lang; path: string } {
  if (pathname === '/en' || pathname.startsWith('/en/')) return { lang: 'ko', path: pathname.slice(3) || '/' };
  return { lang: 'en', path: pathname === '/' ? '/en' : `/en${pathname}` };
}

/** 여러 화면이 같이 쓰는 문구 */
export const UI = {
  ko: {
    skip: '본문으로 건너뛰기',
    nav: { demo: '데모', examples: '예제', install: '설치', guide: '가이드', docs: '문서' },
    navLabel: '사이트',
    switchTo: 'English',
    switchLabel: 'Read in English',
    footerLicense: 'Quire는 MIT 라이선스입니다. 글꼴(Pretendard, Noto Sans KR)은 SIL OFL 1.1을 따릅니다.',
    changelog: '바뀐 것',
    colophon: '이 페이지는 Noto Serif KR로 짰습니다. 견본의 원고는 Quire가 Pretendard로 짭니다.',
    copy: '복사',
    copied: '복사함',
    command: '명령',
    code: '코드',
    loading: '에디터 불러오는 중…',
  },
  en: {
    skip: 'Skip to content',
    nav: { demo: 'Demo', examples: 'Examples', install: 'Install', guide: 'Guide', docs: 'Docs' },
    navLabel: 'Site',
    switchTo: '한국어',
    switchLabel: '한국어로 보기',
    footerLicense: 'Quire is MIT licensed. The fonts (Pretendard, Noto Sans KR) are under the SIL OFL 1.1.',
    changelog: 'Changelog',
    colophon: 'Set in Noto Serif KR. The specimen manuscripts are set by Quire in Pretendard.',
    copy: 'Copy',
    copied: 'Copied',
    command: 'command',
    code: 'code',
    loading: 'Loading the editor…',
  },
} as const;
