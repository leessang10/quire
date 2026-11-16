/**
 * 편집 모델(Doc) ↔ Loro 브리지 (09 §2, §4)
 *
 * - Doc이 화면의 원본이다. 로컬 편집은 Doc에 먼저 반영되고, Doc의 변경 기록(UTF-16 위치)을 받아
 *   같은 변경을 Loro 텍스트에 바로 적용한다 (Loro 로컬 입력 + 커밋은 0.1 ms 미만).
 * - 업데이트 내보내기·가져오기는 batchMs마다 한 번으로 묶는다 (큰 문서에서 1회 고정 비용이 크다).
 * - 원격 업데이트를 가져오면 Loro 텍스트 델타를 Doc에 적용한다.
 *
 * 1단계 한계: 구획(문단 이동·숨김)은 동기화하지 않는다 → 브리지가 붙은 Doc은 구획 연산을 거부한다.
 */
import { LoroDoc, type LoroEventBatch, type LoroText, type VersionVector } from 'loro-crdt';
import { Doc, type RawChange, type TextDelta } from '@quire/model';

const TEXT = 'body';
const LOCAL_ORIGIN = 'quire-local';

export interface SyncOptions {
  /** 이 피어의 ID (피어마다 달라야 한다) */
  peer: number | bigint | `${number}`;
  /** 내보낼 업데이트가 생기면 호출된다 (묶음 단위) */
  onUpdate?: (update: Uint8Array) => void;
  /** 원격 업데이트를 Doc에 반영한 뒤 호출된다 (화면 갱신용) */
  onRemoteChange?: () => void;
  /** 내보내기·가져오기 묶음 간격 (ms). null이면 자동으로 하지 않고 flush()를 직접 부른다 */
  batchMs?: number | null;
}

export class SyncBridge {
  readonly doc: Doc;
  readonly loro: LoroDoc;
  private readonly text: LoroText;
  private readonly opts: SyncOptions;
  /** 마지막으로 내보낸 시점의 버전 (그 사이 가져온 원격 연산 포함) */
  private exported: VersionVector;
  private inbox: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribe: () => void;
  private destroyed = false;

  /** 새 문서를 만든다 (처음 만드는 피어) */
  static create(text: string, opts: SyncOptions): SyncBridge {
    const doc = Doc.fromText(text);
    const loro = newLoro(opts.peer);
    loro.getText(TEXT).insert(0, doc.rawText());
    loro.commit();
    return new SyncBridge(doc, loro, opts);
  }

  /** 다른 피어가 내보낸 스냅샷에서 시작한다 */
  static fromSnapshot(snapshot: Uint8Array, opts: SyncOptions): SyncBridge {
    const loro = newLoro(opts.peer);
    loro.import(snapshot);
    const raw = loro.getText(TEXT).toString();
    if (!raw.endsWith('\n')) throw new Error('snapshot text must end with a paragraph mark');
    return new SyncBridge(Doc.fromText(raw.slice(0, -1)), loro, opts);
  }

  private constructor(doc: Doc, loro: LoroDoc, opts: SyncOptions) {
    this.doc = doc;
    this.loro = loro;
    this.opts = opts;
    this.text = loro.getText(TEXT);
    this.exported = loro.oplogVersion();
    doc.segmentsEnabled = false;
    doc.observe((c) => this.onLocal(c));
    this.unsubscribe = loro.subscribe((e) => this.onEvent(e));
  }

  /** 전체 스냅샷 (새 피어가 참여할 때) */
  snapshot(): Uint8Array {
    return this.loro.export({ mode: 'snapshot' });
  }

  /** 원격 업데이트를 받는다. 다음 묶음 때 적용한다 */
  receive(update: Uint8Array): void {
    this.inbox.push(update);
    this.schedule();
  }

  /**
   * 묶음 처리: 지난번 이후의 로컬 변경을 내보내고, 받아 둔 원격 업데이트를 가져와 Doc에 적용한다.
   * 내보내기를 먼저 해야 이번에 가져온 원격 연산이 다음 내보내기에 섞이지 않는다.
   */
  flush(): void {
    if (this.destroyed) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const now = this.loro.oplogVersion();
    if (now.compare(this.exported) !== 0) {
      const update = this.loro.export({ mode: 'update', from: this.exported });
      this.opts.onUpdate?.(update);
    }
    if (this.inbox.length > 0) {
      const batch = this.inbox;
      this.inbox = [];
      this.loro.importBatch(batch);
      this.opts.onRemoteChange?.();
    }
    this.exported = this.loro.oplogVersion();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.unsubscribe();
    this.doc.observe(null);
    this.doc.segmentsEnabled = true;
  }

  private onLocal(c: RawChange): void {
    if (c.kind === 'insert') this.text.insert(c.at, c.text);
    else this.text.delete(c.at, c.len);
    this.loro.commit({ origin: LOCAL_ORIGIN });
    this.schedule();
  }

  private onEvent(e: LoroEventBatch): void {
    // 로컬 커밋은 이미 Doc에 반영되어 있다. 가져오기는 'import', 여러 업데이트를 한꺼번에 가져오면
    // (importBatch) 'checkout'으로 온다 → 로컬이 아닌 것은 모두 적용한다.
    if (e.by === 'local') return;
    for (const ev of e.events) {
      if (ev.target !== this.text.id || ev.diff.type !== 'text') continue;
      this.doc.applyDelta(ev.diff.diff as TextDelta);
    }
  }

  private schedule(): void {
    const ms = this.opts.batchMs === undefined ? 50 : this.opts.batchMs;
    if (ms === null || this.timer !== null || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, ms);
  }
}

function newLoro(peer: SyncOptions['peer']): LoroDoc {
  const loro = new LoroDoc();
  loro.setPeerId(peer);
  return loro;
}
