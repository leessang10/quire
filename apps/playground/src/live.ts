/**
 * 실시간 편집 페이지: 이 탭의 Worker가 중계 서버(apps/sync-server)에 WebSocket으로 붙는다 (09 §8).
 *   서버:  node apps/sync-server/src/server.ts
 *   주소:  /live.html?room=<방>&server=ws://localhost:8787
 * 서버를 껐다 켜면 Worker가 다시 연결하고, 끊긴 동안의 편집을 맞춘다.
 */
import { Editor } from '@quire/editor';
import { startSyncWorker } from '@quire/sync';

const params = new URLSearchParams(location.search);
const room = params.get('room') || 'demo';
const server = params.get('server') || `ws://${location.hostname}:8787`;
const statusEl = document.getElementById('live-status')!;
const host = document.getElementById('editor')!;

const COLORS = ['#2563eb', '#c2410c', '#047857', '#7c3aed', '#be123c', '#0e7490'];
const peer = 1 + Math.floor(Math.random() * 2 ** 40);
const user = { name: `사용자 ${String(peer).slice(-4)}`, color: COLORS[peer % COLORS.length]! };

const TEXT = `이 문서는 중계 서버의 "${room}" 방에 있습니다. 같은 주소를 다른 탭이나 다른 브라우저에서 열면 함께 편집됩니다.

서버를 끄면 위에 "다시 연결 중"이 보이고, 그동안에도 편집할 수 있습니다. 서버를 다시 켜면 끊긴 동안의 편집이 합쳐집니다.`;

function setStatus(online: boolean, detail?: string) {
  statusEl.textContent = online ? `● 연결됨 · ${user.name}` : `○ ${detail ?? '연결 끊김'}`;
  statusEl.dataset.state = online ? 'online' : 'offline';
}

void (async () => {
  let editor: Editor | null = null;
  const worker = new Worker(new URL('./sync-worker.ts', import.meta.url), { type: 'module' });
  const client = await startSyncWorker(
    worker,
    { mode: 'ws', peer, user, url: `${server}/${encodeURIComponent(room)}`, text: TEXT },
    {
      onRemoteChange: () => editor?.docChanged(),
      onPresence: () => editor?.setRemoteCarets(client.remotes()),
      onStatus: setStatus,
    },
  );
  setStatus(true);
  editor = new Editor({
    host,
    doc: client.doc,
    onChange: () => editor?.setRemoteCarets(client.remotes()),
    onSelectionChange: (a, h) => client.setSelection(a, h),
  });
  editor.focus();
  addEventListener('pagehide', () => client.close());
  Object.assign(window, { client, editor });
})();
