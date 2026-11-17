/**
 * 프레즌스: 피어마다 이름·색·선택 영역을 주고받는다 (09 §7).
 *
 * - 선택 영역의 두 끝은 공유 위치(Loro 커서)로 보낸다. 받는 쪽은 자기 Loro에서 현재 위치를 구해 화면 오프셋으로 바꾼다.
 * - 상태는 문서 기록에 남지 않는다. 키(피어)마다 그 피어만 쓰므로, 보내는 피어의 일련번호가 큰 쪽이 이긴다.
 *   Loro EphemeralStore는 같은 밀리초 안의 연속 갱신을 받는 쪽에서 버려(시각 기준 비교) 캐럿에는 쓸 수 없었다.
 * - 소식이 timeoutMs 동안 없는 피어는 지운다 (받는 쪽 시계 기준). 자기 상태는 그 절반마다 다시 보낸다.
 * - 보내는 순서: 캐럿은 방금 입력한 글자에 붙는 일이 많다. 그 글자가 담긴 문서 업데이트보다 프레즌스가 먼저 가면
 *   받는 쪽이 위치를 풀 수 없으므로, 아직 내보내지 않은 로컬 변경이 있으면 다음 묶음 처리(flush) 뒤에 보낸다.
 * - 그래도 풀 수 없는 경우(다른 피어를 거쳐 오는 연산 등)에는 마지막으로 푼 자리를 Doc 위치로 들고 있다가 쓴다.
 */
import type { Position } from '@quire/model';
import type { SyncBridge } from './bridge';

export interface PresenceUser {
  name: string;
  /** CSS 색 (#rrggbb) */
  color: string;
}

/** 화면 오프셋으로 푼 다른 피어의 선택 영역 */
export interface RemoteSelection {
  key: string;
  name: string;
  color: string;
  anchor: number;
  head: number;
}

export interface PresenceOptions {
  user: PresenceUser;
  /** 다른 피어에게 보낼 프레즌스 업데이트 */
  onUpdate?: (bytes: Uint8Array) => void;
  /** 다른 피어의 프레즌스가 바뀌었을 때 (화면 갱신용) */
  onChange?: () => void;
  /** 이 시간(ms) 동안 소식이 없는 피어는 사라진다. 자기 상태는 그 절반마다 다시 보낸다. 기본 30000 */
  timeoutMs?: number;
}

interface State {
  name: string;
  color: string;
  /** 인코딩한 Loro 커서 */
  anchor: Uint8Array;
  head: Uint8Array;
}

