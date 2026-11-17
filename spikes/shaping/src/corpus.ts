/** 셰이핑 검증 말뭉치. 글꼴: 한글 = 맑은 고딕(malgun.ttf), 라틴 = Calibri(calibri.ttf, 커닝·합자 있음) */

export const LOREM =
  '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다. 이 문단은 대형 문서 성능 측정을 위해 반복해서 생성된 문단입니다. 레이아웃 캐시가 동작하면 편집할 때 바뀐 문단만 다시 줄을 나눕니다.';

export interface Sample {
  id: string;
  font: 'ko' | 'latin';
  text: string;
  note: string;
}

export const SAMPLES: Sample[] = [
  { id: 'ko-sentence', font: 'ko', text: LOREM, note: '현대 한글 음절 + 공백·문장부호' },
  { id: 'ko-old', font: 'ko', text: 'ᄒᆞᆫ글 ᄀᆞᇫ ᄇᆡᆨ셩', note: '옛한글 첫가끝 조합 (GSUB ljmo/vjmo/tjmo)' },
  { id: 'ko-hanja', font: 'ko', text: '大韓民國 憲法 第一條', note: '한자' },
  { id: 'ko-punct', font: 'ko', text: '「인용」 (괄호) ‘작은따옴표’ … 1,234.5% ㈜', note: '전각·약물·숫자' },
  { id: 'ko-mixed', font: 'ko', text: 'Quire는 canvas에 직접 그린다. iPhone·Android에서도.', note: '한글 글꼴로 라틴 섞어 쓰기' },
  { id: 'latin-liga', font: 'latin', text: 'office fifty affluent official ffi fl', note: 'Calibri 합자 (fi, ffi, …)' },
  { id: 'latin-kern', font: 'latin', text: 'AVATAR Wave To. Yo, LT VA P.', note: '커닝 쌍' },
  { id: 'latin-marks', font: 'latin', text: 'Tiếng Việt, café, Å', note: '결합 문자 (분해형)' },
  { id: 'emoji', font: 'ko', text: '좋아요 👍🏽 👩‍💻 🇰🇷', note: '이모지 (맑은 고딕에 없음 → 대체 글꼴 필요)' },
];

/** 문단 n개 (성능 측정) */
export function paragraphs(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${i + 1}. ${LOREM}`);
}
