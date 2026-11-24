import { Editor, highlightWordsPlugin, wordCountPlugin, type InputLogEntry, type WordCount } from '@quiredoc/editor';
import { CommentsPane } from './comments-pane';
import { FindBar } from './find-bar';
import { openPdf } from './pdf-export';
import { lastConvert, openFile, saveAs } from './convert-io';
import { DemoChecker, SpellContextMenu } from './spell-demo';
import { documentFromQuire, quireFromDocument } from '@quiredoc/sync';
import { Doc, Document, LAST_SECTION, PAPER_SIZES, cellStoryId, defaultListDef, fullSection, hfStoryId, noteStoryId, type MarkSet, type ParaAttrs, type SectionProps, type SectionStart } from '@quiredoc/model';

const SAMPLE = `Quire 0단계 프로토타입

이 문서는 캔버스에 직접 그려집니다. contenteditable을 쓰지 않고, 숨긴 textarea로 키 입력과 한글 조합을 받아 자체 레이아웃 엔진으로 줄을 나누고 쪽을 조립합니다.

확인할 것: 한글을 빠르게 입력해 보세요. 조합 중인 글자는 밑줄로 표시되고, 확정될 때 한 번만 문서에 들어가야 합니다. 조합 중에 다른 곳을 클릭하거나 Enter, 방향키를 눌러도 글자가 사라지거나 두 번 들어가면 안 됩니다.

줄바꿈은 어절 단위입니다. 아주긴단어가한줄보다길어지면글자단위로끊기는데이때마침표나쉼표같은닫는문장부호는줄의맨앞에오지않도록한글자를당겨서함께넘깁니다.이렇게요.그리고이모지👩‍💻도한글자로취급되어커서가중간에멈추지않습니다.

단축키: Ctrl+Z 실행 취소, Ctrl+Shift+Z 또는 Ctrl+Y 다시 실행, Ctrl+A 전체 선택, Ctrl+←/→ 단어 이동, Shift+방향키 선택 확장, 두 번 클릭 단어 선택, 세 번 클릭 문단 선택.

맞춤법 검사: 금새 끝날 줄 알았는데 몇일이 걸렸어요. 이렇게 하면 되요? 이 speling misteak 같은 낱말에 물결 밑줄이 생기고, 오른쪽 클릭으로 고칠 말을 고릅니다.`;

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

/**
 * 구역 예제 (12 §3): 표지(A4 세로) → 가로 쪽(A4 가로, 다음 쪽) → 본문(홀수 쪽에서 시작, 여백 30mm) → 이어지는 구역(같은 쪽, 왼쪽 여백 넓게).
 * 머리말·꼬리말 (12 §5): 표지는 첫 쪽 따로(비움), 꼬리말 "쪽 / 전체 쪽"을 뒤 구역들이 이어 쓴다. 본문 구역에서 쪽 번호를 1부터 다시 센다
 */
