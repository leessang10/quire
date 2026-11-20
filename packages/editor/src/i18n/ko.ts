/**
 * 편집기 화면 문자열: 한국어 (기본 언어, 18 §3). 키 목록의 기준이다 (MessageKey). 다른 언어 파일은 시험에서 키 집합을 비교한다.
 * 키는 점으로 나눈 의미 이름, 자리표시는 {이름}, 복수형은 {n, plural, one {…} other {…}} (# = 그 수).
 */
export const ko = {
  // 접근성 이름
  'a11y.input': '문서 편집 영역',
  'a11y.document': '문서 내용',
  'a11y.image': '이미지',

  // 캔버스 표시: 그림 자리
  'image.missing': '이미지 없음',
  'image.missingAlt': '이미지 없음: {alt}',
  'image.loading': '불러오는 중…',

  // 나눔 표시 (구역 시작 방식은 section.*)
  'break.section': '구역 나눔 ({start})',
  'break.page': '쪽 나눔',
  'break.column': '단 나눔',
  'section.nextPage': '다음 쪽',
  'section.continuous': '이어서',
  'section.evenPage': '짝수 쪽',
  'section.oddPage': '홀수 쪽',

  // 머리말·꼬리말 편집 중 이름
  'hf.header': '머리말',
  'hf.headerFirst': '머리말 (첫 쪽)',
  'hf.headerEven': '머리말 (짝수 쪽)',
  'hf.footer': '꼬리말',
  'hf.footerFirst': '꼬리말 (첫 쪽)',
  'hf.footerEven': '꼬리말 (짝수 쪽)',
  'hf.linked': '{label} · 이전과 연결',

  // 백그라운드 쪽 조립
  'layout.progress': '쪽 조립 중… {percent}%',

  // 사용자를 정하지 않았을 때의 댓글 작성자 이름
  'author.me': '나',

  // 제안 요약 (suggestionViews)
  'suggestion.insert': '‘{text}’ 넣음',
  'suggestion.delete': '‘{text}’ 지움',
  'suggestion.format': '서식: {attrs} (‘{text}’)',
  'suggestion.move': '문단 옮김 (‘{text}’)',
  'suggestion.paragraph': '문단: {attrs}',
  'suggestion.rowInsert': '표: 행 넣음',
  'suggestion.rowDelete': '표: 행 지움',
  'suggestion.columnInsert': '표: 열 넣음',
  'suggestion.columnDelete': '표: 열 지움',
  'list.separator': ', ',

  // 서식 속성 이름 (제안 요약)
  'attr.bold': '굵게',
  'attr.italic': '기울임',
  'attr.underline': '밑줄',
  'attr.strike': '취소선',
  'attr.size': '크기',
  'attr.color': '색',
  'attr.highlight': '형광펜',
  'attr.font': '글꼴',
  'attr.sup': '위 첨자',
  'attr.sub': '아래 첨자',
  'attr.link': '링크',
  'attr.align': '정렬',
  'attr.style': '스타일',
  'attr.list': '목록',
  'attr.indent': '들여쓰기',
  'attr.spacing': '줄 간격',

  // 맞춤법 플러그인 메뉴
  'spell.noSuggestions': '고칠 말 없음',
  'spell.ignore': '이 문서에서 무시',
  'spell.addWord': '사전에 더하기',

  // 예제 플러그인
  'wordCount.exporter': '문서 통계 (글)',
  'wordCount.report': '글자 {chars} (공백 빼고 {charsNoSpace})\n어절 {words}\n문단 {paragraphs}\n',
  'highlightWords.add': '강조 낱말로 더하기',
  'highlightWords.remove': '강조 빼기: {word}',
};

export type MessageKey = keyof typeof ko;
