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
 * - 새 판 (09 §9): Worker가 hold를 보내면 보낸 묶음이 끝난 뒤 held로 답하고 그 뒤로는 보내지 않는다. 그때의 화면 텍스트를
 *   기억해 두었다가 reset을 받으면 새 Doc을 만들고, held 뒤에 한 로컬 변경(텍스트 차이)을 새 Doc에 다시 적용한다.
 */
import { Doc, Document, type Position, type RawChange, type SegState, type TableChange, type TableRecord } from '@quire/model';
import { applyHunks, diffText, rebaseHunks } from './epoch';
import { mapPosThrough, opToDelta, transform, type LocalChange } from './ot';
import type { Defs, RemoteSel, StoryDelta, StoryInit, ToMain, ToWorker } from './protocol';
import { applyFormats, type FormatState } from './shape';
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
  /** 문서가 새 판으로 바뀌었다: client.doc이 새 Doc이다 (편집기에 setDoc). lost: 옛 판의 로컬 변경을 살리지 못함 */
  onReset?: (lost: boolean) => void;
}

const isSeg = (c: LocalChange) => c.kind === 'order' || c.kind === 'list' || c.kind === 'hidden' || c.kind === 'flag';
/** 스타일·목록 정의 변경 (Worker의 정의 상태는 통째로 오므로 구획 상태처럼 다룬다) */
const isDef = (c: LocalChange) => c.kind === 'style' || c.kind === 'listDef' || c.kind === 'sectionDef';
/** 가벼운 스토리 끝 ¶ 속성 변경 (Worker의 끝 ¶ 맵 상태는 통째로 오므로 구획 상태처럼 다룬다) */
const isTail = (c: LocalChange) => c.kind === 'tail';
/** 표 레코드 변경 (Worker의 표 레코드는 통째로 오므로 미룬다) */
const tableOf = (c: LocalChange) => (c.kind === 'tableList' || c.kind === 'tableMap' ? c.table : null);

export class SyncClient {
  private current: Doc;
  /** 본문 + 스토리들 (11 §2.5). 처음 상태에 있던 스토리와, 그 뒤 연산이 오거나 로컬에서 연 스토리 */
  private currentDocument!: Document;
  /** 로컬 구획 변경이 아직 가는 중이라 미룬 스토리 구획 상태 */
  private deferredStories = new Map<string, SegState>();
  private deferredTails = new Map<string, Record<string, unknown>>();
  private deferredTables = new Map<string, TableRecord>();
  private readonly opts: ClientOptions;
  /** 받은 H 항목 수 */
  private rev = 0;
  /** 보내고 답을 기다리는 묶음 */
  private outstanding: LocalChange[] | null = null;
  private buffer: LocalChange[] = [];
  /** 로컬 구획 변경이 아직 Worker에 닿지 않아 미룬 구획 상태 */
  private deferredState: SegState | null = null;
  /** 로컬 정의 변경이 아직 Worker에 닿지 않아 미룬 정의 상태 */
  private deferredDefs: Defs | null = null;
  private readonly remotePos = new Map<string, { name: string; color: string; anchor: Position; head: Position }>();
  private presenceVersion = 0;
  private cache: { docVersion: number; presenceVersion: number; list: RemoteSelection[] } | null = null;
  /** hold를 받음 / held를 보냄 (그때의 화면 텍스트) */
  private holding = false;
  private heldText: string | null = null;

  /** Worker의 init 메시지로 만든다 */
  constructor(init: Extract<ToMain, { t: 'init' }>, opts: ClientOptions) {
    this.opts = opts;
    this.current = this.attach(init);
  }

  get doc(): Doc {
    return this.current;
  }

  get document(): Document {
    return this.currentDocument;
  }

  /** 스토리 (없으면 빈 가벼운 스토리) */
  story(id: string): Doc {
    return this.currentDocument.story(id);
  }

  private attach(init: {
    raw: string;
    keys: string[];
    state: SegState;
    peer: string;
    formats: FormatState;
    stories?: Record<string, StoryInit>;
    tables?: Record<string, TableRecord>;
  }): Doc {
    const doc = Doc.fromRaw(init.raw, init.keys, init.state, init.peer);
    applyFormats(doc, init.formats);
    const stories = init.stories ?? {};
    const make = (id: string): Doc => {
      const si = stories[id];
      const empty: SegState = { order: [], hidden: [], placeholder: [], used: [] };
      const d = Doc.fromRaw(si?.raw ?? '', si?.keys ?? [], si?.state ?? empty, init.peer, true);
      if (si) {
        applyFormats(d, si.formats);
        for (const [k, v] of Object.entries(si.tail)) d.applyTail(k, v);
        d.takeParagraphChanges();
      }
      return d;
    };
    const document = new Document(doc, make);
    for (const id of Object.keys(stories)) document.story(id);
    for (const t of Object.values(init.tables ?? {})) document.putTable(t);
    document.takeDirtyTables();
    document.observe((story: string | null, c: RawChange | TableChange) => {
      this.buffer.push(story === null ? c : { ...c, story });
      this.send();
    });
    this.currentDocument = document;
    return doc;
  }

