/**
 * 0단계 실제 환경 확인 페이지 (06 §2 V1–V3). 시나리오마다 처음 상태로 돌려 손으로 입력하고, 결과를 기대값과 자동
 * 비교한 뒤 통과·실패를 적는다. 결과는 환경(OS·브라우저·입력기·입력 층·스크린리더)별로 이 브라우저에 저장하고,
 * Markdown(결과 보고서에 붙이기)이나 JSON(입력 이벤트 포함)으로 내보낸다.
 */
import { Editor, editContextSupported, type InputLogEntry } from '@quire/editor';
import { SCENARIOS, judge, type Scenario } from './checklist-scenarios';

type Status = 'pass' | 'fail' | 'skip';

interface Result {
  status: Status;
  note: string;
  actual: string | null;
  auto: boolean | null;
  at: string;
  log: string[];
}

interface Env {
  platform: string;
  ime: string;
  reader: string;
  input: string;
}

interface Store {
  runs: Record<string, { env: Env; results: Record<string, Result> }>;
}

const STORE_KEY = 'quire-checklist:v1';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ── 저장 (브라우저 저장소를 쓸 수 없어도 페이지는 돈다) ──
function load(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* 비공개 창 등 */
  }
  return { runs: {} };
}
const store = load();
function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* 저장 못 함: 내보내기로 옮긴다 */
  }
}
function pref(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(`quire-checklist:${key}`, value);
    return localStorage.getItem(`quire-checklist:${key}`);
  } catch {
    return null;
  }
}

// ── 환경 ──
function detectPlatform(): string {
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua) || touchMac
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '기타';
  const m =
    /Edg\/(\d+)/.exec(ua)?.slice(1).map((v) => `Edge ${v}`) ??
    /Firefox\/(\d+)/.exec(ua)?.slice(1).map((v) => `Firefox ${v}`) ??
    /SamsungBrowser\/(\d+)/.exec(ua)?.slice(1).map((v) => `Samsung Internet ${v}`) ??
    /Chrome\/(\d+)/.exec(ua)?.slice(1).map((v) => `Chrome ${v}`) ??
    /Version\/(\d+).*Safari/.exec(ua)?.slice(1).map((v) => `Safari ${v}`);
  return `${os} · ${m?.[0] ?? '브라우저?'}`;
}
const isMobile = /iPhone|iPad|Android/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const params = new URLSearchParams(location.search);
const inputMode = (['auto', 'editcontext', 'textarea'] as const).find((m) => m === params.get('input')) ?? 'auto';

const platformEl = $<HTMLInputElement>('env-platform');
const imeEl = $<HTMLSelectElement>('env-ime');
const readerEl = $<HTMLSelectElement>('env-reader');
const inputEl = $<HTMLSelectElement>('env-input');
platformEl.value = pref('platform') ?? detectPlatform();
{
  const ua = navigator.userAgent;
  const guess = /Android/.test(ua) ? 'Gboard' : isMobile ? 'iOS 기본 키보드' : /Mac OS X/.test(ua) ? 'macOS 2벌식' : 'Microsoft 한국어 IME';
  imeEl.value = pref('ime') ?? guess;
}
readerEl.value = pref('reader') ?? '없음';
inputEl.value = inputMode;

// ── 편집기 ──
let log: string[] = [];
const logEl = $<HTMLOListElement>('log');
let logQueued = false;
function onInputLog(e: InputLogEntry): void {
  log.push(`${e.time.toFixed(0)} ${e.type} ${e.detail}`);
  if (log.length > 300) log = log.slice(-300);
  if (logQueued) return;
  logQueued = true;
  requestAnimationFrame(() => {
    logQueued = false;
    logEl.replaceChildren(
      ...log.slice(-40).map((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        return li;
      }),
    );
  });
}

const editor = new Editor({ host: $('editor'), text: '', onInputLog, onChange: () => showJudge(), input: inputMode });
$('env-input-note').textContent =
  editor.inputKind === 'editcontext'
    ? '지금: A. EditContext'
    : `지금: B. 숨긴 textarea${inputMode === 'editcontext' && !editContextSupported() ? ' (이 브라우저는 EditContext 없음)' : ''}`;

function env(): Env {
  return { platform: platformEl.value.trim(), ime: imeEl.value, reader: readerEl.value, input: editor.inputKind === 'editcontext' ? 'A. EditContext' : 'B. textarea' };
}
const envKey = (e: Env) => [e.platform, e.ime, e.input, e.reader].join(' | ');
function run() {
  const e = env();
  const k = envKey(e);
  store.runs[k] ??= { env: e, results: {} };
  store.runs[k].env = e;
  return store.runs[k];
}

