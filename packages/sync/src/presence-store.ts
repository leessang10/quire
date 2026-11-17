/**
 * 프레즌스 저장소 (09 §7): 피어 키 → 상태. 키마다 그 피어만 쓰므로 보내는 쪽 일련번호가 큰 쪽이 이긴다
 * (Loro EphemeralStore는 같은 밀리초 안의 연속 갱신을 받는 쪽에서 버려 쓰지 않았다).
 * 받는 쪽 시계로 timeout 동안 소식이 없는 피어는 지운다. 같은 스레드 Presence와 Worker 코어가 함께 쓴다.
 */
export interface PresenceState {
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

export class PresenceStore {
  /** 다시 시작한 피어의 번호가 이전 것보다 크도록 시각에서 시작한다 */
  private seq = Date.now() * 1000;
  private local: PresenceState | null = null;
  readonly states = new Map<string, PresenceState>();
  /** 키별 마지막으로 받은 일련번호 (떠난 피어 포함: 늦게 온 옛 상태를 버린다) */
  private readonly seqs = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  /** 다른 피어 상태가 바뀔 때마다 증가 */
  version = 0;

  constructor(
    readonly key: string,
    readonly timeout = 30000,
  ) {}

  get hasLocal(): boolean {
    return this.local !== null;
  }

  /** 자기 상태를 바꾸고 보낼 바이트를 돌려준다 (null = 떠남) */
  setLocal(state: PresenceState | null): Uint8Array {
    this.local = state;
    this.seq++;
    return this.encodeLocal();
  }

  /** 자기 상태를 다시 보낼 바이트 (일련번호를 올린다: 하트비트) */
  refresh(): Uint8Array {
    this.seq++;
    return this.encodeLocal();
  }

  encodeLocal(): Uint8Array {
    const s = this.local;
    const e: Entry = {
      k: this.key,
      s: this.seq,
      v: s ? { name: s.name, color: s.color, a: Array.from(s.anchor), h: Array.from(s.head) } : null,
    };
    return encoder.encode(JSON.stringify([e]));
  }

  /** 다른 피어의 업데이트를 받는다. 바뀐 것이 있으면 true */
  receive(bytes: Uint8Array): boolean {
    let entries: Entry[];
    try {
      entries = JSON.parse(decoder.decode(bytes)) as Entry[];
    } catch {
      return false;
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
        this.states.delete(e.k);
        this.seen.delete(e.k);
      }
      changed = true;
    }
    if (changed) this.version++;
    return changed;
  }

  /** 피어를 지운다 (연결이 끊긴 것을 중계 서버가 알려 올 때). 다시 오면 새 일련번호로 받는다 */
  forget(key: string): boolean {
    this.seqs.delete(key);
    this.seen.delete(key);
    const had = this.states.delete(key);
    if (had) this.version++;
    return had;
  }

  /** 오래 소식 없는 피어를 지운다. 지운 키 목록 */
  expire(now = Date.now()): string[] {
    const gone: string[] = [];
    for (const [k, t] of this.seen) if (now - t > this.timeout) gone.push(k);
    for (const k of gone) {
      this.states.delete(k);
      this.seen.delete(k);
    }
    if (gone.length) this.version++;
    return gone;
  }
}
