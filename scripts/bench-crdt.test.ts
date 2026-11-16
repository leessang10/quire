/**
 * CRDT 크기·속도 (V4 보조 측정)
 *   npx vitest run --config vitest.bench.config.ts scripts/bench-crdt.test.ts
 *
 * 10만 문단(약 1만 쪽, 1,370만 글자) 문서를 M1(텍스트 하나)과 M2(문단마다 텍스트)로 만들고
 * 스냅샷 크기, 불러오기 시간, 키 입력 1회의 업데이트 크기·적용 시간을 잰다.
 */
import { it } from 'vitest';
import { LoroDoc, LoroText } from 'loro-crdt';

const NL = String.fromCharCode(10);
const LOREM =
  '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다. 이 문단은 대형 문서 성능 측정을 위해 반복해서 생성된 문단입니다. 레이아웃 캐시가 동작하면 편집할 때 바뀐 문단만 다시 줄을 나눕니다.';

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5)}  p95 ${q(0.95)}  max ${q(1)} ms`;
}

function mb(n: number) {
  return `${(n / 1e6).toFixed(1)} MB`;
}

function measure(name: string, build: (doc: LoroDoc, paras: string[]) => void, edit: (doc: LoroDoc, i: number) => void, n: number) {
  const paras = Array.from({ length: n }, (_, i) => `${i + 1}. ${LOREM}`);
  const chars = paras.reduce((a, p) => a + p.length + 1, 0);

  const heap0 = process.memoryUsage().heapUsed;
  let t = performance.now();
  const a = new LoroDoc();
  a.setPeerId(1);
  build(a, paras);
  a.commit();
  const buildMs = performance.now() - t;

  t = performance.now();
  const snap = a.export({ mode: 'snapshot' });
  const exportMs = performance.now() - t;

  t = performance.now();
  const b = new LoroDoc();
  b.setPeerId(2);
  b.import(snap);
  const importMs = performance.now() - t;
  const heap1 = process.memoryUsage().heapUsed;

  // 키 입력: A에서 한 글자 입력 → 업데이트 내보내기 → B에 적용
  const local: number[] = [];
  const remote: number[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < 300; i++) {
    const v = b.oplogVersion();
    let s = performance.now();
    edit(a, i);
    a.commit();
    const upd = a.export({ mode: 'update', from: v });
    local.push(performance.now() - s);
    sizes.push(upd.length);
    s = performance.now();
    b.import(upd);
    remote.push(performance.now() - s);
  }
  const snapAfter = a.export({ mode: 'snapshot' });

  console.log(
    [
      '',
      `■ ${name} — ${n.toLocaleString()} 문단, ${chars.toLocaleString()} 글자`,
      `  만들기 ${buildMs.toFixed(0)} ms, 스냅샷 ${mb(snap.length)} (내보내기 ${exportMs.toFixed(0)} ms), 불러오기 ${importMs.toFixed(0)} ms`,
      `  JS 힙 증가 (두 문서) ${mb(heap1 - heap0)} — wasm 메모리는 포함되지 않음`,
      `  키 입력 (입력+내보내기) ${stats(local)}`,
      `  원격 적용 ${stats(remote)}`,
      `  업데이트 크기 평균 ${(sizes.reduce((x, y) => x + y, 0) / sizes.length).toFixed(0)} B, 300회 후 스냅샷 ${mb(snapAfter.length)}`,
    ].join(NL),
  );
}

it('crdt size/speed', () => {
  for (const n of [10_000, 100_000]) {
    measure(
      'M1 평평한 텍스트',
      (doc, paras) => doc.getText('body').insert(0, paras.map((p) => p + NL).join('')),
      (doc, i) => {
        const t = doc.getText('body');
        t.insert(Math.floor(t.length / 2) + i, '가');
      },
      n,
    );
    measure(
      'M2 문단 리스트',
      (doc, paras) => {
        const list = doc.getMovableList('body');
        paras.forEach((p, k) => list.insertContainer(k, new LoroText()).insert(0, p));
      },
      (doc, i) => {
        const list = doc.getMovableList('body');
        (list.get(Math.floor(list.length / 2)) as unknown as LoroText).insert(10 + i, '가');
      },
      n,
    );
  }
}, 600_000);
