/**
 * 댓글 (14 §3): 댓글 주석(type 'comment', data.thread)과 스레드를 따로 둔다. 스레드·메시지는 평평한 키 표다 (동기화: Loro 맵
 * comments, 키마다 LWW). 14 §3.1의 메시지 리스트 대신 메시지마다 키를 두어, 동시 답글은 키가 달라 모두 남고 차례는 (시각, ID)로
 * 정한다. 고치기·지우기 표시도 키마다 LWW이므로 같은 때 고치고 지우면 둘 다 남는다.
 *
 * 키:
 *   <스레드>|anchor            주석 ID
 *   <스레드>|resolved          true (없으면 열림)
 *   <스레드>|deleted           true (지운 스레드: 표시만, 메시지는 남는다)
 *   <스레드>|m|<메시지>|author  { id, name, color }
 *   <스레드>|m|<메시지>|time    ms
 *   <스레드>|m|<메시지>|text    글 (평문, 줄바꿈 포함)
 *   <스레드>|m|<메시지>|edited  고친 시각 ms
 *   <스레드>|m|<메시지>|deleted true
 * 값 undefined = 키 없음. ID에는 '|'가 없다.
 */

/** 작성자 (4단계: 접속할 때의 사용자 정보) */
export interface CommentAuthor {
  id: string;
  name: string;
  color: string;
}

export interface CommentMessage {
  id: string;
  author: CommentAuthor;
  time: number;
  text: string;
  edited?: number;
  deleted?: boolean;
}

/** 스레드 (메시지는 시각, ID 순) */
export interface CommentThread {
  id: string;
  /** 댓글 주석 ID (없으면 null) */
  anchor: string | null;
  resolved: boolean;
  deleted: boolean;
  messages: CommentMessage[];
}

/** 댓글 키 변경 (Document → 동기화). value undefined = 지움 */
export interface CommentChange {
  kind: 'cmt';
  key: string;
  value: unknown;
}

const rand = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newThreadId(): string {
  return `t${rand()}`;
}

export function newMessageId(): string {
  return `m${rand()}`;
}

/** 키 → 스레드 ID (키 모양이 아니면 null) */
export function threadOfKey(key: string): string | null {
  const i = key.indexOf('|');
  return i > 0 ? key.slice(0, i) : null;
}

/** 평평한 키 표 → 스레드들 (ID 순). 메시지가 없거나 작성자·시각이 아직 없는 메시지는 건너뛴다 */
export function threadsFromKeys(keys: ReadonlyMap<string, unknown>): CommentThread[] {
  const threads = new Map<string, CommentThread>();
  const msgs = new Map<string, Map<string, Partial<CommentMessage>>>();
  for (const [key, value] of keys) {
    if (value === undefined) continue;
    const parts = key.split('|');
    const tid = parts[0]!;
    let t = threads.get(tid);
    if (!t) threads.set(tid, (t = { id: tid, anchor: null, resolved: false, deleted: false, messages: [] }));
    if (parts.length === 2) {
      if (parts[1] === 'anchor' && typeof value === 'string') t.anchor = value;
      else if (parts[1] === 'resolved') t.resolved = value === true;
      else if (parts[1] === 'deleted') t.deleted = value === true;
    } else if (parts.length === 4 && parts[1] === 'm') {
      let m = msgs.get(tid);
      if (!m) msgs.set(tid, (m = new Map()));
      let msg = m.get(parts[2]!);
      if (!msg) m.set(parts[2]!, (msg = { id: parts[2]! }));
      (msg as Record<string, unknown>)[parts[3]!] = value;
    }
  }
  for (const [tid, m] of msgs) {
    const t = threads.get(tid)!;
    for (const msg of m.values()) {
      if (!msg.author || typeof msg.time !== 'number') continue;
      t.messages.push({
        id: msg.id!,
        author: msg.author,
        time: msg.time,
        text: typeof msg.text === 'string' ? msg.text : '',
        ...(typeof msg.edited === 'number' ? { edited: msg.edited } : {}),
        ...(msg.deleted === true ? { deleted: true } : {}),
      });
    }
    t.messages.sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return [...threads.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** 스레드 → 키들 (정본 읽기, 새 판) */
export function keysOfThread(t: CommentThread): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  if (t.anchor !== null) out.push([`${t.id}|anchor`, t.anchor]);
  if (t.resolved) out.push([`${t.id}|resolved`, true]);
  if (t.deleted) out.push([`${t.id}|deleted`, true]);
  for (const m of t.messages) {
    const p = `${t.id}|m|${m.id}|`;
    out.push([p + 'author', m.author], [p + 'time', m.time], [p + 'text', m.text]);
    if (m.edited !== undefined) out.push([p + 'edited', m.edited]);
    if (m.deleted) out.push([p + 'deleted', true]);
  }
  return out;
}
