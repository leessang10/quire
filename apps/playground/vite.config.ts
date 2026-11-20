import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // loro-crdt의 브라우저 빌드는 .wasm을 ES 모듈로 가져오므로 플러그인이 필요하다. 플레이그라운드는 wasm을 담은 base64 빌드를 쓴다
    alias: [{ find: /^loro-crdt$/, replacement: 'loro-crdt/base64' }],
  },
  // 동기화 Worker는 ES 모듈 Worker (loro-crdt 별칭도 그대로 적용된다)
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        collab: resolve(__dirname, 'collab.html'),
        live: resolve(__dirname, 'live.html'),
        checklist: resolve(__dirname, 'checklist.html'),
        shaping: resolve(__dirname, 'shaping.html'),
        bench: resolve(__dirname, 'bench.html'),
        golden: resolve(__dirname, 'golden.html'),
      },
    },
  },
});
