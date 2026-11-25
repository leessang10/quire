import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Chrome from '../../components/Chrome';
import SiteTheme from '../../components/SiteTheme';
import '../../globals.css';

export const metadata: Metadata = {
  title: { default: 'Quire: a web document editor with real pages', template: '%s · Quire' },
  description: 'A web document editor that typesets onto a canvas: real page layout, precise Korean typesetting, HWPX, DOCX and PDF, real-time collaboration.',
  alternates: { languages: { ko: '/' } },
};

export default function EnLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <SiteTheme><Chrome lang="en">{children}</Chrome></SiteTheme>
      </body>
    </html>
  );
}
