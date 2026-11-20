// 예제 5: Next.js App Router. 페이지(서버 컴포넌트)는 틀만 그리고, 에디터는 브라우저에서만 불러온다
import EditorLoader from './EditorLoader';

export default function Page() {
  return <EditorLoader />;
}
