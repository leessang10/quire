'use client';
// 캔버스·IME 코드는 서버에서 돌 필요가 없다: 브라우저에서만 불러온다
import dynamic from 'next/dynamic';

const DemoEditor = dynamic(() => import('./DemoEditor'), {
  ssr: false,
  loading: () => (
    <div className="demo demo-loading" aria-busy="true">
      에디터 불러오는 중…
    </div>
  ),
});

export default function Demo() {
  return <DemoEditor />;
}
