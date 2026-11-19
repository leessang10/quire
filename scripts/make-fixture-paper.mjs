/**
 * 기준 문서 세트 (12 §1): 논문 만들기. 각주(12 §6)가 많고 본문은 2단(12 §7)이다: 제목·부제는 한 단 띠, 본문은 같은 쪽에서
 * 이어지는 2단 구역 (각주는 참조가 있는 단 아래).
 *   - 문단마다 각주 참조가 하나둘, 각주 길이가 여러 가지 (한 줄 ~ 여러 줄)
 *   - 긴 각주 하나는 쪽의 절반보다 커서 다음 쪽에 이어 쓴다
 *   - 쪽 끝 가까운 참조는 줄과 각주가 함께 다음 쪽으로 간다
 *   node scripts/make-fixture-paper.mjs  → fixtures/docs/paper.json
 * 글은 이 저장소를 위해 쓴 것이다. 한 번 만들어 고정하고, 고치면 기대값(paper.expected.json)도 사람이 다시 본다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

let seq = 0;
const notes = {};
/** 각주 참조 런 (내용은 스토리 fn|<id>) */
const note = (text) => {
  const id = `n${++seq}`;
  notes[`fn|${id}`] = text.split('\n').map((t) => ({ p: {}, c: [{ t }] }));
  return { img: { kind: 'note', id } };
};
const p = (attrs, ...c) => ({ p: attrs, c: c.map((x) => (typeof x === 'string' ? { t: x } : x)) });
const body = (...c) => p({ align: 'justify' }, ...c);

const S = [
  '문서 편집기는 글을 쓰는 화면과 인쇄되는 쪽이 같아야 한다는 요구에서 출발한다',
  '줄을 나누는 규칙과 쪽을 나누는 규칙은 서로 기대어 있어서 하나를 바꾸면 다른 하나의 결과도 달라진다',
  '여러 사람이 동시에 고치는 문서에서는 같은 입력이 어느 컴퓨터에서나 같은 쪽 나눔을 만들어야 한다',
  '각주는 본문의 흐름을 끊지 않고 근거와 덧붙임을 남기는 오래된 방법이다',
  '쪽 아래 각주 영역의 높이는 그 쪽에 참조가 있는 각주들로 정해지므로 본문 영역도 함께 줄어든다',
  '한 문장 안에 참조가 여럿이면 각주는 참조 순서대로 놓인다',
];
const long = (k) => Array.from({ length: k }, (_, i) => S[i % S.length]).join('. ') + '.';

const blocks = [
  p({ style: 'h1', align: 'center' }, '조판 엔진의 각주 배치'),
  p({ align: 'center', section: 'title' }, '쪽 단위 배치와 증분 조립에서'),
  p({ style: 'h2' }, '1. 들어가며'),
  body(long(4), note('이 글의 예는 모두 편집기의 기본 쪽 설정(A4, 여백 1인치)으로 조판한 것이다.'), ' ', long(2)),
  body(long(5), note('같은 입력이 같은 결과를 만든다는 성질을 결정성이라 부른다. 글꼴 파일과 셰이핑 엔진의 판이 같아야 한다.')),
  body(long(3), note('짧은 각주.'), ' ', long(3), note('참조가 둘인 문단의 두 번째 각주.')),
  p({ style: 'h2' }, '2. 각주 영역'),
  body(long(6), note('각주 영역은 구분선과 각주들로 이루어진다.\n구분선은 본문 폭의 삼분의 일이고, 앞 쪽에서 이어 쓴 각주로 시작하면 본문 폭 전체다.')),
  body(long(4)),
  body(long(5), note(Array.from({ length: 14 }, (_, i) => `긴 각주의 ${i + 1}번째 문장이다. ${S[i % S.length]}.`).join(' '))),
  body(long(3), note('긴 각주 뒤에 오는 각주는 이어 쓰는 각주가 다 놓인 다음에 놓인다.')),
  body(long(6)),
  p({ style: 'h2' }, '3. 증분 조립'),
  body(long(5), note('바뀐 문단부터 다시 놓고, 놓인 자리와 각주 상태가 지난 결과와 같아지면 멈춘다.')),
  body(long(4), note('각주 내용이 바뀌면 그 참조가 있는 문단을 바뀐 것으로 본다.')),
  body(long(7)),
  body(long(4), note('번호의 자릿수가 바뀌면 참조 폭이 달라지므로 그 문단을 다시 나눈다.')),
  p({ style: 'h2' }, '4. 맺으며'),
  body(long(5), note('남은 일: 다단에서 단마다 각주 영역을 두는 것.')),
  body(long(3), note('마지막 각주.')),
];

const doc = {
  format: 'quire',
  version: 1,
  settings: {},
  styles: {},
  sections: [
    { id: 'title', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, start: 'nextPage' },
    { id: 'body', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, start: 'continuous', columns: { count: 2, gap: 18000 } },
  ],
  stories: { body: blocks, ...notes },
  annotations: [],
};

const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
mkdirSync('fixtures/docs', { recursive: true });
writeFileSync('fixtures/docs/paper.json', JSON.stringify(sort(doc), null, 2) + '\n');
console.log('fixtures/docs/paper.json');
