import Link from 'next/link';
import Code from './components/Code';
import Demo from './components/Demo';
import { GITHUB, NPM, doc, tree } from '../lib/links';

const FEATURES = [
  { title: '실제 쪽 나눔', body: '화면에서 본 쪽이 PDF와 인쇄에서도 같습니다. 머리말·꼬리말, 다단, 각주, 표가 쪽을 넘어갑니다.' },
  { title: '정밀한 한글 조판', body: '어절 단위 줄바꿈, 금칙 문장부호, 양쪽 맞춤의 고른 간격. 글꼴 모양을 직접 잡아 캔버스에 그립니다.' },
  { title: '입력기를 끝까지', body: '조합 중인 한글, 한자 변환, 두 번 눌린 Enter 같은 실제 Windows·macOS 입력기의 동작을 따로 다룹니다.' },
  { title: 'HWPX·DOCX·PDF', body: '한글과 워드 문서를 열고 저장합니다. PDF는 쓴 글자만 담은 글꼴을 넣어 작게 만듭니다. 서버가 필요 없습니다.' },
  { title: '큰 문서', body: '보이는 쪽만 그리고 바뀐 문단만 다시 조판합니다. 수백 쪽 문서에서도 입력이 밀리지 않습니다.' },
  { title: '필요한 것만 조립', body: '@quiredoc/core 하나로 시작하고, React·변환·PDF·협업은 쓸 때만 더합니다. 기본 앱의 시작 JS는 수백 KB입니다.' },
];

const PACKAGES = [
  { name: '@quiredoc/core', role: '편집기·조판·문서 모델·.quire 파일. 항상 필요합니다.' },
  { name: '@quiredoc/react', role: 'React 훅과 컴포넌트 (useQuire, QuireEditor, useEditorState)' },
  { name: '@quiredoc/convert', role: 'HWPX·DOCX·Markdown·HTML 가져오기·내보내기' },
  { name: '@quiredoc/pdf', role: '글꼴을 넣은 PDF 내보내기 (브라우저·Node)' },
  { name: '@quiredoc/fonts', role: 'Pretendard·Noto Sans KR 글꼴 조각 (공개 폴더에 복사)' },
  { name: '@quiredoc/collab', role: '실시간 협업(CRDT), 접속자 표시, 버전 기록' },
];

const DOCS = [
  { href: doc('README.md'), title: 'README', body: '전체 소개와 설치' },
  { href: tree('examples'), title: '예제 앱 10개', body: 'React·Next.js·Vue·Svelte·바닐라·Node' },
  { href: doc('docs/design/08-integration.md'), title: '앱에 넣기', body: 'SDK, 프레임워크 연결, 서버 렌더링' },
  { href: doc('docs/design/15-ecosystem.md'), title: '플러그인 API', body: '명령, 그리기 층, 상태 구독' },
  { href: doc('docs/design/17-themes.md'), title: '테마', body: '색·글꼴 변수, 다크 모드' },
  { href: doc('docs/design/07-file-format.md'), title: '파일 형식', body: '.quire와 정본 JSON' },
  { href: doc('docs/design/19-packages.md'), title: '패키지 구성', body: 'core와 모듈, 0.1.0에서 옮기기' },
  { href: doc('CHANGELOG.md'), title: '바뀐 것', body: '판마다 달라진 점' },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <span className="eyebrow">0.2.0 · MIT</span>
          <h1>웹에서 쓰는 한글 문서 편집기</h1>
          <p className="lead">
            Quire는 브라우저의 텍스트 상자 대신 자체 조판 엔진으로 캔버스에 문서를 그립니다. 실제 쪽 나눔과 정밀한 한글 조판, HWPX·DOCX·PDF를 앱에 몇 줄로 넣으세요.
          </p>
          <div className="actions">
            <a className="btn primary" href="#demo">
              지금 써 보기
            </a>
            <Link className="btn" href="/guide">
              예제 앱 만들기
            </Link>
            <a className="btn" href={GITHUB}>
              GitHub
            </a>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="features-title">
        <div className="wrap">
          <h2 id="features-title" className="visually-hidden">
            특징
          </h2>
          <ul className="features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" id="demo" aria-labelledby="demo-title">
        <div className="wrap">
          <h2 id="demo-title">써 보기</h2>
          <p className="sub">아래는 이 페이지에 넣은 실제 Quire 편집기입니다. 한글을 입력하고, 서식을 바꾸고, 파일을 열거나 저장해 보세요.</p>
          <Demo />
        </div>
      </section>

      <section className="section" id="install" aria-labelledby="install-title">
        <div className="wrap">
          <h2 id="install-title">설치</h2>
          <p className="sub">
            core에 쓰는 모듈만 더합니다. 모듈은 core를 peer 의존으로 받아 앱에 core가 하나만 들어갑니다. 처음부터 따라 하려면{' '}
            <Link href="/guide">단계별 가이드</Link>를 보세요.
          </p>
          <Code lang="sh">{`npm install @quiredoc/core @quiredoc/react @quiredoc/fonts`}</Code>
          <Code file="Editor.tsx">{`
'use client';
import { QuireEditor, useEditorState, useQuire } from '@quiredoc/react';

const fonts = [
  { name: 'Pretendard', manifest: '/quire/fonts/pretendard/manifest.json' },
];

export default function Editor() {
  const editor = useQuire({ fonts });
  const canUndo = useEditorState(editor, (s) => s.canUndo);
  return (
    <>
      <button disabled={!canUndo} onClick={() => editor.run('undo')}>실행 취소</button>
      <QuireEditor editor={editor} style={{ height: '80vh' }} />
    </>
  );
}
`}</Code>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">패키지</th>
                  <th scope="col">하는 일</th>
                </tr>
              </thead>
              <tbody>
                {PACKAGES.map((p) => (
                  <tr key={p.name}>
                    <td>
                      <a href={`https://www.npmjs.com/package/${p.name}`}>
                        <code>{p.name}</code>
                      </a>
                    </td>
                    <td>{p.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section" id="docs" aria-labelledby="docs-title">
        <div className="wrap">
          <h2 id="docs-title">문서</h2>
          <p className="sub">
            설계 문서와 예제는 모두 <a href={GITHUB}>GitHub</a>에 있습니다. 패키지는 <a href={NPM}>npm의 @quiredoc</a>에서 받습니다.
          </p>
          <ul className="links">
            <li>
              <Link href="/guide">
                <strong>단계별 가이드</strong>
                <span>Next.js 예제 앱을 처음부터</span>
              </Link>
            </li>
            {DOCS.map((d) => (
              <li key={d.title}>
                <a href={d.href}>
                  <strong>{d.title}</strong>
                  <span>{d.body}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
