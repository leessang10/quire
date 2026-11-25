import Link from 'next/link';
import type { ReactNode } from 'react';
import Code from './Code';
import DocsLayout from './DocsLayout';
import { doc, tree } from '../../lib/links';
import { href, type Lang } from '../../lib/i18n';

type B = { ko: ReactNode; en: ReactNode };
type Row = [string, string, B];

const SECTIONS: [string, B][] = [
  ['install', { ko: '설치', en: 'Install' }],
  ['create', { ko: '편집기 만들기', en: 'Creating an editor' }],
  ['options', { ko: '옵션', en: 'Options' }],
  ['handle', { ko: '핸들', en: 'The handle' }],
  ['state', { ko: '상태', en: 'State' }],
  ['commands', { ko: '명령', en: 'Commands' }],
  ['react', { ko: 'React', en: 'React' }],
  ['fonts', { ko: '글꼴', en: 'Fonts' }],
  ['saving', { ko: '저장과 불러오기', en: 'Saving and loading' }],
  ['convert', { ko: 'HWPX·DOCX·Markdown', en: 'HWPX, DOCX, Markdown' }],
  ['pdf', { ko: 'PDF', en: 'PDF' }],
  ['plugins', { ko: '플러그인', en: 'Plugins' }],
  ['themes', { ko: '테마', en: 'Themes' }],
  ['i18n', { ko: '언어', en: 'Languages' }],
  ['collab', { ko: '협업', en: 'Collaboration' }],
  ['versions', { ko: '판과 바뀜', en: 'Versions' }],
];

const OPTIONS: Row[] = [
  ['host', 'HTMLElement', { ko: '편집기를 붙일 요소 (React에서는 QuireEditor가 넣는다)', en: 'Element to mount into (QuireEditor supplies it in React)' }],
  ['doc', 'QuireDoc', { ko: '처음 문서 (정본 JSON). 없으면 빈 문서', en: 'Initial document (canonical JSON). Empty if omitted' }],
  ['fonts', 'FontSource[]', { ko: '엔진 글꼴 (아래 글꼴 절)', en: 'Engine fonts (see Fonts)' }],
  ['plugins', 'QuirePlugin[]', { ko: '만들 때 붙일 플러그인. 나중에 use()로도', en: 'Plugins to attach at creation; use() adds more later' }],
  ['theme', "'classic' | 'minimal' | 'modern'", { ko: '화면 테마. 문서와 조판은 바뀌지 않는다', en: 'Screen theme. Never changes the document or layout' }],
  ['colorScheme', "'light' | 'dark' | 'auto'", { ko: '밝기. 어두운 화면에서도 쪽은 흰 종이', en: 'Light or dark. Pages stay white paper in dark mode' }],
  ['pageView', "'print' | 'continuous'", { ko: '쪽마다 종이(기본) 또는 쪽 경계 없이 이어서', en: 'Separate sheets (default) or one continuous scroll' }],
  ['zoom', 'number', { ko: '화면 배율 (1 = 100%). 그리기만 키운다', en: 'Zoom (1 = 100%). Scales drawing only' }],
  ['showMarks', 'boolean', { ko: '편집 기호(¶, 나눔) 표시', en: 'Show formatting marks (¶, breaks)' }],
  ['locale', 'string', { ko: '편집기 화면 언어 (ko 기본, en 등)', en: 'Editor interface language (ko by default, en, …)' }],
  ['messages', 'Record<string, MessageTable>', { ko: '언어별 문구 덮어쓰기', en: 'Per-language message overrides' }],
  ['assets', 'AssetStore', { ko: '이미지 원본 저장소 (기본 메모리)', en: 'Image storage (memory by default)' }],
  ['user', 'CommentAuthor', { ko: '댓글 작성자', en: 'Comment author' }],
  ['spellChecker', 'SpellChecker', { ko: '맞춤법 검사기. 없으면 검사하지 않는다', en: 'Spell checker. None by default' }],
  ['input', "'auto' | 'editcontext' | 'textarea'", { ko: '입력 층. auto는 EditContext가 있으면 그것을', en: 'Input layer. auto uses EditContext when available' }],
  ['onChange', '(editor) => void', { ko: '문서가 바뀔 때', en: 'When the document changes' }],
  ['onSelectionChange', '(anchor, head, story?, page?) => void', { ko: '선택이 바뀔 때', en: 'When the selection changes' }],
  ['onFindRequest', '(replace: boolean) => void', { ko: 'Ctrl+F·Ctrl+H: 앱이 찾기 막대를 연다', en: 'Ctrl+F / Ctrl+H: open your find bar' }],
  ['onFontsReady', '(editor, error?) => void', { ko: '글꼴을 다 불러왔을 때', en: 'When fonts have loaded' }],
  ['onContextMenu', '(e, spell, items) => boolean | void', { ko: '오른쪽 클릭 메뉴를 앱이 그릴 때', en: 'Draw your own context menu' }],
];

