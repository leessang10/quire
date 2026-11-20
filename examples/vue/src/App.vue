<script setup lang="ts">
// 예제 3: Vue 3 + SCSS
import { computed, ref } from 'vue';
import { useQuire } from './useQuire';
import { ACCEPT, demoPlugins, fonts, openFile, sampleDoc, saveFile, type SaveKind } from './quire-demo.ts';

const host = ref<HTMLElement | null>(null);
const file = ref<HTMLInputElement | null>(null);
const words = ref('');
const message = ref('');
const { handle, state } = useQuire(host, {
  doc: sampleDoc('Vue 3 + SCSS'),
  fonts,
  plugins: demoPlugins((c) => (words.value = `${c.chars.toLocaleString()}자 · ${c.words.toLocaleString()}어절`)),
});
const marks = computed(() => state.value?.marksAtCaret ?? {});
const style = computed(() => (['h1', 'h2', 'h3'].includes(state.value?.paragraphStyle ?? '') ? state.value!.paragraphStyle : 'body'));

function run(cmd: string, ...args: unknown[]) {
  handle.value?.run(cmd, ...args);
  handle.value?.run('focus');
}
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f || !handle.value) return;
  const d = Object.entries(await openFile(handle.value, f));
  message.value = `${f.name} 열림${d.length ? ` · 버림: ${d.map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}`;
}
async function save(kind: SaveKind) {
  if (!handle.value) return;
  const n = await saveFile(handle.value, kind);
  message.value = `${kind.toUpperCase()} 저장 (${(n / 1024).toFixed(1)} KB)`;
}
</script>

<template>
  <div class="app">
    <header>
      <strong>Quire · Vue + SCSS</strong>
      <div class="group">
        <button :aria-pressed="!!marks.bold" title="굵게" @click="run('toggleBold')"><b>가</b></button>
        <button :aria-pressed="!!marks.italic" title="기울임" @click="run('toggleItalic')"><i>가</i></button>
        <button :aria-pressed="!!marks.underline" title="밑줄" @click="run('toggleUnderline')"><u>가</u></button>
      </div>
      <div class="group">
        <button :disabled="!state?.canUndo" title="실행 취소" @click="run('undo')">↶</button>
        <button :disabled="!state?.canRedo" title="다시 실행" @click="run('redo')">↷</button>
      </div>
      <select :value="style" @change="run('setStyle', ($event.target as HTMLSelectElement).value)">
        <option value="body">본문</option>
        <option value="h1">제목 1</option>
        <option value="h2">제목 2</option>
        <option value="h3">제목 3</option>
      </select>
      <div class="group">
        <button @click="file?.click()">열기</button>
        <input ref="file" type="file" :accept="ACCEPT" hidden @change="onFile" />
        <button v-for="k in (['hwpx', 'docx', 'md', 'pdf'] as const)" :key="k" @click="save(k)">{{ k.toUpperCase() }}</button>
      </div>
    </header>
    <main ref="host" class="editor"></main>
    <footer>{{ message || words }} · 플러그인: {{ state?.plugins.join(', ') }}</footer>
  </div>
</template>