function sectionsSample(): Document {
  const r = (text: string, marks: MarkSet = {}) => ({ text, marks });
  const pa = (attrs: ParaAttrs, ...runs: Array<{ text: string; marks: MarkSet }>) => ({ attrs, runs });
  const body = '구역마다 용지 크기·방향·여백이 다를 수 있습니다. 구역 나눔은 그 구역 마지막 문단에 붙은 표시이고, 다음 구역이 어떻게 시작할지(다음 쪽·이어서·짝수 쪽·홀수 쪽)는 다음 구역의 설정입니다.';
  const doc = Doc.fromParagraphRuns([
    pa({ style: 'h1', align: 'center' }, r('구역 예제')),
    pa({ align: 'center' }, r('표지: A4 세로, 기본 여백')),
    pa({ align: 'center', section: 'cover' }, r('Ctrl+Alt+Enter로 캐럿에서 구역을 나눌 수 있습니다.')),
    pa({ style: 'h2' }, r('가로 쪽')),
    pa({ align: 'justify' }, r(body)),
    pa({ align: 'justify', section: 'wide' }, r('이 구역은 A4 가로입니다. 줄이 넓어져 같은 글이 더 적은 줄에 들어갑니다. ' + body)),
    pa({ style: 'h2' }, r('본문 (홀수 쪽에서 시작)')),
    ...Array.from({ length: 6 }, (_, k) => pa({ align: 'justify' }, r(`${k + 1}. ${body} ${body}`))),
    pa({ align: 'justify', section: 'main' }, r('앞 구역이 짝수 쪽에서 끝나면 빈 쪽 없이, 홀수 쪽에서 끝나면 빈 쪽을 하나 두고 시작합니다.')),
    pa({ style: 'h2' }, r('이어지는 구역')),
    pa({ align: 'justify' }, r('이 구역은 앞 구역과 같은 쪽에서 이어서 시작하고 왼쪽 여백이 60mm입니다. ' + body)),
  ]);
  const mm = (v: number) => Math.round((v * 72000) / 25.4);
  const [w, h] = PAPER_SIZES.A4!;
  const hdr = hfStoryId('header', 'cover', 'default');
  const ftr = hfStoryId('footer', 'cover', 'default');
  doc.setSection('cover', { ...fullSection(undefined), titlePage: true, header: { default: hdr }, footer: { default: ftr } });
  doc.setSection('wide', { page: { width: h, height: w, margin: [mm(20), mm(20), mm(20), mm(20)] }, start: 'nextPage' });
  doc.setSection('main', { page: { width: w, height: h, margin: [mm(30), mm(30), mm(30), mm(30)] }, start: 'oddPage', pageNumber: { start: 1 } });
  doc.setSection(LAST_SECTION, { page: { width: w, height: h, margin: [mm(30), mm(30), mm(30), mm(60)] }, start: 'continuous' });
  doc.takeParagraphChanges();
  const document = new Document(doc);
  const head = document.story(hdr);
  head.insertText(0, '구역 예제 · 머리말');
  head.setParaAttr(0, 'align', 'right');
  const foot = document.story(ftr);
  foot.insertObject(0, { kind: 'field', field: 'page' });
  foot.insertText(1, ' / ');
  foot.insertObject(4, { kind: 'field', field: 'pages' });
  foot.setParaAttr(0, 'align', 'center');
  return document;
}

/**
 * 표 예제 (12 §8): 쪽을 넘는 80행 표. 첫 행은 제목 행(쪽마다 다시 그림), 5행은 셀 글이 길어 쪽 사이에서 쪼개지고, 9행은 행 나누지 않음
 */
function tableSample(): Document {
  const doc = Doc.fromText(['표 예제', ...Array.from({ length: 14 }, (_, i) => `${i + 1}. 표 앞 문단입니다. 표가 쪽 끝에 걸리면 행을 줄 단위로 쪼개고, 다음 쪽 맨 위에 제목 행을 다시 그립니다.`), '표 뒤 문단'].join('\n'));
  doc.setParaAttr(0, 'style', 'h1');
  const document = new Document(doc);
  const { id } = document.insertTable(doc.paragraphs()[15]!.start, 80, 3, 451000);
  doc.takeParagraphChanges();
  const t = document.table(id)!;
  const cell = (r: number, c: number) => document.story(cellStoryId(id, t.rows[r]!, t.cols[c]!));
  ['번호', '항목', '설명'].forEach((h, c) => cell(0, c).insertText(0, h));
  document.setRowAttrs(id, t.rows[0]!, { header: true });
  for (let r = 1; r < 80; r++) {
    cell(r, 0).insertText(0, String(r));
    cell(r, 1).insertText(0, `항목 ${r}`);
    cell(r, 2).insertText(0, r === 5 ? Array.from({ length: 40 }, (_, k) => `긴 셀의 ${k + 1}번째 줄입니다.`).join('\n') : r === 9 ? '이 행은 나누지 않습니다.\n둘째 줄\n셋째 줄\n넷째 줄' : `설명 ${r}`);
  }
  document.setRowAttrs(id, t.rows[9]!, { cantSplit: true });
  return document;
}

/**
 * 다단 예제 (12 §7): 제목 띠(1단) → 이어서 2단(구분선) → 이어서 3단 → 이어서 1단. 다단 구역 끝은 단 높이를 맞춘다(균형)
 */
