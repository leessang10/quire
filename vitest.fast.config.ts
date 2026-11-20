import { defineConfig } from 'vitest/config';
import { SLOW_TESTS } from './vitest.slow';

/** 빠른 묶음 (16 §3): 푸시·PR마다. 느린 파일(vitest.slow.ts)을 뺀 나머지 */
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'spikes/**/*.test.ts'],
    exclude: ['**/node_modules/**', ...SLOW_TESTS],
  },
});
