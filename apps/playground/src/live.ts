/**
 * 실시간 편집 페이지: 이 탭의 Worker가 중계 서버(apps/sync-server)에 WebSocket으로 붙는다 (09 §8).
 *   서버:  node apps/sync-server/src/server.ts
 *   주소:  /live.html?room=<방>&server=ws://localhost:8787
 * 서버를 껐다 켜면 Worker가 다시 연결하고, 끊긴 동안의 편집을 맞춘다.
 * 모두 나가 방이 비면 서버가 새 판으로 압축한다. 그 사이 오프라인이던 탭은 다시 붙을 때 새 판으로 옮겨진다 (09 §9).
 * 협업은 플러그인 하나로 붙인다 (`collab()`, 19 §4.4): 공유 문서·원격 변경·프레즌스·권한·새 판·내 선택 보내기를 플러그인이 맡고,
 * 이 페이지는 상태 줄·접속자 목록·파일·버전 같은 앱 화면만 그린다.
 */
import { Editor, HttpAssets, remoteColorSlot } from '@quiredoc/editor';
import { collab } from '@quiredoc/sync';
import { VersionsPane } from './versions-pane';

const params = new URLSearchParams(location.search);
const room = params.get('room') || 'demo';
const server = params.get('server') || `ws://${location.hostname}:8787`;
// 권한 토큰 (14 §6): 방에 access.json이 있으면 역할을 정한다
const token = params.get('token');
const q = token ? `?token=${encodeURIComponent(token)}` : '';
const ROLE_LABEL = { edit: '편집', comment: '댓글만', view: '보기만' } as const;
let role: keyof typeof ROLE_LABEL = 'edit';
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
download.href = `${httpBase}/${encodeURIComponent(room)}.quire${q}`;
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

const peer = 1 + Math.floor(Math.random() * 2 ** 40);
const user = { name: `사용자 ${String(peer).slice(-4)}`, color: String(remoteColorSlot(String(peer))) }; // 협업 팔레트 번호: 테마·다크를 따른다

const TEXT = `이 문서는 중계 서버의 "${room}" 방에 있습니다. 같은 주소를 다른 탭이나 다른 브라우저에서 열면 함께 편집됩니다.

서버를 끄면 위에 "다시 연결 중"이 보이고, 그동안에도 편집할 수 있습니다. 서버를 다시 켜면 끊긴 동안의 편집이 합쳐집니다.`;

function setStatus(online: boolean, detail?: string) {
  statusEl.textContent = online ? `● 연결됨 · ${user.name} · ${ROLE_LABEL[role]}` : `○ ${detail ?? '연결 끊김'}`;
  statusEl.dataset.state = online ? 'online' : 'offline';
}

/** 접속자 목록 (14 §7): 이름·색·지금 스토리. 누르면 그 캐럿으로, 따라가기는 캐럿이 움직일 때마다 */
const peopleEl = document.getElementById('people')!;
const storyLabel = (s?: string) =>
  !s ? '본문' : s.startsWith('fn|') ? '각주' : s.startsWith('hdr|') ? '머리말' : s.startsWith('ftr|') ? '꼬리말' : '표 셀';
let showPeople = () => {};

void (async () => {
  const sync = collab({
    worker: () => new Worker(new URL('./sync-worker.ts', import.meta.url), { type: 'module' }),
    url: `${server}/${encodeURIComponent(room)}${q}`,
    user,
    peer,
    text: TEXT,
    onStatus: setStatus,
    onRole: (r) => {
      role = r;
      setStatus(true);
    },
    onReset: (lost) =>
      note(
        lost
          ? '서버가 이 문서의 옛 판을 몰라, 끊긴 동안의 편집을 살리지 못했습니다.'
          : '서버가 문서를 새 판으로 정리했습니다. 끊긴 동안의 편집을 새 판에 옮겼습니다.',
      ),
    onPresence: () => showPeople(),
  });
  const editor = new Editor({
    host,
    // 이미지 원본은 서버의 자산 저장소 (11 §2.2)
    assets: new HttpAssets(`${server.replace(/^ws/, 'http')}/${encodeURIComponent(room)}/assets/`, undefined, token),
  });
  editor.use(sync);
  const client = await sync.ready;
  role = client.role;
  setStatus(true);
  showPeople = () => {
    const ed = editor!;
    const list = client.remotes();
    peopleEl.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = `접속자 ${list.length + 1}명`;
    peopleEl.append(h);
    const me = document.createElement('div');
    me.className = 'pp-row';
    me.innerHTML = `<i style="background:${user.color}"></i><span>${user.name} (나)</span>`;
    peopleEl.append(me);
    for (const r of list) {
      const row = document.createElement('div');
      row.className = 'pp-row';
      const dot = document.createElement('i');
      dot.style.background = r.color;
      const go = document.createElement('button');
      go.className = 'pp-name';
      go.textContent = `${r.name} · ${storyLabel(r.story)}`;
      go.title = '그 사람 캐럿으로';
      go.addEventListener('click', () => ed.revealRemote(r.key));
      const fol = document.createElement('button');
      const on = ed.followingKey === r.key;
      fol.textContent = on ? '따라가는 중' : '따라가기';
      fol.setAttribute('aria-pressed', String(on));
      fol.addEventListener('click', () => {
        ed.follow(on ? null : r.key);
        showPeople();
      });
      row.append(dot, go, fol);
      peopleEl.append(row);
    }
  };
  showPeople();
  editor.focus();
  // 버전 기록 (14 §5)
  new VersionsPane(document.getElementById('versions')!, editor, `${httpBase}/${encodeURIComponent(room)}`, q);
  addEventListener('pagehide', () => editor.destroy()); // 플러그인이 연결을 닫고 Worker를 끝낸다
  Object.assign(window, { client, editor });
})();
