/**
 * 주석 레이어 (4-1, 14 G1): 주석 1,000개 약 1,000쪽 문서에서 입력 p95 16 ms.
 *   - 편집 모델 + 레이아웃: 주석 안에서 글자 입력·Backspace(지운 원소에 걸린 주석 다시 걸기), 화면에 보이는 주석 찾기
 *     (annotationRanges 캐시 다시 만들기 + 보이는 범위 거르기: 그리기가 입력마다 하는 일)
 *   - Worker 구조: 메인 입력, Worker의 로컬 묶음 적용(ack의 근처 주석 다시 풀기 포함), 원격 가져오기 + 메인 적용(주석 비교)
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-annotations.test.ts --silent=false
 */
import { it } from 'vitest';
import { Doc, Document } from '@quire/model';
import { LayoutCache, PagedLayout, type Measurer } from '@quire/layout';
import { defaultPageSetup } from '../packages/editor/src/formatter';
import { SyncClient, SyncCore, type ToMain, type ToWorker } from '@quire/sync';

const measurer: Measurer = { width: (g) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) };
const NL = String.fromCharCode(10);
const LINE = '주석이 많은 긴 문서의 문단입니다. 댓글과 강조가 문단마다 걸려 있고 입력은 그 사이에서 일어납니다.';
const setup = defaultPageSetup(16);

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5)}  p95 ${q(0.95)}  max ${q(1)} ms`;
}

const textOf = (paras: number) => Array.from({ length: paras }, (_, i) => `${i + 1}. ${LINE}`).join(NL);

/** 문단마다 고르게 주석 n개 (문단 안 6~30 글자) */
function annotateAll(document: Document, n: number): number[] {
  const paras = document.body.paragraphs();
  const every = Math.max(1, Math.floor(paras.length / n));
  const at: number[] = [];
  for (let k = 0; k < n; k++) {
    const p = paras[(k * every) % paras.length]!;
    document.annotate({ id: `a${k}`, type: k % 2 ? 'comment' : 'highlight', story: null, from: p.start + 6, to: p.start + 30, data: { k } });
    at.push(p.start);
  }
  return at;
}

function modelScenario(paras: number, anns: number) {
  const doc = Doc.fromText(textOf(paras));
  const document = new Document(doc);
  let t0 = performance.now();
  annotateAll(document, anns);
  const annotateMs = performance.now() - t0;
  doc.takeParagraphChanges();
  const layout = new PagedLayout(setup, measurer, new LayoutCache(20000));
  t0 = performance.now();
  layout.update(doc.paragraphs(), null, Infinity, doc.takeParagraphChanges());
  layout.finish();
  const firstMs = performance.now() - t0;
  const pages = layout.pageCount;
  const mid = Math.floor(paras / 2 / Math.max(1, Math.floor(paras / anns))) * Math.max(1, Math.floor(paras / anns)); // 주석이 있는 문단
  const view = setup.height * 3;
  const top = () => layout.para(mid).lines[0]!.y;
  /** 입력 뒤 한 번의 화면 갱신: 레이아웃 + 보이는 주석 (그리기가 하는 일) */
  const frame = () => {
    const y = top();
    layout.update(doc.paragraphs(), null, y + view, doc.takeParagraphChanges());
    const p0 = doc.paragraphs()[mid]!.start;
    return document.annotationsIn(null, p0, p0 + 2000).length;
  };
  frame();
  const type: number[] = [];
  const back: number[] = [];
  const backEdge: number[] = [];
  let at = doc.paragraphs()[mid]!.start + 12; // 주석 안
  for (let k = 0; k < 300; k++) {
    t0 = performance.now();
    doc.insertText(at++, '가');
    frame();
    type.push(performance.now() - t0);
  }
  for (let k = 0; k < 100; k++) {
    t0 = performance.now();
    doc.deleteRange(--at, at + 1);
    frame();
    back.push(performance.now() - t0);
  }
  // 주석 시작 글자를 지운다 (지운 원소에 걸린 주석을 옆 글자로 다시 건다: 주석 전체를 훑는다)
  for (let k = 0; k < 10; k++) {
    const r = document.annotationsIn(null, doc.paragraphs()[mid]!.start, doc.paragraphs()[mid]!.end).find((x) => x.id === `a${mid / Math.max(1, Math.floor(paras / anns))}`) ?? document.annotationsIn(null, doc.paragraphs()[mid]!.start, doc.paragraphs()[mid]!.end)[0]!;
    t0 = performance.now();
    doc.deleteRange(r.from, r.from + 1);
    frame();
    backEdge.push(performance.now() - t0);
  }
  layout.finish();
  // 댓글 창 목록 (14 §3.2): 주석마다 스레드를 걸고, 입력 뒤 목록(스레드 + 범위 + 범위 y)을 다시 만드는 비용 (편집기 threads()와 같은 일)
  const author = { id: 'u', name: '가', color: '#000' };
  for (const id of document.annotationIds()) document.updateAnnotation(id, { thread: `t${id}` });
  for (const id of document.annotationIds()) {
    document.setComment(`t${id}|anchor`, id);
    document.addMessage(`t${id}`, { id: 'm', author, time: 1, text: '댓글' });
  }
  const list: number[] = [];
  at = doc.paragraphs()[mid]!.start + 12;
  for (let k = 0; k < 50; k++) {
    doc.insertText(at++, '가');
    frame();
    t0 = performance.now();
    const ranges = new Map(document.annotationRanges().map((r) => [r.id, r]));
    let ys = 0;
    for (const t of document.threads()) {
      const r = t.anchor ? ranges.get(t.anchor) : undefined;
      if (r && !r.orphan) ys += layout.caretRect(r.from).y;
    }
    list.push(performance.now() - t0);
    if (ys < 0) throw new Error('bad');
  }
  console.log(
    [
      '',
      `■ 문단 ${paras.toLocaleString()}개, 주석 ${document.annotationIds().length.toLocaleString()}개, ${pages.toLocaleString()}쪽`,
      `  주석 걸기 (전체)       ${annotateMs.toFixed(0)} ms`,
      `  처음 조립              ${firstMs.toFixed(0)} ms`,
      `  주석 안 글자 입력      ${stats(type)}`,
      `  Backspace              ${stats(back)}`,
      `  주석 시작 글자 지우기  ${stats(backEdge)}`,
      `  댓글 창 목록 (입력 뒤) ${stats(list)}`,
    ].join(NL),
  );
}

/** Worker 구조: 메인(SyncClient)과 Worker(SyncCore)를 같은 스레드에서 직접 잇는다 */
function workerScenario(paras: number, anns: number) {
  const text = textOf(paras);
  const mk = (k: number, snap: Uint8Array | null, out: Uint8Array[]) => {
    const toMain: ToMain[] = [];
    const opts = { user: { name: 'p', color: '#000000' }, batchMs: null, post: (m: ToMain) => toMain.push(m), net: { sendDoc: (b: Uint8Array) => out.push(b), sendPresence: () => {} } };
    const core = snap ? SyncCore.fromSnapshot(snap, k, opts) : SyncCore.create(text, k, opts);
    const toWorker: ToWorker[] = [];
    const client = new SyncClient(toMain.shift() as Extract<ToMain, { t: 'init' }>, { post: (m) => toWorker.push(m) });
    return { core, client, toMain, toWorker };
  };
  const pump = (p: ReturnType<typeof mk>) => {
    while (p.toWorker.length || p.toMain.length) {
      for (const m of p.toWorker.splice(0)) p.core.handle(m);
      for (const m of p.toMain.splice(0)) p.client.handle(m);
    }
  };
  const outA: Uint8Array[] = [];
  const outB: Uint8Array[] = [];
  const A = mk(1, null, outA);
  const starts = annotateAll(A.client.document, anns);
  pump(A);
  A.core.flush();
  const snap = A.core.loro.export({ mode: 'snapshot' });
  let t0 = performance.now();
  const B = mk(2, snap, outB);
  const joinMs = performance.now() - t0;
  outA.splice(0);
  if (B.client.document.annotationIds().length !== anns) throw new Error('annotations not loaded');
  // 주석 안에서 입력 (ack에 근처 주석 다시 풀기가 실린다)
  let caret = starts[Math.floor(anns / 2)]! + 12;
  const typing: number[] = [];
  const workerOps: number[] = [];
  const ackApply: number[] = [];
  for (let i = 0; i < 300; i++) {
    let s = performance.now();
    A.client.doc.insertText(caret++, '가');
    typing.push(performance.now() - s);
    s = performance.now();
    for (const m of A.toWorker.splice(0)) A.core.handle(m);
    workerOps.push(performance.now() - s);
    s = performance.now();
    for (const m of A.toMain.splice(0)) A.client.handle(m);
    ackApply.push(performance.now() - s);
  }
  // 원격 묶음: A의 5타를 B가 받는다 (Worker가 그 스토리 주석을 다시 풀고, 메인이 비교한다)
  const coreImport: number[] = [];
  const mainApply: number[] = [];
  for (let k = 0; k < 30; k++) {
    for (let i = 0; i < 5; i++) A.client.doc.insertText(caret++, '나');
    pump(A);
    A.core.flush();
    for (const u of outA.splice(0)) B.core.receiveDoc(u);
    let s = performance.now();
    B.core.flush();
    coreImport.push(performance.now() - s);
    s = performance.now();
    for (const m of B.toMain.splice(0)) B.client.handle(m);
    mainApply.push(performance.now() - s);
    pump(B);
  }
  if (A.client.doc.text() !== B.client.doc.text()) throw new Error('diverged');
  console.log(
    [
      `  [Worker] 스냅샷으로 참여 (주석 커서 모두 풀기 포함) ${joinMs.toFixed(0)} ms`,
      `  [Worker] 메인: 글자 입력           ${stats(typing)}`,
      `  [Worker] Worker: 로컬 묶음 적용    ${stats(workerOps)}`,
      `  [Worker] 메인: ack 적용            ${stats(ackApply)}`,
      `  [Worker] Worker: 원격 가져오기     ${stats(coreImport)}`,
      `  [Worker] 메인: 원격 적용 + 주석 비교 ${stats(mainApply)}`,
    ].join(NL),
  );
  A.core.close();
  B.core.close();
}

it('annotations benchmark', () => {
  modelScenario(15000, 1000);
  workerScenario(15000, 1000);
  modelScenario(15000, 5000);
  workerScenario(15000, 3000);
});
