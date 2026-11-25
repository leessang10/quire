import Link from 'next/link';
import Code from './Code';
import Demo from './Demo';
import Gallery from './Gallery';
import { GITHUB, NPM, doc, tree } from '../../lib/links';
import { coreVersion } from '../../lib/version';
import { href, type Lang } from '../../lib/i18n';

const T = {
  ko: {
    definition: ['quire', '[ˈkwaɪər]', '제본에서 종이를 접어 겹친 한 묶음. 책은 이 묶음을 엮어 만든다.'],
    title: '종이 위의 글처럼, 웹에서 쓰는 문서',
    lead: 'Quire는 브라우저의 글상자 대신 자체 조판 엔진으로 문서를 한 쪽씩 짜서 그립니다. 쪽 나눔과 한글 조판, HWPX·DOCX·PDF까지 코드 몇 줄이면 당신의 앱에 들어갑니다.',
    ctaDemo: '데모 써 보기',
    ctaGuide: '예제 앱 만들기',
    status: (v: string) => `${v ? `판 ${v}` : '0.x'} · MIT · 아직 0.x 단계라 판이 바뀔 때 API가 달라질 수 있습니다.`,
    changelog: '바뀐 것',
    chapter: (n: number) => `제${n}장`,
    examplesTitle: '예제 앱',
    examplesSub: '같은 엔진을 워드 프로세서로, 노트로, 단출한 원고지로 꾸며 보았습니다.',
    whyTitle: '왜 Quire인가',
    whySub: '대부분의 웹 편집기는 브라우저가 글자를 배치하는 contenteditable 위에 지어집니다. 웹 글에는 그것으로 충분하지만, 쪽이 있는 문서를 쓰기에는 한계가 있습니다. Quire는 조판을 직접 맡습니다.',
    features: [
      { title: '실제 쪽', body: '화면에서 본 쪽이 PDF와 인쇄에서도 같습니다. 머리말·꼬리말, 다단, 각주, 표가 쪽을 넘어 이어집니다.' },
      { title: '한글 조판', body: '어절 단위로 줄을 바꾸고, 닫는 문장부호는 줄 첫머리에 두지 않으며, 양쪽 맞춤의 간격을 고르게 나눕니다.' },
      { title: '한글 입력기 그대로', body: '조합 중인 글자, 한자 변환, 조합 중에 누른 Enter까지 Windows·macOS 입력기에서 그대로 동작합니다.' },
      { title: 'HWPX·DOCX·PDF', body: '한컴오피스 한글과 워드 문서를 열고 저장합니다. PDF에는 쓴 글자만 담은 글꼴을 넣어 작게 만듭니다. 서버는 필요 없습니다.' },
      { title: '두꺼운 원고', body: '보이는 쪽만 그리고 고친 문단만 다시 짭니다. 수백 쪽 원고에서도 입력이 밀리지 않습니다.' },
      { title: '필요한 만큼만', body: '@quiredoc/core 하나로 시작하고 React·변환·PDF·협업은 필요할 때 더합니다. 기본 앱은 처음에 약 500 KB만 받습니다.' },
    ],
    compareCaption: 'Quire와 contenteditable 기반 편집기 (ProseMirror·Tiptap, Lexical, Slate 등)',
    compareHead: ['', 'Quire', 'contenteditable 기반'],
    compare: [
      ['글자 배치', '자체 조판 엔진이 캔버스에 그림', '브라우저가 HTML로 배치'],
      ['쪽', '실제 쪽 단위 (머리말·꼬리말·각주·다단)', '기본은 끝없는 한 장. 쪽은 따로 흉내 내야 함'],
      ['한글 줄바꿈·금칙', '엔진이 직접', '브라우저 CSS 규칙에 맡김'],
      ['화면과 PDF·인쇄', '같은 조판', '인쇄 CSS나 별도 변환, 차이가 생기기 쉬움'],
      ['HWPX·DOCX', '열기·저장 (@quiredoc/convert)', '대개 별도 라이브러리'],
      ['접근성', '캔버스라 스크린리더용 구조를 따로 만듦. 실제 화면 낭독기 확인은 진행 중', 'DOM이 그대로 보조 기술에 보임'],
      ['성숙도', '0.x, 플러그인이 아직 적음', '오래 쓰여 확장과 자료가 많음'],
    ],
    fitTitle: '잘 맞는 곳',
    fit: ['보고서·계약서·논문처럼 쪽과 인쇄가 중요한 문서', '한컴오피스·워드 문서를 웹에서 열고 고쳐야 하는 서비스', '한글 조판의 품질이 제품의 일부인 곳'],
    unfitTitle: '다른 편집기가 나은 곳',
    unfit: ['댓글창·채팅 입력처럼 짧은 글', '블로그·CMS처럼 화면 너비에 맞춰 흐르는 웹 글', '지금 당장 넓은 플러그인 생태계가 필요할 때'],
    demoTitle: '데모',
    demoSub: '아래는 그림이 아니라 이 페이지에 넣은 실제 편집기입니다. 한 문장 써 보세요.',
    skipDemo: '데모 건너뛰기',
    installTitle: '설치',
    installSub: (guide: React.ReactNode) => <>core에 필요한 모듈만 더합니다. 모듈은 core를 peer 의존으로 받아 앱에 core가 하나만 들어갑니다. 처음부터 따라 하려면 {guide}를 펼치세요.</>,
    guideLink: '단계별 가이드',
    undo: '실행 취소',
    pkgHead: ['패키지', '하는 일'],
    packages: [
      ['@quiredoc/core', '편집기·조판·문서 모델·.quire 파일. 언제나 필요합니다.'],
      ['@quiredoc/react', 'React 훅과 컴포넌트 (useQuire, QuireEditor, useEditorState)'],
      ['@quiredoc/convert', 'HWPX·DOCX·Markdown·HTML 가져오기·내보내기'],
      ['@quiredoc/pdf', '글꼴을 넣은 PDF 내보내기 (브라우저·Node)'],
      ['@quiredoc/fonts', 'Pretendard·Noto Sans KR 글꼴 조각 (공개 폴더에 복사)'],
      ['@quiredoc/collab', '실시간 협업(CRDT), 접속자 표시, 버전 기록'],
    ],
    docsTitle: '읽을거리',
    docsSub: (gh: React.ReactNode, npm: React.ReactNode) => <>API 문서와 가이드는 이 사이트에, 설계 노트와 예제는 {gh}에, 패키지는 {npm}에 있습니다.</>,
    npmName: 'npm의 @quiredoc',
    docs: [
      ['site:/docs', 'API 문서', '편집기 옵션, 명령, 상태, 플러그인, 변환, PDF, 협업'],
      ['site:/guide', '단계별 가이드', 'Next.js 예제 앱을 처음부터'],
      [tree('examples'), '예제 앱 10개', 'React·Next.js·Vue·Svelte·바닐라·Node'],
      [doc('docs/design/17-themes.md'), '테마', '색·글꼴 변수, 다크 모드'],
      [doc('docs/design/07-file-format.md'), '파일 형식', '.quire와 정본 JSON'],
      [doc('CHANGELOG.md'), '바뀐 것', '판마다 달라진 점'],
    ],
  },
  en: {
    definition: ['quire', '[ˈkwaɪər]', 'In bookbinding, a gathering of folded sheets. A book is sewn together from quires.'],
    title: 'Documents on the web, set like a printed page',
    lead: 'Quire typesets every page itself and draws it on a canvas, instead of leaving layout to the browser. Real pages, precise Korean typesetting, HWPX, DOCX and PDF — a few lines of code put them in your app.',
    ctaDemo: 'Try the demo',
    ctaGuide: 'Build an example app',
    status: (v: string) => `${v ? `v${v}` : '0.x'} · MIT · Still 0.x: APIs may change between versions.`,
    changelog: 'Changelog',
    chapter: (n: number) => `Chapter ${['I', 'II', 'III', 'IV', 'V'][n - 1]}`,
    examplesTitle: 'Example apps',
    examplesSub: 'The same engine, dressed as a word processor, a notebook and a plain manuscript.',
    whyTitle: 'Why Quire',
    whySub: 'Most web editors are built on contenteditable, where the browser lays out the text. That is fine for web writing, but it falls short for documents with pages. Quire does the typesetting itself.',
    features: [
      { title: 'Real pages', body: 'The page you see is the page in the PDF and on paper. Headers, footers, columns, footnotes and tables flow across pages.' },
      { title: 'Korean typesetting', body: 'Lines break between words, closing punctuation never starts a line, and justified lines share their spacing evenly.' },
      { title: 'Native Korean input', body: 'Composing syllables, Hanja conversion and Enter during composition behave as they do in Windows and macOS input methods.' },
      { title: 'HWPX · DOCX · PDF', body: 'Open and save Hancom Office and Word documents. PDFs embed only the glyphs you used, so they stay small. No server needed.' },
      { title: 'Long manuscripts', body: 'Only visible pages are drawn and only edited paragraphs are reset. Typing stays smooth in documents hundreds of pages long.' },
      { title: 'Only what you need', body: 'Start with @quiredoc/core and add React, conversion, PDF and collaboration when you need them. A basic app loads about 500 KB.' },
    ],
    compareCaption: 'Quire and contenteditable-based editors (ProseMirror/Tiptap, Lexical, Slate and others)',
    compareHead: ['', 'Quire', 'contenteditable-based'],
    compare: [
      ['Layout', 'Its own typesetting engine, drawn on a canvas', 'The browser lays out HTML'],
      ['Pages', 'Real pages (headers, footers, footnotes, columns)', 'One endless sheet; pages must be emulated'],
      ['Korean line breaking', 'Handled by the engine', 'Left to browser CSS rules'],
      ['Screen vs PDF and print', 'The same typesetting', 'Print CSS or a separate converter; results drift'],
      ['HWPX · DOCX', 'Open and save (@quiredoc/convert)', 'Usually a separate library'],
      ['Accessibility', 'A canvas, so it builds a separate structure for screen readers; real screen-reader testing is in progress', 'The DOM is visible to assistive technology as is'],
      ['Maturity', '0.x, few plugins so far', 'Years of use, many extensions and resources'],
    ],
    fitTitle: 'A good fit for',
    fit: ['Reports, contracts and papers where pages and print matter', 'Services that open and edit Hancom Office or Word files on the web', 'Products where Korean typesetting quality is part of the product'],
    unfitTitle: 'Another editor is better for',
    unfit: ['Short text such as comment boxes and chat input', 'Web writing that reflows to the screen, like blogs and CMSs', 'When you need a large plugin ecosystem today'],
    demoTitle: 'Demo',
    demoSub: 'This is not a picture. It is the real editor, embedded in this page. Write a sentence.',
    skipDemo: 'Skip the demo',
    installTitle: 'Install',
    installSub: (guide: React.ReactNode) => <>Add only the modules you need to core. Modules take core as a peer dependency, so your app ships one copy of it. To start from scratch, follow the {guide}.</>,
    guideLink: 'step-by-step guide',
    undo: 'Undo',
    pkgHead: ['Package', 'What it does'],
    packages: [
      ['@quiredoc/core', 'Editor, typesetting, document model and .quire files. Always needed.'],
      ['@quiredoc/react', 'React hooks and component (useQuire, QuireEditor, useEditorState)'],
      ['@quiredoc/convert', 'Import and export HWPX, DOCX, Markdown and HTML'],
      ['@quiredoc/pdf', 'PDF export with embedded fonts (browser and Node)'],
      ['@quiredoc/fonts', 'Pretendard and Noto Sans KR font chunks (copy to your public folder)'],
      ['@quiredoc/collab', 'Real-time collaboration (CRDT), presence and version history'],
    ],
    docsTitle: 'Further reading',
    docsSub: (gh: React.ReactNode, npm: React.ReactNode) => <>The API docs and guide live on this site, design notes (in Korean) and examples on {gh}, and packages on {npm}.</>,
    npmName: '@quiredoc on npm',
    docs: [
      ['site:/docs', 'API docs', 'Editor options, commands, state, plugins, conversion, PDF, collaboration'],
      ['site:/guide', 'Step-by-step guide', 'A Next.js example app from scratch'],
      [tree('examples'), '10 example apps', 'React, Next.js, Vue, Svelte, vanilla, Node'],
      [doc('docs/design/17-themes.md'), 'Themes (Korean)', 'Color and font variables, dark mode'],
      [doc('docs/design/07-file-format.md'), 'File format (Korean)', '.quire and canonical JSON'],
      [doc('CHANGELOG.md'), 'Changelog', 'What changed in each version'],
    ],
  },
};

