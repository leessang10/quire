/**
 * 헤드리스 브라우저 실행 도우미 (16 §4·§5): 플레이그라운드 개발 서버와 헤드리스 Chrome·Edge를 띄우고 DevTools 프로토콜로 몬다.
 * 브라우저 자동화 패키지 없이 Node 22의 내장 WebSocket만 쓴다. scripts/bench.mjs, scripts/golden.mjs가 쓴다.
 *
 * 브라우저: QUIRE_BENCH_BROWSER, 없으면 흔한 설치 경로 (Chrome → Edge → chromium)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function findBrowser() {
  const env = process.env.QUIRE_BENCH_BROWSER;
  if (env) return env;
  const list = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const hit = list.find((p) => existsSync(p));
  if (!hit) throw new Error('Chrome·Edge를 찾지 못했습니다. QUIRE_BENCH_BROWSER로 경로를 주세요');
  return hit;
}

/** 줄 단위로 출력을 보다가 pattern이 나오면 그 일치를 돌려준다 */
function waitFor(stream, pattern, ms, what) {
  return new Promise((res, rej) => {
    let buf = '';
    const timer = setTimeout(() => rej(new Error(`${what}: ${ms}ms 안에 시작하지 않음\n${buf}`)), ms);
    stream.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(pattern);
      if (m) {
        clearTimeout(timer);
        res(m);
      }
    });
  });
}

export async function startVite(port) {
  const p = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'apps/playground', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 색 코드가 섞여도 되게 주소만 찾는다
  await waitFor(p.stdout, new RegExp(`localhost:\\x1b?\\[?[0-9;]*m?${port}`), 30000, 'vite');
  return p;
}

export async function startBrowser(exe) {
  const profile = mkdtempSync(join(tmpdir(), 'quire-headless-'));
  const p = spawn(
    exe,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1400,1000',
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-precise-memory-info',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  // 포트: 프로필 폴더의 DevToolsActivePort 첫 줄 (Edge는 stderr에 주소를 찍지 않는다)
  const file = join(profile, 'DevToolsActivePort');
  const t0 = Date.now();
  while (!existsSync(file) || !readFileSync(file, 'utf8').includes('\n')) {
    if (Date.now() - t0 > 30000) throw new Error(`브라우저가 30초 안에 시작하지 않음: ${exe}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  const port = Number(readFileSync(file, 'utf8').split('\n')[0]);
  return { p, port, profile };
}

/** 새 탭을 열고 붙는 작은 CDP 클라이언트 (실행마다 새 탭: 앞 실행의 힙이 남지 않게) */
export async function connectPage(port) {
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(m.error.message));
      else res(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const close = async () => {
    ws.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`).catch(() => {});
  };
  return { send, close };
}

export async function evaluate(page, expression) {
  const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

/** 페이지를 열고 window[name] 결과(또는 window[name.replace('Result','Error')] 오류)가 생길 때까지 기다린다 */
export async function runPage(page, url, name, timeoutMs = 180000) {
  const err = name.replace(/Result$/, 'Error');
  await page.send('Page.navigate', { url });
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 500));
    const v = await evaluate(page, `JSON.stringify({ r: window.${name} ?? null, e: window.${err} ?? null })`).catch(() => null);
    if (v) {
      const { r, e } = JSON.parse(v);
      if (e) throw new Error(e);
      if (r) return r;
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`${url}: ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않음`);
  }
}

/** 브라우저를 끄고 끝나기를 기다린 뒤 임시 프로필을 지운다 (지우지 못해도 넘어간다: 아직 파일을 잡고 있을 수 있다) */
export async function stopBrowser(b) {
  const done = new Promise((r) => {
    if (b.p.exitCode !== null) r();
    else b.p.once('exit', r);
  });
  b.p.kill();
  await Promise.race([done, new Promise((r) => setTimeout(r, 5000))]);
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(b.profile, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