function columnsSample(): Doc {
  const body = '다단 구역에서는 글이 첫 단을 채운 뒤 다음 단으로 흐르고, 마지막 단을 채우면 다음 쪽 첫 단으로 갑니다. 단 나누기(Ctrl+Shift+Enter)로 다음 단에서 시작할 수 있습니다.';
  const pa = (attrs: ParaAttrs, text: string) => ({ attrs, runs: [{ text, marks: {} as MarkSet }] });
  const doc = Doc.fromParagraphRuns([
    pa({ style: 'h1', align: 'center' }, '다단 예제'),
    pa({ align: 'center', section: 'title' }, '제목은 한 단, 본문은 같은 쪽에서 이어지는 두 단과 세 단입니다.'),
    ...Array.from({ length: 9 }, (_, k) => pa({ align: 'justify' }, `${k + 1}. ${body}`)),
    pa({ align: 'justify', section: 'two' }, '두 단 구역의 끝입니다. 뒤 구역이 같은 쪽에서 이어지므로 두 단의 높이를 맞춥니다.'),
    ...Array.from({ length: 7 }, (_, k) => pa({ align: 'justify' }, `세 단 ${k + 1}. ${body}`)),
    pa({ align: 'justify', section: 'three' }, '세 단 구역의 끝입니다.'),
    pa({ style: 'h2' }, '다시 한 단'),
    pa({ align: 'justify' }, '세 단 구역 아래에서 한 단으로 이어집니다. ' + body),
  ]);
  const mm = (v: number) => Math.round((v * 72000) / 25.4);
  doc.setSection('title', fullSection(undefined));
  doc.setSection('two', { ...fullSection(undefined), start: 'continuous', columns: { count: 2, gap: mm(8), separator: true } });
  doc.setSection('three', { ...fullSection(undefined), start: 'continuous', columns: { count: 3, gap: mm(6) } });
  doc.setSection(LAST_SECTION, { ...fullSection(undefined), start: 'continuous' });
  doc.takeParagraphChanges();
  return doc;
}

/**
 * 각주 예제 (12 §6): 문단마다 각주 참조. 쪽 끝 근처의 참조는 줄과 각주가 함께 다음 쪽으로 가고, 긴 각주는 쪽 사이에서 나뉘어 이어진다
 */
