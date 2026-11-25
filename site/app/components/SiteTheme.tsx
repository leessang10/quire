'use client';

import { Moon, Sun } from 'lucide-react';
import { ThemeProvider, useTheme } from 'next-themes';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { Lang } from '@/lib/i18n';

export default function SiteTheme({ children }: { children: ReactNode }) {
  return <ThemeProvider attribute="class" disableTransitionOnChange>{children}</ThemeProvider>;
}

export function ThemeToggle({ lang }: { lang: Lang }) {
  const { resolvedTheme, setTheme } = useTheme();
  const label = lang === 'ko' ? '밝은 화면과 어두운 화면 전환' : 'Toggle light and dark mode';

  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label}
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
      <Sun className="dark:hidden" />
      <Moon className="hidden dark:block" />
    </Button>
  );
}
