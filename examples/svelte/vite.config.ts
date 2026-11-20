import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // SvelteKit 3: 설정은 플러그인에 (svelte.config.js는 쓰지 않는다)
  plugins: [sveltekit({ adapter: adapter({ fallback: 'index.html' }) })],
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['harfbuzzjs', 'loro-crdt'] },
});
