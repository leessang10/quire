import Link from 'next/link';
import { BookOpen, Code2, LayoutGrid, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { href, type Lang } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Section = readonly [id: string, title: ReactNode];

export default function DocsLayout({
  lang,
  page,
  sections,
  children,
}: {
  lang: Lang;
  page: '/guide' | '/docs';
  sections: readonly Section[];
  children: ReactNode;
}) {
  const ko = lang === 'ko';
  const contents = ko ? '이 페이지에서' : 'On this page';
  const links = [
    { href: `${href(lang, '/')}#install`, icon: Terminal, label: ko ? '설치' : 'Installation' },
    { href: href(lang, '/guide'), icon: BookOpen, label: ko ? '시작 가이드' : 'Getting started' },
    { href: href(lang, '/docs'), icon: Code2, label: ko ? 'API 문서' : 'API reference' },
    { href: `${href(lang, '/')}#examples`, icon: LayoutGrid, label: ko ? '예제 앱' : 'Example apps' },
  ];
  const sectionLinks = sections.map(([id, title]) => (
    <li key={id}>
      <a href={`#${id}`} className="block rounded-sm py-1.5 leading-snug hover:text-foreground">{title}</a>
    </li>
  ));

  return (
    <div className="site-width grid min-w-0 gap-6 py-7 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8 md:py-10 lg:grid-cols-[10rem_minmax(0,1fr)_9.5rem] lg:gap-9">
      <nav aria-label={ko ? '문서 탐색' : 'Documentation'} className="flex flex-wrap items-center gap-1 self-start md:sticky md:top-20 md:col-start-1 md:row-start-1 md:row-span-2 md:flex-col md:items-stretch lg:row-span-1">
        {links.map(({ href: target, icon: Icon, label }) => {
          const active = target === href(lang, page);
          return (
            <Link key={target} href={target} aria-current={active ? 'page' : undefined}
              className={cn('flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground', active && 'bg-muted font-medium text-foreground')}>
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
      <details className="rounded-lg border px-3.5 text-sm md:col-start-2 lg:hidden">
        <summary className="cursor-pointer py-2.5 font-medium">{contents}</summary>
        <ul className="max-h-64 overflow-y-auto pb-2 text-muted-foreground">{sectionLinks}</ul>
      </details>
      <article className="docs-prose min-w-0 md:col-start-2 lg:row-start-1">{children}</article>
      <nav aria-label={contents} className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] overflow-y-auto self-start text-sm lg:col-start-3 lg:row-start-1 lg:block">
        <p className="mb-2 font-medium">{contents}</p>
        <ul className="text-muted-foreground">{sectionLinks}</ul>
      </nav>
    </div>
  );
}
