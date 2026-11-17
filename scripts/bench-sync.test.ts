/**
 * 동기화 브리지 비용 (09 §2)
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-sync.test.ts --silent=false
 *
 * 브리지를 붙인 Doc에서 키 입력 1회 비용(Doc 편집 + UTF-16 위치 + Loro 입력·커밋)과
 * 묶음 처리(flush: 내보내기 + 원격 가져오기 + Doc 적용) 비용, 공유 위치(Loro 커서) 만들기·풀기 비용을 잰다.
 */
import { it } from 'vitest';
import { SyncBridge } from '@quire/sync';

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

it('sync bridge cost', () => {
  scenario(1_000);
  scenario(10_000);
  scenario(100_000);
}, 600_000);
