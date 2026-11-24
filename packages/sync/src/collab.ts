/**
 * 협업을 플러그인 하나로 (19 §4.4, P-4): `editor.use(collab({...}))` 또는 `createEditor({ plugins: [collab({...})] })`.
 * 앱이 직접 엮던 것(Worker 시작 → 공유 문서를 편집기에 → 원격 변경·프레즌스·권한·새 판을 편집기에 → 내 선택을 서버로)을
 * 감싼다. 낮은 단계 API(startSyncWorker, WorkerClient …)는 그대로 있다: 직접 엮고 싶은 앱.
 *
 * - 연결해 공유 문서를 받기 전에는 보기만 (그 전에 쓴 글은 공유 문서로 바뀔 때 사라지므로).
 * - Worker는 앱이 만든다 (번들러마다 Worker 만드는 법이 다르다): 그 파일에서 `serveSyncWorker(self)`.
 * - 플러그인 하나는 편집기 하나에 붙인다.
 */
import type { QuirePlugin } from '@quiredoc/editor';
import { startSyncWorker, type WorkerClient } from './host';
import type { PresenceUser } from './presence';

export type CollabRole = 'edit' | 'comment' | 'view';

export interface CollabOptions {
  /** `serveSyncWorker(self)`를 돌리는 Worker, 또는 만드는 함수 (함수면 뗄 때 이 플러그인이 끝낸다) */
  worker: Worker | (() => Worker);
  /** 동기화 서버의 방 주소 (`ws://서버/방`, 권한 토큰은 `?token=`) */
  url: string;
  /** 나 (이름, 색: 협업 팔레트 번호 '1'–'8' 또는 CSS 색) */
  user: PresenceUser;
  /** CRDT 피어 번호 (기본: 무작위) */
  peer?: number;
  /** 빈 방이면 이 글로 시작한다 */
  text?: string;
  /** 보낼 변경을 모으는 시간 (ms) */
  batchMs?: number;
  /** 연결해 공유 문서를 편집기에 넣은 뒤 */
  onReady?(client: WorkerClient): void;
  /** 연결 상태 (끊기면 다시 연결하고, 그동안의 편집은 다시 붙을 때 합친다) */
  onStatus?(online: boolean, detail?: string): void;
  /** 서버가 정한 내 역할 (편집기 권한은 이 플러그인이 맞춘다) */
  onRole?(role: CollabRole): void;
  /** 문서가 새 판으로 바뀌었다 (편집기 문서는 이 플러그인이 바꾼다). lost: 끊긴 동안의 편집을 살리지 못함 */
  onReset?(lost: boolean): void;
  /** 다른 사람의 캐럿·접속이 바뀌었다 (접속자 목록 등) */
  onPresence?(client: WorkerClient): void;
}

export interface CollabPlugin extends QuirePlugin {
  /** 연결된 클라이언트 (연결 전·뗀 뒤 null) */
  readonly client: WorkerClient | null;
  /** 연결해 공유 문서를 편집기에 넣으면 풀린다 */
  readonly ready: Promise<WorkerClient>;
}

/** 협업 플러그인을 만든다 */
export function collab(opts: CollabOptions): CollabPlugin {
  let client: WorkerClient | null = null;
  let resolveReady!: (c: WorkerClient) => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<WorkerClient>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  ready.catch(() => {}); // 쓰지 않는 앱에서 처리되지 않은 거부가 되지 않게
  let attached = false;

  return {
    name: 'collab',
    get client() {
      return client;
    },
    ready,
    init(ctx) {
      if (attached) throw new Error('collab: 플러그인 하나는 편집기 하나에만 붙인다');
      attached = true;
      let closed = false;
      const offs: Array<() => void> = [];
      const ownWorker = typeof opts.worker === 'function';
      const worker = typeof opts.worker === 'function' ? opts.worker() : opts.worker;
      ctx.sync.setAccess('view');
      const peer = opts.peer ?? 1 + Math.floor(Math.random() * 2 ** 40);
      const carets = () => {
        if (client) ctx.sync.setRemoteCarets(client.remotes());
      };
      startSyncWorker(
        worker,
        { mode: 'ws', peer, user: opts.user, url: opts.url, text: opts.text ?? '', ...(opts.batchMs !== undefined ? { batchMs: opts.batchMs } : {}) },
        {
          onRemoteChange: () => {
            if (!client || closed) return;
            ctx.sync.documentChanged();
            carets();
          },
          onPresence: () => {
            if (!client || closed) return;
            carets();
            opts.onPresence?.(client);
          },
          onStatus: (online, detail) => opts.onStatus?.(online, detail),
          onRole: (role) => {
            if (closed) return;
            ctx.sync.setAccess(role);
            opts.onRole?.(role);
          },
          onReset: (lost) => {
            if (!client || closed) return;
            ctx.sync.setDocument(client.document);
            carets();
            opts.onReset?.(lost);
          },
        },
      ).then(
        (c) => {
          if (closed) {
            c.close();
            return;
          }
          client = c;
          ctx.sync.setDocument(c.document);
          ctx.sync.setAccess(c.role);
          carets();
          // 내 편집 뒤 다른 사람 캐럿 자리를 다시 (공유 위치가 따라간다), 내 선택은 서버로 (14 §7: 셀·머리말은 그 스토리와 쪽)
          offs.push(ctx.on('change', carets));
          offs.push(
            ctx.on('selection', () => {
              const s = ctx.selection();
              c.setSelection(s.anchor, s.head, s.story, s.page);
            }),
          );
          resolveReady(c);
          opts.onReady?.(c);
        },
        (e) => rejectReady(e),
      );
      return () => {
        closed = true;
        for (const off of offs.splice(0)) off();
        client?.close();
        client = null;
        if (ownWorker) worker.terminate();
      };
    },
  };
}
