#!/usr/bin/env node
/**
 * 성능 벤치마크 실행·비교 (16 §4): 플레이그라운드 개발 서버를 띄우고, 헤드리스 Chrome(또는 Edge)에서 bench.html을
 * 여러 번 돌려 지표마다 가운뎃값을 낸 뒤 기준선(bench/baseline.json)과 06 §3 목표와 비교한다.
 * 브라우저 자동화 패키지 없이 DevTools 프로토콜(WebSocket)만 쓴다.
 *
 *   node scripts/bench.mjs                  # 3번 돌려 비교. 나빠지면 종료 코드 1
 *   node scripts/bench.mjs --runs 5 --out bench/last.json
 *   node scripts/bench.mjs --update-baseline   # 결과를 기준선으로 쓴다
 *   node scripts/bench.mjs --compare a.json    # 돌리지 않고 결과 파일만 비교
 *   node scripts/bench.mjs --targets-only      # 기준선 없이 06 §3 목표만 (기준선과 다른 기기, CI)
 *
 * 브라우저: QUIRE_BENCH_BROWSER, 없으면 흔한 설치 경로 (Chrome → Edge → chromium)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPage, evaluate, findBrowser, startBrowser, startVite, stopBrowser } from './headless.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(root, 'bench', 'baseline.json');

/** 지표: [이름, 방향, 06 §3 목표 (없으면 null), 기준선 비교의 절대 여유] */
export const METRICS = {
  inputP95Ms: ['입력 p95 (ms)', 'lower', 16, 1],
  inputP50Ms: ['입력 p50 (ms)', 'lower', null, 1],
  firstScreenMs: ['첫 화면 (ms)', 'lower', 1000, 100],
  firstFrameMs: ['첫 프레임 (ms)', 'lower', null, 50],
  fullLayoutMs: ['전체 조판 (ms)', 'lower', 10000, 300],
  scrollFps: ['스크롤 (fps)', 'higher', 55, 3],
  scrollP95FrameMs: ['스크롤 프레임 p95 (ms)', 'lower', null, 3],
  heapMB: ['메모리 (MB)', 'lower', 500, 15],
};
/** 기준선보다 이만큼 넘게 나빠지면 실패 (상대) */
export const TOLERANCE = 0.2;

/** 결과를 기준선·목표와 비교한다. 실패한 줄이 있으면 ok: false */
export function compare(result, baseline) {
  const rows = [];
  let ok = true;
  for (const [key, [label, dir, target, slack]] of Object.entries(METRICS)) {
    const v = result.metrics[key];
    const b = baseline?.metrics?.[key];
    if (v === null || v === undefined) {
      rows.push({ label, value: '-', base: b ?? '-', note: '잴 수 없음' });
      continue;
    }
    const notes = [];
    if (target !== null && (dir === 'lower' ? v > target : v < target)) notes.push(dir === 'lower' ? `목표 ≤ ${target} 넘음` : `목표 ≥ ${target}에 못 미침`);
    if (typeof b === 'number') {
      const worse = dir === 'lower' ? v - b : b - v;
      if (worse > slack && worse > Math.abs(b) * TOLERANCE) notes.push(`기준선보다 ${Math.round((worse / Math.abs(b)) * 100)}% 나쁨`);
    }
    if (notes.length) ok = false;
    rows.push({ label, value: v, base: b ?? '-', note: notes.join(', ') || 'ok' });
  }
  return { ok, rows };
}

function median(xs) {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
}

async function runOnce(page, url) {
  await page.send('Page.navigate', { url });
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 500));
    const v = await evaluate(page, 'JSON.stringify({ r: window.benchResult ?? null, e: window.benchError ?? null })').catch(() => null);
    if (v) {
      const { r, e } = JSON.parse(v);
      if (e) throw new Error(e);
      if (r) {
        // 힙: GC를 한 번 돌린 뒤 (페이지 안 performance.memory는 GC 시점에 따라 흔들린다)
        await page.send('HeapProfiler.collectGarbage');
        // JS 객체 + 임베더(DOM) + ArrayBuffer·WASM 메모리. 캔버스(GPU) 메모리는 들지 않는다
        const u = await page.send('Runtime.getHeapUsage');
        const bytes = u.usedSize + (u.embedderHeapUsedSize ?? 0) + (u.backingStorageSize ?? 0);
        r.metrics.heapMB = Math.round((bytes / 2 ** 20) * 10) / 10;
        return r;
      }
    }
    if (Date.now() - t0 > 180000) throw new Error('벤치마크가 3분 안에 끝나지 않음');
  }
}

function printTable(result, baseline, { ok, rows }) {
  console.log(`\n${result.pages.toLocaleString()}쪽 · 문단 ${result.paragraphs.toLocaleString()}개 · ${result.runs ?? 1}번의 가운뎃값`);
  if (baseline) console.log(`기준선: ${baseline.date} (${baseline.machine ?? '?'})`);
  const w = Math.max(...rows.map((r) => r.label.length));
  for (const r of rows) console.log(`  ${r.label.padEnd(w)}  ${String(r.value).padStart(8)}  기준 ${String(r.base).padStart(8)}  ${r.note}`);
  console.log(ok ? '\n결과: 통과' : '\n결과: 실패');
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
  };
  const baseline = !args.includes('--targets-only') && existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;

  const only = opt('--compare', null);
  if (only) {
    const result = JSON.parse(readFileSync(only, 'utf8'));
    const c = compare(result, baseline);
    printTable(result, baseline, c);
    process.exit(c.ok ? 0 : 1);
  }

  const runs = Number(opt('--runs', 3));
  const pages = Number(opt('--pages', 1000));
  const port = Number(opt('--port', 5180));
  const exe = findBrowser();
  console.log(`브라우저: ${exe}`);
  const vite = await startVite(port);
  const browser = await startBrowser(exe);
  const all = [];
  try {
    for (let i = 0; i < runs; i++) {
      const page = await connectPage(browser.port);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      const r = await runOnce(page, `http://localhost:${port}/bench.html?pages=${pages}&run=${i}`);
      await page.close();
      console.log(`  ${i + 1}/${runs}: ${JSON.stringify(r.metrics)}`);
      all.push(r);
    }
  } finally {
    await stopBrowser(browser);
    vite.kill();
  }
  const first = all[0];
  const result = {
    date: new Date().toISOString(),
    machine: opt('--machine', process.env.QUIRE_BENCH_MACHINE ?? `${process.platform} ${process.arch}`),
    userAgent: first.userAgent,
    pages: first.pages,
    paragraphs: first.paragraphs,
    keys: first.keys,
    runs,
    metrics: Object.fromEntries(Object.keys(first.metrics).map((k) => [k, median(all.map((r) => r.metrics[k]))])),
  };
  const out = opt('--out', null);
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  }
  if (args.includes('--update-baseline')) {
    mkdirSync(dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, JSON.stringify(result, null, 2) + '\n');
    console.log(`기준선을 썼습니다: ${BASELINE}`);
  }
  const c = compare(result, args.includes('--update-baseline') ? result : baseline);
  printTable(result, baseline, c);
  process.exitCode = c.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
