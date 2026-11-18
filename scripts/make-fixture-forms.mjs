/**
 * 기준 문서 세트 (12 §1): 서식 문서 만들기. 구역 4개를 쓴다.
 *   1. 신청서 (A4 세로, 기본 여백): 제목·안내·신청 표(병합)
 *   2. 별지 (A4 가로, 여백 15mm, 다음 쪽): 열이 많은 넓은 표
 *   3. 작성 요령 (A4 세로, 여백 25mm, 홀수 쪽에서 시작): 번호 목록. 앞 구역이 2쪽에서 끝나므로 3쪽에서 시작 (빈 쪽 없음)
 *   4. 유의 사항 (같은 쪽에서 이어서, 왼쪽 여백 40mm): 글머리 목록
 *   node scripts/make-fixture-forms.mjs  → fixtures/docs/forms.json
 * 글은 이 저장소를 위해 쓴 것이다. 한 번 만들어 고정하고, 고치면 기대값(forms.expected.json)도 사람이 다시 본다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const p = (text, attrs = {}) => ({ p: attrs, c: text ? [{ t: text }] : [] });
const runs = (attrs, ...rs) => ({ p: attrs, c: rs.map((r) => (typeof r === 'string' ? { t: r } : r)) });
const b = (t) => ({ t, m: { bold: true } });
const mm = (v) => Math.round((v * 72000) / 25.4);
const A4 = [595276, 841890];

const N = 'n1';
const B = 'b1';
const li = (text, level = 0, id = N, extra = {}) => p(text, { list: { id, level }, ...extra });

const cell = (story, extra = {}) => ({ story, ...extra });
const cols = (n, total) => Array.from({ length: n }, () => Math.floor(total / n));

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
  sections: [
    { id: 'apply', page: { width: A4[0], height: A4[1], margin: [72000, 72000, 72000, 72000] }, start: 'nextPage' },
    { id: 'annex', page: { width: A4[1], height: A4[0], margin: [mm(15), mm(15), mm(15), mm(15)] }, start: 'nextPage' },
    { id: 'guide', page: { width: A4[0], height: A4[1], margin: [mm(25), mm(25), mm(25), mm(25)] }, start: 'oddPage' },
    { id: 'notes', page: { width: A4[0], height: A4[1], margin: [mm(25), mm(25), mm(25), mm(40)] }, start: 'continuous' },
  ],
  stories: {
    body: [
      p('시설 사용 신청서', { style: 'h1', align: 'center' }),
      p('※ 뒤쪽의 작성 요령을 읽고 빈칸에 적어 주십시오. 굵은 글씨 항목은 꼭 적어야 합니다.', { align: 'center' }),
      p(''),
      { table: { cols: [120000, 331276], rows: [
        { cells: [cell('t1.a1', { fill: '#eeeeee' }), cell('t1.a2')] },
        { cells: [cell('t1.b1', { fill: '#eeeeee' }), cell('t1.b2')] },
        { cells: [cell('t1.c1', { fill: '#eeeeee' }), cell('t1.c2')] },
        { cells: [cell('t1.d1', { fill: '#eeeeee' }), cell('t1.d2')] },
        { cells: [cell('t1.e1', { span: [1, 2] })] },
      ] } },
      p(''),
      p('위와 같이 시설 사용을 신청합니다.', { align: 'center' }),
      p('2026년    월    일', { align: 'right' }),
      runs({ align: 'right', section: 'apply' }, '신청인  ', b('(서명 또는 인)')),
      p('[별지] 사용 일정표', { style: 'h2' }),
      p('날마다 쓰는 시간과 인원을 적습니다. 같은 날 두 번 쓰면 줄을 나눠 적습니다.'),
      { table: { cols: cols(7, 749000), rows: [
        { cells: ['월', '화', '수', '목', '금', '토', '일'].map((_, k) => cell(`t2.h${k}`, { fill: '#eeeeee' })) },
        { cells: Array.from({ length: 7 }, (_, k) => cell(`t2.a${k}`)) },
        { cells: Array.from({ length: 7 }, (_, k) => cell(`t2.b${k}`)) },
      ] } },
      p('표가 모자라면 같은 모양으로 더 붙여 씁니다.', { section: 'annex' }),
      p('작성 요령', { style: 'h2' }),
      li('신청인은 시설을 실제로 쓰는 단체나 사람의 이름을 적습니다.'),
      li('연락처는 낮에 연락할 수 있는 전화번호를 적습니다. 휴대 전화도 됩니다.'),
      li('사용 목적은 행사의 이름과 내용을 한두 문장으로 적습니다.'),
      li('회의·교육처럼 정기적으로 쓰면 첫 회와 마지막 회 날짜를 함께 적습니다.', 1),
      li('입장료를 받는 행사면 그 금액을 적습니다.', 1),
      li('사용 일정은 별지의 표에 날마다 적습니다.'),
      li('신청서는 사용하려는 날의 7일 전까지 내야 합니다. 늦게 낸 신청서는 빈 시설이 있을 때만 받습니다.', 0, N, { section: 'guide' }),
      p('유의 사항', { style: 'h2' }),
      li('사용한 뒤에는 시설을 처음 모양으로 되돌려 놓습니다.', 0, B),
      li('시설이나 비품이 망가지면 바로 관리실에 알립니다. 사용자의 잘못으로 망가지면 고치는 비용을 사용자가 냅니다.', 0, B),
      li('사용 시간이 끝나면 정해진 시각까지 시설을 비워 줍니다.', 0, B),
    ],
    't1.a1': [runs({}, b('신청인'))],
    't1.a2': [p('')],
    't1.b1': [runs({}, b('연락처'))],
    't1.b2': [p('')],
    't1.c1': [runs({}, b('사용 목적'))],
    't1.c2': [p(''), p('')],
    't1.d1': [p('사용 기간')],
    't1.d2': [p('      년   월   일 부터      년   월   일 까지')],
    't1.e1': [p('개인 정보는 이 신청을 처리하는 데에만 쓰고, 처리가 끝나면 1년 뒤에 지웁니다.')],
    ...Object.fromEntries(['월', '화', '수', '목', '금', '토', '일'].map((d, k) => [`t2.h${k}`, [p(d, { align: 'center' })]])),
    ...Object.fromEntries(Array.from({ length: 7 }, (_, k) => [`t2.a${k}`, [p(k < 5 ? '09:00–12:00' : '')]])),
    ...Object.fromEntries(Array.from({ length: 7 }, (_, k) => [`t2.b${k}`, [p(k < 5 ? '30명' : '')]])),
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
writeFileSync('fixtures/docs/forms.json', JSON.stringify(sort(doc), null, 2) + '\n');
console.log('fixtures/docs/forms.json');