function notesSample(): Document {
  const body = '각주는 본문의 참조 번호와 쪽 아래의 각주 내용으로 이루어집니다. 참조가 있는 줄과 그 각주는 같은 쪽에 놓이고, 각주가 쪽보다 크면 다음 쪽에 이어 씁니다.';
  const OBJ = String.fromCharCode(0xfffc);
  const texts: string[] = ['각주 예제'];
  for (let i = 0; i < 24; i++) texts.push(`${i + 1}. ${body} ${body}${OBJ}`);
  const doc = Doc.fromParagraphRuns(
    texts.map((t, i) => ({
      attrs: i === 0 ? { style: 'h1' } : { align: 'justify' as const },
      runs: t.endsWith(OBJ) ? [{ text: t.slice(0, -1), marks: {} }, { text: OBJ, marks: {}, obj: { id: `n${i}`, kind: 'note' as const } }] : [{ text: t, marks: {} }],
    })),
  );
  doc.takeParagraphChanges();
  const document = new Document(doc);
  for (let i = 1; i < texts.length; i++) {
    const s = document.story(noteStoryId(`n${i}`));
    const long = i === 9;
    s.insertText(0, long ? Array.from({ length: 18 }, (_, k) => `긴 각주의 ${k + 1}번째 문장입니다. 각주가 쪽의 절반보다 크면 들어가는 만큼 놓고 나머지는 다음 쪽 각주 영역 맨 위에 이어 씁니다.`).join(' ') : `각주 ${i}: 이 문단에 대한 설명입니다.`);
  }
  return document;
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
    editor.select(editor.doc.paragraphs()[just]!.start, editor.doc.paragraphs()[just]!.start + 1); // 넣은 이미지 선택
    editor.setObjectAttr('w', 120000);
    editor.setObjectAttr('h', 67500);
    editor.setObjectAttr('float', { relX: 'column', relY: 'paragraph', x: 'right', y: 0, wrap: 'square', side: 'largest', gap: 9000 });
  }
  if (small >= 0) {
    await editor.insertImage(img, '작은 그림', editor.doc.paragraphs()[small]!.start + 7);
    editor.select(editor.doc.paragraphs()[small]!.start + 7, editor.doc.paragraphs()[small]!.start + 8);
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
      ['가져오기·내보내기', lastConvert || '-'],
      ['글자 수 (플러그인)', wordCount ? `${wordCount.chars.toLocaleString()}자 · ${wordCount.words.toLocaleString()}어절` : '-'],
      ['플러그인', editor.pluginNames().join(', ')],
      ['맞춤법 검사', editor.spellSession ? `${editor.spellSession.stats.checked.toLocaleString()} 문단 (그만둠 ${editor.spellSession.stats.aborted})` : '꺼짐'],
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
let pane: CommentsPane | null = null;
let findBar: FindBar | null = null;
let wordCount: WordCount | null = null;
const spellMenu = new SpellContextMenu(() => editor);
const spellChecker = new DemoChecker();
const editor = new Editor({
  host,
  // 보기 모드 (14 §4.3): 최종본·원본은 정본 왕복으로 복제한 파생 문서
  cloneDocument: (d) => documentFromQuire(quireFromDocument(d)).document,
  text: SAMPLE,
  // 화면 언어 (18): ?lang=en 이면 캔버스 표시·접근성 이름을 영어로 (플레이그라운드 자체 UI는 한국어)
  locale: params.get('lang') ?? 'ko',
  onInputLog,
  onChange: () => {
    showStats();
    showMarks();
    pane?.update();
    const t = (document.querySelector('.tbl-tools') as HTMLElement | null);
    const ts = editor?.tableState();
    if (t) t.hidden = !ts?.inTable;
    document.querySelectorAll<HTMLButtonElement>('[data-tbl="header"], [data-tbl="cantSplit"]').forEach((b) =>
      b.setAttribute('aria-pressed', String(!!ts?.[b.dataset.tbl as 'header' | 'cantSplit'])),
    );
    showHeaderFooter();
    findBar?.update();
  },
  // 찾기 막대 (15 §3.1)
  onFindRequest: (replace) => findBar?.open(replace),
  // 맞춤법 (15 §4): 데모 검사기, 오류 위 오른쪽 클릭 메뉴
  spellChecker,
  onContextMenu: (e, spell, items) => spellMenu.open(e, spell, items),
  // 예제 플러그인 (15 §7): 글자 수(상태 칸), 강조 낱말(오른쪽 클릭·Ctrl+Alt+K 더하기·Ctrl+Alt+J 다음)
  plugins: [wordCountPlugin((c) => ((wordCount = c), queueMicrotask(showStats))), highlightWordsPlugin(['Quire'])],
  input: inputMode,
  fonts,
  onFontsReady: (_e, err) => {
    if (err) console.warn('엔진 글꼴을 쓰지 못해 시스템 글꼴로 잽니다:', err);
    showStats();
  },
});
editor.focus();
showStats();
findBar = new FindBar(() => editor, host);

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
    if (kind === 'table') {
      editor.setDocument(tableSample());
      editor.focus();
      showStats();
      return;
    }
    if (kind === 'columns') {
      editor.setDoc(columnsSample());
      editor.focus();
      showStats();
      return;
    }
    if (kind === 'notes') {
      editor.setDocument(notesSample());
      editor.focus();
      showStats();
      return;
    }
    if (kind === 'sections') {
      editor.setDocument(sectionsSample());
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

// 표 (2-11)
document.getElementById('tbl-insert')!.addEventListener('click', () => {
  editor.insertTable(3, 3);
  editor.focus();
});
document.querySelectorAll<HTMLButtonElement>('[data-tbl]').forEach((b) =>
  b.addEventListener('click', () => {
    const t = editor.tableState();
    switch (b.dataset.tbl) {
      case 'rowBelow': editor.tableAddRow(true); break;
      case 'colRight': editor.tableAddCol(true); break;
      case 'delRow': editor.tableDelete('row'); break;
      case 'delCol': editor.tableDelete('col'); break;
      case 'merge': editor.tableMerge(); break;
      case 'unmerge': editor.tableUnmerge(); break;
      case 'fill': editor.tableCellFill(t.inTable && !fillOn ? '#eeeeee' : undefined); fillOn = !fillOn; break;
      case 'delete': editor.deleteTable(); break;
      case 'header': editor.tableSetRowFlag('header', !t.header); break;
      case 'cantSplit': editor.tableSetRowFlag('cantSplit', !t.cantSplit); break;
    }
    editor.focus();
  }),
);
let fillOn = false;

// 다단 (3-6)
document.getElementById('col-break')!.addEventListener('click', () => {
  editor.insertColumnBreak();
  editor.focus();
});

// 댓글 창 (4-2)
pane = new CommentsPane(document.getElementById('comments')!, editor);

// 보기 모드 (4-4)
const viewSel = document.getElementById('view-mode') as HTMLSelectElement;
viewSel.addEventListener('change', () => {
  const t = performance.now();
  editor.setViewMode(viewSel.value as 'suggestions' | 'final' | 'original');
  viewSel.title = `${Math.round(performance.now() - t)} ms`;
  suggestBtn.toggleAttribute('disabled', editor.viewMode !== 'suggestions');
});

// HTML·Markdown·DOCX·HWPX 가져오기·내보내기 (5-5–5-7)
document.getElementById('export-html')!.addEventListener('click', () => void saveAs(editor, 'html').then(showStats));
document.getElementById('export-md')!.addEventListener('click', () => void saveAs(editor, 'md').then(showStats));
document.getElementById('export-docx')!.addEventListener('click', () => void saveAs(editor, 'docx').then(showStats));
document.getElementById('export-hwpx')!.addEventListener('click', () => void saveAs(editor, 'hwpx').then(showStats));
const importFile = document.getElementById('import-file') as HTMLInputElement;
document.getElementById('import-doc')!.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  const f = importFile.files?.[0];
  importFile.value = '';
  if (f)
    void openFile(editor, f).then(() => {
      editor.focus();
      showStats();
    });
});

