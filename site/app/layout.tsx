import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { GITHUB, NPM, doc } from '../lib/links';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Quire: 웹에서 쓰는 한글 문서 편집기', template: '%s · Quire' },
  description: '캔버스에 직접 조판하는 웹 문서 편집기. 실제 쪽 나눔, 정밀한 한글 조판, HWPX·DOCX·PDF, 실시간 협업.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <a className="skip" href="#main">
          본문으로 건너뛰기
        </a>
        <header className="site-header">
          <nav className="wrap nav" aria-label="사이트">
            <Link href="/" className="brand">
              Quire
            </Link>
            <ul>
              <li>
                <Link href="/#demo">데모</Link>
              </li>
              <li>
                <Link href="/#examples">예제</Link>
              </li>
              <li>
                <Link href="/#install">설치</Link>
              </li>
              <li>
                <Link href="/guide">가이드</Link>
              </li>
              <li>
                <Link href="/#docs">문서</Link>
              </li>
              <li>
                <a href={GITHUB}>GitHub</a>
              </li>
            </ul>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <div className="wrap">
            <p>
              Quire는 MIT 라이선스입니다. 글꼴(Pretendard, Noto Sans KR)은 SIL OFL 1.1을 따릅니다.
            </p>
            <p>
              <a href={GITHUB}>GitHub</a> · <a href={NPM}>npm</a> · <a href={doc('CHANGELOG.md')}>바뀐 것</a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
