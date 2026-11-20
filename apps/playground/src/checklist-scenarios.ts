/**
 * 0단계 실제 환경 확인 시나리오 (06 §2 V1–V3).
 *
 * V4(6-7)는 0단계 뒤에 생긴 입력 자리(표 셀, 각주, 머리말, 제안 모드)에서 같은 IME 동작을 본다. setup이 처음 상태를 만들고
 * read가 판정할 글(그 스토리)을 읽는다.
 *
 * V1·V2는 처음 상태(텍스트·선택)에서 시작해 손으로 입력한 결과를 기대값과 자동 비교한다. 브라우저·IME마다 정당하게
 * 달라질 수 있는 경우(조합 중 방향키 등)는 accept 함수로 허용 범위를 둔다. V3(스크린리더)와 후보 창 위치는 눈·귀로 판정한다.
 */

import type { Editor } from '@quire/editor';
import { isHFStory } from '@quire/model';

export type Group = 'V1' | 'V2' | 'V3' | 'V4';

export interface Scenario {
  id: string;
  group: Group;
  title: string;
  /** 어느 환경에서 하는가 (없으면 모두) */
  only?: 'desktop' | 'mobile' | 'windows' | 'mac';
  /** 처음 상태. 없으면 편집기를 건드리지 않는다 (V3) */
  start?: { text: string; anchor: number; head?: number };
  steps: string[];
  /** 기대 결과 설명 */
  expect: string;
  /** 기대 텍스트 (자동 비교). accept가 있으면 그것을 쓴다 */
  expected?: string;
  accept?: (text: string) => boolean;
  /** 자동 비교 말고 눈·귀로 볼 것 */
  look?: string;
  /** 처음 상태를 만든 뒤 (표 넣기, 각주·머리말로 들어가기 등) */
  setup?: (editor: Editor) => void;
  /** 판정할 글 (없으면 본문) */
  read?: (editor: Editor) => string;
}

/** 고른 스토리들의 글 (끝 ¶ 빼고, 빈 스토리 빼고 줄바꿈으로 잇는다) */
function storyText(editor: Editor, pick: (id: string) => boolean): string {
  return editor.document
    .storyIds()
    .filter((id) => id !== null && pick(id))
    .map((id) => editor.document.story(id).text().replace(/\n$/, ''))
    .filter(Boolean)
    .join('\n');
}
const cells = (e: Editor) => storyText(e, (id) => id.includes('|') && !id.startsWith('fn|') && !isHFStory(id));
const notes = (e: Editor) => storyText(e, (id) => id.startsWith('fn|'));
const headers = (e: Editor) => storyText(e, (id) => id.startsWith('hdr|'));

/** 남으면 안 되는 낱자모 (조합 중간 상태가 문서에 들어간 흔적) */
const JAMO = /[ㄱ-ㆎ]/;

const LONG = Array.from({ length: 60 }, (_, i) => `${i + 1}번째 문단입니다. 스크롤한 뒤에도 후보 창이 캐럿 옆에 떠야 합니다.`).join('\n');

