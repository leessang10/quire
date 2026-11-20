/**
 * 느린 시험 파일 (16 §3.1): 매일 한 번만 돈다. 이름을 바꾸지 않고 여기서 고른다.
 * 기준: 이 기기에서 파일 하나가 60초를 넘는 것 (2026-11-20 측정)
 */
export const SLOW_TESTS = [
  // CRDT 랜덤 수렴 (약 76분)
  'spikes/crdt/src/random.test.ts',
  // CRDT 정리 시나리오 (약 66초)
  'spikes/crdt/src/cleanup.test.ts',
];