/** 전송 단위: 키, 일련번호, 상태(null = 떠남) */
interface Entry {
  k: string;
  s: number;
  v: { name: string; color: string; a: number[]; h: number[] } | null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Presence {
  readonly key: string;
  private readonly opts: PresenceOptions;
  private readonly timeout: number;
  /** 다시 시작한 피어의 번호가 이전 것보다 크도록 시각에서 시작한다 */
  private seq = Date.now() * 1000;
  private local: State | null = null;
  private readonly states = new Map<string, State>();
  /** 키별 마지막으로 받은 일련번호 (떠난 피어 포함: 늦게 온 옛 상태를 버린다) */
  private readonly seqs = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  /** 다음 flush 뒤에 보낼 로컬 상태 */
  private held = false;
  /** 피어별 마지막으로 푼 자리 (풀 수 없을 때 대신 쓴다) */
  private readonly last = new Map<string, { anchor: Position; head: Position }>();
  private readonly offFlush: () => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private destroyed = false;
  /** remotes() 결과 캐시: 문서 판·프레즌스 판이 같으면 다시 풀지 않는다 */
  private cache: { docVersion: number; stateVersion: number; list: RemoteSelection[] } | null = null;
  private stateVersion = 0;

  constructor(
    private readonly bridge: SyncBridge,
    opts: PresenceOptions,
  ) {
    this.opts = opts;
    this.key = bridge.loro.peerIdStr;
    this.timeout = opts.timeoutMs ?? 30000;
    this.offFlush = bridge.onFlush(() => {
      if (!this.held) return;
      this.held = false;
      this.send();
    });
    this.timer = setInterval(() => this.tick(), this.timeout / 2);
  }

  /** 이 피어의 선택 영역 (화면 오프셋) */
  setSelection(anchor: number, head: number): void {
    if (this.destroyed) return;
    const { name, color } = this.opts.user;
    const a = this.bridge.cursorAt(anchor);
    this.local = { name, color, anchor: a, head: anchor === head ? a : this.bridge.cursorAt(head) };
    this.seq++;
    if (this.bridge.pendingExport) this.held = true;
    else this.send();
  }

  /** 다른 피어의 프레즌스 업데이트를 받는다 */
  receive(bytes: Uint8Array): void {
    if (this.destroyed) return;
    let entries: Entry[];
    try {
      entries = JSON.parse(decoder.decode(bytes)) as Entry[];
    } catch {
      return;
    }
    const now = Date.now();
    let changed = false;
    for (const e of entries) {
      if (e.k === this.key || !(e.s > (this.seqs.get(e.k) ?? -1))) continue;
      this.seqs.set(e.k, e.s);
      if (e.v) {
        this.states.set(e.k, { name: e.v.name, color: e.v.color, anchor: Uint8Array.from(e.v.a), head: Uint8Array.from(e.v.h) });
        this.seen.set(e.k, now);
      } else {
        this.forget(e.k);
      }
      changed = true;
    }
    if (changed) {
      this.stateVersion++;
      this.opts.onChange?.();
    }
  }

  /** 새로 참여한 피어에게 보낼 전체 상태 (이 피어 것만; 각 피어가 자기 상태를 보낸다) */
  encodeAll(): Uint8Array {
    return this.encode();
  }

  /** 다른 피어들의 선택 영역을 지금 문서 기준 화면 오프셋으로 */
  remotes(): RemoteSelection[] {
    const doc = this.bridge.doc;
    const c = this.cache;
    if (c && c.docVersion === doc.version && c.stateVersion === this.stateVersion) return c.list;
    const out: RemoteSelection[] = [];
    const max = doc.maxCaret;
    for (const key of [...this.states.keys()].sort()) {
      const s = this.states.get(key)!;
      let anchor = this.bridge.resolveCursor(s.anchor);
      let head = s.head === s.anchor ? anchor : this.bridge.resolveCursor(s.head);
      const prev = this.last.get(key);
      if (anchor === null || head === null) {
        if (!prev) continue;
        anchor ??= doc.resolve(prev.anchor);
        head ??= doc.resolve(prev.head);
      }
      anchor = Math.min(anchor, max);
      head = Math.min(head, max);
      this.last.set(key, { anchor: doc.positionAt(anchor), head: doc.positionAt(head) });
      out.push({ key, name: s.name, color: s.color, anchor, head });
    }
    this.cache = { docVersion: doc.version, stateVersion: this.stateVersion, list: out };
    return out;
  }

  /** 떠날 때: 다른 피어에게서 이 피어를 지운다 */
  destroy(): void {
    if (this.destroyed) return;
    this.local = null;
    this.seq++;
    this.send();
    this.destroyed = true;
    clearInterval(this.timer);
    this.offFlush();
  }

  private encode(): Uint8Array {
    const s = this.local;
    const e: Entry = {
      k: this.key,
      s: this.seq,
      v: s ? { name: s.name, color: s.color, a: Array.from(s.anchor), h: Array.from(s.head) } : null,
    };
    return encoder.encode(JSON.stringify([e]));
  }

  private send(): void {
    this.opts.onUpdate?.(this.encode());
  }

  private forget(key: string): void {
    this.states.delete(key);
    this.seen.delete(key);
    this.last.delete(key);
  }

  /** 주기: 자기 상태를 다시 보내고, 오래 소식 없는 피어를 지운다 */
  private tick(): void {
    if (this.local && !this.held) {
      this.seq++;
      this.send();
    }
    const now = Date.now();
    let changed = false;
    for (const [k, t] of this.seen) {
      if (now - t > this.timeout) {
        this.forget(k);
        changed = true;
      }
    }
    if (changed) {
      this.stateVersion++;
      this.opts.onChange?.();
    }
  }
}
