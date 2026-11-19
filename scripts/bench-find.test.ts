/**
 * 찾기 (5-1, 15 G1): 1,000쪽 문서(문단 2만 개)에서 모두 찾기 200 ms 안, 입력 한 번 뒤 다시 찾기(문단 캐시)는 몇 ms.
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-find.test.ts --silent=false
 */
import { expect, it } from 'vitest';
import { Doc, Document, FindCache, compileFind, findInDocument, replaceMatches, type Matcher } from '@quire/model';

const NL = String.fromCharCode(10);
const LINE = '찾기 시험용 긴 문서의 문단입니다. 보고서와 논문에서 자주 나오는 낱말을 찾아 바꾸어 봅니다. Report 2026';
const PARAS = 20_000;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

it('find all on 1,000 pages: plain, case-insensitive word, regex; refind after a keystroke', () => {
  const doc = Doc.fromText(Array.from({ length: PARAS }, (_, i) => `${i + 1}. ${LINE}`).join(NL));
  const d = new Document(doc);
  const chars = doc.maxCaret;
  for (const [name, q] of [
    ['plain 낱말', { text: '낱말' }],
    ['word report (i)', { text: 'report', wholeWord: true }],
    ['regex \\d{4}', { text: '\\d{4}', regex: true }],
    ['rare 없는말', { text: '없는말' }],
  ] as const) {
    const c = compileFind(q) as { matcher: Matcher };
    const first: number[] = [];
    let count = 0;
    let truncated = false;
    for (let r = 0; r < 5; r++) {
      const cache = new FindCache(c.matcher);
      const t = performance.now();
      const res = findInDocument(d, cache, { limit: 100_000 });
      first.push(performance.now() - t);
      count = res.matches.length;
      truncated = res.truncated;
    }
    // 입력 한 번 뒤 (바뀐 문단 하나): 캐시가 있는 다시 찾기
    const cache = new FindCache(c.matcher);
    findInDocument(d, cache, { limit: 100_000 });
    const again: number[] = [];
    for (let r = 0; r < 20; r++) {
      doc.insertText(doc.paragraphs()[PARAS / 2]!.start + 3, '가');
      const t = performance.now();
      findInDocument(d, cache, { limit: 100_000 });
      again.push(performance.now() - t);
    }
    console.log(`${name}: ${count} matches${truncated ? '+' : ''} in ${chars} chars, find all ${median(first).toFixed(1)} ms, refind after a keystroke ${median(again).toFixed(2)} ms`);
    expect(median(first)).toBeLessThan(200);
  }
});

it('replace all 20,000 matches: one transaction', () => {
  const doc = Doc.fromText(Array.from({ length: PARAS }, (_, i) => `${i + 1}. ${LINE}`).join(NL));
  const d = new Document(doc);
  const c = compileFind({ text: '보고서' }) as { matcher: Matcher };
  const { matches } = findInDocument(d, new FindCache(c.matcher), { limit: 100_000 });
  const t = performance.now();
  const { ops, count } = replaceMatches(d, matches, c.matcher, null, '리포트');
  const ms = performance.now() - t;
  console.log(`replace all: ${count} matches, ${ops.length} ops, ${ms.toFixed(0)} ms`);
  expect(count).toBe(PARAS);
});