// 환경 칸을 고치면(잘못 잡힌 OS·입력기 바로잡기) 그 이름으로 남긴 결과도 새 이름으로 옮긴다. 새 이름에 이미 결과가 있으면 옮기지 않는다
let lastKey = envKey(env());
for (const [el, key] of [
  [platformEl, 'platform'],
  [imeEl, 'ime'],
  [readerEl, 'reader'],
] as const) {
  el.addEventListener('change', () => {
    pref(key, el.value);
    const next = envKey(env());
    const old = store.runs[lastKey];
    if (next !== lastKey && old && Object.keys(old.results).length > 0 && !store.runs[next]) {
      store.runs[next] = { env: env(), results: old.results };
      delete store.runs[lastKey];
      save();
    }
    lastKey = next;
    renderList();
    show(current);
  });
}
inputEl.addEventListener('change', () => {
  params.set('input', inputEl.value);
  params.set('s', SCENARIOS[current]!.id);
  location.search = params.toString();
});

// ── 시나리오 목록 ──
const listEl = $<HTMLOListElement>('scenario-list');
let current = Math.max(0, SCENARIOS.findIndex((s) => s.id === params.get('s')));

const applies = (s: Scenario) =>
  !s.only ||
  (s.only === 'mobile' && isMobile) ||
  (s.only === 'desktop' && !isMobile) ||
  (s.only === 'windows' && /Windows/.test(navigator.userAgent)) ||
  (s.only === 'mac' && /Mac OS X/.test(navigator.userAgent) && !isMobile);

const STATUS_LABEL: Record<Status, string> = { pass: '통과', fail: '실패', skip: '해당 없음' };

function renderList(): void {
  const results = run().results;
  let group = '';
  const items: HTMLElement[] = [];
  SCENARIOS.forEach((s, i) => {
    if (s.group !== group) {
      group = s.group;
      const h = document.createElement('li');
      h.className = 'ck-group';
      h.textContent = { V1: 'V1 한글 IME', V2: 'V2 후보 창', V3: 'V3 스크린리더', V4: 'V4 새 입력 자리 (6-7)' }[s.group];
      items.push(h);
    }
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const r = results[s.id];
    b.className = `ck-item${i === current ? ' current' : ''}${applies(s) ? '' : ' na'}`;
    if (i === current) b.setAttribute('aria-current', 'step');
    const dot = document.createElement('span');
    dot.className = `ck-dot ${r?.status ?? 'none'}`;
    dot.setAttribute('aria-hidden', 'true');
    b.append(dot, `${s.title}`);
    b.setAttribute('aria-label', `${s.title}: ${r ? STATUS_LABEL[r.status] : '아직'}`);
    b.addEventListener('click', () => show(i));
    li.appendChild(b);
    items.push(li);
  });
  listEl.replaceChildren(...items);
  const all = SCENARIOS.filter(applies);
  const done = all.filter((s) => results[s.id]);
  const fail = done.filter((s) => results[s.id]!.status === 'fail').length;
  $('summary').textContent = `${done.length}/${all.length} 판정 · 실패 ${fail}`;
}

// ── 시나리오 하나 ──
const visible = (t: string) => (t === '' ? '(빈 문서)' : t.replace(/\n/g, '⏎').replace(/ /g, '·'));

