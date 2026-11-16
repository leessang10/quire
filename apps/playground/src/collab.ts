/**
 * 협업 데모: 한 페이지의 두 편집기를 가짜 네트워크(지연, 오프라인)로 잇는다.
 * 각 편집기는 자기 Doc + SyncBridge(Loro)를 가진다. 09 §2.
 */
import { Editor } from '@quire/editor';
import { SyncBridge } from '@quire/sync';

const TEXT = `두 편집기는 각자 문서 사본을 가지고 CRDT(Loro)로 변경을 주고받습니다.

양쪽에서 동시에 입력해 보세요. 지연을 늘리거나 한쪽을 오프라인으로 두고 편집한 뒤 다시 연결하면, 두 문서가 같은 내용으로 합쳐져야 합니다.

1단계에서는 텍스트 편집만 동기화합니다. 문단 이동·삭제(구획)는 2단계에서 다룹니다.`;

const latencyEl = document.getElementById('latency') as HTMLInputElement;
const verdictEl = document.getElementById('verdict')!;
const sections = [...document.querySelectorAll<HTMLElement>('.peer')];

interface Peer {
  bridge: SyncBridge;
  editor: Editor;
  offline: boolean;
  /** 오프라인 동안 보내지 못한 업데이트 */
  held: Uint8Array[];
  sent: number;
  received: number;
  statusEl: HTMLElement;
}

const peers: Peer[] = [];
let inFlight = 0;

function send(from: number, update: Uint8Array) {
  const to = 1 - from;
  const src = peers[from]!;
  src.sent += update.length;
  if (src.offline || peers[to]!.offline) {
    src.held.push(update);
  } else {
    transmit(to, update);
  }
  status();
}

function transmit(to: number, update: Uint8Array) {
  inFlight++;
  setTimeout(() => {
    inFlight--;
    const p = peers[to]!;
    p.received += update.length;
    p.bridge.receive(update);
    status();
  }, Math.max(0, Number(latencyEl.value) || 0));
}

function reconnect() {
  for (let k = 0; k < 2; k++) {
    const p = peers[k]!;
    if (p.offline || peers[1 - k]!.offline) continue;
    for (const u of p.held.splice(0)) transmit(1 - k, u);
  }
  status();
}

function status() {
  for (const p of peers) {
    p.statusEl.textContent =
      `보냄 ${p.sent.toLocaleString()} B · 받음 ${p.received.toLocaleString()} B` +
      (p.held.length ? ` · 대기 ${p.held.length}건` : '');
  }
  if (peers.length < 2) return;
  const [a, b] = peers as [Peer, Peer];
  const idle = inFlight === 0 && !a.held.length && !b.held.length;
  const same = a.editor.getText() === b.editor.getText();
  verdictEl.textContent = !idle ? '전송 중…' : same ? '✓ 두 문서가 같습니다' : '… 합치는 중 (다음 묶음에서 반영)';
  verdictEl.dataset.state = !idle ? 'busy' : same ? 'same' : 'busy';
}

function makePeer(k: number, bridge: SyncBridge) {
  const section = sections[k]!;
  const host = section.querySelector<HTMLElement>('.peer-editor')!;
  const editor = new Editor({ host, doc: bridge.doc, onChange: () => status() });
  const peer: Peer = { bridge, editor, offline: false, held: [], sent: 0, received: 0, statusEl: section.querySelector('.peer-status')! };
  section.querySelector<HTMLInputElement>('.offline')!.addEventListener('change', (e) => {
    peer.offline = (e.target as HTMLInputElement).checked;
    section.classList.toggle('is-offline', peer.offline);
    reconnect();
  });
  peers[k] = peer;
}

// 피어 A가 문서를 만들고, 피어 B는 A의 스냅샷으로 참여한다
const bridgeA = SyncBridge.create(TEXT, {
  peer: 1,
  onUpdate: (u) => send(0, u),
  onRemoteChange: () => peers[0]?.editor.docChanged(),
});
const bridgeB = SyncBridge.fromSnapshot(bridgeA.snapshot(), {
  peer: 2,
  onUpdate: (u) => send(1, u),
  onRemoteChange: () => peers[1]?.editor.docChanged(),
});
makePeer(0, bridgeA);
makePeer(1, bridgeB);
peers[0]!.editor.focus();
status();

Object.assign(window, { peers });
