/**
 * 메인 스레드 쪽 동기화 클라이언트 (09 §8): 화면의 원본인 Doc을 들고, Loro는 Worker의 SyncCore에 둔다.
 *
 * - 로컬 편집은 Doc에 바로 반영되고, 변경 기록(UTF-16 위치)을 Worker로 보낸다. 한 번에 한 묶음만 보내고,
 *   답(ack)을 받기 전의 변경은 대기열에 쌓았다가 다음 묶음으로 보낸다.
 * - Worker가 보낸 원격 변경은 보낸 묶음과 대기열에 대해 변환해 Doc에 적용하고, 보낸 묶음·대기열도 원격 변경 뒤의
 *   좌표로 바꾼다 (ot.ts).
 * - 구획 상태(순서·숨김·자리표시)는 Worker가 통째로 보낸다. 아직 Worker에 닿지 않은 로컬 구획 변경이 있으면
 *   그 상태는 옛것이므로 미루고, 로컬 구획 변경이 반영된 상태를 ack로 받아 적용한다.
 * - 원격 캐럿은 Worker가 푼 UTF-16 위치를 보낸 묶음·대기열만큼 옮긴 뒤 Doc 위치로 바꿔 둔다.
 */
import { Doc, type Position, type RawChange, type SegState } from '@quire/model';
import { mapPosThrough, opToDelta, transform, type LocalChange } from './ot';
import type { RemoteSel, ToMain, ToWorker } from './protocol';
import type { RemoteSelection } from './presence';

export interface ClientOptions {
  /** Worker로 메시지를 보낸다 */
  post: (msg: ToWorker) => void;
  /** 원격 변경을 Doc에 반영한 뒤 (화면 갱신) */
  onRemoteChange?: () => void;
  /** 원격 캐럿이 바뀌었을 때 */
  onPresence?: () => void;
  /** 연결 상태가 바뀌었을 때 (WebSocket 모드) */
  onStatus?: (online: boolean, detail?: string) => void;
}

const isSeg = (c: LocalChange) => c.kind === 'order' || c.kind === 'list' || c.kind === 'hidden' || c.kind === 'flag';

export class SyncClient {
  readonly doc: Doc;
  private readonly opts: ClientOptions;
  /** 받은 H 항목 수 */
  private rev = 0;
  /** 보내고 답을 기다리는 묶음 */
  private outstanding: LocalChange[] | null = null;
  private buffer: LocalChange[] = [];
  /** 로컬 구획 변경이 아직 Worker에 닿지 않아 미룬 구획 상태 */
  private deferredState: SegState | null = null;
  private readonly remotePos = new Map<string, { name: string; color: string; anchor: Position; head: Position }>();
  private presenceVersion = 0;
  private cache: { docVersion: number; presenceVersion: number; list: RemoteSelection[] } | null = null;

  /** Worker의 init 메시지로 만든다 */
  constructor(init: Extract<ToMain, { t: 'init' }>, opts: ClientOptions) {
    this.opts = opts;
    this.doc = Doc.fromRaw(init.raw, init.keys, init.state, init.peer);
    this.doc.observe((c: RawChange) => {
      this.buffer.push(c);
      this.send();
    });
  }

  /** 보내고 답을 기다리거나 대기 중인 로컬 변경이 있는가 */
  get pending(): boolean {
    return this.outstanding !== null || this.buffer.length > 0;
  }

  /** 이 피어의 선택 영역 (화면 오프셋). Worker가 Loro 커서로 만들어 다른 피어에게 보낸다 */
  setSelection(anchor: number, head: number): void {
    const sel: LocalChange = { kind: 'sel', anchor: this.doc.u16OfOffset(anchor), head: this.doc.u16OfOffset(head) };
    // 아직 보내지 않은 옛 선택은 버린다
    this.buffer = this.buffer.filter((c) => c.kind !== 'sel');
    this.buffer.push(sel);
    this.send();
  }

  /** Worker에서 온 메시지 */
  handle(msg: ToMain): void {
    switch (msg.t) {
      case 'ack':
        this.rev++;
        this.outstanding = null;
        this.takeState(msg.state ?? null);
        this.send();
        break;
      case 'remote': {
        this.rev++;
        let ops = msg.ops;
        if (this.outstanding) [this.outstanding, ops] = transform(this.outstanding, ops);
        [this.buffer, ops] = transform(this.buffer, ops);
        for (const op of ops) this.doc.applyDelta(opToDelta(op));
        if (msg.state) this.takeState(msg.state);
        this.opts.onRemoteChange?.();
        break;
      }
      case 'remotes':
        this.takeRemotes(msg.list);
        break;
      case 'status':
        this.opts.onStatus?.(msg.online, msg.detail);
        break;
      default:
        break;
    }
  }

  /** 원격 피어들의 선택 영역 (지금 Doc 기준 화면 오프셋) */
  remotes(): RemoteSelection[] {
    const c = this.cache;
    if (c && c.docVersion === this.doc.version && c.presenceVersion === this.presenceVersion) return c.list;
    const list: RemoteSelection[] = [];
    for (const [key, r] of this.remotePos) {
      list.push({ key, name: r.name, color: r.color, anchor: this.doc.resolve(r.anchor), head: this.doc.resolve(r.head) });
    }
    this.cache = { docVersion: this.doc.version, presenceVersion: this.presenceVersion, list };
    return list;
  }

  private send(): void {
    if (this.outstanding !== null || this.buffer.length === 0) return;
    const changes = this.buffer;
    this.buffer = [];
    this.outstanding = changes;
    const wantState = this.deferredState !== null || changes.some(isSeg);
    this.opts.post({ t: 'ops', rev: this.rev, changes, wantState });
  }

  /** Worker의 구획 상태: 로컬 구획 변경이 아직 가는 중이면 미룬다 */
  private takeState(state: SegState | null): void {
    const candidate = state ?? this.deferredState;
    if (!candidate) return;
    const segPending = (this.outstanding?.some(isSeg) ?? false) || this.buffer.some(isSeg);
    if (segPending) {
      this.deferredState = candidate;
      return;
    }
    this.deferredState = null;
    this.doc.applySegState(candidate);
    this.opts.onRemoteChange?.();
  }

  private takeRemotes(list: RemoteSel[]): void {
    const pending = [...(this.outstanding ?? []), ...this.buffer];
    const max = this.doc.maxCaret;
    const keys = new Set<string>();
    for (const r of list) {
      keys.add(r.key);
      const prev = this.remotePos.get(r.key);
      if (r.anchor === null || r.head === null) {
        // 아직 풀 수 없음: 이전 자리 유지
        if (prev) this.remotePos.set(r.key, { ...prev, name: r.name, color: r.color });
        continue;
      }
      const at = (u: number) => this.doc.positionAt(Math.min(max, this.doc.offsetOfU16(mapPosThrough(u, pending))));
      this.remotePos.set(r.key, { name: r.name, color: r.color, anchor: at(r.anchor), head: at(r.head) });
    }
    for (const k of [...this.remotePos.keys()]) if (!keys.has(k)) this.remotePos.delete(k);
    this.presenceVersion++;
    this.opts.onPresence?.();
  }
}
