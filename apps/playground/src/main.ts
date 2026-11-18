import { Editor, type InputLogEntry } from '@quire/editor';
import { Doc, defaultListDef, type MarkSet, type ParaAttrs } from '@quire/model';

const SAMPLE = `Quire 0단계 프로토타입

이 문서는 캔버스에 직접 그려집니다. contenteditable을 쓰지 않고, 숨긴 textarea로 키 입력과 한글 조합을 받아 자체 레이아웃 엔진으로 줄을 나누고 쪽을 조립합니다.

확인할 것: 한글을 빠르게 입력해 보세요. 조합 중인 글자는 밑줄로 표시되고, 확정될 때 한 번만 문서에 들어가야 합니다. 조합 중에 다른 곳을 클릭하거나 Enter, 방향키를 눌러도 글자가 사라지거나 두 번 들어가면 안 됩니다.

줄바꿈은 어절 단위입니다. 아주긴단어가한줄보다길어지면글자단위로끊기는데이때마침표나쉼표같은닫는문장부호는줄의맨앞에오지않도록한글자를당겨서함께넘깁니다.이렇게요.그리고이모지👩‍💻도한글자로취급되어커서가중간에멈추지않습니다.

단축키: Ctrl+Z 실행 취소, Ctrl+Shift+Z 또는 Ctrl+Y 다시 실행, Ctrl+A 전체 선택, Ctrl+←/→ 단어 이동, Shift+방향키 선택 확장, 두 번 클릭 단어 선택, 세 번 클릭 문단 선택.`;

/** 서식 예제 (10 §4, 2-3·2-4): 굵게·기울임·크기·색·밑줄·취소선·형광펜·첨자, 줄마다 높이 */
function formatSample(): Doc {
  const r = (text: string, marks: MarkSet = {}) => ({ text, marks });
  const p = (...runs: Array<{ text: string; marks: MarkSet }>) => ({ attrs: {}, runs });
  const pa = (attrs: ParaAttrs, ...runs: Array<{ text: string; marks: MarkSet }>) => ({ attrs, runs });
  const long =
    '양쪽 맞춤은 마지막 줄을 뺀 줄에서 남는 폭을 어절 사이 공백에 나눠 줍니다. 추가 폭은 셰이핑 위치에 더하지 않고 줄마다 따로 들고 있다가 캐럿 위치와 그리기에서 더하므로, 정렬을 바꿔도 문단을 다시 셰이핑하지 않습니다.';
  const li = (id: string, level: number, text: string) => pa({ list: { id, level } }, r(text));
  const doc = Doc.fromParagraphRuns([
    pa({ style: 'h1' }, r('서식 예제')),
    pa({ style: 'h2' }, r('문단 서식')),
    pa({ align: 'justify' }, r(long)),
    pa({ align: 'center' }, r('가운데 정렬한 문단입니다.')),
    pa({ align: 'right' }, r('오른쪽 정렬한 문단입니다.')),
    pa({ indent: { left: 36000, first: -18000 } }, r('내어쓰기: 왼쪽 36pt 들여쓰고 첫 줄은 18pt 내어 씁니다. 번호나 글머리를 붙일 자리를 만드는 방식이고, 둘째 줄부터는 들여쓴 자리에서 시작합니다.')),
    pa({ indent: { first: 24000 }, line: { rule: 'multiple', value: 1.5 } }, r('첫 줄 들여쓰기 24pt와 줄 간격 1.5배입니다. 한국어 문서에서 흔한 첫 줄 들여쓰기 모양이고, 줄 간격은 기본 줄 높이의 배수로 정합니다.')),
    pa({ style: 'quote' }, r('인용 스타일: 양쪽 24pt 들여쓰기, 기울임, 회색. 스타일의 기본 글자 서식은 직접 서식 아래에 깔립니다.')),
    pa({ style: 'h2' }, r('목록')),
    li('ex-n', 0, '번호 목록: 번호는 저장하지 않고 화면 순서대로 셉니다.'),
    li('ex-n', 1, '수준 2는 가, 나, 다 순서입니다. Tab으로 수준을 내리고 Shift+Tab으로 올립니다.'),
    li('ex-n', 1, '항목을 끌어 옮기거나(Alt+Shift+↑↓) 지워도 번호가 다시 매겨집니다.'),
    li('ex-n', 2, '수준 3은 1), 2), 3) 입니다.'),
    li('ex-n', 0, '수준 1로 돌아오면 아래 수준 번호는 처음부터 다시 셉니다.'),
    li('ex-n', 1, '빈 항목에서 Enter를 누르면 수준이 올라가고, 수준 1이면 목록이 끝납니다.'),
    li('ex-b', 0, '글머리 목록: 수준마다 •, ◦, ▪ 기호를 씁니다.'),
    li('ex-b', 1, '목록 첫머리에서 Backspace를 누르면 글머리부터 지웁니다.'),
    li('ex-b', 0, '번호가 내어쓴 자리보다 넓으면 첫 줄 본문을 그만큼 밉니다.'),
    pa({ style: 'h2' }, r('글자 서식')),
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
  doc.setList('ex-n', defaultListDef('ex-n', 'number'));
  doc.setList('ex-b', defaultListDef('ex-b', 'bullet'));
  doc.takeParagraphChanges();
  return doc;
}

/** 예제 그림 (캔버스로 만든 PNG): 이미지 원본이 저장소에 있어야 하므로 문서를 연 뒤 넣는다 */
async function sampleImage(): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 320, 180);
  grad.addColorStop(0, '#3884ff');
  grad.addColorStop(1, '#26a269');
  g.fillStyle = grad;
  g.fillRect(0, 0, 320, 180);
  g.fillStyle = '#ffffff';
  g.font = 'bold 28px sans-serif';
  g.fillText('Quire 이미지', 24, 100);
  return new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
}

