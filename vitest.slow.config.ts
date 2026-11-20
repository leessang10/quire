import { defineConfig } from 'vitest/config';
import { SLOW_TESTS } from './vitest.slow';

/** 느린 묶음 (16 §3): 매일 한 번 */
export default defineConfig({
  test: {
    include: [...SLOW_TESTS],
    testTimeout: 600_000,
  },
});
