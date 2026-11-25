import type { Metadata } from 'next';
import Link from 'next/link';
import Code from '../../../components/Code';
import { doc, tree } from '../../../../lib/links';

export const metadata: Metadata = {
  title: 'Build an example app',
  description: 'Put the Quire editor in a Next.js app, add a toolbar and HWPX, DOCX and PDF saving, and deploy it to Vercel, step by step.',
};

const STEPS = [
  ['create', 'Create a Next.js app'],
  ['install', 'Install the packages'],
  ['fonts', 'Copy the fonts'],
  ['editor', 'The editor component'],
  ['client', 'Load it in the browser only'],
  ['toolbar', 'A toolbar'],
  ['files', 'Open and save files'],
  ['pdf', 'Save as PDF'],
  ['deploy', 'Deploy to Vercel'],
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
      <nav className="toc" aria-label="Steps">
        <p>Steps</p>
        <ol>
          {STEPS.map(([id, title]) => (
            <li key={id}>
              <a href={`#${id}`}>{title}</a>
            </li>
          ))}
        </ol>
      </nav>
      <article>
        <p className="kicker">A guide</p>
        <h1>Build an example app</h1>
        <p className="sub">
          Start from an empty Next.js app, add the Quire editor, a toolbar, opening and saving files and PDF export, then deploy it to Vercel. You end up with the same app as{' '}
          <Link href="/en#demo">the demo on the front page</Link>. You need Node.js 20 or later.
        </p>

        <Step n={1} id="create">
          <p>Create a new Next.js app. When asked, choose TypeScript and the App Router.</p>
          <Code lang="sh" ui="en">{`npx create-next-app@latest quire-app
cd quire-app`}</Code>
        </Step>

        <Step n={2} id="install">
          <p>
            Install <code>@quiredoc/core</code> (the editor itself), <code>@quiredoc/react</code> (the React bindings) and <code>@quiredoc/fonts</code> (the fonts). Conversion and PDF come in steps 7 and 8.
          </p>
          <Code lang="sh" ui="en">{`npm install @quiredoc/core @quiredoc/react @quiredoc/fonts`}</Code>
        </Step>

        <Step n={3} id="fonts">
          <p>
            Quire reads font files itself to shape every glyph. Copy the font chunks from <code>@quiredoc/fonts</code> into your <code>public</code> folder, so the browser downloads only the chunks that hold the characters in a document. A small script does it on every install.
          </p>
          <Code file="scripts/copy-assets.mjs" ui="en">{`
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = resolve('public', 'quire');
const require = createRequire(join(process.cwd(), 'package.json'));
const fonts = join(require.resolve('@quiredoc/fonts/package.json'), '..', 'fonts');
mkdirSync(dir, { recursive: true });
cpSync(fonts, join(dir, 'fonts'), { recursive: true });

// Once harfbuzzjs is installed (step 8), also copy the font-subsetting WASM
try {
  const hb = require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm');
  if (existsSync(hb)) cpSync(hb, join(dir, 'harfbuzz-subset.wasm'));
} catch {}
`}</Code>
          <p>
            Add a <code>postinstall</code> script to <code>package.json</code> and run it once.
          </p>
          <Code file="package.json" ui="en">{`
"scripts": {
  "postinstall": "node scripts/copy-assets.mjs",
  "dev": "next dev",
  "build": "next build",
  "start": "next start"
}
`}</Code>
          <Code lang="sh" ui="en">{`npm run postinstall`}</Code>
          <p>
            The copied files are recreated on every install, so add <code>/public/quire</code> to <code>.gitignore</code>.
          </p>
        </Step>

        <Step n={4} id="editor">
          <p>
            Write the editor component. <code>useQuire</code> creates the editor and <code>QuireEditor</code> mounts it. The fonts point at the files copied in step 3, and <code>locale</code> sets the editor’s own interface language (menus, messages).
          </p>
          <Code file="app/Editor.tsx" ui="en">{`
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
  const editor = useQuire({ fonts, locale: 'en' });
  return <QuireEditor editor={editor} style={{ height: '100vh' }} />;
}
`}</Code>
          <div className="note">
            <code>useQuire</code> creates the editor once, from the options of the first render. Change things later (the document, formatting) with <code>editor.run(…)</code> commands or <code>editor.load(…)</code>.
          </div>
        </Step>

        <Step n={5} id="client">
          <p>
            The editor works with a canvas and the input method, so there is nothing to render on the server. Load it in the browser only with <code>next/dynamic</code> and <code>ssr: false</code>. That option is only allowed inside a client component, hence a small loader.
          </p>
          <Code file="app/EditorLoader.tsx" ui="en">{`
'use client';
import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('./Editor'), {
  ssr: false,
  loading: () => <p>Loading the editor…</p>,
});

export default function EditorLoader() {
  return <Editor />;
}
`}</Code>
          <Code file="app/page.tsx" ui="en">{`
import EditorLoader from './EditorLoader';

export default function Page() {
  return <EditorLoader />;
}
`}</Code>
          <p>
            Start it with <code>npm run dev</code> and open <code>http://localhost:3000</code>. You should see a blank page; click it and type. If the screen stays empty, check the browser’s network tab for a 404 on <code>/quire/fonts/…/manifest.json</code>: that means step 3 did not copy the fonts.
          </p>
        </Step>

        <Step n={6} id="toolbar">
          <p>First move the font list into its own file, since steps 7 and 8 use it too. Take the <code>fonts</code> from step 4 as is and export it.</p>
          <Code file="app/fonts.ts" ui="en">{`
import type { FontSource } from '@quiredoc/core';

export const fonts: FontSource[] = [
  {
    name: 'Pretendard',
    manifest: '/quire/fonts/pretendard/manifest.json',
    bold: { manifest: '/quire/fonts/pretendard-bold/manifest.json' },
  },
  { name: 'Noto Sans KR', manifest: '/quire/fonts/noto-sans-kr/manifest.json' },
];
`}</Code>
          <p>
            <code>useEditorState</code> picks only the values you need from the editor state. The component re-renders only when a picked value changes, so typing does not re-render the toolbar. Buttons send commands with <code>editor.run</code>.
          </p>
          <Code file="app/Editor.tsx" ui="en">{`
'use client';
import { QuireEditor, useEditorState, useQuire } from '@quiredoc/react';
import { fonts } from './fonts';

export default function Editor() {
  const editor = useQuire({ fonts, locale: 'en' });
  const bold = useEditorState(editor, (s) => !!s.marksAtCaret.bold);
  const canUndo = useEditorState(editor, (s) => s.canUndo);
  const style = useEditorState(editor, (s) => s.paragraphStyle);

  const run = (command: string, ...args: unknown[]) => {
    editor.run(command, ...args);
    editor.run('focus'); // keep typing right after clicking a button
  };

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100vh' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8 }}>
        <button aria-pressed={bold} onClick={() => run('toggleBold')}>Bold</button>
        <button disabled={!canUndo} onClick={() => run('undo')}>Undo</button>
        <select value={style} onChange={(e) => run('setStyle', e.target.value)}>
          <option value="body">Body</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
        </select>
      </div>
      <QuireEditor editor={editor} style={{ minHeight: 0 }} />
    </div>
  );
}
`}</Code>
          <p>
            Other commands include <code>toggleItalic</code>, <code>toggleUnderline</code>, <code>redo</code>, <code>setStyle</code> and <code>setAlign</code> (<Link href="/en/docs#commands">all commands</Link>).
          </p>
        </Step>

        <Step n={7} id="files">
          <p>
            <code>@quiredoc/convert</code> opens and saves HWPX, DOCX and Markdown. It all runs in the browser; files never go to a server. Load it with <code>import()</code> when first used, so it does not add to the JavaScript loaded at startup.
          </p>
          <Code lang="sh" ui="en">{`npm install @quiredoc/convert`}</Code>
          <Code file="app/files.ts" ui="en">{`
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
  return result.report; // elements that could not be carried over (report.dropped)
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
          <p>Add buttons to the toolbar.</p>
          <Code file="app/Editor.tsx" ui="en">{`
import { useRef } from 'react';
import { openFile, saveHwpx } from './files';

// inside Editor
const input = useRef<HTMLInputElement>(null);

<button onClick={() => input.current?.click()}>Open</button>
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
<button onClick={() => void saveHwpx(editor)}>Save as HWPX</button>
`}</Code>
          <p>
            Use <code>exportDocx</code> for DOCX and <code>exportMarkdown</code> for Markdown the same way. If the document has images, pass their bytes through the <code>asset</code> option (<a href={tree('examples/shared')}>quire-demo.ts in the examples</a>).
          </p>
        </Step>

        <Step n={8} id="pdf">
          <p>
            <code>@quiredoc/pdf</code> produces a PDF with the same page breaks as the screen, embedding only the glyphs the document uses. It shrinks the fonts with the WASM build of <code>harfbuzzjs</code>.
          </p>
          <Code lang="sh" ui="en">{`npm install @quiredoc/pdf harfbuzzjs`}</Code>
          <p>
            After installing, the step 3 script also copies <code>public/quire/harfbuzz-subset.wasm</code>. harfbuzzjs calls Node’s built-in <code>module</code> only under Node, so replace it with an empty module in the browser bundle.
          </p>
          <Code file="lib/empty-module.js" ui="en">{`
export const createRequire = () => () => {
  throw new Error('module: not used in the browser');
};
export default {};
`}</Code>
          <Code file="next.config.mjs" ui="en">{`
/** @type {import('next').NextConfig} */
export default {
  turbopack: { resolveAlias: { module: { browser: './lib/empty-module.js' } } },
  webpack: (config, { isServer }) => {
    if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, module: false };
    return config;
  },
};
`}</Code>
          <Code file="app/files.ts" ui="en">{`
export async function savePdf(editor: QuireController) {
  const handle = editor.handle;
  if (!handle) return;
  const pdf = await import('@quiredoc/pdf');
  const src = handle.editor.printSource(); // the same typesetting as the screen
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
            Push it to a Git repository and import it on <a href="https://vercel.com/new">Vercel</a>. Vercel recognizes Next.js, so there is nothing to configure, and it runs <code>postinstall</code> during the install to copy the fonts.
          </p>
          <Code lang="sh" ui="en">{`git init && git add -A && git commit -m "Quire example app"
# create a GitHub repository, push, then Import it on Vercel`}</Code>
          <p>The finished app looks like this.</p>
          <pre className="tree code" style={{ padding: 14 }}>{`quire-app/
├─ app/
│  ├─ Editor.tsx        editor and toolbar
│  ├─ EditorLoader.tsx  browser-only loading
│  ├─ files.ts          open, save, PDF
│  ├─ fonts.ts          font locations
│  └─ page.tsx
├─ lib/empty-module.js
├─ scripts/copy-assets.mjs
├─ next.config.mjs
└─ public/quire/        (copied on install, not in git)`}</pre>
        </Step>

        <section className="step" aria-labelledby="next-title">
          <h2 id="next-title">Where next</h2>
          <ul>
            <li>
              <Link href="/en/docs">The API docs</Link>: every editor option, command and state field
            </li>
            <li>
              <a href={tree('examples')}>10 example apps</a>: Vue, Svelte, vanilla JS, converting in Node, and Next.js apps styled like Word and Notion
            </li>
            <li>
              <Link href="/en/docs#themes">Themes</Link>: match the editor’s colors and fonts to your app
            </li>
            <li>
              <Link href="/en/docs#collab">Real-time collaboration</Link> with <code>@quiredoc/collab</code> (design notes: <a href={doc('docs/design/14-collaboration-history.md')}>collaboration and history</a>, in Korean)
            </li>
          </ul>
        </section>
      </article>
    </div>
  );
}