// PDF 내보내기·인쇄 (5-4): 버튼, Ctrl+P (브라우저 인쇄 대신 쪽 그대로의 PDF)
const pdfBtn = document.getElementById('pdf-export')!;
pdfBtn.addEventListener('click', () => openPdf(editor));
window.addEventListener(
  'keydown',
  (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      openPdf(editor);
    }
  },
  true,
);

// 제안 모드 (4-3)
const suggestBtn = document.getElementById('suggest')!;
const spellBtn = document.getElementById('spell')!;
spellBtn.addEventListener('click', () => {
  const on = spellBtn.getAttribute('aria-pressed') !== 'true';
  spellBtn.setAttribute('aria-pressed', String(on));
  editor.setSpellChecker(on ? spellChecker : null);
  editor.focus();
});
suggestBtn.addEventListener('click', () => {
  editor.setSuggesting(!editor.suggesting);
  suggestBtn.setAttribute('aria-pressed', String(editor.suggesting));
  editor.focus();
});

// 주석 레이어 (4-1)
document.getElementById('ann-add')!.addEventListener('click', () => {
  editor.annotate('highlight');
  editor.focus();
});
document.getElementById('ann-del')!.addEventListener('click', () => {
  for (const a of editor.annotationsAtCaret()) editor.unannotate(a.id);
  editor.focus();
});

// 각주 (3-5)
document.getElementById('footnote')!.addEventListener('click', () => {
  editor.insertFootnote();
  editor.focus();
});

// 쪽 나눔 제어 (3-3)
document.getElementById('page-break')!.addEventListener('click', () => {
  editor.insertPageBreak();
  editor.focus();
});
document.querySelectorAll<HTMLButtonElement>('[data-keep]').forEach((btn) =>
  btn.addEventListener('click', () => {
    editor.toggleParagraphKeep(btn.dataset.keep as 'pageBreakBefore' | 'keepWithNext' | 'keepTogether');
    editor.focus();
  }),
);

// 머리말·꼬리말과 필드 (3-4)
document.getElementById('hf-header')!.addEventListener('click', () => {
  editor.editHeaderFooter('header');
  editor.focus();
});
document.getElementById('hf-footer')!.addEventListener('click', () => {
  editor.editHeaderFooter('footer');
  editor.focus();
});
document.querySelectorAll<HTMLButtonElement>('[data-field]').forEach((b) =>
  b.addEventListener('click', () => {
    editor.insertField(b.dataset.field as 'page' | 'pages');
    editor.focus();
  }),
);
document.querySelectorAll<HTMLButtonElement>('[data-hfopt]').forEach((b) =>
  b.addEventListener('click', () => {
    const k = b.dataset.hfopt as 'titlePage' | 'oddEven';
    editor.setHeaderFooterOption(k, !editor.headerFooterInfo()?.[k]);
    editor.focus();
  }),
);
document.getElementById('hf-link')!.addEventListener('click', () => {
  editor.setHeaderFooterLinked(!editor.headerFooterInfo()?.linked);
  editor.focus();
});
document.getElementById('hf-close')!.addEventListener('click', () => {
  editor.closeHeaderFooter();
  editor.focus();
});

