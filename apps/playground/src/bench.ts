/**
 * 성능 벤치마크 (16 §4, 06 §3): 1,000쪽 문서로 다섯 지표를 재어 `window.benchResult`에 둔다.
 *
 * - 첫 화면: 편집기를 만든 때부터 엔진 글꼴이 준비되고 그 뒤 첫 그리기가 끝날 때까지 (글꼴 전 시스템 글꼴 화면은 firstFrameMs)
 * - 전체 조판: 만든 때부터 백그라운드 쪽 조립이 끝날 때까지
 * - 메모리: 전체 조판 뒤 JS 힙 (Chromium `performance.memory`, 이미지 없음)
 * - 입력 지연: 문서 가운데에 숨긴 textarea로 `beforeinput`을 넣고, 그 처리(동기 조판) + 다음 프레임의 그리기 시간.
 *   프레임을 기다리는 시간(vsync)은 빼고 작업 시간만 잰다. 프레임 끝까지의 벽시계 시간은 inputWallP95Ms로 따로 둔다
 * - 스크롤: 프레임마다 스크롤 위치를 옮기며 3초 동안 프레임 간격을 잰다
 *
 * 쿼리: ?pages=1000&keys=300&scrollMs=3000
 */
import { Editor } from '@quire/editor';

const params = new URLSearchParams(location.search);
const PAGES = Number(params.get('pages') ?? 1000);
const KEYS = Number(params.get('keys') ?? 300);
const SCROLL_MS = Number(params.get('scrollMs') ?? 3000);

/** 플레이그라운드의 큰 문서와 같은 문단 (main.ts generate) */
const LOREM =
  '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다. 이 문단은 대형 문서 성능 측정을 위해 반복해서 생성된 문단입니다. 레이아웃 캐시가 동작하면 편집할 때 바뀐 문단만 다시 줄을 나눕니다.';
const generate = (pages: number) => Array.from({ length: pages * 10 }, (_, i) => `${i + 1}. ${LOREM}`).join('\n');

export interface BenchResult {
  date: string;
  userAgent: string;
  pages: number;
  paragraphs: number;
  keys: number;
  metrics: {
    /** 입력 작업 시간 (ms) */
    inputP50Ms: number;
    inputP95Ms: number;
    /** 키 → 그 프레임 끝 (vsync 대기 포함, 참고용) */
    inputWallP95Ms: number;
    firstFrameMs: number;
    firstScreenMs: number;
    fullLayoutMs: number;
    scrollFps: number;
    scrollP95FrameMs: number;
    heapMB: number | null;
  };
}

declare global {
  interface Window {
    benchResult?: BenchResult;
    benchError?: string;
  }
}

const statusEl = document.getElementById('status')!;
const status = (s: string) => {
  statusEl.textContent = s;
};
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : NaN;
};
const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