function Kicker({ lang, n }: { lang: Lang; n: number }) {
  return (
    <p className="kicker" aria-hidden="true">
      {T[lang].chapter(n)}
    </p>
  );
}

export default function Home({ lang }: { lang: Lang }) {
  const t = T[lang];
  const version = coreVersion();
  const guide = href(lang, '/guide');
  const link = (h: string) => (h.startsWith('site:') ? href(lang, h.slice(5)) : h);
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <p className="definition">
            <dfn lang="en">{t.definition[0]}</dfn> <span className="ipa">{t.definition[1]}</span> {t.definition[2]}
          </p>
          <h1>{t.title}</h1>
          <p className="lead">{t.lead}</p>
          <div className="actions">
            <a className="btn primary" href="#demo">
              {t.ctaDemo}
            </a>
            <Link className="btn" href={guide}>
              {t.ctaGuide}
            </Link>
            <a className="btn" href={GITHUB}>
              GitHub
            </a>
          </div>
          <p className="colophon">
            {t.status(version)} <a href={doc('CHANGELOG.md')}>{t.changelog}</a>
          </p>
        </div>
      </section>

      <section className="section" id="examples" aria-labelledby="examples-title">
        <div className="wrap">
          <Kicker lang={lang} n={1} />
          <h2 id="examples-title">{t.examplesTitle}</h2>
          <p className="sub">{t.examplesSub}</p>
          <Gallery lang={lang} />
        </div>
      </section>

      <section className="section" id="why" aria-labelledby="why-title">
        <div className="wrap">
          <Kicker lang={lang} n={2} />
          <h2 id="why-title">{t.whyTitle}</h2>
          <p className="sub">{t.whySub}</p>
          <ul className="features">
            {t.features.map((f) => (
              <li key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
          </ul>
          <div className="table-wrap compare">
            <table>
              <caption>{t.compareCaption}</caption>
              <thead>
                <tr>
                  {t.compareHead.map((h, i) => (
                    <th key={i} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.compare.map(([k, a, b]) => (
                  <tr key={k}>
                    <th scope="row">{k}</th>
                    <td>{a}</td>
                    <td>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="fit">
            <div>
              <h3>{t.fitTitle}</h3>
              <ul>
                {t.fit.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>{t.unfitTitle}</h3>
              <ul>
                {t.unfit.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="demo" aria-labelledby="demo-title">
        <div className="wrap">
          <Kicker lang={lang} n={3} />
          <h2 id="demo-title">{t.demoTitle}</h2>
          <p className="sub">{t.demoSub}</p>
          <a className="skip-demo" href="#install">
            {t.skipDemo}
          </a>
          <Demo lang={lang} />
        </div>
      </section>

      <section className="section" id="install" aria-labelledby="install-title">
        <div className="wrap">
          <Kicker lang={lang} n={4} />
          <h2 id="install-title">{t.installTitle}</h2>
          <p className="sub">{t.installSub(<Link href={guide}>{t.guideLink}</Link>)}</p>
          <Code lang="sh" ui={lang}>{`npm install @quiredoc/core @quiredoc/react @quiredoc/fonts`}</Code>
          <Code file="Editor.tsx" ui={lang}>{`
'use client';
import { QuireEditor, useEditorState, useQuire } from '@quiredoc/react';

const fonts = [
  { name: 'Pretendard', manifest: '/quire/fonts/pretendard/manifest.json' },
];

export default function Editor() {
  const editor = useQuire({ fonts${lang === 'en' ? ", locale: 'en'" : ''} });
  const canUndo = useEditorState(editor, (s) => s.canUndo);
  return (
    <>
      <button disabled={!canUndo} onClick={() => editor.run('undo')}>${t.undo}</button>
      <QuireEditor editor={editor} style={{ height: '80vh' }} />
    </>
  );
}
`}</Code>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.pkgHead[0]}</th>
                  <th scope="col">{t.pkgHead[1]}</th>
                </tr>
              </thead>
              <tbody>
                {t.packages.map(([name, role]) => (
                  <tr key={name}>
                    <td>
                      <a href={`https://www.npmjs.com/package/${name}`}>
                        <code>{name}</code>
                      </a>
                    </td>
                    <td>{role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section" id="docs" aria-labelledby="docs-title">
        <div className="wrap">
          <Kicker lang={lang} n={5} />
          <h2 id="docs-title">{t.docsTitle}</h2>
          <p className="sub">{t.docsSub(<a href={GITHUB}>GitHub</a>, <a href={NPM}>{t.npmName}</a>)}</p>
          <ul className="links">
            {t.docs.map(([h, title, body]) => {
              const inner = (
                <>
                  <strong>{title}</strong>
                  <span>{body}</span>
                </>
              );
              return <li key={title}>{h.startsWith('site:') ? <Link href={link(h)}>{inner}</Link> : <a href={h}>{inner}</a>}</li>;
            })}
          </ul>
        </div>
      </section>
    </>
  );
}