/** 머리말·꼬리말을 편집 중이면 그 도구를 보인다 */
function showHeaderFooter(): void {
  const info = editor?.headerFooterInfo();
  const tools = document.querySelector('.hf-tools') as HTMLElement | null;
  if (!tools) return;
  tools.hidden = !info;
  if (!info) return;
  document.querySelectorAll<HTMLButtonElement>('[data-hfopt]').forEach((b) => b.setAttribute('aria-pressed', String(!!info[b.dataset.hfopt as 'titlePage' | 'oddEven'])));
  const link = document.getElementById('hf-link') as HTMLButtonElement;
  link.setAttribute('aria-pressed', String(info.linked));
  link.disabled = info.sectionIndex === 0;
}

// 구역 (3-2): 구역 나누기, 쪽 설정 대화상자
document.getElementById('sec-break')!.addEventListener('click', () => {
  editor.insertSectionBreak('nextPage');
  editor.focus();
});
const pageDialog = document.getElementById('page-dialog') as HTMLDialogElement;
const pageForm = pageDialog.querySelector('form')!;
const field = <T extends HTMLElement = HTMLInputElement>(name: string) => pageForm.elements.namedItem(name) as unknown as T;
const toMm = (v: number) => Math.round((v * 25.4) / 72) / 1000;
const fromMm = (v: number) => Math.round((v * 72000) / 25.4);
/** 용지 크기 → 이름 (세로·가로 모두 본다, 1pt 안쪽이면 같음) */
function paperName(w: number, h: number): string {
  for (const [name, [a, b]] of Object.entries(PAPER_SIZES)) {
    const near = (x: number, y: number) => Math.abs(x - y) < 1000;
    if ((near(w, a) && near(h, b)) || (near(w, b) && near(h, a))) return name;
  }
  return 'custom';
}
function fillPageForm(p: SectionProps): void {
  const { width, height, margin } = p.page;
  field<HTMLSelectElement>('paper').value = paperName(width, height);
  field('width').value = String(toMm(width));
  field('height').value = String(toMm(height));
  for (const el of pageForm.querySelectorAll<HTMLInputElement>('input[name="orient"]')) el.checked = el.value === (width > height ? 'landscape' : 'portrait');
  ['mt', 'mr', 'mb', 'ml'].forEach((n, k) => (field(n).value = String(toMm(margin[k]!))));
  field<HTMLSelectElement>('start').value = p.start;
  field<HTMLSelectElement>('cols').value = String(p.columns?.count ?? 1);
  field('colGap').value = String(toMm(p.columns?.gap ?? fromMm(12.5)));
  field('colSep').checked = !!p.columns?.separator;
  field('pnStart').value = p.pageNumber?.start !== undefined ? String(p.pageNumber.start) : '';
  field<HTMLSelectElement>('pnFormat').value = p.pageNumber?.format ?? 'decimal';
}
function syncPaper(): void {
  const name = field<HTMLSelectElement>('paper').value;
  const custom = name === 'custom';
  field('width').disabled = !custom;
  field('height').disabled = !custom;
  if (custom) return;
  const [a, b] = PAPER_SIZES[name]!;
  const land = (pageForm.querySelector<HTMLInputElement>('input[name="orient"]:checked')?.value ?? 'portrait') === 'landscape';
  field('width').value = String(toMm(land ? b : a));
  field('height').value = String(toMm(land ? a : b));
}
field<HTMLSelectElement>('paper').addEventListener('change', syncPaper);
for (const el of pageForm.querySelectorAll<HTMLInputElement>('input[name="orient"]'))
  el.addEventListener('change', () => {
    if (field<HTMLSelectElement>('paper').value === 'custom') {
      // 사용자 지정 크기: 너비와 높이를 바꾼다
      const w = field('width').value;
      const h = field('height').value;
      const land = el.value === 'landscape';
      if ((Number(w) > Number(h)) !== land) {
        field('width').value = h;
        field('height').value = w;
      }
    } else syncPaper();
  });
