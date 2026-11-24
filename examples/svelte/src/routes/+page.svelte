<script lang="ts">
  // 예제 4: SvelteKit + Svelte scoped 스타일. 서버 렌더링 중에는 에디터를 만들지 않는다 (onMount는 브라우저에서만)
  import { onMount } from 'svelte';
  import type { EditorState, QuireHandle } from '@quiredoc/core';
  import { ACCEPT, demoPlugins, fonts, openFile, sampleDoc, saveFile, type SaveKind } from '#lib/quire-demo';

  let host: HTMLElement;
  let file: HTMLInputElement;
  let handle = $state<QuireHandle | null>(null);
  let st = $state<EditorState | null>(null);
  let words = $state('');
  let message = $state('');

  onMount(() => {
    let alive = true;
    let h: QuireHandle | null = null;
    let off = () => {};
    // 에디터 패키지는 브라우저에서만 불러온다 (서버 묶음에 캔버스 코드를 넣지 않는다)
    import('@quiredoc/core').then(async ({ createEditor }) => {
      h = await createEditor({
        host,
        doc: sampleDoc('SvelteKit + scoped 스타일'),
        fonts,
        plugins: demoPlugins((c) => (words = `${c.chars.toLocaleString()}자 · ${c.words.toLocaleString()}어절`)),
      });
      if (!alive) return h.destroy();
      handle = h;
      st = h.getState();
      off = h.subscribe(() => {
        const next = h!.getState();
        if (next !== st) st = next; // 스냅샷이 같으면 그대로 (다시 그리지 않는다)
      });
    });
    return () => {
      alive = false;
      off();
      h?.destroy();
    };
  });

  const run = (cmd: string, ...args: unknown[]) => {
    handle?.run(cmd, ...args);
    handle?.run('focus');
  };
  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f || !handle) return;
    const d = Object.entries(await openFile(handle, f));
    message = `${f.name} 열림${d.length ? ` · 버림: ${d.map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}`;
  }
  async function save(kind: SaveKind) {
    if (!handle) return;
    const n = await saveFile(handle, kind);
    message = `${kind.toUpperCase()} 저장 (${(n / 1024).toFixed(1)} KB)`;
  }
  const SAVE_KINDS: SaveKind[] = ['hwpx', 'docx', 'md', 'pdf'];
  const style = $derived(['h1', 'h2', 'h3'].includes(st?.paragraphStyle ?? '') ? st!.paragraphStyle : 'body');
</script>

<div class="app">
  <header>
    <strong>Quire · SvelteKit</strong>
    <div class="group">
      <button aria-pressed={!!st?.marksAtCaret.bold} title="굵게" onclick={() => run('toggleBold')}><b>가</b></button>
      <button aria-pressed={!!st?.marksAtCaret.italic} title="기울임" onclick={() => run('toggleItalic')}><i>가</i></button>
      <button aria-pressed={!!st?.marksAtCaret.underline} title="밑줄" onclick={() => run('toggleUnderline')}><u>가</u></button>
    </div>
    <div class="group">
      <button disabled={!st?.canUndo} title="실행 취소" onclick={() => run('undo')}>↶</button>
      <button disabled={!st?.canRedo} title="다시 실행" onclick={() => run('redo')}>↷</button>
    </div>
    <select value={style} onchange={(e) => run('setStyle', (e.currentTarget as HTMLSelectElement).value)}>
      <option value="body">본문</option>
      <option value="h1">제목 1</option>
      <option value="h2">제목 2</option>
      <option value="h3">제목 3</option>
    </select>
    <div class="group">
      <button onclick={() => file.click()}>열기</button>
      <input bind:this={file} type="file" accept={ACCEPT} hidden onchange={onFile} />
      {#each SAVE_KINDS as k (k)}
        <button onclick={() => save(k)}>{k.toUpperCase()}</button>
      {/each}
    </div>
  </header>
  <main bind:this={host} class="editor"></main>
  <footer>{message || words} · 플러그인: {st?.plugins.join(', ') ?? ''}</footer>
</div>

<style>
  /* Svelte scoped 스타일 (전역 리셋은 body만) */
  :global(html), :global(body) { margin: 0; height: 100%; }
  :global(body) { font: 14px/1.5 system-ui, 'Malgun Gothic', sans-serif; color: #1d1d1f; background: #f4f1ec; }
  .app { display: grid; grid-template-rows: auto 1fr auto; height: 100vh; }
  header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; background: #fff; border-bottom: 1px solid #ddd6cc; }
  .group { display: flex; gap: 4px; }
  button, select { font: inherit; padding: 4px 10px; border: 1px solid #c9c0b3; border-radius: 6px; background: #fff; cursor: pointer; }
  button[aria-pressed='true'] { background: #ffe6c7; border-color: #e08a2c; }
  button:disabled { opacity: 0.45; cursor: default; }
  .editor { position: relative; min-height: 0; }
  footer { padding: 4px 12px; font-size: 12px; color: #6b6257; background: #fff; border-top: 1px solid #ddd6cc; }
</style>