export const SCENARIOS: Scenario[] = [
  // ── V1 한글 IME ──
  {
    id: 'v1-basic',
    group: 'V1',
    title: '기본 입력',
    start: { text: '', anchor: 0 },
    steps: ['"한글 입력"을 보통 속도로 입력한다.'],
    expect: '"한글 입력". 조합 중인 글자는 밑줄로 보이고, 음절이 바뀔 때 한 번씩만 들어간다.',
    expected: '한글 입력',
  },
  {
    id: 'v1-fast',
    group: 'V1',
    title: '빠른 연타',
    start: { text: '', anchor: 0 },
    steps: ['"안녕하세요 반갑습니다"를 최대한 빠르게 입력한다.', '한 번 더: "동해물과 백두산이 마르고 닳도록"'],
    expect: '두 문장이 한 글자도 빠지거나 겹치지 않는다.',
    expected: '안녕하세요 반갑습니다동해물과 백두산이 마르고 닳도록',
    accept: (t) => t.replace(/\s+/g, '') === '안녕하세요반갑습니다동해물과백두산이마르고닳도록',
  },
  {
    id: 'v1-backspace',
    group: 'V1',
    title: '조합 중 백스페이스',
    start: { text: '', anchor: 0 },
    steps: ['ㄱ ㅏ ㅁ 을 쳐서 "감"을 조합 중으로 둔다 (확정하지 않는다).', 'Backspace를 한 번 누른다 → "가"(아직 조합 중).', 'ㅇ 을 쳐서 "강"을 만든 뒤 Space.'],
    expect: '"강 ". 백스페이스는 조합 중인 글자의 자모 하나만 지우고, 앞 글자를 지우거나 "감"이 남지 않는다.',
    expected: '강 ',
  },
  {
    id: 'v1-backspace-empty',
    group: 'V1',
    title: '조합 중 백스페이스로 조합을 모두 지움',
    start: { text: '가나', anchor: 2 },
    steps: ['ㄷ 을 쳐서 조합 중으로 둔다.', 'Backspace를 두 번 누른다.'],
    expect: '"가". 첫 번째로 조합 중인 ㄷ이 사라지고, 두 번째로 "나"가 지워진다.',
    expected: '가',
  },
  {
    id: 'v1-click',
    group: 'V1',
    title: '조합 중 클릭',
    start: { text: '가나다', anchor: 3 },
    steps: ['ㄹ ㅏ 를 쳐서 "라"를 조합 중으로 둔다.', '확정하지 말고 첫 글자 "가" 앞을 마우스로 클릭한다.', '"마"를 입력하고 Space.'],
    expect: '"마 가나다라". "라"는 클릭 전에 원래 자리에서 확정되고, 클릭한 곳에 "마"가 들어간다.',
    expected: '마 가나다라',
  },
  {
    id: 'v1-arrow',
    group: 'V1',
    title: '조합 중 방향키',
    start: { text: '가나다', anchor: 3 },
    steps: ['ㄹ ㅏ 를 쳐서 "라"를 조합 중으로 둔다.', '확정하지 말고 ←를 한 번 누른다.', '"마"를 입력한다.'],
    expect: '"라"가 한 번만 남는다. 캐럿이 "라" 앞으로 갔으면 "가나다마라", 확정만 되고 제자리면 "가나다라마" (IME마다 다름: 어느 쪽이었는지 메모).',
    accept: (t) => t === '가나다마라' || t === '가나다라마',
  },
  {
    id: 'v1-enter',
    group: 'V1',
    title: '조합 중 Enter',
    start: { text: '', anchor: 0 },
    steps: ['"한"을 조합 중으로 둔다.', '확정하지 말고 Enter.', '"글"을 입력한다.'],
    expect: '두 문단 "한" / "글". "한"이 사라지거나 두 번 들어가거나, 빈 문단이 하나 더 생기지 않는다.',
    expected: '한\n글',
  },
  {
    id: 'v1-punct',
    group: 'V1',
    title: '조합 중 문장부호·숫자',
    start: { text: '', anchor: 0 },
    steps: ['"가"를 조합 중으로 둔 채 쉼표, Space, "나"를 조합 중으로 둔 채 마침표, 이어서 1 2 3.'],
    expect: '"가, 나.123"',
    expected: '가, 나.123',
  },
  {
    id: 'v1-switch',
    group: 'V1',
    title: '한/영 전환',
    start: { text: '', anchor: 0 },
    steps: ['"한"을 조합 중으로 둔 채 한/영 키(macOS: Caps Lock 또는 Ctrl+Space)로 영문 전환 → a', '다시 한글 → "글" → 영문 → b'],
    expect: '"한a글b"',
    expected: '한a글b',
  },
  {
    id: 'v1-selection',
    group: 'V1',
    title: '선택 영역 위에서 조합',
    start: { text: '바꿀 글자', anchor: 0, head: 2 },
    steps: ['"바꿀"이 선택된 상태에서 "새"를 입력한다.'],
    expect: '"새 글자". 첫 자모를 치는 순간 선택이 지워지고 조합이 그 자리에서 시작된다.',
    expected: '새 글자',
  },
  {
    id: 'v1-undo',
    group: 'V1',
    title: '입력 뒤 실행 취소',
    start: { text: '', anchor: 0 },
    steps: ['"한글 입력"을 입력한다.', 'Ctrl+Z (macOS: Cmd+Z)를 한 번 누른다.'],
    expect: '연속 입력이 한 단위로 지워진다. ㅎ·하 같은 조합 중간 상태가 남지 않는다.',
    accept: (t) => !JAMO.test(t) && t.length < '한글 입력'.length,
  },
  {
    id: 'v1-autocorrect',
    group: 'V1',
    title: '자동 수정·추천 단어 (모바일)',
    only: 'mobile',
    start: { text: '', anchor: 0 },
    steps: ['"안녕하"까지 입력한다.', '키보드 위 추천 단어에서 "안녕하세요"를 누른다.'],
    expect: '"안녕하세요"(키보드에 따라 뒤에 공백). "안녕하안녕하세요"처럼 겹치지 않는다.',
    accept: (t) => t.trimEnd() === '안녕하세요',
  },

  {
    id: 'v1-bold-ime',
    group: 'V1',
    title: '굵게 켜고 한글 조합 (서식 2-3)',
    start: { text: '보통 ', anchor: 3 },
    steps: ['선택 없이 Ctrl+B (macOS ⌘B)를 누른다.', '"굵게 입력"을 입력한다.'],
    expect: '"보통 굵게 입력". 조합 중인 글자도 처음부터 굵게 보이고, 확정한 뒤에도 굵게 남는다.',
    expected: '보통 굵게 입력',
    look: '조합 중 글자가 보통 굵기로 보였다가 확정 때 굵어지면 실패 (메모에 적는다).',
  },
  // ── V2 후보 창 ──
  {
    id: 'v2-hanja',
    group: 'V2',
    title: '한자 변환 후보 창',
    only: 'desktop',
    start: { text: '', anchor: 0 },
    steps: ['"한"을 입력하고 한자 키(Windows: 한자 키 또는 오른쪽 Ctrl, macOS: Option+Enter)를 누른다.', '후보 창에서 韓을 고른다.'],
    expect: '"韓"',
    expected: '韓',
    look: '후보 창이 캐럿 바로 아래·옆에 뜬다 (화면 구석이나 편집기 밖이 아님).',
  },
  {
    id: 'v2-emoji',
    group: 'V2',
    title: '이모지 창',
    only: 'desktop',
    start: { text: '웃음', anchor: 2 },
    steps: ['이모지 창을 연다 (Windows: Win+. , macOS: Ctrl+Cmd+Space).', '😀을 고른다.'],
    expect: '"웃음😀"',
    expected: '웃음😀',
    look: '이모지 창이 캐럿 근처에 뜬다.',
  },
  {
    id: 'v2-scrolled',
    group: 'V2',
    title: '스크롤한 뒤의 후보 창',
    only: 'desktop',
    start: { text: LONG, anchor: 0 },
    steps: ['편집기를 아래로 스크롤해 40번째 문단 끝을 클릭한다.', '"한"을 입력하고 한자 변환 창을 연 뒤 Esc.'],
    expect: '후보 창이 40번째 문단의 캐럿 옆에 뜬다.',
    look: '후보 창 위치가 스크롤 전 위치(문서 맨 위)에 남아 있지 않다.',
  },

  // ── V4 새 입력 자리 (6-7: 0단계 뒤에 생긴 표 셀·각주·머리말·제안 모드) ──
  {
    id: 'v4-cell',
    group: 'V4',
    title: '표 셀 안에서 조합',
    start: { text: '', anchor: 0 },
    setup: (e) => e.insertTable(2, 2),
    read: cells,
    steps: ['캐럿이 첫 셀에 있다. "표 안 입력"을 입력한다.'],
    expect: '첫 셀에 "표 안 입력". 조합 중 글자가 셀 안에 보이고 셀 밖(본문)에 새지 않는다.',
    expected: '표 안 입력',
  },
  {
    id: 'v4-cell-enter',
    group: 'V4',
    title: '셀 안에서 조합 중 Enter',
    start: { text: '', anchor: 0 },
    setup: (e) => e.insertTable(2, 2),
    read: cells,
    steps: ['첫 셀에서 "첫줄"을 입력하고, "줄"이 조합 중일 때 Enter.', '"둘째"를 입력한다.'],
    expect: '첫 셀이 두 문단 "첫줄" / "둘째". 빈 문단이 더 생기지 않는다 (Enter가 두 번 들어오는 IME).',
    expected: '첫줄\n둘째',
  },
  {
    id: 'v4-cell-hanja',
    group: 'V4',
    title: '셀 안 한자 변환 후보 창',
    only: 'desktop',
    start: { text: '', anchor: 0 },
    setup: (e) => e.insertTable(2, 2),
    read: cells,
    steps: ['첫 셀에서 "한"을 입력하고 한자 키를 누른다.', '韓을 고른다.'],
    expect: '첫 셀에 "韓"',
    expected: '韓',
    look: '후보 창이 셀 안 캐럿 옆에 뜬다 (본문 맨 위나 화면 구석이 아님).',
  },
  {
    id: 'v4-note',
    group: 'V4',
    title: '각주 안에서 조합',
    start: { text: '본문 문장.', anchor: 6 },
    setup: (e) => e.insertFootnote(),
    read: notes,
    steps: ['캐럿이 쪽 아래 각주 칸에 있다. "각주 내용"을 입력한다.'],
    expect: '각주가 "각주 내용". 본문은 그대로 "본문 문장." + 각주 번호.',
    expected: '각주 내용',
    look: '조합 중 글자가 각주 칸(쪽 아래)에 보인다.',
  },
  {
    id: 'v4-header',
    group: 'V4',
    title: '머리말 안에서 조합',
    start: { text: '본문', anchor: 0 },
    setup: (e) => e.editHeaderFooter('header'),
    read: headers,
    steps: ['캐럿이 쪽 위 머리말에 있다. "머리말 글"을 입력한다.'],
    expect: '머리말이 "머리말 글".',
    expected: '머리말 글',
    look: '조합 중 글자가 머리말 자리에 보이고, 후보 창(한자 키)도 머리말 캐럿 옆에 뜬다.',
  },
  {
    id: 'v4-suggest',
    group: 'V4',
    title: '제안 모드에서 조합',
    start: { text: '본문 ', anchor: 3 },
    setup: (e) => e.setSuggesting(true),
    steps: ['"제안 글"을 입력한다.'],
    expect: '"본문 제안 글". 넣은 글이 제안(색·밑줄)으로 보인다.',
    expected: '본문 제안 글',
    look: '조합 중 글자도 제안 색인지, 확정 뒤 제안 하나로 묶이는지 (댓글 창 없음: 색만 본다).',
  },

  // ── V3 스크린리더 ──
  {
    id: 'v3-focus',
    group: 'V3',
    title: '편집기 포커스 안내',
    steps: ['스크린리더를 켠다 (NVDA + Chrome, VoiceOver + Safari).', 'Tab으로 편집기에 들어간다.'],
    expect: '"문서 편집 영역", 여러 줄 편집 가능하다는 안내를 읽는다.',
    look: '들은 안내를 메모에 적는다.',
  },
  {
    id: 'v3-read',
    group: 'V3',
    title: '문단 읽기',
    start: { text: '첫째 문단입니다.\n둘째 문단에는 English도 섞여 있습니다.\n셋째 문단.', anchor: 0 },
    steps: ['편집기 안에서 모두 읽기 (NVDA: NVDA+↓, VoiceOver: VO+A).'],
    expect: '세 문단을 순서대로 읽는다.',
    look: '빠지거나 두 번 읽는 문단이 없는지.',
  },
  {
    id: 'v3-caret',
    group: 'V3',
    title: '캐럿 이동 읽기',
    start: { text: '가나다라마\n바사아자차', anchor: 0 },
    steps: ['→를 몇 번 누른다.', '↓, ↑를 누른다.'],
    expect: '←/→는 지나간 글자를, ↑/↓는 그 줄 전체를 읽는다.',
    look: '읽은 내용을 메모에 적는다. 아무것도 읽지 않으면 실패.',
  },
  {
    id: 'v3-table',
    group: 'V3',
    title: '표 읽기 (6-7)',
    start: { text: '표 앞 문단', anchor: 6 },
    setup: (e) => {
      e.insertTable(2, 2);
      e.focus();
    },
    steps: ['첫 셀에 "가"를 입력하고 Tab, 둘째 셀에 "나"를 입력한다.', '모두 읽기, 그리고 ↑로 표 앞 문단으로 나갔다가 ↓로 돌아온다.'],
    expect: '셀 글을 읽고, 표에 들어가고 나가는 것을 알 수 있다.',
    look: '읽은 내용을 메모에 적는다 ("표", 행·열 안내가 있는지).',
  },
  {
    id: 'v3-echo',
    group: 'V3',
    title: '입력 반향',
    start: { text: '', anchor: 0 },
    steps: ['"안녕"을 입력한다.', 'Backspace를 한 번 누른다.'],
    expect: '입력한 글자와 지운 글자를 읽는다.',
    expected: '안',
    look: '읽은 내용을 메모에 적는다.',
  },
];

export function judge(s: Scenario, text: string): boolean | null {
  if (s.accept) return s.accept(text);
  if (s.expected !== undefined) return text === s.expected;
  return null;
}