document.getElementById('page-setup')!.addEventListener('click', () => {
  const info = editor.sectionInfo();
  document.getElementById('page-section')!.textContent = `구역 ${info.index + 1} / ${info.count}`;
  fillPageForm(info.props);
  syncPaper();
  (document.getElementById('sec-remove') as HTMLButtonElement).disabled = info.index >= info.count - 1;
  (document.getElementById('page-error') as HTMLElement).hidden = true;
  pageDialog.showModal();
});
document.getElementById('sec-remove')!.addEventListener('click', () => {
  editor.removeSectionBreak();
  pageDialog.close('cancel');
});
pageForm.addEventListener('submit', (e) => {
  if ((e.submitter as HTMLButtonElement | null)?.value !== 'ok') return;
  const num = (n: string) => Number(field(n).value);
  const w = num('width');
  const h = num('height');
  const [mt, mr, mb, ml] = ['mt', 'mr', 'mb', 'ml'].map(num) as [number, number, number, number];
  const err = document.getElementById('page-error') as HTMLElement;
  const bad = [w, h, mt, mr, mb, ml].some((v) => !Number.isFinite(v) || v < 0);
  // 본문이 너무 좁거나 낮으면 받지 않는다 (글자 하나도 들어가지 않는 쪽)
  if (bad || w - ml - mr < 20 || h - mt - mb < 20) {
    e.preventDefault();
    err.textContent = '여백을 뺀 본문이 가로·세로 20mm보다 커야 합니다. 여백이나 용지 크기를 줄이세요.';
    err.hidden = false;
    return;
  }
  const info = editor.sectionInfo();
  const pnStart = field('pnStart').value.trim();
  const pnFormat = field<HTMLSelectElement>('pnFormat').value as 'decimal' | 'roman' | 'hangul';
  const pageNumber = { ...(pnStart !== '' ? { start: Math.max(0, Math.round(Number(pnStart))) } : {}), ...(pnFormat !== 'decimal' ? { format: pnFormat } : {}) };
  const next: SectionProps = {
    ...info.props,
    page: { width: fromMm(w), height: fromMm(h), margin: [fromMm(mt), fromMm(mr), fromMm(mb), fromMm(ml)] },
    start: field<HTMLSelectElement>('start').value as SectionStart,
  };
  if (Object.keys(pageNumber).length) next.pageNumber = pageNumber;
  else delete next.pageNumber;
  const cols = Number(field<HTMLSelectElement>('cols').value);
  if (cols > 1) next.columns = { count: cols, gap: fromMm(Math.max(0, Number(field('colGap').value) || 0)), ...(field('colSep').checked ? { separator: true } : {}) };
  else delete next.columns;
  editor.setSectionProps(next);
});
pageDialog.addEventListener('close', () => editor.focus());

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
const breakSel = document.getElementById('para-break') as HTMLSelectElement;
breakSel.addEventListener('change', () => {
  editor.setParagraphAttr('koreanBreak', breakSel.value === 'char' ? 'char' : undefined);
  editor.focus();
});
document.querySelectorAll<HTMLButtonElement>('[data-korean]').forEach((b) =>
  b.addEventListener('click', () => {
    const k = b.dataset.korean as 'hangPunct' | 'squeeze';
    const ps = editor.paragraphState();
    editor.setParagraphAttr(k, ps.attrs[k] === true && !ps.mixed.has(k) ? undefined : true);
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
  breakSel.value = ps.attrs.koreanBreak === 'char' ? 'char' : 'word';
  document.querySelectorAll<HTMLButtonElement>('[data-korean]').forEach((b) => {
    const k = b.dataset.korean as 'hangPunct' | 'squeeze';
    b.setAttribute('aria-pressed', ps.mixed.has(k) ? 'mixed' : String(ps.attrs[k] === true));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-keep]').forEach((b) => {
    const k = b.dataset.keep as 'pageBreakBefore' | 'keepWithNext' | 'keepTogether';
    b.setAttribute('aria-pressed', ps.mixed.has(k) ? 'mixed' : String(ps.attrs[k] === true));
  });

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