const HANDLE: Row[] = [
  ['run(command, ...args)', 'boolean', { ko: '명령 실행. 내장 명령은 점 없는 이름, 플러그인 명령은 "이름.명령"', en: 'Run a command: built-ins by bare name, plugin commands as "name.command"' }],
  ['getState()', 'EditorState', { ko: '불변 스냅샷. 값이 같으면 같은 객체', en: 'Immutable snapshot; the same object while nothing changed' }],
  ['subscribe(listener)', '() => void', { ko: '그리기가 끝날 때마다 알림. 떼는 함수를 돌려준다', en: 'Notified after each render; returns an unsubscribe' }],
  ['toJSON()', 'QuireDoc', { ko: '지금 문서 (정본 JSON)', en: 'The current document (canonical JSON)' }],
  ['load(doc, assets?)', 'Promise<void>', { ko: '문서를 바꾼다 (가져오기 결과, 다른 문서 열기)', en: 'Replace the document (an import result, another file)' }],
  ['caretRect()', 'Rect | null', { ko: '캐럿의 화면 좌표 (떠 있는 UI 배치용)', en: 'Caret position in viewport coordinates, for floating UI' }],
  ['rangeRects(from, to)', 'Rect[]', { ko: '범위의 줄마다 화면 사각형', en: 'Viewport rectangles of a range, one per line' }],
  ['use(plugin)', '() => void', { ko: '플러그인을 붙인다. 떼는 함수를 돌려준다', en: 'Attach a plugin; returns a detach function' }],
  ['destroy()', 'void', { ko: '이벤트와 자원 정리', en: 'Release events and resources' }],
  ['editor', 'Editor', { ko: '편집기 자체 (넓은 API로 가는 탈출구)', en: 'The Editor itself, an escape hatch to the wider API' }],
];

const STATE: Row[] = [
  ['selection', '{ anchor, head, story }', { ko: '선택 (story: null이면 본문, 아니면 셀·각주·머리말)', en: 'Selection (story null = body, otherwise a cell, footnote or header)' }],
  ['marksAtCaret', 'MarkSet', { ko: '캐럿의 글자 서식 (섞인 것은 빠진다)', en: 'Character formatting at the caret (mixed keys omitted)' }],
  ['paragraphStyle', 'string', { ko: "문단 스타일 이름 ('body', 'h1' …)", en: "Paragraph style name ('body', 'h1', …)" }],
  ['canUndo · canRedo', 'boolean', { ko: '실행 취소·다시 실행 가능', en: 'Whether undo / redo are available' }],
  ['suggesting', 'boolean', { ko: '제안 모드 (변경 내용 추적)', en: 'Suggesting mode (track changes)' }],
  ['find', 'FindStatus | null', { ko: '찾기 결과 상태', en: 'Find status' }],
  ['plugins', 'string[]', { ko: '붙은 플러그인 이름', en: 'Names of attached plugins' }],
  ['version', 'number', { ko: '바뀔 때마다 늘어난다', en: 'Increases on every change' }],
];

