#!/usr/bin/env node
/**
 * 예제 앱 스크린샷 (examples/<예제>/screenshots/*.webp): 예제마다 개발 서버를 띄우고 헤드리스 Chrome으로 장면을 찍는다.
 * 장면마다 페이지를 새로 불러 상태가 섞이지 않게 한다. 예제를 먼저 설치해 두어야 한다 (examples/README.md).
 *
 *   node scripts/example-screenshots.mjs                 # 모두
 *   node scripts/example-screenshots.mjs react-full      # 하나만
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { click, connectPage, evaluate, findBrowser, hover, startBrowser, startDevServer, stopBrowser } from './headless.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1440;
const H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vite = (dir, port) => [`examples/${dir}/node_modules/vite/bin/vite.js`, `examples/${dir}`, '--port', String(port), '--strictPort'];
const next = (dir, port) => [`examples/${dir}/node_modules/next/dist/bin/next`, 'dev', `examples/${dir}`, '-p', String(port)];

/** 편집기가 준비될 때까지: 글자 수 플러그인이 상태 줄을 채우면 (모든 예제에 있다) */
async function ready(page) {
  for (let i = 0; ; i++) {
    const ok = await evaluate(page, `document.body.innerText.includes('어절') && !!document.querySelector('canvas')`).catch(() => false);
    if (ok) break;
    // 첫 컴파일(Next.js)은 오래 걸린다. 그래도 3분 안에 안 뜨면 준비가 안 된 화면을 찍지 않고 멈춘다
    if (i > 360) throw new Error('편집기가 3분 안에 준비되지 않음 (같은 예제의 개발 서버가 이미 떠 있지 않은지 보세요: Next.js는 하나만 허용)');
    await sleep(500);
  }
  await sleep(1500); // 글꼴 조각을 받고 다시 그릴 시간
}

const editor = `window.quire.handle.editor`;
/** 전체 기능 앱의 장면들 (react-full, next-shadcn이 같은 장면을 찍는다) */
const FULL_SHOTS = [
  { name: 'overview', about: '첫 화면: 기능 둘러보기 문서, 개요, 댓글 창', run: async () => {} },
  {
    name: 'menu',
    about: '서식 › 한글 조판 메뉴',
    run: async (page) => {
      await click(page, 'text:서식');
      await sleep(400);
      await hover(page, 'text:한글 조판');
      await sleep(600);
    },
  },
  {
    name: 'table',
    about: '표 안: 상황별 표 도구 줄',
    run: async (page) => {
      await evaluate(page, `(() => { const e = ${editor}; e.find({ text: '칸 5' }); e.findNext(1); e.clearFind(); e.focus(); })()`);
      await sleep(600);
    },
  },
  {
    name: 'suggestions',
    about: '제안 창: 제안 모드로 고친 것을 수락·거부',
    run: async (page) => {
      await evaluate(page, `(() => { const e = ${editor}; const s = e.suggestionViews()[0]; if (s) e.revealSuggestion(s.id); })()`);
      await sleep(300);
      await click(page, 'text:제안');
      await sleep(600);
    },
  },
  {
    name: 'page-setup',
    about: '쪽 설정 대화상자: 용지·방향·여백·다단·쪽 번호',
    run: async (page) => {
      await click(page, 'text:파일');
      await sleep(400);
      await click(page, 'text:쪽 설정');
      await sleep(800);
    },
  },
  {
    name: 'newsletter',
    about: '예제 문서 소식지: 구역마다 다른 다단',
    run: async (page) => {
      await evaluate(page, `fetch('/quire/samples/newsletter.json').then((r) => r.json()).then((d) => window.quire.load(d))`);
      await sleep(2500);
    },
  },
];

const BASIC = [{ name: 'screenshot', about: '첫 화면', run: async () => {} }];

const EXAMPLES = [
  { id: 'vanilla', args: (p) => vite('vanilla', p), shots: BASIC },
  { id: 'react-vite', args: (p) => vite('react-vite', p), shots: BASIC },
  { id: 'next', args: (p) => next('next', p), shots: BASIC },
  { id: 'vue', args: (p) => vite('vue', p), shots: BASIC },
  { id: 'svelte', args: (p) => vite('svelte', p), shots: BASIC },
  { id: 'react-full', args: (p) => vite('react-full', p), shots: FULL_SHOTS },
  { id: 'next-shadcn', args: (p) => next('next-shadcn', p), shots: FULL_SHOTS },
];

async function main() {
  const only = process.argv.slice(2);
  const list = EXAMPLES.filter((e) => !only.length || only.includes(e.id));
  const browser = await startBrowser(findBrowser());
  let port = 5410;
  try {
    for (const ex of list) {
      if (!existsSync(join(root, 'examples', ex.id, 'node_modules'))) {
        console.log(`${ex.id}: 설치되지 않아 건너뜀`);
        continue;
      }
      port++;
      const server = await startDevServer(ex.args(port), port);
      try {
        const outDir = join(root, 'examples', ex.id, 'screenshots');
        mkdirSync(outDir, { recursive: true });
        for (const shot of ex.shots) {
          const page = await connectPage(browser.port);
          await page.send('Page.enable');
          await page.send('Runtime.enable');
          await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
          await page.send('Page.navigate', { url: `http://localhost:${port}/` });
          await ready(page);
          await shot.run(page);
          const { data } = await page.send('Page.captureScreenshot', { format: 'webp', quality: 82 });
          const file = join(outDir, `${shot.name}.webp`);
          writeFileSync(file, Buffer.from(data, 'base64'));
          console.log(`${ex.id}/${shot.name}.webp  ${(Buffer.from(data, 'base64').length / 1024).toFixed(0)} KB  · ${shot.about}`);
          await page.close();
        }
      } finally {
        server.kill();
      }
    }
  } finally {
    await stopBrowser(browser);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