  /** 보내고 답을 기다리거나 대기 중인 로컬 변경이 있는가 */
  get pending(): boolean {
    return this.outstanding !== null || this.buffer.length > 0;
  }

  /** 이 피어의 선택 영역 (화면 오프셋). Worker가 Loro 커서로 만들어 다른 피어에게 보낸다 */
  setSelection(anchor: number, head: number): void {
    const sel: LocalChange = { kind: 'sel', anchor: this.current.u16OfOffset(anchor), head: this.current.u16OfOffset(head) };
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
        this.takeDefs(msg.defs ?? null);
        this.takeStories(msg.stories ?? {});
        this.takeTables(msg.tables ?? {});
        this.send();
        break;
      case 'remote': {
        this.rev++;
        let ops = msg.ops;
        if (this.outstanding) [this.outstanding, ops] = transform(this.outstanding, ops);
        [this.buffer, ops] = transform(this.buffer, ops);
        for (const op of ops) (op.story !== undefined ? this.currentDocument.story(op.story) : this.current).applyDelta(opToDelta(op));
        if (msg.state) this.takeState(msg.state);
        if (msg.defs) this.takeDefs(msg.defs);
        if (msg.stories) this.takeStories(msg.stories);
        if (msg.tables) this.takeTables(msg.tables);
        this.opts.onRemoteChange?.();
        break;
      }
      case 'remotes':
        this.takeRemotes(msg.list);
        break;
      case 'status':
        this.opts.onStatus?.(msg.online, msg.detail);
        break;
      case 'hold':
        this.holding = true;
        this.send();
        break;
      case 'reset':
        this.reset(msg);
        break;
      default:
        break;
    }
  }

  /** 원격 피어들의 선택 영역 (지금 Doc 기준 화면 오프셋) */
  remotes(): RemoteSelection[] {
    const c = this.cache;
    if (c && c.docVersion === this.current.version && c.presenceVersion === this.presenceVersion) return c.list;
    const list: RemoteSelection[] = [];
    for (const [key, r] of this.remotePos) {
      list.push({ key, name: r.name, color: r.color, anchor: this.current.resolve(r.anchor), head: this.current.resolve(r.head) });
    }
    this.cache = { docVersion: this.current.version, presenceVersion: this.presenceVersion, list };
    return list;
  }

  private send(): void {
    if (this.holding) {
      // held를 보낸 뒤로는 보내지 않는다. 그 전에는 대기열의 문서 변경을 마저 보내, held 때 Worker와 Doc이 같게 한다
      if (this.heldText !== null || this.outstanding !== null) return;
      if (!this.buffer.some((c) => c.kind !== 'sel')) {
        this.heldText = this.current.text();
        this.opts.post({ t: 'held' });
        return;
      }
    }
    if (this.outstanding !== null || this.buffer.length === 0) return;
    const changes = this.buffer;
    this.buffer = [];
    this.outstanding = changes;
    const wantState =
      this.deferredState !== null ||
      this.deferredDefs !== null ||
      this.deferredStories.size > 0 ||
      this.deferredTails.size > 0 ||
      this.deferredTables.size > 0 ||
      changes.some(isSeg) ||
      changes.some(isDef) ||
      changes.some(isTail) ||
      changes.some((c) => tableOf(c) !== null);
    this.opts.post({ t: 'ops', rev: this.rev, changes, wantState });
  }

  /** 새 판: Doc을 새로 만들고 held 뒤의 로컬 변경을 다시 적용한다 */
  private reset(msg: Extract<ToMain, { t: 'reset' }>): void {
    const base = this.heldText;
    const ours = base !== null ? diffText(base, this.current.text()) : [];
    this.currentDocument.observe(null);
    this.rev = 0;
    this.outstanding = null;
    this.buffer = [];
    this.deferredState = null;
    this.deferredDefs = null;
    this.deferredStories.clear();
    this.deferredTails.clear();
    this.deferredTables.clear();
    this.remotePos.clear();
    this.cache = null;
    this.presenceVersion++;
    this.holding = false;
    this.heldText = null;
    this.current = this.attach(msg);
    // held 뒤 로컬 변경을 새 문서(다른 피어의 옛 판 변경이 더해졌을 수 있음) 좌표로 옮겨 적용한다
    if (ours.length > 0) applyHunks(this.current, rebaseHunks(ours, diffText(base!, this.current.text())));
    this.opts.onReset?.(msg.lost);
    this.opts.onPresence?.();
  }

  /** Worker의 구획 상태: 로컬 구획 변경이 아직 가는 중이면 미룬다 */
  private takeState(state: SegState | null): void {
    const candidate = state ?? this.deferredState;
    if (!candidate) return;
    const bodySeg = (c: LocalChange) => c.story === undefined && isSeg(c);
    const segPending = (this.outstanding?.some(bodySeg) ?? false) || this.buffer.some(bodySeg);
    if (segPending) {
      this.deferredState = candidate;
      return;
    }
    this.deferredState = null;
    this.current.applySegState(candidate);
    this.opts.onRemoteChange?.();
  }

  /** 스토리 상태 (구획·끝 ¶ 속성). 그 스토리의 로컬 구획 변경이 아직 가는 중이면 구획 상태는 미룬다 */
  private takeStories(stories: Record<string, StoryDelta>): void {
    const pending = (id: string, f: (c: LocalChange) => boolean) =>
      (this.outstanding?.some((c) => c.story === id && f(c)) ?? false) || this.buffer.some((c) => c.story === id && f(c));
    const segPending = (id: string) => pending(id, isSeg);
    const ids = new Set([...Object.keys(stories), ...this.deferredStories.keys(), ...this.deferredTails.keys()]);
    for (const id of ids) {
      const d = stories[id];
      const doc = this.currentDocument.story(id);
      const tail = d?.tail ?? this.deferredTails.get(id);
      if (tail) {
        if (pending(id, isTail)) this.deferredTails.set(id, tail);
        else {
          this.deferredTails.delete(id);
          doc.applyTailAll(tail);
        }
      }
      const state = d?.state ?? this.deferredStories.get(id);
      if (!state) continue;
      if (segPending(id)) {
        this.deferredStories.set(id, state);
        continue;
      }
      this.deferredStories.delete(id);
      doc.applySegState(state);
    }
  }

  /** Worker의 표 레코드: 그 표의 로컬 변경이 아직 가는 중이면 미룬다 */
  private takeTables(tables: Record<string, TableRecord>): void {
    const pending = (id: string) => (this.outstanding?.some((c) => tableOf(c) === id) ?? false) || this.buffer.some((c) => tableOf(c) === id);
    const ids = new Set([...Object.keys(tables), ...this.deferredTables.keys()]);
    for (const id of ids) {
      const t = tables[id] ?? this.deferredTables.get(id)!;
      if (pending(id)) {
        this.deferredTables.set(id, t);
        continue;
      }
      this.deferredTables.delete(id);
      this.currentDocument.applyRemoteTable(t);
    }
  }

  /** Worker의 정의 상태: 로컬 정의 변경이 아직 가는 중이면 미룬다 */
  private takeDefs(defs: Defs | null): void {
    const candidate = defs ?? this.deferredDefs;
    if (!candidate) return;
    if ((this.outstanding?.some(isDef) ?? false) || this.buffer.some(isDef)) {
      this.deferredDefs = candidate;
      return;
    }
    this.deferredDefs = null;
    this.current.applyRemoteDefs(candidate.styles ?? {}, candidate.lists ?? {}, candidate.sections ?? {});
    this.opts.onRemoteChange?.();
  }

  private takeRemotes(list: RemoteSel[]): void {
    const pending = [...(this.outstanding ?? []), ...this.buffer];
    const max = this.current.maxCaret;
    const keys = new Set<string>();
    for (const r of list) {
      keys.add(r.key);
      const prev = this.remotePos.get(r.key);
      if (r.anchor === null || r.head === null) {
        // 아직 풀 수 없음: 이전 자리 유지
        if (prev) this.remotePos.set(r.key, { ...prev, name: r.name, color: r.color });
        continue;
      }
      const at = (u: number) => this.current.positionAt(Math.min(max, this.current.offsetOfU16(mapPosThrough(u, pending))));
      this.remotePos.set(r.key, { name: r.name, color: r.color, anchor: at(r.anchor), head: at(r.head) });
    }
    for (const k of [...this.remotePos.keys()]) if (!keys.has(k)) this.remotePos.delete(k);
    this.presenceVersion++;
    this.opts.onPresence?.();
  }
}