const COMMANDS: Row[] = [
  ['toggleBold · toggleItalic · toggleUnderline · toggleStrike', '', { ko: '글자 서식 켜고 끄기', en: 'Toggle character formatting' }],
  ['superscript · subscript', '', { ko: '위 첨자·아래 첨자', en: 'Superscript and subscript' }],
  ['clearFormatting', '', { ko: '글자 서식 지우기', en: 'Clear character formatting' }],
  ['setMark', 'key, value', { ko: "글자 서식 하나 정하기 (예: 'color', '#c00')", en: "Set one character mark (e.g. 'color', '#c00')" }],
  ['setStyle', 'name', { ko: "문단 스타일 ('body', 'h1'–'h6', …)", en: "Paragraph style ('body', 'h1'–'h6', …)" }],
  ['setAlign', "'left' | 'center' | 'right' | 'justify'", { ko: '문단 정렬', en: 'Paragraph alignment' }],
  ['bulletList · numberedList', '', { ko: '목록 켜고 끄기', en: 'Toggle lists' }],
  ['indent · outdent', '', { ko: '들여쓰기·내어쓰기', en: 'Indent and outdent' }],
  ['undo · redo', '', { ko: '실행 취소·다시 실행', en: 'Undo and redo' }],
  ['insertTable', 'rows = 3, cols = 3', { ko: '표 넣기', en: 'Insert a table' }],
  ['insertPageBreak', '', { ko: '쪽 나누기', en: 'Insert a page break' }],
  ['insertFootnote', '', { ko: '각주 넣기', en: 'Insert a footnote' }],
  ['setSuggesting', 'on', { ko: '제안 모드 켜고 끄기', en: 'Turn suggesting mode on or off' }],
  ['addComment', 'text', { ko: '선택에 댓글 달기', en: 'Comment on the selection' }],
  ['focus', '', { ko: '편집기에 초점 주기', en: 'Focus the editor' }],
];

const PLUGIN: Row[] = [
  ['name', 'string', { ko: '이름. 명령은 "이름.명령"으로 부른다', en: 'Name; its commands are run as "name.command"' }],
  ['commands', 'Record<string, (ctx, ...args) => boolean>', { ko: '명령. 처리했으면 true', en: 'Commands; return true when handled' }],
  ['keymap', 'Record<string, string>', { ko: "단축키 → 명령 ('Mod+Alt+K', Mod = Ctrl, 맥은 Cmd)", en: "Shortcut → command ('Mod+Alt+K'; Mod = Ctrl, Cmd on Mac)" }],
  ['decorations', '(ctx) => DecorationSource', { ko: '글자 위에 칠할 장식 (강조, 밑줄 등)', en: 'Decorations drawn over text (highlights, underlines)' }],
  ['contextMenu', '(ctx, at, point) => MenuItem[]', { ko: '오른쪽 클릭 메뉴 항목', en: 'Context menu items' }],
  ['exporters', 'Record<string, Exporter>', { ko: '내보내기 형식', en: 'Export formats' }],
  ['data', '{ schemaVersion, migrate? }', { ko: '문서에 함께 저장할 플러그인 데이터', en: 'Plugin data saved with the document' }],
  ['init', '(ctx) => void | (() => void)', { ko: '붙을 때. 정리 함수를 돌려주면 뗄 때 부른다', en: 'On attach; a returned function runs on detach' }],
];

