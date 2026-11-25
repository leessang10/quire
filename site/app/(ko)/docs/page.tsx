import type { Metadata } from 'next';
import Docs from '../../components/Docs';

export const metadata: Metadata = { title: 'API 문서', description: 'Quire 0.2 공개 API: 편집기 옵션, 명령, 상태, React, 저장, 변환, PDF, 플러그인, 테마, 언어, 협업.' };

export default function Page() {
  return <Docs lang="ko" />;
}
