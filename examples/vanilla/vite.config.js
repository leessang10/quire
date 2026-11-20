import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022' },
  // harfbuzzjs·loro-crdt의 WASM을 미리 묶지 않는다 (WASM 파일을 그대로 쓴다)
  optimizeDeps: { exclude: ['harfbuzzjs', 'loro-crdt'] },
});
