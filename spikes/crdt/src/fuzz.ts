/** 무작위 동시 편집 시험의 공용 부분 (random.test, cleanup.test) */
import type { Replica } from './models';

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export const ALPHA = Array.from('가나다라마바사아자차');

/** 편집 종류별 누적 확률 경계: 입력, 삭제, 분할, 병합, 이동, 문단 삭제 (나머지는 실행 취소) */
export type Mix = [number, number, number, number, number, number];
export const NORMAL: Mix = [0.35, 0.5, 0.65, 0.78, 0.9, 0.95];
export const MOVE_HEAVY: Mix = [0.25, 0.35, 0.45, 0.55, 0.9, 0.95];

export function randomEdit(r: () => number, x: Replica, mix: Mix = NORMAL): string {
  const paras = x.paragraphs();
  const n = paras.length;
  if (n === 0) return 'skip';
  const p = Math.floor(r() * n);
  const len = Array.from(paras[p]!).length;
  const roll = r();
  if (roll < mix[0]) {
    x.insertText(p, Math.floor(r() * (len + 1)), ALPHA[Math.floor(r() * ALPHA.length)]!.repeat(1 + Math.floor(r() * 3)));
    return 'insert';
  }
  if (roll < mix[1] && len > 0) {
    const at = Math.floor(r() * len);
    x.deleteText(p, at, Math.min(len - at, 1 + Math.floor(r() * 3)));
    return 'delete';
  }
  if (roll < mix[2]) {
    x.split(p, Math.floor(r() * (len + 1)));
    return 'split';
  }
  if (roll < mix[3] && p + 1 < n) {
    x.merge(p);
    return 'merge';
  }
  if (roll < mix[4] && n > 1) {
    x.move(p, Math.floor(r() * n));
    return 'move';
  }
  if (roll < mix[5] && n > 1) {
    x.deletePara(p);
    return 'deletePara';
  }
  if (x.undo()) return 'undo';
  return 'skip';
}
