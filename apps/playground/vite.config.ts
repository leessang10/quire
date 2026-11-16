import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // loro-crdt의 브라우저 빌드는 .wasm을 ES 모듈로 가져오므로 플러그인이 필요하다. 플레이그라운드는 wasm을 담은 base64 빌드를 쓴다
    alias: [{ find: /^loro-crdt$/, replacement: 'loro-crdt/base64' }],
  },
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), collab: resolve(__dirname, 'collab.html') },
    },
  },
});