async function run(): Promise<BenchResult> {
  const host = document.getElementById('editor')!;
  status(`${PAGES.toLocaleString()}쪽 문서 여는 중`);
  await frame();
  const text = generate(PAGES);

  // ── 첫 화면 ──
  let fontsAt = 0;
  let fontsError: unknown = null;
  const t0 = performance.now();
  const editor = new Editor({
    host,
    text,
    input: 'textarea',
    fonts: [
      { name: 'Pretendard', manifest: '/fonts/pretendard/manifest.json', bold: { manifest: '/fonts/pretendard-bold/manifest.json' } },
      { name: 'Noto Sans KR', manifest: '/fonts/noto-sans-kr/manifest.json' },
    ],
    onFontsReady: (_e, err) => {
      fontsAt = performance.now();
      fontsError = err ?? null;
    },
  });
  (window as unknown as { benchEditor: Editor }).benchEditor = editor;
  await frame();
  await frame();
  const firstFrameMs = performance.now() - t0;
  while (!fontsAt) await frame();
  if (fontsError) throw new Error(`엔진 글꼴을 쓰지 못함: ${String(fontsError)}`);
  // 글꼴이 준비된 뒤의 첫 그리기 (다시 조판 + 그리기)
  await frame();
  await frame();
  const firstScreenMs = performance.now() - t0;

  // ── 전체 조판 ──
  status('전체 조판 기다리는 중');
  while (editor.stats.pendingParas > 0) await new Promise((r) => setTimeout(r, 20));
  const fullLayoutMs = performance.now() - t0;
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const heapMB = memory ? memory.usedJSHeapSize / 2 ** 20 : null;

  // ── 입력 지연 ──
  status('입력 재는 중');
  const ta = host.querySelector('textarea');
  if (!ta) throw new Error('숨긴 textarea가 없습니다');
  editor.focus();
  // 문서 가운데 문단의 가운데
  const body = editor.body;
  const mid = body.paragraphs()[Math.floor(body.paragraphs().length / 2)]!;
  editor.select(mid.start + 20);
  await frame();
  await frame();
  const work: number[] = [];
  const wall: number[] = [];
  for (let i = 0; i < KEYS; i++) {
    const enter = i % 40 === 39;
    const ev = new InputEvent('beforeinput', { inputType: enter ? 'insertParagraph' : 'insertText', data: enter ? null : '가', bubbles: true, cancelable: true });
    const k0 = performance.now();
    ta.dispatchEvent(ev);
    const sync = performance.now() - k0;
    // 편집기의 rAF(그리기)가 먼저 등록되었으므로 이 콜백은 그리기 뒤에 돈다
    await frame();
    wall.push(performance.now() - k0);
    work.push(sync + editor.stats.renderMs);
  }

  // ── 스크롤 ──
  status('스크롤 재는 중');
  const sc = editor.scrollElement;
  sc.scrollTop = 0;
  await frame();
  const gaps: number[] = [];
  let last = await frame();
  const s0 = last;
  const step = Math.max(200, sc.clientHeight * 0.4);
  while (last - s0 < SCROLL_MS) {
    sc.scrollTop = (sc.scrollTop + step) % Math.max(1, sc.scrollHeight - sc.clientHeight);
    const now = await frame();
    gaps.push(now - last);
    last = now;
  }
  const scrollFps = (gaps.length * 1000) / (last - s0);

  return {
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    pages: editor.stats.pages,
    paragraphs: editor.stats.paragraphs,
    keys: KEYS,
    metrics: {
      inputP50Ms: round(pct(work, 50), 2),
      inputP95Ms: round(pct(work, 95), 2),
      inputWallP95Ms: round(pct(wall, 95), 2),
      firstFrameMs: round(firstFrameMs),
      firstScreenMs: round(firstScreenMs),
      fullLayoutMs: round(fullLayoutMs),
      scrollFps: round(scrollFps),
      scrollP95FrameMs: round(pct(gaps, 95), 2),
      heapMB: heapMB === null ? null : round(heapMB),
    },
  };
}

/** 06 §3 목표 (비교 스크립트와 같게) */
const TARGETS: Record<string, [string, number, 'max' | 'min']> = {
  inputP95Ms: ['입력 p95 (ms)', 16, 'max'],
  firstScreenMs: ['첫 화면 (ms)', 1000, 'max'],
  fullLayoutMs: ['전체 조판 (ms)', 10000, 'max'],
  scrollFps: ['스크롤 (fps)', 55, 'min'],
  heapMB: ['메모리 (MB)', 500, 'max'],
};

function show(r: BenchResult): void {
  const rows = Object.entries(r.metrics).map(([k, v]) => {
    const t = TARGETS[k];
    const ok = t && v !== null ? (t[2] === 'max' ? v <= t[1] : v >= t[1]) : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${t ? t[0] : k}</td><td class="num">${v ?? '-'}</td><td class="${ok === false ? 'fail' : 'ok'}">${t ? `${t[2] === 'max' ? '≤' : '≥'} ${t[1]}` : ''}</td>`;
    return tr;
  });
  document.getElementById('table')!.replaceChildren(...rows);
  document.getElementById('result')!.textContent = JSON.stringify(r, null, 2);
}

run().then(
  (r) => {
    window.benchResult = r;
    show(r);
    status(`끝 (${r.pages.toLocaleString()}쪽, 문단 ${r.paragraphs.toLocaleString()}개)`);
  },
  (e: unknown) => {
    window.benchError = String(e);
    status(`실패: ${String(e)}`);
    console.error(e);
  },
);
