import type { Metadata } from 'next';
import Link from 'next/link';
import Code from '../components/Code';
import { doc, tree } from '../../lib/links';

export const metadata: Metadata = {
  title: '예제 앱 만들기',
  description: 'Next.js 앱에 Quire 편집기를 넣고, 도구 막대와 HWPX·DOCX·PDF 저장을 붙여 Vercel에 올리는 단계별 가이드.',
};

const STEPS = [
  ['create', 'Next.js 앱 만들기'],
  ['install', '패키지 설치'],
  ['fonts', '글꼴을 공개 폴더에'],
  ['editor', '편집기 컴포넌트'],
  ['client', '브라우저에서만 불러오기'],
  ['toolbar', '도구 막대'],
  ['files', '파일 열기·저장'],
  ['pdf', 'PDF로 저장'],
  ['deploy', 'Vercel에 올리기'],
] as const;

function Step({ n, id, children }: { n: number; id: string; children: React.ReactNode }) {
  return (
    <section className="step" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        <span className="num" aria-hidden="true">
          {n}
        </span>
        {STEPS[n - 1][1]}
      </h2>
      {children}
    </section>
  );
}

export default function Guide() {
  return (
    <div className="wrap guide">
      <nav className="toc" aria-label="단계">
        <p>단계</p>
        <ol>
          {STEPS.map(([id, title]) => (
            <li key={id}>
              <a href={`#${id}`}>{title}</a>
            </li>
          ))}
        </ol>
      </nav>
      <article>
        <h1>예제 앱 만들기</h1>
        <p className="sub">
          빈 Next.js 앱에 Quire 편집기를 넣고, 도구 막대와 파일 열기·저장, PDF 내보내기를 붙여 Vercel에 올립니다. 다 만들면{' '}
          <Link href="/#demo">첫 화면의 데모</Link>와 같은 앱이 됩니다. Node.js 20 이상이 필요합니다.
        </p>

        <Step n={1} id="create">
          <p>새 Next.js 앱을 만듭니다. 묻는 것에는 TypeScript와 App Router를 쓰겠다고 답하면 됩니다.</p>
          <Code lang="sh">{`npx create-next-app@latest quire-app
cd quire-app`}</Code>
        </Step>

        <Step n={2} id="install">
          <p>
            편집기의 핵심 <code>@quiredoc/core</code>와 React 연결 <code>@quiredoc/react</code>, 글꼴 <code>@quiredoc/fonts</code>를 설치합니다. 변환과 PDF는 7·8단계에서 더합니다.
          </p>
          <Code lang="sh">{`npm install @quiredoc/core @quiredoc/react @quiredoc/fonts`}</Code>
        </Step>

        <Step n={3} id="fonts">
          <p>
            Quire는 글꼴을 직접 읽어 글자 모양을 잡습니다. <code>@quiredoc/fonts</code>에 든 글꼴 조각을 앱의 <code>public</code> 폴더로 복사해, 브라우저가 문서에 나온 글자가 든 조각만 받게 합니다. 설치할 때마다 복사되게 스크립트를 만듭니다.
          </p>
          <Code file="scripts/copy-assets.mjs">{`
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = resolve('public', 'quire');
const require = createRequire(join(process.cwd(), 'package.json'));
const fonts = join(require.resolve('@quiredoc/fonts/package.json'), '..', 'fonts');
mkdirSync(dir, { recursive: true });
cpSync(fonts, join(dir, 'fonts'), { recursive: true });

// 8단계(PDF)에서 harfbuzzjs를 설치하면 글꼴 부분화 WASM도 복사한다
try {
  const hb = require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm');
  if (existsSync(hb)) cpSync(hb, join(dir, 'harfbuzz-subset.wasm'));
} catch {}
`}</Code>
          <p>
            <code>package.json</code>의 <code>scripts</code>에 <code>postinstall</code>을 더하고 한 번 실행합니다.
          </p>
          <Code file="package.json">{`
"scripts": {
  "postinstall": "node scripts/copy-assets.mjs",
  "dev": "next dev",
  "build": "next build",
  "start": "next start"
}
`}</Code>
          <Code lang="sh">{`npm run postinstall`}</Code>
          <p>
            복사한 파일은 설치 때마다 다시 만들어지므로 <code>.gitignore</code>에 <code>/public/quire</code>를 넣어 둡니다.
          </p>
        </Step>

        <Step n={4} id="editor">
          <p>
            편집기 컴포넌트를 만듭니다. <code>useQuire</code>가 편집기를 만들고, <code>QuireEditor</code>가 그것을 화면에 붙입니다. 글꼴은 3단계에서 복사한 위치를 가리킵니다.
          </p>
          <Code file="app/Editor.tsx">{`
'use client';
import { QuireEditor, useQuire } from '@quiredoc/react';
import type { FontSource } from '@quiredoc/core';

const fonts: FontSource[] = [
  {
    name: 'Pretendard',
    manifest: '/quire/fonts/pretendard/manifest.json',
    bold: { manifest: '/quire/fonts/pretendard-bold/manifest.json' },
  },
  { name: 'Noto Sans KR', manifest: '/quire/fonts/noto-sans-kr/manifest.json' },
];

export default function Editor() {
  const editor = useQuire({ fonts });
  return <QuireEditor editor={editor} style={{ height: '100vh' }} />;
}
`}</Code>
          <div className="note">
            <code>useQuire</code>는 처음 렌더의 옵션으로 편집기를 한 번만 만듭니다. 나중에 바꿀 것(문서, 서식)은 <code>editor.run(…)</code> 명령이나 <code>editor.load(…)</code>로 바꿉니다.
          </div>
        </Step>

        <Step n={5} id="client">
          <p>
            편집기는 캔버스와 입력기를 다루므로 서버에서 그릴 것이 없습니다. <code>next/dynamic</code>의 <code>ssr: false</code>로 브라우저에서만 불러옵니다. 이 옵션은 클라이언트 컴포넌트 안에서만 쓸 수 있어 작은 불러오기 컴포넌트를 둡니다.
          </p>
          <Code file="app/EditorLoader.tsx">{`
'use client';
import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('./Editor'), {
  ssr: false,
  loading: () => <p>에디터 불러오는 중…</p>,
});

export default function EditorLoader() {
  return <Editor />;
}
`}</Code>
          <Code file="app/page.tsx">{`
import EditorLoader from './EditorLoader';

export default function Page() {
  return <EditorLoader />;
}
`}</Code>
          <p>
            <code>npm run dev</code>로 띄우고 <code>http://localhost:3000</code>을 엽니다. 빈 쪽이 나오면 눌러서 한글을 입력해 보세요. 화면이 비어 있으면 브라우저 개발자 도구의 네트워크 탭에서 <code>/quire/fonts/…/manifest.json</code>이 404인지 봅니다. 그렇다면 3단계 복사가 안 된 것입니다.
          </p>
        </Step>

        <Step n={6} id="toolbar">
          <p>
            <code>useEditorState</code>로 편집기 상태에서 필요한 값만 고릅니다. 고른 값이 바뀔 때만 컴포넌트가 다시 그려지므로, 글자를 칠 때마다 도구 막대가 다시 그려지지 않습니다. 단추는 <code>editor.run</code>으로 명령을 보냅니다.
          </p>
          <Code file="app/Editor.tsx">{`
'use client';
import { QuireEditor, useEditorState, useQuire } from '@quiredoc/react';
import { fonts } from './fonts';

export default function Editor() {
  const editor = useQuire({ fonts });
  const bold = useEditorState(editor, (s) => !!s.marksAtCaret.bold);
  const canUndo = useEditorState(editor, (s) => s.canUndo);
  const style = useEditorState(editor, (s) => s.paragraphStyle);

  const run = (command: string, ...args: unknown[]) => {
    editor.run(command, ...args);
    editor.run('focus'); // 단추를 누른 뒤에도 바로 이어서 입력
  };

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100vh' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8 }}>
        <button aria-pressed={bold} onClick={() => run('toggleBold')}>굵게</button>
        <button disabled={!canUndo} onClick={() => run('undo')}>실행 취소</button>
        <select value={style} onChange={(e) => run('setStyle', e.target.value)}>
          <option value="body">본문</option>
          <option value="h1">제목 1</option>
          <option value="h2">제목 2</option>
        </select>
      </div>
      <QuireEditor editor={editor} style={{ minHeight: 0 }} />
    </div>
  );
}
`}</Code>
          <p>
            글꼴 목록은 다음 단계에서도 쓰므로 4단계의 <code>fonts</code>를 <code>app/fonts.ts</code>로 옮기고 <code>export</code>합니다. 쓸 수 있는 명령은{' '}
            <code>toggleItalic</code>, <code>toggleUnderline</code>, <code>redo</code>, <code>setStyle</code>, <code>setAlign</code> 등이 있습니다 (<a href={doc('docs/design/15-ecosystem.md')}>명령 목록</a>).
          </p>
        </Step>

        <Step n={7} id="files">
          <p>
            <code>@quiredoc/convert</code>로 HWPX·DOCX·Markdown을 열고 저장합니다. 모두 브라우저 안에서 처리되어 파일이 서버로 가지 않습니다. 처음 쓸 때 불러오도록 <code>import()</code>로 가져오면 시작할 때 받는 JS가 늘지 않습니다.
          </p>
          <Code lang="sh">{`npm install @quiredoc/convert`}</Code>
          <Code file="app/files.ts">{`
import type { QuireController } from '@quiredoc/react';

export async function openFile(editor: QuireController, file: File) {
  const c = await import('@quiredoc/convert');
  const name = file.name.toLowerCase();
  const result = name.endsWith('.hwpx')
    ? await c.importHwpx(new Uint8Array(await file.arrayBuffer()))
    : name.endsWith('.docx')
      ? await c.importDocx(new Uint8Array(await file.arrayBuffer()))
      : await c.importMarkdown(await file.text());
  await editor.load(result.doc, result.assets);
  return result.report; // 옮기지 못한 요소 (report.dropped)
}

export async function saveHwpx(editor: QuireController) {
  const c = await import('@quiredoc/convert');
  const doc = editor.toJSON();
  if (!doc) return;
  download(await c.exportHwpx(doc), 'document.hwpx', 'application/hwp+zip');
}

export function download(data: Uint8Array | string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
`}</Code>
          <p>도구 막대에 단추를 더합니다.</p>
          <Code file="app/Editor.tsx">{`
import { useRef } from 'react';
import { openFile, saveHwpx } from './files';

// Editor 안에서
const input = useRef<HTMLInputElement>(null);

<button onClick={() => input.current?.click()}>열기</button>
<input
  ref={input}
  type="file"
  accept=".hwpx,.docx,.md"
  hidden
  onChange={(e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void openFile(editor, f);
  }}
/>
<button onClick={() => void saveHwpx(editor)}>HWPX로 저장</button>
`}</Code>
          <p>
            DOCX는 <code>exportDocx</code>, Markdown은 <code>exportMarkdown</code>을 같은 방식으로 씁니다. 문서에 이미지가 있으면 <code>asset</code> 옵션으로 이미지 바이트를 넘깁니다 (<a href={tree('examples/shared')}>예제의 quire-demo.ts</a>).
          </p>
        </Step>

        <Step n={8} id="pdf">
          <p>
            <code>@quiredoc/pdf</code>는 화면과 같은 쪽 나눔으로 PDF를 만들고, 문서에 쓴 글자만 담은 글꼴을 넣습니다. 글꼴을 줄이는 데 <code>harfbuzzjs</code>의 WASM을 씁니다.
          </p>
          <Code lang="sh">{`npm install @quiredoc/pdf harfbuzzjs`}</Code>
          <p>
            설치하면 3단계 스크립트가 <code>public/quire/harfbuzz-subset.wasm</code>도 복사합니다. harfbuzzjs는 Node에서만 Node 내장 모듈 <code>module</code>을 부르므로, 브라우저 묶음에서는 빈 모듈로 바꿔 둡니다.
          </p>
          <Code file="lib/empty-module.js">{`
export const createRequire = () => () => {
  throw new Error('module: 브라우저에서는 쓰지 않습니다');
};
export default {};
`}</Code>
          <Code file="next.config.mjs">{`
/** @type {import('next').NextConfig} */
export default {
  turbopack: { resolveAlias: { module: { browser: './lib/empty-module.js' } } },
  webpack: (config, { isServer }) => {
    if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, module: false };
    return config;
  },
};
`}</Code>
          <Code file="app/files.ts">{`
export async function savePdf(editor: QuireController) {
  const handle = editor.handle;
  if (!handle) return;
  const pdf = await import('@quiredoc/pdf');
  const src = handle.editor.printSource(); // 화면과 같은 조판 결과
  const wasm = await fetch('/quire/harfbuzz-subset.wasm').then((r) => r.arrayBuffer());
  const { bytes } = await pdf.exportPdf({
    env: src.env,
    fonts: src.fonts,
    asset: src.asset,
    subsetter: await pdf.loadSubsetter(wasm),
    title: src.title,
  });
  download(bytes, 'document.pdf', 'application/pdf');
}
`}</Code>
        </Step>

        <Step n={9} id="deploy">
          <p>
            Git 저장소에 올리고 <a href="https://vercel.com/new">Vercel</a>에서 가져오면 됩니다. Next.js로 알아보므로 따로 설정할 것은 없습니다. Vercel도 설치할 때 <code>postinstall</code>을 돌려 글꼴을 복사합니다.
          </p>
          <Code lang="sh">{`git init && git add -A && git commit -m "Quire 예제 앱"
# GitHub에 저장소를 만들어 올린 뒤 Vercel에서 Import`}</Code>
          <p>다 만든 앱의 파일은 이렇습니다.</p>
          <pre className="tree code" style={{ padding: 14 }}>{`quire-app/
├─ app/
│  ├─ Editor.tsx        편집기와 도구 막대
│  ├─ EditorLoader.tsx  브라우저에서만 불러오기
│  ├─ files.ts          열기·저장·PDF
│  ├─ fonts.ts          글꼴 위치
│  └─ page.tsx
├─ lib/empty-module.js
├─ scripts/copy-assets.mjs
├─ next.config.mjs
└─ public/quire/        (설치 때 복사, git에 넣지 않음)`}</pre>
        </Step>

        <section className="step" aria-labelledby="next-title">
          <h2 id="next-title">다음으로</h2>
          <ul>
            <li>
              <a href={tree('examples')}>예제 앱 10개</a>: Vue, Svelte, 바닐라 JS, Node에서 변환하기, 워드·노션 같은 화면을 흉내 낸 Next.js 앱
            </li>
            <li>
              <a href={doc('docs/design/17-themes.md')}>테마</a>로 편집기 색과 글꼴을 앱에 맞추기
            </li>
            <li>
              <a href={doc('docs/design/15-ecosystem.md')}>플러그인</a>으로 명령과 그리기 층 더하기
            </li>
            <li>
              <code>@quiredoc/collab</code>으로 실시간 협업 붙이기 (<a href={doc('docs/design/14-collaboration-history.md')}>협업과 기록</a>)
            </li>
          </ul>
        </section>
      </article>
    </div>
  );
}