/** 서식 예제를 열고 이미지 두 개를 넣는다 (인라인: 글자처럼 줄 안에) */
async function openFormatSample(): Promise<void> {
  editor.setDoc(formatSample());
  const img = await sampleImage();
  const paras = editor.doc.paragraphs();
  const at = paras.findIndex((p) => p.text.startsWith('물의 화학식'));
  if (at >= 0) await editor.insertImage(img, '그러데이션 위에 Quire 이미지라고 쓴 그림', paras[at]!.start);
  const small = editor.doc.paragraphs().findIndex((p) => p.text.startsWith('크기가 섞인 줄'));
  // 떠 있는 이미지 (2-9): 양쪽 맞춤 문단 오른쪽에 어울림
  const just = editor.doc.paragraphs().findIndex((p) => p.text.startsWith('양쪽 맞춤은'));
  if (just >= 0) {
    await editor.insertImage(img, '어울림 예제 그림', editor.doc.paragraphs()[just]!.start);
    editor.setObjectAttr('w', 120000);
    editor.setObjectAttr('h', 67500);
    editor.setObjectAttr('float', { relX: 'column', relY: 'paragraph', x: 'right', y: 0, wrap: 'square', side: 'largest', gap: 9000 });
  }
  if (small >= 0) {
    await editor.insertImage(img, '작은 그림', editor.doc.paragraphs()[small]!.start + 7);
    editor.setObjectAttr('w', 36000);
    editor.setObjectAttr('h', 20250);
  }
  editor.select(0);
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
      void openFormatSample().then(() => {
        editor.focus();
        showStats();
      });
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
// 이미지 (2-8)
const fileInput = document.getElementById('img-file') as HTMLInputElement;
document.getElementById('img-insert')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) void editor.insertImage(f).then(() => editor.focus());
  fileInput.value = '';
});
document.getElementById('img-alt')!.addEventListener('click', () => {
  const o = editor.selectedObject();
  if (!o) return;
  const alt = prompt('대체 텍스트 (화면 읽기 프로그램이 읽음)', o.attrs.alt ?? '');
  if (alt !== null) editor.setObjectAttr('alt', alt || undefined);
  editor.focus();
});

const placeSel = document.getElementById('img-place') as HTMLSelectElement;
placeSel.addEventListener('change', () => {
  editor.setPlacement(placeSel.value as 'inline' | 'square' | 'topBottom' | 'front' | 'behind');
  editor.focus();
});

document.getElementById('fmt-clear')!.addEventListener('click', () => {
  editor.clearMarks();
  editor.focus();
});
// ── 문단 서식 막대 (2-4) ──
const styleSel = document.getElementById('para-style') as HTMLSelectElement;
const lineSel = document.getElementById('para-line') as HTMLSelectElement;
styleSel.addEventListener('change', () => {
  editor.setParagraphStyle(styleSel.value);
  editor.focus();
});
document.querySelectorAll<HTMLButtonElement>('[data-align]').forEach((b) =>
  b.addEventListener('click', () => {
    editor.setParagraphAttr('align', b.dataset.align === 'left' ? undefined : b.dataset.align);
    editor.focus();
  }),
);
lineSel.addEventListener('change', () => {
  editor.setParagraphAttr('line', lineSel.value ? { rule: 'multiple', value: Number(lineSel.value) } : undefined);
  editor.focus();
});
document.getElementById('para-indent')!.addEventListener('click', () => {
  editor.indent(1);
  editor.focus();
});
document.querySelectorAll<HTMLButtonElement>('[data-list]').forEach((b) =>
  b.addEventListener('click', () => {
    editor.toggleList(b.dataset.list as 'bullet' | 'number');
    editor.focus();
  }),
);
document.getElementById('para-outdent')!.addEventListener('click', () => {
  editor.indent(-1);
  editor.focus();
});
// 스타일 정의 바꾸기: 제목 1 문단만 다시 조판된다 (10 §2.3)
let h1Blue = false;
document.getElementById('restyle-h1')!.addEventListener('click', () => {
  const cur = editor.doc.style('h1')!;
  h1Blue = !h1Blue;
  const marks = { ...cur.marks };
  if (h1Blue) marks.color = '#1a5fb4';
  else delete marks.color;
  editor.setStyleDef('h1', { ...cur, marks });
  editor.focus();
});

/** 도구 막대에 선택 영역의 서식을 보인다 */
function showMarks(): void {
  const so = editor.selectedObject();
  const fl = so?.attrs.float;
  placeSel.disabled = !so;
  placeSel.value = !fl ? 'inline' : fl.wrap === 'none' ? (fl.behind ? 'behind' : 'front') : fl.wrap;
  const ps = editor.paragraphState();
  styleSel.value = ps.mixed.has('style') ? '' : ps.style;
  const align = ps.attrs.align ?? 'left';
  document.querySelectorAll<HTMLButtonElement>('[data-align]').forEach((b) => {
    b.setAttribute('aria-pressed', ps.mixed.has('align') ? 'mixed' : String(b.dataset.align === align));
  });
  const li = ps.attrs.list ? editor.doc.listDef(ps.attrs.list.id)?.kind : undefined;
  document.querySelectorAll<HTMLButtonElement>('[data-list]').forEach((b) => b.setAttribute('aria-pressed', String(li === b.dataset.list)));
  lineSel.value = ps.mixed.has('line') || ps.attrs.line?.rule !== 'multiple' ? '' : String(ps.attrs.line.value);

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
