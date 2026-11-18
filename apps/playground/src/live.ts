/**
 * 실시간 편집 페이지: 이 탭의 Worker가 중계 서버(apps/sync-server)에 WebSocket으로 붙는다 (09 §8).
 *   서버:  node apps/sync-server/src/server.ts
 *   주소:  /live.html?room=<방>&server=ws://localhost:8787
 * 서버를 껐다 켜면 Worker가 다시 연결하고, 끊긴 동안의 편집을 맞춘다.
 * 모두 나가 방이 비면 서버가 새 판으로 압축한다. 그 사이 오프라인이던 탭은 다시 붙을 때 새 판으로 옮겨진다 (09 §9).
 */
import { Editor, HttpAssets } from '@quire/editor';
import { startSyncWorker } from '@quire/sync';

const params = new URLSearchParams(location.search);
const room = params.get('room') || 'demo';
const server = params.get('server') || `ws://${location.hostname}:8787`;
const statusEl = document.getElementById('live-status')!;
const host = document.getElementById('editor')!;
const noteEl = document.getElementById('live-note')!;
const httpBase = server.replace(/^ws/, 'http');

function note(text: string | null) {
  noteEl.hidden = text === null;
  noteEl.textContent = text ?? '';
}

// .quire 내려받기·열기 (07): 서버가 지금 문서로 파일을 만들고, 올린 파일로 새 방을 만든다
const download = document.getElementById('download') as HTMLAnchorElement;
download.href = `${httpBase}/${encodeURIComponent(room)}.quire`;
download.download = `${room}.quire`;
const fileInput = document.getElementById('open-file') as HTMLInputElement;
document.getElementById('open')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  const name = `${file.name.replace(/.quire$/i, '') || 'doc'}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    const res = await fetch(`${httpBase}/${encodeURIComponent(name)}.quire`, { method: 'PUT', body: file });
    const body = (await res.json()) as { error?: string; history?: boolean; notes?: string[] };
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    const params = new URLSearchParams(location.search);
    params.set('room', name);
    if (body.notes?.length) sessionStorage.setItem('quire-open-note', body.notes.join(' / '));
    location.search = params.toString();
  } catch (e) {
    note(`열지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
  }
});
try {
  const pending = sessionStorage.getItem('quire-open-note');
  if (pending) {
    sessionStorage.removeItem('quire-open-note');
    note(`파일을 열었습니다: ${pending}`);
  }
} catch {
  /* 저장소를 쓸 수 없는 환경 */
}

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
      onReset: (lost) => {
        editor?.setDocument(client.document);
        note(
          lost
            ? '서버가 이 문서의 옛 판을 몰라, 끊긴 동안의 편집을 살리지 못했습니다.'
            : '서버가 문서를 새 판으로 정리했습니다. 끊긴 동안의 편집을 새 판에 옮겼습니다.',
        );
      },
    },
  );
  setStatus(true);
  editor = new Editor({
    host,
    document: client.document,
    onChange: () => editor?.setRemoteCarets(client.remotes()),
    onSelectionChange: (a, h) => client.setSelection(a, h),
    // 이미지 원본은 서버의 자산 저장소 (11 §2.2)
    assets: new HttpAssets(`${server.replace(/^ws/, 'http')}/${encodeURIComponent(room)}/assets/`),
  });
  editor.focus();
  addEventListener('pagehide', () => client.close());
  Object.assign(window, { client, editor });
})();
