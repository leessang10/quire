// Vue에서 Quire 붙이기 (공식 래퍼 없이 @quire/sdk만): 에디터 수명은 onMounted·onBeforeUnmount, 상태는 shallowRef
import { onBeforeUnmount, onMounted, shallowRef, type Ref } from 'vue';
import { createEditor, type CreateEditorOptions, type EditorState, type QuireHandle } from '@quire/sdk';

export function useQuire(host: Ref<HTMLElement | null>, options: Omit<CreateEditorOptions, 'host'>) {
  const handle = shallowRef<QuireHandle | null>(null);
  const state = shallowRef<EditorState | null>(null);
  let off: (() => void) | null = null;
  let alive = true;
  onMounted(async () => {
    const h = await createEditor({ ...options, host: host.value! });
    if (!alive) return h.destroy();
    handle.value = h;
    state.value = h.getState();
    // 스냅샷은 값이 같으면 같은 객체라 shallowRef가 바뀌지 않는다 (다시 그리지 않는다)
    off = h.subscribe(() => (state.value = h.getState()));
  });
  onBeforeUnmount(() => {
    alive = false;
    off?.();
    handle.value?.destroy();
    handle.value = null;
  });
  return { handle, state };
}
