/**
 * 레이아웃 골든 비교 (16 §5, R3): 기준 문서 세트(fixtures/docs)를 브라우저에서 조판해 Node 시험의 기대값(*.expected.json)과 같은지 본다.
 *
 * 문서마다 두 경로:
 * - editor: 실제 편집기(조각 글꼴, 백그라운드 조판)를 열고 `layoutSummary()` — 사용자가 보는 쪽 나눔
 * - whole: 통째 글꼴로 Node 시험과 똑같이 처음부터 조판 (`composeReference`) — JS 엔진·플랫폼 차이만 본다
 *
 * 결과는 `window.goldenResult`. 쿼리 ?only=report 로 한 문서만.
 */
import { Editor, composeReference, summarizeLayout, type LayoutSummary } from '@quire/editor';
import { HbShaper, loadShapingFont, slotOf } from '@quire/shaping';
import { documentFromQuire, migrateQuire } from '@quire/sync';
import pretendardUrl from '../../../fonts/pretendard/Pretendard-Regular.otf?url';
import pretendardBoldUrl from '../../../fonts/pretendard/Pretendard-Bold.otf?url';
import notoUrl from '../../../fonts/noto-sans-kr/NotoSansKR-Regular.otf?url';

Error.stackTraceLimit = 40;
const files = import.meta.glob('../../../fixtures/docs/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface GoldenDoc {
  name: string;
  pages: number;
  editor: { ok: boolean; diff: string | null; ms: number };
  whole: { ok: boolean; diff: string | null };
}
export interface GoldenResult {
  date: string;
  userAgent: string;
  ok: boolean;
  docs: GoldenDoc[];
}
declare global {
  interface Window {
    goldenResult?: GoldenResult;
    goldenError?: string;
  }
}

const statusEl = document.getElementById('status')!;
const status = (s: string) => (statusEl.textContent = s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 첫 차이 (경로와 두 값) */
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path || '(전체)'}: 기대 ${JSON.stringify(b)?.slice(0, 120)} / 실제 ${JSON.stringify(a)?.slice(0, 120)}`;
}

const openDoc = (raw: string) => documentFromQuire(migrateQuire(JSON.parse(raw)).doc).document;

/** 편집기로 열고 조판이 끝나 지문이 더 바뀌지 않을 때까지 (늦게 받는 글꼴 조각이 다시 조판하게 한다) */
async function viaEditor(host: HTMLElement, raw: string): Promise<LayoutSummary> {
  let ready = false;
  let failed: unknown = null;
  const editor = new Editor({
    host,
    document: openDoc(raw),
    input: 'textarea',
    fonts: [
      { name: 'Pretendard', manifest: '/fonts/pretendard/manifest.json', bold: { manifest: '/fonts/pretendard-bold/manifest.json' } },
      { name: 'Noto Sans KR', manifest: '/fonts/noto-sans-kr/manifest.json' },
    ],
    onFontsReady: (_e, err) => {
      ready = true;
      failed = err ?? null;
    },
  });
  try {
    const t0 = performance.now();
    while (!ready) {
      if (performance.now() - t0 > 20000) throw new Error('글꼴이 20초 안에 준비되지 않음');
      await sleep(20);
    }
    if (failed) throw new Error(`글꼴: ${String(failed)}`);
    // 머리말·각주·셀 글자의 조각은 처음 조판에서 모자라면 받아서 다시 조판한다. 지문이 세 번 연속 같으면 끝
    let last = '';
    let same = 0;
    while (same < 3) {
      if (performance.now() - t0 > 30000) throw new Error('조판이 30초 안에 멈추지 않음');
      await sleep(150);
      const s = editor.layoutSummary();
      const j = s ? JSON.stringify(s) : '';
      same = j && j === last ? same + 1 : 0;
      last = j;
    }
    return JSON.parse(last) as LayoutSummary;
  } finally {
    editor.destroy();
    host.replaceChildren();
  }
}

async function run(): Promise<GoldenResult> {
  const only = new URLSearchParams(location.search).get('only');
  const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const pretendard = loadShapingFont(await bytes(pretendardUrl), 'Pretendard');
  const shaper = new HbShaper([{ ...slotOf(pretendard), bold: slotOf(loadShapingFont(await bytes(pretendardBoldUrl), 'Pretendard Bold')) }, loadShapingFont(await bytes(notoUrl), 'Noto Sans KR')], { size: 16 });
  const host = document.getElementById('editor')!;
  const docs: GoldenDoc[] = [];
  const names = Object.keys(files)
    .filter((p) => !p.endsWith('.expected.json'))
    .map((p) => p.split('/').pop()!.replace(/\.json$/, ''))
    .filter((n) => !only || n === only)
    .sort();
  for (const name of names) {
    status(`${name} 조판 중`);
    const raw = files[`../../../fixtures/docs/${name}.json`]!;
    const expected = JSON.parse(files[`../../../fixtures/docs/${name}.expected.json`]!) as LayoutSummary;
    const t0 = performance.now();
    const ed = await viaEditor(host, raw);
    const ms = performance.now() - t0;
    const d = openDoc(raw);
    const c = composeReference(d, shaper, pretendard.metrics);
    const whole = summarizeLayout(d, c.layout, c.fmt);
    const eDiff = firstDiff(ed, expected);
    const wDiff = firstDiff(whole, expected);
    docs.push({ name, pages: expected.pages, editor: { ok: !eDiff, diff: eDiff, ms: Math.round(ms) }, whole: { ok: !wDiff, diff: wDiff } });
    show(docs);
  }
  return { date: new Date().toISOString(), userAgent: navigator.userAgent, ok: docs.every((d) => d.editor.ok && d.whole.ok), docs };
}

function show(docs: GoldenDoc[]): void {
  const mark = (ok: boolean) => (ok ? '<span class="ok">같음</span>' : '<span class="fail">다름</span>');
  const table = document.getElementById('table')!;
  table.innerHTML =
    '<tr><th>문서</th><th>쪽</th><th>편집기</th><th>통째 글꼴</th></tr>' +
    docs.map((d) => `<tr><td>${d.name}</td><td class="num">${d.pages}</td><td>${mark(d.editor.ok)}</td><td>${mark(d.whole.ok)}</td></tr>`).join('');
  const diffs = docs.flatMap((d) => [d.editor.diff && `${d.name} 편집기 ${d.editor.diff}`, d.whole.diff && `${d.name} 통째 ${d.whole.diff}`].filter(Boolean));
  document.getElementById('result')!.textContent = diffs.join('\n');
}

run().then(
  (r) => {
    window.goldenResult = r;
    status(r.ok ? `끝: ${r.docs.length}개 모두 같음` : '끝: 다른 문서가 있음');
  },
  (e: unknown) => {
    window.goldenError = e instanceof Error ? `${e.message}
${e.stack ?? ""}` : String(e);
    status(`실패: ${String(e)}`);
    console.error(e);
  },
);
