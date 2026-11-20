'use client';
// 캔버스·IME 코드는 서버에서 돌 필요가 없다: ssr: false로 브라우저에서만 불러온다 (08 §5)
import dynamic from 'next/dynamic';

const QuireApp = dynamic(() => import('./QuireApp'), { ssr: false, loading: () => <p style={{ padding: 16 }}>에디터 불러오는 중…</p> });

export default function EditorLoader() {
  return <QuireApp />;
}
