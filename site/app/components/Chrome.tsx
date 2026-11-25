import type { ReactNode } from 'react';
import Link from 'next/link';
import { BookOpen, Code2 } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { GITHUB, NPM, doc } from '@/lib/links';
import { UI, href, type Lang } from '@/lib/i18n';
import { ThemeToggle } from './SiteTheme';
import LangSwitch from './LangSwitch';
import SiteNav from './SiteNav';

export default function Chrome({ lang, children }: { lang: Lang; children: ReactNode }) {
  const t = UI[lang];
  const home = href(lang, '/');
  const links = [
    { href: `${home}#demo`, label: t.nav.demo },
    { href: `${home}#examples`, label: t.nav.examples },
    { href: href(lang, '/guide'), label: t.nav.guide },
    { href: href(lang, '/docs'), label: t.nav.docs },
  ];

  return (
    <>
      <a className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:p-3" href="#main">
        {t.skip}
      </a>
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-sm">
        <div className="site-width grid grid-cols-[auto_1fr] items-center gap-x-4 sm:h-14 sm:grid-cols-[auto_1fr_auto] sm:gap-x-7">
          <Link href={home} className="col-start-1 row-start-1 flex h-14 shrink-0 items-center gap-2.5 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <BookOpen aria-hidden="true" className="size-4" />
            </span>
            Quire
          </Link>
          <SiteNav links={links} label={t.navLabel} />
          <div className="col-start-2 row-start-1 ml-auto flex shrink-0 items-center gap-1 sm:col-start-3">
            <a href={GITHUB} className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label="GitHub" title="GitHub">
              <Code2 />
            </a>
            <ThemeToggle lang={lang} />
            <span aria-hidden="true" className="mx-1 hidden h-4 border-l sm:block" />
            <LangSwitch lang={lang} />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>{children}</main>
      <footer className="border-t">
        <div className="site-width flex flex-wrap items-center justify-between gap-4 py-7 text-sm text-muted-foreground">
          <p><span className="font-semibold text-foreground">Quire</span> <span className="mx-1.5">·</span> <a href={doc('LICENSE')} className="hover:text-foreground">MIT License</a></p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <a href={GITHUB} className="hover:text-foreground">GitHub</a>
            <a href={NPM} className="hover:text-foreground">npm</a>
            <a href={doc('CHANGELOG.md')} className="hover:text-foreground">{t.changelog}</a>
          </div>
        </div>
      </footer>
    </>
  );
}
