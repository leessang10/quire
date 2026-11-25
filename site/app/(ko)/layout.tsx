import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Chrome from '../components/Chrome';
import SiteTheme from '../components/SiteTheme';
import '../globals.css';

export const metadata: Metadata = {
  title: { default: 'Quire: 웹에서 쓰는 한글 문서 편집기', template: '%s · Quire' },
  description: '캔버스에 직접 조판하는 웹 문서 편집기. 실제 쪽 나눔, 정밀한 한글 조판, HWPX·DOCX·PDF, 실시간 협업.',
  alternates: { languages: { en: '/en' } },
};

export default function KoLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>
        <SiteTheme><Chrome lang="ko">{children}</Chrome></SiteTheme>
      </body>
    </html>
  );
}
