/**
 * 동기화 브리지 비용 (09 §2)
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-sync.test.ts --silent=false
 *
 * 브리지를 붙인 Doc에서 키 입력 1회 비용(Doc 편집 + UTF-16 위치 + Loro 입력·커밋)과
 * 묶음 처리(flush: 내보내기 + 원격 가져오기 + Doc 적용) 비용, 공유 위치(Loro 커서) 만들기·풀기 비용을 잰다.
 * 저장(09 §9): 새 판 압축, .quire 저장·열기, 재기반 비용과 크기.
 */
import { it } from 'vitest';
import {
  SyncBridge,
  SyncClient,
  SyncCore,
  compactLoro,
  displayText,
  openQuire,
  packQuire,
  rebaseOnto,
  type ToMain,
  type ToWorker,
} from '@quiredoc/sync';

const NL = String.fromCharCode(10);
const LOREM =
  '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다. 이 문단은 대형 문서 성능 측정을 위해 반복해서 생성된 문단입니다. 레이아웃 캐시가 동작하면 편집할 때 바뀐 문단만 다시 줄을 나눕니다.';

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5)}  p95 ${q(0.95)}  max ${q(1)} ms`;
}

function scenario(paragraphs: number) {
  const text = Array.from({ length: paragraphs }, (_, i) => `${i + 1}. ${LOREM}`).join(NL);
  let t = performance.now();
  const outbox: Uint8Array[] = [];
  const a = SyncBridge.create(text, { peer: 1, batchMs: null, onUpdate: (u) => outbox.push(u) });
  const createMs = performance.now() - t;
  t = performance.now();
  const b = SyncBridge.fromSnapshot(a.snapshot(), { peer: 2, batchMs: null });
  const joinMs = performance.now() - t;

  // 같은 문서를 브리지 없이 편집할 때와 비교
  let caret = Math.floor(a.doc.length / 2);
  const typing: number[] = [];
  for (let i = 0; i < 300; i++) {
    const s = performance.now();
    a.doc.insertText(caret++, '가');
    typing.push(performance.now() - s);
  }
  const back: number[] = [];
  for (let i = 0; i < 100; i++) {
    const s = performance.now();
    a.doc.deleteRange(--caret, caret + 1);
    back.push(performance.now() - s);
  }

  // 묶음 처리: 키 입력 5회(50 ms 분량) 뒤 flush → 상대 피어가 받아 flush
  const flushA: number[] = [];
  const flushB: number[] = [];
  for (let k = 0; k < 30; k++) {
    for (let i = 0; i < 5; i++) a.doc.insertText(caret++, '나');
    let s = performance.now();
    a.flush();
    flushA.push(performance.now() - s);
    for (const u of outbox.splice(0)) b.receive(u);
    s = performance.now();
    b.flush();
    flushB.push(performance.now() - s);
  }
  if (a.doc.text() !== b.doc.text()) throw new Error('diverged');

  // 공유 위치: 캐럿 → 커서(보내는 쪽), 커서 → 화면 오프셋(받는 쪽). 문단을 몇 개 옮겨 구획을 늘린 상태
  for (let k = 0; k < 20; k++) {
    const n = a.doc.paragraphs().length;
    a.doc.moveParagraphs((k * 7919) % n, (k * 7919) % n, (k * 104729) % (n + 1));
  }
  a.flush();
  for (const u of outbox.splice(0)) b.receive(u);
  b.flush();
  const make: number[] = [];
  const resolve: number[] = [];
  for (let k = 0; k < 200; k++) {
    const o = Math.floor(((k * 2654435761) % 1_000_003) / 1_000_003 * a.doc.maxCaret);
    let s = performance.now();
    const c = a.cursorAt(o);
    make.push(performance.now() - s);
    s = performance.now();
    const back = b.resolveCursor(c);
    resolve.push(performance.now() - s);
    if (back !== o) throw new Error(`cursor ${o} -> ${back}`);
  }

  console.log(
    [
      '',
      `■ ${paragraphs.toLocaleString()} 문단 (${text.length.toLocaleString()} 글자)`,
      `  만들기 ${createMs.toFixed(0)} ms, 스냅샷으로 참여 ${joinMs.toFixed(0)} ms`,
      `  글자 입력 (브리지 포함)  ${stats(typing)}`,
      `  Backspace (브리지 포함)  ${stats(back)}`,
      `  묶음 내보내기 (5타)      ${stats(flushA)}`,
      `  묶음 가져오기 + Doc 적용 ${stats(flushB)}`,
      `  공유 위치 만들기         ${stats(make)}  (구획 ${a.doc.segmentCount}개)`,
      `  공유 위치 풀기           ${stats(resolve)}`,
    ].join(NL),
  );
  a.destroy();
  b.destroy();
}

/**
 * Worker 구조 (09 §8): 메인 쪽(SyncClient: Doc + 변환)과 Worker 쪽(SyncCore: Loro)을 나눠 잰다.
 * 메시지 전달은 같은 스레드에서 직접 부른다 (실제 postMessage 복사 비용은 빠진다).
 */
function workerScenario(paragraphs: number) {
  const text = Array.from({ length: paragraphs }, (_, i) => `${i + 1}. ${LOREM}`).join(NL);
  const mk = (k: number, snap: Uint8Array | null, out: Uint8Array[]) => {
    const toMain: ToMain[] = [];
    const opts = { user: { name: 'p', color: '#000000' }, batchMs: null, post: (m: ToMain) => toMain.push(m), net: { sendDoc: (b: Uint8Array) => out.push(b), sendPresence: () => {} } };
    const core = snap ? SyncCore.fromSnapshot(snap, k, opts) : SyncCore.create(text, k, opts);
    const toWorker: ToWorker[] = [];
    const client = new SyncClient(toMain.shift() as Extract<ToMain, { t: 'init' }>, { post: (m) => toWorker.push(m) });
    return { core, client, toMain, toWorker };
  };
  const outA: Uint8Array[] = [];
  const outB: Uint8Array[] = [];
  const A = mk(1, null, outA);
  const B = mk(2, A.core.loro.export({ mode: 'snapshot' }), outB);
  const pump = (p: typeof A) => {
    while (p.toWorker.length || p.toMain.length) {
      for (const m of p.toWorker.splice(0)) p.core.handle(m);
      for (const m of p.toMain.splice(0)) p.client.handle(m);
    }
  };
  let caret = Math.floor(A.client.doc.length / 2);
  const typing: number[] = [];
  const workerOps: number[] = [];
  for (let i = 0; i < 300; i++) {
    let s = performance.now();
    A.client.doc.insertText(caret++, '가');
    typing.push(performance.now() - s);
    s = performance.now();
    for (const m of A.toWorker.splice(0)) A.core.handle(m);
    workerOps.push(performance.now() - s);
    for (const m of A.toMain.splice(0)) A.client.handle(m);
  }
  // 원격 묶음 적용: A의 5타를 B가 받는다. Worker 쪽(가져오기) / 메인 쪽(변환 + Doc 적용)
  const coreImport: number[] = [];
  const mainApply: number[] = [];
  for (let k = 0; k < 30; k++) {
    for (let i = 0; i < 5; i++) A.client.doc.insertText(caret++, '나');
    pump(A);
    A.core.flush();
    for (const u of outA.splice(0)) B.core.receiveDoc(u);
    // B는 아직 Worker에 닿지 않은 로컬 입력을 하나 들고 있다 (변환 경로)
    B.client.doc.insertText(1, 'x');
    let s = performance.now();
    B.core.flush();
    coreImport.push(performance.now() - s);
    s = performance.now();
    for (const m of B.toMain.splice(0)) B.client.handle(m);
    mainApply.push(performance.now() - s);
    pump(B);
  }
  if (A.client.doc.text().length < 10) throw new Error('bad');
  console.log(
    [
      `  [Worker 구조] 메인: 글자 입력 ${stats(typing)}`,
      `  [Worker 구조] Worker: 로컬 묶음 적용 ${stats(workerOps)}`,
      `  [Worker 구조] Worker: 원격 가져오기 ${stats(coreImport)}`,
      `  [Worker 구조] 메인: 원격 변환 + Doc 적용 ${stats(mainApply)}`,
    ].join(NL),
  );
  A.core.close();
  B.core.close();
}

/** 편집이 쌓인 문서를 새 판으로 압축·저장·재기반하는 비용 */
async function storageScenario(paragraphs: number) {
  const text = Array.from({ length: paragraphs }, (_, i) => `${i + 1}. ${LOREM}`).join(NL);
  const a = SyncBridge.create(text, { peer: 1, batchMs: null });
  const n = a.doc.paragraphs().length;
  // 문단 이동 200번, 삭제(숨김) 100번, 입력 2,000자
  for (let k = 0; k < 200; k++) {
    const i = (k * 7919) % (n - 2);
    a.doc.moveParagraphs(i, i, (k * 104729) % (n - 1));
  }
  for (let k = 0; k < 100; k++) {
    const i = (k * 31337) % (a.doc.paragraphs().length - 2);
    a.doc.hideParagraphs(i, i);
  }
  for (let k = 0; k < 2000; k++) a.doc.insertText((k * 2654435761) % a.doc.maxCaret, '가');
  a.flush();
  const before = a.loro.export({ mode: 'snapshot' }).length;
  let t = performance.now();
  const shown = displayText(a.loro);
  const displayMs = performance.now() - t;
  t = performance.now();
  const fresh = compactLoro(shown, 'e1', 99);
  const compactMs = performance.now() - t;
  const base = fresh.export({ mode: 'snapshot' });
  t = performance.now();
  const file = await packQuire({ loro: fresh });
  const packMs = performance.now() - t;
  t = performance.now();
  const opened = await openQuire(file);
  const openMs = performance.now() - t;
  // 재기반: 옛 판에서 오프라인으로 20자 입력한 클라이언트
  const off = SyncBridge.fromSnapshot(a.snapshot(), { peer: 2, batchMs: null });
  const finalVV = a.loro.oplogVersion().encode();
  for (let k = 0; k < 20; k++) off.doc.insertText((k * 7907) % off.doc.maxCaret, '오');
  off.flush();
  t = performance.now();
  const r = rebaseOnto(off.loro, { epoch: 'e1', oldVV: finalVV, update: new Uint8Array(), base }, 2);
  const rebaseMs = performance.now() - t;
  const ok = displayText(r.loro) === displayText(off.loro) && opened.crdt !== null;
  const kb = (b: number) => `${(b / 1024).toFixed(0)} KB`;
  console.log(
    [
      `── 저장 ${paragraphs.toLocaleString()}문단 (이동 200 · 삭제 100 · 입력 2,000) ──`,
      `  스냅샷 ${kb(before)} → 새 판 ${kb(base.length)} (구획 표식 ${a.doc.segmentCount} → 2)`,
      `  화면 텍스트 ${displayMs.toFixed(0)} ms · 새 판 만들기 ${compactMs.toFixed(0)} ms`,
      `  .quire ${kb(file.length)} · 저장 ${packMs.toFixed(0)} ms · 열기(해시 확인 포함) ${openMs.toFixed(0)} ms`,
      `  재기반(오프라인 20자) ${rebaseMs.toFixed(0)} ms · 결과 일치 ${ok}`,
    ].join(NL),
  );
  a.destroy();
  off.destroy();
}

it('storage cost', async () => {
  await storageScenario(1_000);
  await storageScenario(10_000);
  await storageScenario(100_000);
}, 600_000);

it('sync bridge cost', () => {
  scenario(1_000);
  workerScenario(1_000);
  scenario(10_000);
  workerScenario(10_000);
  scenario(100_000);
  workerScenario(100_000);
}, 600_000);
