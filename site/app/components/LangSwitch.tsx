'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { UI, counterpart, type Lang } from '../../lib/i18n';

/** 같은 페이지의 다른 언어로 */
export default function LangSwitch({ lang }: { lang: Lang }) {
  const other = counterpart(usePathname() ?? '/');
  const t = UI[lang];
  return (
    <Link href={other.path} hrefLang={other.lang} lang={other.lang} aria-label={t.switchLabel} className={buttonVariants({ variant: 'ghost', className: 'px-2' })}>
      {t.switchTo}
    </Link>
  );
}
