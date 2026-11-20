import type { ReactNode } from 'react';
import StyledComponentsRegistry from '../lib/registry';

export const metadata = { title: 'Quire 예제 · Next.js + styled-components' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0 }}>
        <StyledComponentsRegistry>{children}</StyledComponentsRegistry>
      </body>
    </html>
  );
}
