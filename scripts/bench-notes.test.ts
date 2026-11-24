/**
 * 각주 (3-5, 12 G4): 각주 1,000개 약 1,000쪽 문서에서 입력 p95 16 ms. 편집기의 relayout과 같게 입력마다 머리말 높이 맞추기
 * (syncSections), 각주 번호·높이 맞추기(syncNotes: 참조를 훑는다), 화면까지 조립, 보이는 세 쪽의 각주 영역.
 *   - 본문 입력, 본문 Enter
 *   - 각주 입력 (높이 그대로), 각주 Enter (각주가 한 줄 늘어 그 쪽부터 밀린다)
 *   - 맨 앞에 각주 넣기 (뒤 번호가 모두 바뀐다: 자릿수가 바뀐 참조 문단만 다시 나눈다)
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-notes.test.ts
 */
import { it } from 'vitest';
import { Doc, Document, noteStoryId } from '@quiredoc/model';
import { LayoutCache, PagedLayout, SectionFrames, type Measurer } from '@quiredoc/layout';
import { Formatter, defaultPageSetup } from '../packages/editor/src/formatter';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const NL = String.fromCharCode(10);

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5)}  p95 ${q(0.95)}  max ${q(1)} ms`;
}

function scenario(paras: number, notes: number) {
  const text = Array.from({ length: paras }, (_, i) => `${i + 1}. 각주가 많은 긴 문서의 문단입니다. 참조가 있는 줄과 그 각주는 같은 쪽에 놓입니다.`).join(NL);
  const doc = Doc.fromText(text);
  const document = new Document(doc);
  const every = Math.max(1, Math.floor(paras / notes));
  let n = 0;
  for (let i = 0; i < paras && n < notes; i += every, n++) {
    const p = doc.paragraphs()[i]!;
    doc.insertObject(p.start + 4, { id: `n${i}`, kind: 'note' });
    document.story(noteStoryId(`n${i}`)).insertText(0, i % 7 === 0 ? `각주 ${i}: 두세 줄이 되는 조금 긴 설명입니다. `.repeat(4) : `각주 ${i}: 짧은 설명.`);
  }
  doc.takeParagraphChanges();
  const setup = defaultPageSetup(16);
  const fmt = new Formatter(() => document, setup, 16);
  fmt.reset(measurer, new LayoutCache(20000));
  const layout = new PagedLayout(setup, measurer, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  let t0 = performance.now();
  layout.update(doc.paragraphs(), null, Infinity, doc.takeParagraphChanges());
  layout.finish();
  const firstMs = performance.now() - t0;
  const pages = layout.pageCount;
  const view = setup.height * 3;
  const relayout = (top: number) => {
    const sec = fmt.syncSections();
    if (sec >= 0) doc.touchParagraph(sec === 0 ? 0 : doc.sectionBreaks()[sec - 1]! + 1);
    for (const i of fmt.syncNotes()) doc.touchParagraph(i);
    layout.update(doc.paragraphs(), null, top + view, doc.takeParagraphChanges());
  };
  /** 보이는 세 쪽의 각주 영역 (그리기 전에 하는 일: 각주 조각 찾기와 각주 레이아웃) */
  const drawNotes = (p0: number) => {
    for (let p = p0; p < p0 + 3; p++) for (const pl of layout.notesOnPage(p)) fmt.layoutStory(document.story(noteStoryId(pl.id)), 600, null);
  };
  const mid = Math.floor(paras / 2 / every) * every; // 각주가 있는 문단
  const top = () => layout.para(mid).lines[0]!.y;
  const page = () => layout.para(mid).lines[0]!.page;
  const type: number[] = [];
  const enter: number[] = [];
  let at = doc.paragraphs()[mid]!.end;
  for (let k = 0; k < 300; k++) {
    const nl = k % 20 === 19;
    t0 = performance.now();
    doc.insertText(at++, nl ? NL : '가');
    relayout(top());
    drawNotes(page());
    (nl ? enter : type).push(performance.now() - t0);
  }
  layout.finish();
  const note = document.story(noteStoryId(`n${mid}`));
  const ntype: number[] = [];
  const nenter: number[] = [];
  for (let k = 0; k < 300; k++) {
    const nl = k % 20 === 19;
    t0 = performance.now();
    // 넣고 지우기를 번갈아 (각주 높이가 그대로), 가끔 줄을 넣었다 지운다 (높이가 바뀐다)
    if (nl) note.insertText(note.maxCaret, NL + '줄');
    else if (k % 2 === 0) note.insertText(1, '가');
    else note.deleteRange(1, 2);
    relayout(top());
    drawNotes(page());
    (nl ? nenter : ntype).push(performance.now() - t0);
    if (nl) {
      note.deleteRange(note.maxCaret - 2, note.maxCaret);
      relayout(top());
    }
  }
  layout.finish();
  // 맨 앞 문단에 각주 넣기 (뒤 번호가 모두 하나씩 밀린다)
  t0 = performance.now();
  doc.insertObject(1, { id: 'front', kind: 'note' });
  document.story(noteStoryId('front')).insertText(0, '맨 앞 각주');
  relayout(top());
  const frontMs = performance.now() - t0;
  const reflowed = layout.counts.reflowed;
  layout.finish();
  console.log(
    [
      `문단 ${paras.toLocaleString()}개, 각주 ${fmt.noteList().length.toLocaleString()}개, ${pages.toLocaleString()}쪽`,
      `  처음 조립            ${firstMs.toFixed(0)} ms`,
      `  본문 입력            ${stats(type)}`,
      `  본문 Enter           ${stats(enter)}`,
      `  각주 입력            ${stats(ntype)}`,
      `  각주 Enter           ${stats(nenter)}`,
      `  맨 앞에 각주 넣기     ${frontMs.toFixed(2)} ms (다시 나눈 문단 ${reflowed})`,
    ].join(NL),
  );
}

it('notes benchmark', () => {
  scenario(15000, 1000);
  scenario(100000, 5000);
});
