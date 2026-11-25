import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Chrome from '../../components/Chrome';
import { serif } from '../../../lib/fonts';
import '../../globals.css';

export const metadata: Metadata = {
  title: { default: 'Quire: a web document editor with real pages', template: '%s · Quire' },
  description: 'A web document editor that typesets onto a canvas: real page layout, precise Korean typesetting, HWPX, DOCX and PDF, real-time collaboration.',
  alternates: { languages: { ko: '/' } },
};

export default function EnLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={serif.variable}>
      <body className="lang-en">
        <Chrome lang="en">{children}</Chrome>
      </body>
    </html>
  );
}
