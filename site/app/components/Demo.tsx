'use client';
// 캔버스·IME 코드는 서버에서 돌 필요가 없다: 브라우저에서만 불러온다
import dynamic from 'next/dynamic';
import { UI, type Lang } from '../../lib/i18n';

const loading = (lang: Lang) =>
  function Loading() {
    return (
      <div className="demo demo-loading" aria-busy="true">
        {UI[lang].loading}
      </div>
    );
  };

const DemoKo = dynamic(() => import('./DemoEditor'), { ssr: false, loading: loading('ko') });
const DemoEn = dynamic(() => import('./DemoEditor'), { ssr: false, loading: loading('en') });

export default function Demo({ lang }: { lang: Lang }) {
  return lang === 'en' ? <DemoEn lang="en" /> : <DemoKo lang="ko" />;
}
