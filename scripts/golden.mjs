#!/usr/bin/env node
/**
 * 레이아웃 골든 비교 (16 §5, R3): 기준 문서 세트를 헤드리스 브라우저에서 조판해 Node 시험의 기대값(fixtures/docs/*.expected.json)과
 * 같은지 본다. 브라우저마다 apps/playground/golden.html을 열고 window.goldenResult를 읽는다.
 *
 *   node scripts/golden.mjs                 # 찾은 브라우저 모두 (Chrome, Edge)
 *   node scripts/golden.mjs --only report   # 한 문서만
 *   QUIRE_BENCH_BROWSER=/usr/bin/google-chrome node scripts/golden.mjs
 *
 * 하나라도 다르면 종료 코드 1.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { connectPage, findBrowser, runPage, startBrowser, startVite, stopBrowser } from './headless.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};

function browsers() {
  if (process.env.QUIRE_BENCH_BROWSER) return [process.env.QUIRE_BENCH_BROWSER];
  const all = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter((p) => existsSync(p));
  return all.length ? all : [findBrowser()];
}

async function main() {
  const port = Number(opt('--port', 5181));
  const only = opt('--only', null);
  const vite = await startVite(port);
  const results = [];
  let ok = true;
  try {
    for (const exe of browsers()) {
      const b = await startBrowser(exe);
      try {
        const page = await connectPage(b.port);
        await page.send('Page.enable');
        await page.send('Runtime.enable');
        const r = await runPage(page, `http://localhost:${port}/golden.html${only ? `?only=${only}` : ''}`, 'goldenResult', 300000);
        await page.close();
        const ua = (r.userAgent.match(/Edg\/[\d.]+/) ?? r.userAgent.match(/(HeadlessChrome|Chrome)\/[\d.]+/))?.[0] ?? r.userAgent;
        console.log(`\n${exe}\n  ${ua}`);
        for (const d of r.docs) {
          console.log(`  ${d.name.padEnd(12)} ${String(d.pages).padStart(3)}쪽  편집기 ${d.editor.ok ? '같음' : '다름'} (${d.editor.ms} ms)  통째 글꼴 ${d.whole.ok ? '같음' : '다름'}  편집 기호 ${d.marks.ok ? '같음' : '다름'}`);
          if (d.editor.diff) console.log(`      편집기: ${d.editor.diff}`);
          if (d.whole.diff) console.log(`      통째: ${d.whole.diff}`);
          if (d.marks.diff) console.log(`      편집 기호: ${d.marks.diff}`);
        }
        ok &&= r.ok;
        results.push({ browser: exe, ...r });
      } finally {
        await stopBrowser(b);
      }
    }
  } finally {
    vite.kill();
  }
  const out = opt('--out', null);
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
  }
  console.log(ok ? '\n결과: 모든 브라우저에서 기대값과 같음' : '\n결과: 다른 것이 있음');
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
