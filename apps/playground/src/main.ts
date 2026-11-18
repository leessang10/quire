import { Editor, type InputLogEntry } from '@quire/editor';
import { Doc, type MarkSet } from '@quire/model';

const SAMPLE = `Quire 0단계 프로토타입

이 문서는 캔버스에 직접 그려집니다. contenteditable을 쓰지 않고, 숨긴 textarea로 키 입력과 한글 조합을 받아 자체 레이아웃 엔진으로 줄을 나누고 쪽을 조립합니다.

확인할 것: 한글을 빠르게 입력해 보세요. 조합 중인 글자는 밑줄로 표시되고, 확정될 때 한 번만 문서에 들어가야 합니다. 조합 중에 다른 곳을 클릭하거나 Enter, 방향키를 눌러도 글자가 사라지거나 두 번 들어가면 안 됩니다.

줄바꿈은 어절 단위입니다. 아주긴단어가한줄보다길어지면글자단위로끊기는데이때마침표나쉼표같은닫는문장부호는줄의맨앞에오지않도록한글자를당겨서함께넘깁니다.이렇게요.그리고이모지👩‍💻도한글자로취급되어커서가중간에멈추지않습니다.

단축키: Ctrl+Z 실행 취소, Ctrl+Shift+Z 또는 Ctrl+Y 다시 실행, Ctrl+A 전체 선택, Ctrl+←/→ 단어 이동, Shift+방향키 선택 확장, 두 번 클릭 단어 선택, 세 번 클릭 문단 선택.`;

/** 서식 예제 (10 §4, 2-3): 굵게·기울임·크기·색·밑줄·취소선·형광펜·첨자, 줄마다 높이 */
function formatSample(): Doc {
  const r = (text: string, marks: MarkSet = {}) => ({ text, marks });
  const p = (...runs: Array<{ text: string; marks: MarkSet }>) => ({ attrs: {}, runs });
  return Doc.fromParagraphRuns([
    p(r('글자 서식 예제', { bold: true, size: 24000 })),
    p(
      r('본문 사이에 '),
      r('굵게', { bold: true }),
      r(', '),
      r('기울임', { italic: true }),
      r(', '),
      r('굵은 기울임', { bold: true, italic: true }),
      r(', '),
      r('밑줄', { underline: true }),
      r(', '),
      r('취소선', { strike: true }),
      r('을 섞었습니다. '),
      r('빨간 글자', { color: '#c01c28' }),
      r('와 '),
      r('형광펜', { highlight: '#fff3a3' }),
      r(', '),
      r('링크', { link: 'https://example.com' }),
      r('도 있습니다.'),
    ),
    p(r('물의 화학식은 H'), r('2', { script: 'sub' }), r('O이고, 아인슈타인의 식은 E = mc'), r('2', { script: 'sup' }), r('입니다. 각주 표시처럼 위 첨자를 씁니다'), r('1)', { script: 'sup' }), r('.')),
    p(r('크기가 섞인 줄: '), r('작게 9pt', { size: 9000 }), r(' 보통 '), r('크게 18pt', { size: 18000 }), r(' 다시 보통. 크기가 다른 글자가 한 줄에 있으면 줄 높이는 가장 큰 글자를 따르고 모든 글자가 한 기준선에 섭니다.')),
    p(r('Bold Latin and 한글 굵게 kerning: AVATAR Wave, ', { bold: true }), r('Italic Latin AVATAR Wave', { italic: true })),
    p(r('큰 제목 크기의 빈 줄 아래', { size: 18000 })),
    p(),
    p(r('위 빈 줄은 ¶에 서식이 없어 보통 높이입니다. 글자를 선택하고 위의 단추나 단축키(Ctrl+B·I·U, Ctrl+Shift+X, Ctrl+. ·, , Ctrl+\\)로 서식을 바꿔 보세요. 선택 없이 Ctrl+B를 누르면 다음에 입력하는 글자가 굵게 들어갑니다.')),
  ]);
}

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
      ['글자 측정', editor.textEngine],
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

