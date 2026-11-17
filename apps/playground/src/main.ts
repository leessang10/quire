import { Editor, type InputLogEntry } from '@quire/editor';

const SAMPLE = `Quire 0단계 프로토타입

이 문서는 캔버스에 직접 그려집니다. contenteditable을 쓰지 않고, 숨긴 textarea로 키 입력과 한글 조합을 받아 자체 레이아웃 엔진으로 줄을 나누고 쪽을 조립합니다.

확인할 것: 한글을 빠르게 입력해 보세요. 조합 중인 글자는 밑줄로 표시되고, 확정될 때 한 번만 문서에 들어가야 합니다. 조합 중에 다른 곳을 클릭하거나 Enter, 방향키를 눌러도 글자가 사라지거나 두 번 들어가면 안 됩니다.

줄바꿈은 어절 단위입니다. 아주긴단어가한줄보다길어지면글자단위로끊기는데이때마침표나쉼표같은닫는문장부호는줄의맨앞에오지않도록한글자를당겨서함께넘깁니다.이렇게요.그리고이모지👩‍💻도한글자로취급되어커서가중간에멈추지않습니다.

단축키: Ctrl+Z 실행 취소, Ctrl+Shift+Z 또는 Ctrl+Y 다시 실행, Ctrl+A 전체 선택, Ctrl+←/→ 단어 이동, Shift+방향키 선택 확장, 두 번 클릭 단어 선택, 세 번 클릭 문단 선택.`;

const LOREM =
  '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다. 이 문단은 대형 문서 성능 측정을 위해 반복해서 생성된 문단입니다. 레이아웃 캐시가 동작하면 편집할 때 바뀐 문단만 다시 줄을 나눕니다.';

function generate(pages: number): string {
  // 기본 설정(A4, 16px)에서 한 쪽에 약 10문단
  const paras: string[] = [];
  for (let i = 0; i < pages * 10; i++) paras.push(`${i + 1}. ${LOREM}`);
  return paras.join('\n');
}

const host = document.getElementById('editor')!;
const statsEl = document.getElementById('stats')!;
const logEl = document.getElementById('log')!;

// 로그는 모아 두었다가 프레임당 한 번만 DOM에 반영한다 (입력 처리 시간에 영향을 주지 않도록)
const MAX_LOG = 300;
let logBuffer: InputLogEntry[] = [];
let logQueued = false;
function onInputLog(e: InputLogEntry) {
  logBuffer.push(e);
  if (logQueued) return;
  logQueued = true;
  requestAnimationFrame(() => {
    logQueued = false;
    const entries = logBuffer.slice(-MAX_LOG);
    logBuffer = [];
    const frag = document.createDocumentFragment();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
      const li = document.createElement('li');
      if (entry.type.startsWith('composition')) li.className = 'composition';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = entry.type;
      li.append(`${entry.time.toFixed(0).padStart(7)} `, t, ` ${entry.detail}`);
      frag.appendChild(li);
    }
    logEl.prepend(frag);
    while (logEl.childElementCount > MAX_LOG) logEl.lastElementChild!.remove();
  });
}

let statsQueued = false;
function showStats() {
  if (statsQueued) return;
  statsQueued = true;
  requestAnimationFrame(() => {
    statsQueued = false;
    const s = editor.stats;
    const sel = editor.selection();
    const rows: Array<[string, string]> = [
      ['쪽', `${s.pendingParas > 0 ? '≈ ' : ''}${s.pages.toLocaleString()}`],
      ['쪽 조립 대기 문단', s.pendingParas.toLocaleString()],
      ['백그라운드 조립 누적', `${s.backgroundMs.toFixed(0)} ms`],
      ['문단', s.paragraphs.toLocaleString()],
      ['줄', s.lines.toLocaleString()],
      ['글자', s.characters.toLocaleString()],
      ['레이아웃', `${s.layoutMs.toFixed(1)} ms`],
      ['렌더링', `${s.renderMs.toFixed(1)} ms`],
      ['문단 재계산/재배치/재사용', `${s.reflowed} / ${s.repositioned.toLocaleString()} / ${s.reused.toLocaleString()}`],
      ['캐시 적중/실패', `${s.cacheHits.toLocaleString()} / ${s.cacheMisses.toLocaleString()}`],
      ['입력 층', editor.inputKind === 'editcontext' ? 'A. EditContext' : 'B. 숨긴 textarea'],
      ['선택', sel.anchor === sel.head ? `${sel.head}` : `${sel.anchor} → ${sel.head}`],
      ['실행 취소', editor.history.canUndo ? '가능' : '-'],
    ];
    statsEl.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      }),
    );
  });
}

// 입력 층 (03 §2): ?input=auto|editcontext|textarea
const params = new URLSearchParams(location.search);
const inputMode = (['auto', 'editcontext', 'textarea'] as const).find((m) => m === params.get('input')) ?? 'auto';
const modeSelect = document.getElementById('input-mode') as HTMLSelectElement;
modeSelect.value = inputMode;
modeSelect.addEventListener('change', () => {
  params.set('input', modeSelect.value);
  location.search = params.toString();
});

const editor = new Editor({ host, text: SAMPLE, onInputLog, onChange: showStats, input: inputMode });
editor.focus();
showStats();

document.querySelectorAll<HTMLButtonElement>('[data-doc]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.doc!;
    const text = kind === 'sample' ? SAMPLE : kind === 'empty' ? '' : generate(Number(kind));
    editor.setText(text);
    editor.focus();
    showStats();
  });
});

document.getElementById('clear-log')!.addEventListener('click', () => logEl.replaceChildren());

// 디버깅용
Object.assign(window, { editor });
