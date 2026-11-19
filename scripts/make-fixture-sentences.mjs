/**
 * 한글 문장 세트 (12 §1, G7): 금칙·문장부호·영문·숫자·주소가 섞인 문장 200개. 정해진 조각들을 고정된 난수로 이어 만든다.
 *   node scripts/make-fixture-sentences.mjs  → fixtures/sentences/ko.json
 * 기대 줄 나눔은 packages/editor/src/sentences.test.ts가 처음 돌 때 ko.expected.json으로 쓴다 (사람이 보고 고정).
 * 글은 이 저장소를 위해 쓴 것이다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const KO = [
  '문서 편집기는', '줄을 나누는 규칙을', '한 줄씩 정한다', '양쪽 정렬에서는', '어간을 늘이거나 줄인다', '문장부호는', '줄 앞에 오지 않는다',
  '여는 괄호는', '줄 끝에 남지 않는다', '글자 단위로 끊으면', '오른쪽 끝이 고르다', '어절 단위로 끊으면', '낱말이 쪼개지지 않는다',
  '조판 결과는', '어느 컴퓨터에서나 같다', '긴 주소와 영문 낱말은', '줄보다 길 때만 글자 단위로 끊는다', '한국어 문서에서는', '쉼표와 마침표를',
  '여백에 걸칠 수 있다', '보기', '다음과 같다', '이 문단은', '시험용 문장이다',
];
const PUNCT_AFTER = [',', '.', '!', '?', ':', ';', '…', '%', ')', '」', '』', '”', '’', '》', '〉', '·'];
const OPEN = ['(', '「', '『', '“', '‘', '《', '〈', '['];
const CLOSE_OF = { '(': ')', '「': '」', '『': '』', '“': '”', '‘': '’', '《': '》', '〈': '〉', '[': ']' };
const EN = ['HarfBuzz', 'Unicode', 'UAX #14', 'Knuth–Plass', 'OpenType', 'CRDT', 'Loro', 'Pretendard', 'line-break', 'kinsoku'];
const NUM = ['2,048', '3.14', '100%', '25℃', '1,000쪽', '16 ms', '0.05em', '12쪽', '2026년', '제3장'];
const URL = ['https://example.com/docs/typesetting/korean-line-breaking', 'quire.example/editor?doc=12&section=9', 'C:\\Users\\docs\\sample.quire'];

let s = 12345;
const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 0x100000000);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const out = [];
for (let i = 0; i < 200; i++) {
  const parts = [];
  const n = 5 + Math.floor(rnd() * 10);
  for (let k = 0; k < n; k++) {
    const r = rnd();
    let piece;
    if (r < 0.55) piece = pick(KO);
    else if (r < 0.68) piece = pick(EN);
    else if (r < 0.8) piece = pick(NUM);
    else if (r < 0.86) piece = pick(URL);
    else {
      const o = pick(OPEN);
      piece = `${o}${pick(KO)}${CLOSE_OF[o]}`;
    }
    if (rnd() < 0.35) piece += pick(PUNCT_AFTER);
    parts.push(piece);
  }
  // 가끔 공백 없이 이어 붙인 긴 어절
  let text = parts.join(rnd() < 0.15 ? '' : ' ');
  if (!/[.!?…]$/.test(text)) text += '.';
  out.push(text);
}

mkdirSync('fixtures/sentences', { recursive: true });
writeFileSync('fixtures/sentences/ko.json', JSON.stringify(out, null, 2) + '\n');
console.log(`fixtures/sentences/ko.json (${out.length})`);
