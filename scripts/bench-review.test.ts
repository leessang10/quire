/**
 * 보기 모드 (4-4, 14 G4): 1,000쪽 문서(제안 1,000개)에서 최종본·원본으로 바꾸기 1초 안.
 *   파생 문서 = 정본 왕복 복제 + 모두 수락·거부 + 처음 조립 (화면에 보이는 첫 쪽들이 아니라 전체).
 *   최종본의 쪽 나눔 = 살아 있는 문서에서 모두 수락한 뒤의 쪽 나눔.
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-review.test.ts --silent=false
 */
import { expect, it } from 'vitest';
import { Doc, Document } from '@quire/model';
import { LayoutCache, PagedLayout, type Measurer } from '@quire/layout';
import { documentFromQuire, quireFromDocument } from '@quire/sync';
import { defaultPageSetup } from '../packages/editor/src/formatter';

const measurer: Measurer = { width: (g) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) };
const NL = String.fromCharCode(10);
const LINE = '검토 중인 긴 문서의 문단입니다. 제안이 문단마다 걸려 있고 수락하거나 거부하면 쪽 나눔이 달라집니다.';
const setup = defaultPageSetup(16);
const author = { id: 'u', name: '가', color: '#2563eb' };

function build(paras: number, n: number): Document {
  const doc = Doc.fromText(Array.from({ length: paras }, (_, i) => `${i + 1}. ${LINE}`).join(NL));
  const d = new Document(doc);
  d.setSuggesting({ author, now: () => 1 });
  const every = Math.floor(paras / n);
  // 뒤에서부터 (앞 문단 오프셋이 그대로)
  for (let k = n - 1; k >= 0; k--) {
    const p = doc.paragraphs()[k * every]!;
    if (k % 3 === 0) d.recordSuggestions(null, doc, [{ type: 'insert', ids: doc.insertText(p.start + 5, '넣은 글자 '.repeat(4)) }]);
    else if (k % 3 === 1) d.recordSuggestions(null, doc, doc.deleteRange(p.start + 5, p.start + 40));
    else d.recordSuggestions(null, doc, doc.format(p.start + 3, p.start + 20, 'bold', true));
  }
  d.setSuggesting(null);
  return d;
}

function layout(d: Document): { ms: number; pages: number; breaks: number[] } {
  const t = performance.now();
  const L = new PagedLayout(setup, measurer, new LayoutCache(20000));
  L.update(d.body.paragraphs(), null, Infinity, d.body.takeParagraphChanges());
  L.finish();
  const ms = performance.now() - t;
  const breaks: number[] = [];
  const paras = d.body.paragraphs();
  let page = -1;
  for (let i = 0; i < paras.length; i++) {
    const pl = L.para(i);
    for (const ln of pl.lines) if (ln.page !== page) {
      page = ln.page;
      breaks.push(i);
    }
  }
  return { ms, pages: L.pageCount, breaks };
}

it('view mode benchmark', () => {
  const live = build(15000, 1000);
  const live0 = layout(live);
  const out: string[] = [`문단 15,000개, 제안 ${live.annotationRanges().length}개, ${live0.pages}쪽 (제안 포함 조립 ${live0.ms.toFixed(0)} ms)`];
  for (const accept of [true, false]) {
    let t = performance.now();
    const clone = documentFromQuire(quireFromDocument(live)).document;
    const cloneMs = performance.now() - t;
    t = performance.now();
    clone.resolveAll(accept);
    const resolveMs = performance.now() - t;
    const l = layout(clone);
    out.push(
      `  ${accept ? '최종본' : '원본  '}: 복제 ${cloneMs.toFixed(0)} ms + 모두 ${accept ? '수락' : '거부'} ${resolveMs.toFixed(0)} ms + 조립 ${l.ms.toFixed(0)} ms = ${(cloneMs + resolveMs + l.ms).toFixed(0)} ms, ${l.pages}쪽`,
    );
    if (accept) {
      // 살아 있는 문서에서 직접 모두 수락한 것과 쪽 나눔이 같다
      const direct = build(15000, 1000);
      direct.resolveAll(true);
      const dl = layout(direct);
      expect(l.breaks).toEqual(dl.breaks);
      expect(clone.body.text()).toBe(direct.body.text());
      out.push(`  최종본 쪽 나눔 = 직접 모두 수락한 문서 (${dl.pages}쪽)`);
    }
  }
  console.log(out.join(NL));
});
