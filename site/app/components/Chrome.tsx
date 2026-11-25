import type { ReactNode } from 'react';
import Link from 'next/link';
import LangSwitch from './LangSwitch';
import { GITHUB, NPM, doc } from '../../lib/links';
import { UI, href, type Lang } from '../../lib/i18n';

/** 머리(메뉴)·꼬리: 두 언어가 같이 쓴다 */
export default function Chrome({ lang, children }: { lang: Lang; children: ReactNode }) {
  const t = UI[lang];
  const home = href(lang, '/');
  const at = (hash: string) => `${home === '/' ? '' : home}/#${hash}`;
  return (
    <>
      <a className="skip" href="#main">
        {t.skip}
      </a>
      <header className="site-header">
        <nav className="wrap nav" aria-label={t.navLabel}>
          <Link href={home} className="brand">
            Quire
          </Link>
          <ul>
            <li>
              <Link href={at('demo')}>{t.nav.demo}</Link>
            </li>
            <li>
              <Link href={at('examples')}>{t.nav.examples}</Link>
            </li>
            <li>
              <Link href={at('install')}>{t.nav.install}</Link>
            </li>
            <li>
              <Link href={href(lang, '/guide')}>{t.nav.guide}</Link>
            </li>
            <li>
              <Link href={href(lang, '/docs')}>{t.nav.docs}</Link>
            </li>
            <li>
              <a href={GITHUB}>GitHub</a>
            </li>
            <li>
              <LangSwitch lang={lang} />
            </li>
          </ul>
        </nav>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="wrap">
          <p>{t.footerLicense}</p>
          <p>{t.colophon}</p>
          <p>
            <a href={GITHUB}>GitHub</a> · <a href={NPM}>npm</a> · <a href={doc('CHANGELOG.md')}>{t.changelog}</a>
          </p>
        </div>
      </footer>
    </>
  );
}
