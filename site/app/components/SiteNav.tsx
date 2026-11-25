'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export default function SiteNav({ links, label }: { links: { href: string; label: string }[]; label: string }) {
  const path = usePathname();

  return (
    <nav aria-label={label} className="col-span-2 row-start-2 flex min-w-0 items-center gap-5 overflow-x-auto whitespace-nowrap max-sm:border-t sm:col-span-1 sm:col-start-2 sm:row-start-1">
      {links.map((link) => (
        <Link key={link.href} href={link.href} aria-current={path === link.href ? 'page' : undefined}
          className={cn('py-2 text-sm text-muted-foreground hover:text-foreground', path === link.href && 'font-medium text-foreground')}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