function show(i: number): void {
  current = i;
  const s = SCENARIOS[i]!;
  $('sc-meta').textContent = `${s.group} · ${i + 1}/${SCENARIOS.length}${s.only ? ` · ${{ mobile: '모바일', desktop: '데스크톱', windows: 'Windows', mac: 'macOS' }[s.only]}에서` : ''}${applies(s) ? '' : ' (이 환경과 맞지 않음)'}`;
  $('sc-title').textContent = s.title;
  $('sc-steps').replaceChildren(
    ...s.steps.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
  $('sc-expect').textContent = s.expect;
  const look = $('sc-look');
  look.hidden = !s.look;
  look.textContent = s.look ? `눈·귀로 볼 것: ${s.look}` : '';
  const r = run().results[s.id];
  $<HTMLTextAreaElement>('note').value = r?.note ?? '';
  document.querySelectorAll<HTMLButtonElement>('[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(r?.status === b.dataset.status)));
  const hasStart = s.start !== undefined;
  $<HTMLButtonElement>('reset').disabled = !hasStart;
  $('reset-note').textContent = hasStart
    ? `처음 상태: ${visible(s.start!.text.length > 40 ? `${s.start!.text.slice(0, 40)}…` : s.start!.text)}${s.start!.head !== undefined ? ` (${s.start!.anchor}–${s.start!.head} 선택)` : ` (캐럿 ${s.start!.anchor})`}`
    : '편집기 상태는 그대로 둔다';
  if (hasStart) reset();
  renderList();
  history.replaceState(null, '', `?${new URLSearchParams({ ...Object.fromEntries(params), s: s.id }).toString()}`);
}

function reset(): void {
  const s = SCENARIOS[current]!;
  if (!s.start) return;
  editor.setText(s.start.text);
  editor.select(s.start.anchor, s.start.head ?? s.start.anchor);
  // 제안 모드 등 앞 시나리오의 상태를 끄고, 이 시나리오의 처음 상태를 만든다 (V4)
  editor.setSuggesting(false);
  s.setup?.(editor);
  log = [];
  logEl.replaceChildren();
  editor.focus();
  showJudge();
}

function showJudge(): void {
  const s = SCENARIOS[current]!;
  const el = $('judge');
  const text = s.read ? s.read(editor) : editor.getText();
  const ok = judge(s, text);
  if (ok === null) {
    el.className = 'ck-judge';
    el.textContent = '자동 비교 없음: 눈·귀로 판정한다.';
    return;
  }
  el.className = `ck-judge ${ok ? 'ok' : 'diff'}`;
  const want = s.expected !== undefined ? `기대 ${visible(s.expected)}` : '허용 범위는 위 설명';
  el.textContent = `${ok ? '✓ 기대와 같음' : '✗ 아직 다름'} — 지금 ${visible(text.length > 60 ? `${text.slice(0, 60)}…` : text)} · ${want}`;
}

function record(status: Status): void {
  const s = SCENARIOS[current]!;
  const text = s.start ? (s.read ? s.read(editor) : editor.getText()) : null;
  run().results[s.id] = {
    status,
    note: $<HTMLTextAreaElement>('note').value.trim(),
    actual: text,
    auto: text === null ? null : judge(s, text),
    at: new Date().toISOString(),
    log: log.slice(-120),
  };
  save();
  renderList();
  document.querySelectorAll<HTMLButtonElement>('[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === status)));
}

document.querySelectorAll<HTMLButtonElement>('[data-status]').forEach((b) => b.addEventListener('click', () => record(b.dataset.status as Status)));
$('note').addEventListener('change', () => {
  const r = run().results[SCENARIOS[current]!.id];
  if (r) {
    r.note = $<HTMLTextAreaElement>('note').value.trim();
    save();
  }
});
$('reset').addEventListener('click', reset);
$('next').addEventListener('click', () => {
  let i = current;
  do i = (i + 1) % SCENARIOS.length;
  while (!applies(SCENARIOS[i]!) && i !== current);
  show(i);
});

// ── 내보내기 ──
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function markdown(): string {
  const out: string[] = [];
  for (const { env: e, results } of Object.values(store.runs)) {
    const ids = SCENARIOS.filter((s) => results[s.id]);
    if (ids.length === 0) continue;
    const day = ids.map((s) => results[s.id]!.at).sort().at(-1)!.slice(0, 10);
    out.push(`#### ${e.platform} · ${e.ime} · 입력 층 ${e.input}${e.reader !== '없음' ? ` · ${e.reader}` : ''} (${day})`, '');
    out.push('| # | 시나리오 | 판정 | 자동 비교 | 결과 텍스트 | 메모 |', '|---|---|---|---|---|---|');
    for (const s of ids) {
      const r = results[s.id]!;
      const auto = r.auto === null ? '-' : r.auto ? '같음' : '다름';
      out.push(`| ${s.group} | ${cell(s.title)} | ${STATUS_LABEL[r.status]} | ${auto} | ${r.actual === null ? '-' : `\`${cell(visible(r.actual))}\``} | ${cell(r.note) || '-'} |`);
    }
    out.push('');
  }
  return out.join('\n') || '(아직 판정한 시나리오가 없습니다)';
}

$('copy-md').addEventListener('click', async () => {
  const md = markdown();
  try {
    await navigator.clipboard.writeText(md);
    $('summary').textContent = 'Markdown을 클립보드에 복사했습니다.';
  } catch {
    // 클립보드를 쓸 수 없으면 새 창에 보여 준다
    const w = window.open('', '_blank');
    if (w) {
      w.document.title = 'Quire 확인 결과';
      const pre = w.document.createElement('pre');
      pre.textContent = md;
      w.document.body.appendChild(pre);
    }
  }
});

$('download-json').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ format: 'quire-checklist', version: 1, userAgent: navigator.userAgent, runs: store.runs }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `quire-checklist-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('clear-env').addEventListener('click', () => {
  const k = envKey(env());
  if (!store.runs[k] || !confirm(`이 환경의 결과를 지울까요?\n${k}`)) return;
  delete store.runs[k];
  save();
  show(current);
});

show(current);
Object.assign(window, { editor, store });
