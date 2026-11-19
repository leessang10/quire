/**
 * 기준 문서 세트 (12 §1): 일정표 만들기. 쪽을 넘는 긴 표 (12 §8):
 *   - 첫 행은 제목 행: 표가 이어지는 쪽마다 맨 위에 다시 그린다
 *   - 설명이 긴 행은 쪽 끝에서 줄 단위로 쪼개진다, 쪽보다 큰 행도 쪼개져 다 보인다
 *   - 행 나누지 않음인 행은 통째로 다음 쪽으로
 *   node scripts/make-fixture-schedule.mjs  → fixtures/docs/schedule.json
 * 글은 이 저장소를 위해 쓴 것이다. 한 번 만들어 고정하고, 고치면 기대값(schedule.expected.json)도 사람이 다시 본다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const stories = {};
const para = (t) => ({ p: {}, c: t ? [{ t }] : [] });
const TASKS = ['요구 정리', '설계 검토', '구현', '시험', '문서', '배포 준비', '사용자 확인'];
const NOTE = [
  '이번 주에 끝낸다.',
  '앞 단계 결과를 받아 시작한다. 막히는 것이 있으면 바로 알린다.',
  '두 사람이 나눠 맡는다.',
];
const rows = [];
const cell = (name, lines) => {
  stories[name] = lines.map(para);
  return { story: name };
};
rows.push({ header: true, cells: [cell('h.0', ['주']), cell('h.1', ['할 일']), cell('h.2', ['설명'])] });
for (let i = 1; i <= 70; i++) {
  const desc =
    i === 18
      ? Array.from({ length: 24 }, (_, k) => `${k + 1}. 긴 설명의 한 줄이다. ${NOTE[k % NOTE.length]}`)
      : i === 40
        ? Array.from({ length: 70 }, (_, k) => `쪽보다 큰 행 ${k + 1}`)
        : i % 9 === 0
          ? [NOTE[1], NOTE[2], NOTE[0]]
          : [NOTE[i % NOTE.length]];
  const row = { cells: [cell(`r${i}.0`, [`${i}주`]), cell(`r${i}.1`, [TASKS[i % TASKS.length]]), cell(`r${i}.2`, desc)] };
  if (i === 27 || i === 58) row.cantSplit = true;
  rows.push(row);
}

const doc = {
  format: 'quire',
  version: 1,
  settings: {},
  styles: {},
  sections: [{ id: 's1', page: { width: 595276, height: 841890, margin: [72000, 72000, 72000, 72000] }, columns: 1 }],
  stories: {
    body: [
      { p: { style: 'h1' }, c: [{ t: '일정표' }] },
      { p: {}, c: [{ t: '표가 쪽을 넘으면 제목 행을 쪽마다 다시 그리고, 쪽 끝에 걸린 행은 줄 단위로 쪼갠다. 나누지 않는 행은 통째로 다음 쪽으로 간다.' }] },
      { table: { cols: [60000, 120000, 271000], rows } },
      { p: {}, c: [{ t: '표 뒤 문단.' }] },
    ],
    ...stories,
  },
  annotations: [],
};

const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
mkdirSync('fixtures/docs', { recursive: true });
writeFileSync('fixtures/docs/schedule.json', JSON.stringify(sort(doc), null, 2) + '\n');
console.log('fixtures/docs/schedule.json');