// 엔진 글꼴 (ADR-0002): 저장소의 OFL 글꼴(fonts/)을 조각낸 것 (node scripts/build-fonts.mjs → public/fonts).
// 문서에 나온 글자의 조각만 받는다. ?fonts=off면 시스템 글꼴 측정, ?fonts=windows면 Windows 글꼴 통째로(검증용)
const fonts =
  params.get('fonts') === 'off'
    ? undefined
    : params.get('fonts') === 'windows'
      ? [
          { name: '맑은 고딕', url: '/spike-fonts/malgun.ttf' },
          { name: 'Calibri', url: '/spike-fonts/calibri.ttf' },
        ]
      : [
          { name: 'Pretendard', manifest: '/fonts/pretendard/manifest.json', bold: { manifest: '/fonts/pretendard-bold/manifest.json' } },
          { name: 'Noto Sans KR', manifest: '/fonts/noto-sans-kr/manifest.json' },
        ];
const editor = new Editor({
  host,
  text: SAMPLE,
  onInputLog,
  onChange: () => {
    showStats();
    showMarks();
  },
  input: inputMode,
  fonts,
  onFontsReady: (_e, err) => {
    if (err) console.warn('엔진 글꼴을 쓰지 못해 시스템 글꼴로 잽니다:', err);
    showStats();
  },
});
editor.focus();
showStats();

document.querySelectorAll<HTMLButtonElement>('[data-doc]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.doc!;
    if (kind === 'format') {
      editor.setDoc(formatSample());
      editor.select(0);
      editor.focus();
      showStats();
      return;
    }
    const text = kind === 'sample' ? SAMPLE : kind === 'empty' ? '' : generate(Number(kind));
    editor.setText(text);
    editor.focus();
    showStats();
  });
});

// ── 서식 도구 막대 ──
// 단추가 포커스를 가져가지 않게 (편집기 선택 유지)
document.querySelectorAll<HTMLButtonElement>('.format-bar button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
document.querySelectorAll<HTMLButtonElement>('[data-mark]').forEach((b) =>
  b.addEventListener('click', () => {
    editor.toggleMark(b.dataset.mark as 'bold' | 'italic' | 'underline' | 'strike');
    editor.focus();
  }),
);
document.querySelectorAll<HTMLButtonElement>('[data-script]').forEach((b) =>
  b.addEventListener('click', () => {
    editor.toggleScript(b.dataset.script as 'sup' | 'sub');
    editor.focus();
  }),
);
const sizeSel = document.getElementById('fmt-size') as HTMLSelectElement;
const colorSel = document.getElementById('fmt-color') as HTMLSelectElement;
const hlSel = document.getElementById('fmt-highlight') as HTMLSelectElement;
sizeSel.addEventListener('change', () => {
  editor.setMark('size', sizeSel.value ? Number(sizeSel.value) : undefined);
  editor.focus();
});
colorSel.addEventListener('change', () => {
  editor.setMark('color', colorSel.value || undefined);
  editor.focus();
});
hlSel.addEventListener('change', () => {
  editor.setMark('highlight', hlSel.value || undefined);
  editor.focus();
});
document.getElementById('fmt-clear')!.addEventListener('click', () => {
  editor.clearMarks();
  editor.focus();
});
/** 도구 막대에 선택 영역의 서식을 보인다 */
function showMarks(): void {
  const { marks, mixed } = editor.selectionMarks();
  const state = (on: boolean, mix: boolean) => (mix ? 'mixed' : on ? 'true' : 'false');
  document.querySelectorAll<HTMLButtonElement>('[data-mark]').forEach((b) => {
    const k = b.dataset.mark as 'bold' | 'italic' | 'underline' | 'strike';
    b.setAttribute('aria-pressed', state(!!marks[k], mixed.has(k)));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-script]').forEach((b) => {
    b.setAttribute('aria-pressed', state(marks.script === b.dataset.script, mixed.has('script')));
  });
  const pick = (sel: HTMLSelectElement, v: unknown, mix: boolean) => {
    sel.value = mix ? '' : v === undefined ? '' : String(v);
    if (sel.value !== (v === undefined ? '' : String(v)) && !mix) sel.value = '';
  };
  pick(sizeSel, marks.size, mixed.has('size'));
  pick(colorSel, marks.color, mixed.has('color'));
  pick(hlSel, marks.highlight, mixed.has('highlight'));
}

document.getElementById('clear-log')!.addEventListener('click', () => logEl.replaceChildren());

// 디버깅용
Object.assign(window, { editor });
