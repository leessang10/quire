/**
 * 기준 문서 세트 (12 §1): 소식지 만들기. 구역마다 단 수가 다르고 같은 쪽에서 이어진다 (12 §7.2):
 *   - 제호(1단) → 이어서 2단(구분선) → 이어서 3단 → 이어서 1단 → 다음 쪽 2단 (문서 끝: 균형을 맞추지 않음)
 *   - 2단 구역 끝·3단 구역 끝은 뒤 구역이 같은 쪽에서 이어지므로 단 높이를 맞춘다 (균형)
 *   - 단 나눔(columnBreakBefore) 하나
 * 어울림 그림은 이미지 자산이 필요해 3-6에서는 넣지 않았다.
 *   node scripts/make-fixture-newsletter.mjs  → fixtures/docs/newsletter.json
 * 글은 이 저장소를 위해 쓴 것이다. 한 번 만들어 고정하고, 고치면 기대값(newsletter.expected.json)도 사람이 다시 본다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const p = (attrs, t) => ({ p: attrs, c: t ? [{ t }] : [] });
const body = (t, extra = {}) => p({ align: 'justify', ...extra }, t);
const S = [
  '이번 호에서는 편집기에 새로 들어간 조판 기능을 소개한다',
  '구역마다 용지와 여백과 단 수를 따로 정할 수 있다',
  '같은 쪽에서 이어지는 구역은 앞 구역 아래 띠에서 시작한다',
  '다단 구역이 끝나고 같은 쪽에서 다른 구역이 이어지면 단 높이를 맞춘다',
  '각주는 참조가 있는 단 아래에 놓인다',
  '쪽 번호와 전체 쪽 수는 머리말이나 꼬리말에 필드로 넣는다',
  '여러 사람이 같은 문서를 고쳐도 쪽 나눔은 어느 컴퓨터에서나 같다',
];
const long = (k, o = 0) => Array.from({ length: k }, (_, i) => S[(i + o) % S.length]).join('. ') + '.';
const page = { width: 595276, height: 841890, margin: [56693, 56693, 56693, 56693] };

const blocks = [
  p({ style: 'h1', align: 'center' }, '편집기 소식'),
  p({ align: 'center', section: 'masthead' }, '조판 기능 특집호'),
  p({ style: 'h2' }, '여는 글'),
  body(long(5)),
  body(long(4, 2)),
  body(long(3, 4), { section: 'two' }),
  p({ style: 'h3' }, '짧은 소식 하나'),
  body(long(2, 1)),
  p({ style: 'h3' }, '짧은 소식 둘'),
  body(long(2, 3)),
  p({ style: 'h3' }, '짧은 소식 셋'),
  body(long(2, 5), { section: 'three' }),
  p({ style: 'h2' }, '자세히 보기'),
  body(long(6, 1), { section: 'single' }),
  p({ style: 'h2', pageBreakBefore: true }, '다음 쪽: 두 단'),
  body(long(4)),
  body(long(3, 3)),
  body(long(4, 5), { columnBreakBefore: true }),
  body(long(2, 6)),
];

const doc = {
  format: 'quire',
  version: 1,
  settings: {},
  styles: {},
  sections: [
    { id: 'masthead', page, start: 'nextPage' },
    { id: 'two', page, start: 'continuous', columns: { count: 2, gap: 17008, separator: true } },
    { id: 'three', page, start: 'continuous', columns: { count: 3, gap: 14173 } },
    { id: 'single', page, start: 'continuous' },
    { id: 'last', page, start: 'continuous', columns: { count: 2, gap: 17008 } },
  ],
  stories: { body: blocks },
  annotations: [],
};

const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
mkdirSync('fixtures/docs', { recursive: true });
writeFileSync('fixtures/docs/newsletter.json', JSON.stringify(sort(doc), null, 2) + '\n');
console.log('fixtures/docs/newsletter.json');