function Table({ rows, lang, head }: { rows: Row[]; lang: Lang; head: [string, string, string] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b, c]) => (
            <tr key={a}>
              <th scope="row">
                <code>{a}</code>
              </th>
              <td>{b && <code>{b}</code>}</td>
              <td>{c[lang]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Sec({ id, lang, children }: { id: string; lang: Lang; children: ReactNode }) {
  const title = SECTIONS.find(([s]) => s === id)![1][lang];
  return (
    <section className="step" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  );
}

export default function Docs({ lang }: { lang: Lang }) {
  const ko = lang === 'ko';
  const H = ko ? (['이름', '타입', '설명'] as [string, string, string]) : (['Name', 'Type', 'Description'] as [string, string, string]);
  const C = ko ? (['명령', '인자', '하는 일'] as [string, string, string]) : (['Command', 'Arguments', 'What it does'] as [string, string, string]);
  const P = (k: ReactNode, e: ReactNode) => <p>{ko ? k : e}</p>;
  return (
    <DocsLayout lang={lang} page="/docs" sections={SECTIONS.map(([id, title]) => [id, title[lang]] as const)}>
        <h1>{ko ? 'API 문서' : 'API reference'}</h1>
        <p className="sub">
          {ko ? (
            <>
              Quire 0.2의 공개 API입니다. 처음이라면 <Link href={href(lang, '/guide')}>단계별 가이드</Link>부터 읽으세요. 타입은 패키지에 함께 실린 선언 파일이 기준입니다.
            </>
          ) : (
            <>
              The public API of Quire 0.2. New here? Start with the <Link href={href(lang, '/guide')}>step-by-step guide</Link>. The type declarations shipped in each package are the source of truth.
            </>
          )}
        </p>

        <Sec id="install" lang={lang}>
          {P('core 하나에 필요한 모듈만 더합니다. 모듈은 core를 peer 의존으로 받습니다.', 'Add only the modules you need to core. Modules take core as a peer dependency.')}
          <Code lang="sh" ui={lang}>{`npm install @quiredoc/core @quiredoc/fonts   # editor, .quire files
npm install @quiredoc/react                   # React
npm install @quiredoc/convert                 # HWPX, DOCX, Markdown, HTML
npm install @quiredoc/pdf harfbuzzjs          # PDF
npm install @quiredoc/collab                  # real-time collaboration`}</Code>
        </Sec>

        <Sec id="create" lang={lang}>
          {P(
            <>
              프레임워크 없이 쓸 때는 <code>createEditor</code>로 만듭니다. React라면 <a href="#react">React 절</a>의 <code>useQuire</code>가 이 일을 대신합니다.
            </>,
            <>
              Without a framework, create the editor with <code>createEditor</code>. In React, <code>useQuire</code> does this for you (see <a href="#react">React</a>).
            </>,
          )}
          <Code lang="ts" ui={lang}>{`import { createEditor } from '@quiredoc/core';

const editor = await createEditor({
  host: document.querySelector('#editor')!,
  fonts: [{ name: 'Pretendard', manifest: '/quire/fonts/pretendard/manifest.json' }],
});

editor.run('toggleBold');
const unsubscribe = editor.subscribe(() => console.log(editor.getState().canUndo));
// later: editor.destroy();`}</Code>
          <div className="note">
            {ko
              ? '문서 상태는 편집기가 가집니다. 앱은 문서를 따로 state로 들고 있지 않고, 저장할 때 subscribe와 디바운스로 toJSON()을 받습니다. destroy() 뒤 같은 요소에 다시 만들어도 됩니다 (React StrictMode).'
              : 'The editor owns the document state. Don’t mirror it in your app state; to save, subscribe (debounced) and call toJSON(). You can create a new editor on the same element after destroy() (React StrictMode).'}
          </div>
        </Sec>

        <Sec id="options" lang={lang}>
          {P(<><code>createEditor</code>와 <code>useQuire</code>가 받는 옵션입니다. 모두 선택입니다 (<code>host</code>는 <code>createEditor</code>에서만 필요).</>, <>Options for <code>createEditor</code> and <code>useQuire</code>. All are optional (<code>host</code> is required by <code>createEditor</code> only).</>)}
          <Table rows={OPTIONS} lang={lang} head={H} />
        </Sec>

        <Sec id="handle" lang={lang}>
          {P(<><code>createEditor</code>가 돌려주는 <code>QuireHandle</code>입니다. React의 제어기도 같은 이름의 메서드를 갖습니다.</>, <><code>createEditor</code> returns a <code>QuireHandle</code>. The React controller has the same methods.</>)}
          <Table rows={HANDLE} lang={lang} head={H} />
        </Sec>

        <Sec id="state" lang={lang}>
          {P(<><code>getState()</code>와 <code>useEditorState</code>가 주는 <code>EditorState</code>입니다. 도구 막대의 눌림·비활성 상태를 여기서 읽습니다.</>, <>The <code>EditorState</code> returned by <code>getState()</code> and read by <code>useEditorState</code>. Toolbars read pressed and disabled states from it.</>)}
          <Table rows={STATE} lang={lang} head={H} />
        </Sec>

        <Sec id="commands" lang={lang}>
          {P(<><code>run(이름, ...인자)</code>로 부르는 내장 명령입니다. 처리했으면 <code>true</code>를 돌려줍니다.</>, <>Built-in commands, run with <code>run(name, ...args)</code>. Each returns <code>true</code> when handled.</>)}
          <Table rows={COMMANDS} lang={lang} head={C} />
        </Sec>

        <Sec id="react" lang={lang}>
          {P(
            <>
              <code>@quiredoc/react</code>는 React 18 이상에서 씁니다. 서버 렌더링 프레임워크에서는 브라우저에서만 불러옵니다 (Next.js는 <code>next/dynamic</code>의 <code>ssr: false</code>).
            </>,
            <>
              <code>@quiredoc/react</code> needs React 18 or later. In server-rendering frameworks, load it in the browser only (in Next.js, <code>next/dynamic</code> with <code>ssr: false</code>).
            </>,
          )}
          <Code file="Editor.tsx" ui={lang}>{`'use client';
import { QuireEditor, useEditorState, useQuire } from '@quiredoc/react';

export default function Editor() {
  const editor = useQuire({ fonts });            // created once, from the first render's options
  const bold = useEditorState(editor, (s) => !!s.marksAtCaret.bold);
  return (
    <>
      <button aria-pressed={bold} onClick={() => editor.run('toggleBold')}>B</button>
      <QuireEditor editor={editor} style={{ height: '80vh' }} />
    </>
  );
}`}</Code>
          <ul>
            <li>{ko ? <><code>useQuire(options)</code>: 제어기를 처음 렌더의 옵션으로 한 번만 만듭니다. 붙기 전에도 쓸 수 있고, <code>handle</code>은 붙은 뒤 생깁니다.</> : <><code>useQuire(options)</code>: creates the controller once, from the first render’s options. Usable before mounting; <code>handle</code> appears after.</>}</li>
            <li>{ko ? <><code>useEditorState(editor, selector, isEqual?)</code>: 고른 값이 바뀔 때만 다시 그립니다. 새 객체를 만드는 selector에는 <code>isEqual</code>을 줍니다.</> : <><code>useEditorState(editor, selector, isEqual?)</code>: re-renders only when the selected value changes. Pass <code>isEqual</code> if your selector builds new objects.</>}</li>
            <li>{ko ? <><code>{'<QuireEditor editor className style />'}</code>: 편집기를 붙일 자리입니다.</> : <><code>{'<QuireEditor editor className style />'}</code>: where the editor mounts.</>}</li>
            <li>{ko ? <><code>createController(options)</code>: 컴포넌트 밖에서 제어기를 만들 때.</> : <><code>createController(options)</code>: create a controller outside a component.</>}</li>
          </ul>
        </Sec>

        <Sec id="fonts" lang={lang}>
          {P(
            <>
              Quire는 글꼴 파일을 직접 읽어 글자 모양을 잡습니다. <code>@quiredoc/fonts</code>의 <code>fonts</code> 폴더를 공개 폴더의 <code>/quire/fonts/</code>로 복사하고 <code>manifest</code>를 가리키면, 문서에 나온 글자가 든 조각만 받습니다.
            </>,
            <>
              Quire reads font files itself to shape glyphs. Copy the <code>fonts</code> folder of <code>@quiredoc/fonts</code> to <code>/quire/fonts/</code> in your public folder and point at a <code>manifest</code>; only the chunks holding the document’s characters are downloaded.
            </>,
          )}
          <Code lang="ts" ui={lang}>{`type FontSource = {
  name: string;
  manifest?: string;               // chunked font (recommended)
  bold?: { manifest: string };     // bold face; synthesized if omitted
  url?: string;                    // or a single font file
  data?: ArrayBuffer | Uint8Array;
};`}</Code>
        </Sec>

        <Sec id="saving" lang={lang}>
          {P(
            <>
              문서의 기준 형식은 <strong>정본 JSON</strong>(<code>QuireDoc</code>)입니다. <code>toJSON()</code>으로 받아 그대로 저장하고 <code>load()</code>나 <code>doc</code> 옵션으로 엽니다. 이미지까지 한 파일로 묶으려면 <code>.quire</code>(zip)를 씁니다.
            </>,
            <>
              The document’s source of truth is <strong>canonical JSON</strong> (<code>QuireDoc</code>). Store what <code>toJSON()</code> returns and open it with <code>load()</code> or the <code>doc</code> option. To bundle images in one file, use <code>.quire</code> (a zip).
            </>,
          )}
          <Code lang="ts" ui={lang}>{`import { assetIdsOf, openQuire, packQuire } from '@quiredoc/core';

// save
const src = handle.editor.printSource();
const assets = [];
for (const id of assetIdsOf(handle.editor.document)) {
  const bytes = await src.asset(id);
  if (bytes) assets.push({ id, mime: mimeOf(bytes), bytes }); // mimeOf from @quiredoc/convert
}
const file = await packQuire({ document: handle.editor.document, assets });

// open
const q = await openQuire(bytes);
await handle.load(q.doc, q.assets.map((a) => [a.id, { bytes: a.bytes, type: a.mime }]));`}</Code>
          <p>
            {ko ? <>형식 설명: <a href={doc('docs/design/07-file-format.md')}>파일 형식 설계 노트</a>.</> : <>Format details: <a href={doc('docs/design/07-file-format.md')}>file format design notes</a> (Korean).</>}
          </p>
        </Sec>

        <Sec id="convert" lang={lang}>
          {P(
            <>
              <code>@quiredoc/convert</code>는 브라우저와 Node에서 똑같이 돕니다. 가져오기는 <code>{'{ doc, assets, report }'}</code>를 돌려주고, <code>report.dropped</code>에 옮기지 못한 요소의 종류와 개수가 있습니다.
            </>,
            <>
              <code>@quiredoc/convert</code> runs the same in the browser and Node. Imports return <code>{'{ doc, assets, report }'}</code>; <code>report.dropped</code> counts the kinds of elements that could not be carried over.
            </>,
          )}
          <Code lang="ts" ui={lang}>{`importHwpx(bytes: Uint8Array): Promise<ImportResult>
importDocx(bytes: Uint8Array): Promise<ImportResult>
importMarkdown(md: string): Promise<ImportResult>
importHtml(html: string): Promise<ImportResult>

exportHwpx(doc: QuireDoc, { title?, asset? }): Promise<Uint8Array>
exportDocx(doc: QuireDoc, { title?, asset? }): Promise<Uint8Array>
exportHtml(doc: QuireDoc, { title?, asset? }): Promise<string>
exportMarkdown(doc: QuireDoc): string`}</Code>
          <p>
            {ko ? (
              <>
                <code>asset(id)</code>는 이미지 바이트를 <code>{'{ bytes, type }'}</code>로 돌려주는 함수입니다. 예시: <a href={tree('examples/node')}>Node 변환기 예제</a>.
              </>
            ) : (
              <>
                <code>asset(id)</code> returns an image’s bytes as <code>{'{ bytes, type }'}</code>. Example: <a href={tree('examples/node')}>the Node converter</a>.
              </>
            )}
          </p>
        </Sec>

        <Sec id="pdf" lang={lang}>
          {P(
            <>
              브라우저에서는 편집기의 조판 결과를 그대로 PDF로 만듭니다 (<code>exportPdf</code>). Node에서는 화면 없이 정본에서 바로 만듭니다 (<code>pdfFromQuire</code>). 둘 다 <code>harfbuzzjs</code>의 부분화 WASM으로 쓴 글자만 담습니다.
            </>,
            <>
              In the browser, <code>exportPdf</code> turns the editor’s own typesetting into a PDF. In Node, <code>pdfFromQuire</code> builds one straight from canonical JSON, no screen needed. Both embed only the used glyphs via the <code>harfbuzzjs</code> subsetting WASM.
            </>,
          )}
          <Code lang="ts" ui={lang}>{`import { exportPdf, loadSubsetter, pdfFromQuire } from '@quiredoc/pdf';

// browser
const src = handle.editor.printSource();
const wasm = await fetch('/quire/harfbuzz-subset.wasm').then((r) => r.arrayBuffer());
const { bytes, pages } = await exportPdf({
  env: src.env, fonts: src.fonts, asset: src.asset, title: src.title,
  subsetter: await loadSubsetter(wasm),
});

// Node
const result = await pdfFromQuire(doc, { fonts /* { name, bytes, bold? }[] */, subsetter });`}</Code>
        </Sec>

        <Sec id="plugins" lang={lang}>
          {P(<>플러그인은 명령, 단축키, 장식, 메뉴, 내보내기 형식, 문서 데이터를 더합니다. <code>plugins</code> 옵션이나 <code>use()</code>로 붙입니다.</>, <>Plugins add commands, shortcuts, decorations, menu items, export formats and document data. Attach them with the <code>plugins</code> option or <code>use()</code>.</>)}
          <Table rows={PLUGIN} lang={lang} head={H} />
          <Code lang="ts" ui={lang}>{`import type { QuirePlugin } from '@quiredoc/core';

const emphasis: QuirePlugin = {
  name: 'emphasis',
  commands: {
    // inside a plugin, built-in commands are 'core.<name>'
    strong: (ctx) => ctx.run('core.toggleBold') && ctx.run('core.toggleItalic'),
  },
  keymap: { 'Mod+Shift+E': 'emphasis.strong' },
};

editor.use(emphasis);
editor.run('emphasis.strong');`}</Code>
          <p>
            {ko ? (
              <>
                <code>ctx</code>(<code>PluginContext</code>)는 문서 읽기(<code>document</code>·<code>doc</code>·<code>selection</code>), 고치기(<code>edit</code>·<code>editDocument</code>, 실행 취소 한 단계), 화면(<code>caretRect</code>·<code>hitTest</code>·<code>redraw</code>), 이벤트(<code>on</code>), 문서 데이터(<code>getData</code>·<code>setData</code>), 번역(<code>t</code>)을 줍니다. 내장 예: <code>wordCountPlugin</code>, <code>highlightWordsPlugin</code>. 설계 노트: <a href={doc('docs/design/15-ecosystem.md')}>15 생태계</a>.
              </>
            ) : (
              <>
                <code>ctx</code> (<code>PluginContext</code>) offers reading (<code>document</code>, <code>doc</code>, <code>selection</code>), editing (<code>edit</code>, <code>editDocument</code>, one undo step), the screen (<code>caretRect</code>, <code>hitTest</code>, <code>redraw</code>), events (<code>on</code>), document data (<code>getData</code>, <code>setData</code>) and translation (<code>t</code>). Built-in examples: <code>wordCountPlugin</code>, <code>highlightWordsPlugin</code>. Design notes: <a href={doc('docs/design/15-ecosystem.md')}>15 ecosystem</a> (Korean).
              </>
            )}
          </p>
        </Sec>

        <Sec id="themes" lang={lang}>
          {P(
            <>
              <code>theme</code>(classic·minimal·modern)과 <code>colorScheme</code>(light·dark·auto)을 고르고, 세부 색은 CSS 변수로 덮어씁니다. 테마는 화면만 바꾸고 문서와 쪽 나눔은 그대로입니다.
            </>,
            <>
              Pick a <code>theme</code> (classic, minimal, modern) and a <code>colorScheme</code> (light, dark, auto), then override details with CSS variables. Themes change only the screen, never the document or pagination.
            </>,
          )}
          <Code file="app.css" ui={lang}>{`.my-editor {
  --quire-desk: #f4efe6;      /* around the pages */
  --quire-accent: #8a2b2b;    /* caret, focus */
  --quire-selection: #8a2b2b33;
}`}</Code>
          <Code lang="scss" ui={lang}>{`@use 'pkg:@quiredoc/core/tokens.scss' as quire;
.my-editor { @include quire.theme((accent: #8a2b2b, page-shadow: none)); }`}</Code>
          <p>
            {ko ? (
              <>
                변수 목록은 <code>THEME_VARIABLES</code>, JS에서 넣을 때는 <code>themeDeclarations(tokens)</code>. 전체 표: <a href={doc('docs/design/17-themes.md')}>17 테마</a>.
              </>
            ) : (
              <>
                All variables are listed in <code>THEME_VARIABLES</code>; from JS use <code>themeDeclarations(tokens)</code>. Full table: <a href={doc('docs/design/17-themes.md')}>17 themes</a> (Korean).
              </>
            )}
          </p>
        </Sec>

        <Sec id="i18n" lang={lang}>
          {P(
            <>
              편집기 화면 언어는 <code>locale</code>로 정합니다. 기본은 한국어이고 영어 묶음은 처음 필요할 때 따로 받습니다. 첫 그림부터 영어여야 하면 미리 넣어 둡니다.
            </>,
            <>
              Set the editor’s interface language with <code>locale</code>. Korean is the default; the English bundle loads on first use. To render English from the very first paint, register it up front.
            </>,
          )}
          <Code lang="ts" ui={lang}>{`import { registerMessages } from '@quiredoc/core';
import { en } from '@quiredoc/core/i18n/en';

registerMessages('en', en);
const editor = useQuire({ fonts, locale: 'en', messages: { en: { 'break.page': 'Page break' } } });`}</Code>
        </Sec>

        <Sec id="collab" lang={lang}>
          {P(
            <>
              <code>@quiredoc/collab</code>은 플러그인 하나로 실시간 협업을 붙입니다. 동기화(Loro CRDT)는 Worker에서 돌고, 동기화 서버는 오래 열린 WebSocket이 필요해 서버리스 함수가 아닌 별도 프로세스로 둡니다 (<a href={tree('apps/sync-server')}>apps/sync-server</a>).
            </>,
            <>
              <code>@quiredoc/collab</code> adds real-time collaboration as a single plugin. Sync (Loro CRDT) runs in a Worker. The sync server needs long-lived WebSockets, so run it as its own process rather than a serverless function (<a href={tree('apps/sync-server')}>apps/sync-server</a>).
            </>,
          )}
          <Code file="sync-worker.ts" ui={lang}>{`import { serveSyncWorker } from '@quiredoc/collab';
serveSyncWorker(self);`}</Code>
          <Code lang="ts" ui={lang}>{`import { collab } from '@quiredoc/collab';

const sync = collab({
  worker: () => new Worker(new URL('./sync-worker.ts', import.meta.url), { type: 'module' }),
  url: 'wss://sync.example.com/room-1?token=…',
  user: { name: 'Kim', color: '1' },     // palette slot '1'–'8' or a CSS color
  onStatus: (online) => console.log(online ? 'online' : 'offline'),
});
editor.use(sync);
await sync.ready;`}</Code>
          <p>
            {ko
              ? '그 밖의 옵션: peer, text(빈 방의 처음 글), batchMs, onReady, onRole(edit·comment·view), onReset, onPresence. 협업 기록까지 .quire에 담으려면 packQuireWithHistory, 열 때는 restoreHistory.'
              : 'Other options: peer, text (initial text for an empty room), batchMs, onReady, onRole (edit, comment, view), onReset, onPresence. To keep collaboration history in a .quire file use packQuireWithHistory, and restoreHistory when opening.'}
          </p>
        </Sec>

        <Sec id="versions" lang={lang}>
          {P(
            <>
              Quire는 아직 0.x입니다. 판이 올라갈 때 API가 바뀔 수 있고, 바뀐 것은 <a href={doc('CHANGELOG.md')}>CHANGELOG</a>에 옛 이름과 새 이름을 함께 적습니다. 모든 <code>@quiredoc/*</code> 패키지는 같은 판 번호를 씁니다.
            </>,
            <>
              Quire is still 0.x. APIs may change between versions; the <a href={doc('CHANGELOG.md')}>CHANGELOG</a> lists old and new names for every change. All <code>@quiredoc/*</code> packages share one version number.
            </>,
          )}
        </Sec>
    </DocsLayout>
  );
}
