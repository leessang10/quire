/**
 * 기준 문서 세트 (12 §1): 보고서 문서 만들기. 제목·본문·목록(번호·글머리 중첩)·서식·양쪽 정렬·인용·표(병합)를 쓴다.
 *   node scripts/make-fixture-report.mjs  → fixtures/docs/report.json
 * 글은 이 저장소를 위해 쓴 것이다. 한 번 만들어 고정하고, 고치면 기대값(report.expected.json)도 사람이 다시 본다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const p = (text, attrs = {}) => ({ p: attrs, c: text ? [{ t: text }] : [] });
const runs = (attrs, ...rs) => ({ p: attrs, c: rs.map((r) => (typeof r === 'string' ? { t: r } : r)) });
const b = (t) => ({ t, m: { bold: true } });
const i = (t) => ({ t, m: { italic: true } });

const N = 'n1';
const B = 'b1';
const li = (text, level = 0, id = N) => p(text, { list: { id, level } });

const PARA = [
  '문서 편집기는 조직 안에서 가장 오래, 가장 많이 쓰이는 도구 가운데 하나다. 보고서와 회의록, 계약서와 안내문이 모두 같은 도구에서 만들어지고 고쳐진다. 그래서 편집기를 바꾸는 일은 화면 하나를 바꾸는 일이 아니라 일하는 방식 전체를 바꾸는 일에 가깝다.',
  '이 보고서는 지난 두 달 동안 세 부서가 함께 시험한 결과를 정리한 것이다. 시험은 실제 업무 문서를 그대로 옮겨 와 같은 일을 두 도구로 해 보는 방식으로 진행했다. 숫자로 잴 수 있는 것은 쟀고, 잴 수 없는 것은 사용자의 말을 그대로 적었다.',
  '가장 먼저 눈에 띈 차이는 쪽 나눔이었다. 기존 도구에서는 같은 문서를 다른 사람이 열면 쪽 끝이 한두 줄씩 달라지는 일이 잦았다. 인쇄본과 화면이 어긋나니 "몇 쪽 몇째 줄"이라는 말로 의견을 주고받기가 어려웠다.',
  '두 번째는 함께 쓰기였다. 여러 사람이 한 문서를 동시에 고칠 때 누가 무엇을 바꿨는지 알기 어렵고, 같은 문단을 동시에 고치면 한쪽의 글이 사라지는 일도 있었다. 시험한 도구는 글자 하나 단위로 변경을 합쳐 이런 일이 없었다.',
];

const doc = {
  format: 'quire',
  version: 1,
  settings: {
    lists: {
      [N]: { id: N, kind: 'number', levels: numberLevels() },
      [B]: { id: B, kind: 'bullet', levels: bulletLevels() },
    },
  },
  styles: {},
  sections: [{ id: 's1', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, columns: 1 }],
  stories: {
    body: [
      p('문서 편집기 도입 검토 보고서', { style: 'h1' }),
      runs({}, '작성: 업무지원팀, ', i('2026년 11월')),
      p('1. 검토 배경', { style: 'h2' }),
      p(PARA[0], { align: 'justify' }),
      p(PARA[1], { align: 'justify' }),
      p('2. 시험 결과', { style: 'h2' }),
      p(PARA[2], { align: 'justify' }),
      p(PARA[3], { align: 'justify' }),
      p('시험에서 확인한 항목은 다음과 같다.'),
      li('같은 문서를 여러 기기에서 열었을 때 쪽 나눔이 같은가'),
      li('세 사람이 같은 문단을 동시에 고쳤을 때 글이 남는가'),
      li('표와 그림이 많은 문서에서 입력이 늦어지지 않는가'),
      li('천 쪽짜리 문서에서도 입력 지연이 한 프레임 안인가', 1),
      li('그림을 불러오기 전후로 쪽이 바뀌지 않는가', 1),
      li('한글 입력기의 조합이 끊기지 않는가'),
      runs({ align: 'justify' }, '결과는 ', b('네 항목 모두 기준을 넘었다'), '. 다만 입력기 조합은 운영체제마다 동작이 달라, 실제 기기에서 한 번 더 확인하기로 했다. 아래 표는 부서별로 옮겨 본 문서와 걸린 시간이다.'),
      { table: { cols: [150000, 150000, 150000], rows: [
        { cells: [{ story: 't1.h', span: [1, 3], fill: '#eeeeee' }] },
        { cells: [{ story: 't1.a1' }, { story: 't1.a2' }, { story: 't1.a3' }] },
        { cells: [{ story: 't1.b1' }, { story: 't1.b2' }, { story: 't1.b3' }] },
        { cells: [{ story: 't1.c1' }, { story: 't1.c2' }, { story: 't1.c3' }] },
      ] } },
      p('3. 사용자 의견', { style: 'h2' }),
      p('사용자 의견은 대체로 긍정적이었다. 특히 자주 나온 말은 다음 셋이다.'),
      li('"쪽 번호로 말해도 서로 같은 곳을 본다."', 0, B),
      li('"동시에 고쳐도 내 글이 사라지지 않는다."', 0, B),
      li('"표 안에서 줄을 바꿔도 행 높이가 알아서 맞는다."', 0, B),
      p('반대로 아쉬운 점으로는 머리말과 각주가 아직 없다는 것, 그리고 다른 프로그램에서 붙여 넣은 서식이 가끔 다르게 보인다는 것이 꼽혔다.', { style: 'quote' }),
      p('4. 결론', { style: 'h2' }),
      p(PARA[0] + ' ' + PARA[1], { align: 'justify' }),
      p('검토팀은 다음 분기부터 두 부서에서 시범 사용을 시작하고, 머리말·각주·다단이 준비되는 대로 전체 도입을 다시 논의할 것을 제안한다.', { align: 'justify' }),
      p(''),
      p('— 끝 —', { align: 'center' }),
    ],
    't1.h': [p('부서별 시험 결과', { align: 'center' })],
    't1.a1': [runs({}, b('부서'))],
    't1.a2': [runs({}, b('옮긴 문서'))],
    't1.a3': [runs({}, b('걸린 시간'))],
    't1.b1': [p('기획팀')],
    't1.b2': [p('보고서 12건, 회의록 30건')],
    't1.b3': [p('사흘')],
    't1.c1': [p('총무팀')],
    't1.c2': [p('안내문 8건'), p('계약서 서식 5건')],
    't1.c3': [p('이틀')],
  },
  annotations: [],
};

function numberLevels() {
  const fmts = [['decimal', '%1.'], ['hangul', '%2.'], ['decimal', '%3)'], ['hangul', '%4)'], ['decimal', '(%5)'], ['hangul', '(%6)'], ['circled', '%7'], ['hangulJamo', '%8'], ['lowerRoman', '%9.']];
  return fmts.map(([format, text], l) => ({ format, text, indent: 24000 * (l + 1), hanging: 18000 }));
}
function bulletLevels() {
  const bs = ['•', '◦', '▪'];
  return Array.from({ length: 9 }, (_, l) => ({ format: 'bullet', text: bs[l % 3], indent: 24000 * (l + 1), hanging: 18000 }));
}

const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
mkdirSync('fixtures/docs', { recursive: true });
writeFileSync('fixtures/docs/report.json', JSON.stringify(sort(doc), null, 2) + '\n');
console.log('fixtures/docs/report.json');
