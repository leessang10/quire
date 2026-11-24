/**
 * 제품 구현(Q): @quiredoc/model의 Doc + @quiredoc/sync의 SyncBridge를 V4 시나리오·무작위 시험의 Replica로 감싼다.
 * 문단 이동·삭제는 Doc의 구획 연산(moveParagraphs, hideParagraphs), 실행 취소는 Doc의 History.
 */
import { History, type Doc, type Op } from '@quiredoc/model';
import { SyncBridge } from '@quiredoc/sync';
import type { Model, Replica } from './models';

class QuireReplica implements Replica {
  readonly doc;
  private readonly history = new History(0);
  private step = 0;

  constructor(readonly bridge: SyncBridge) {
    this.doc = bridge.loro;
  }

  private get d(): Doc {
    return this.bridge.doc;
  }

  private record(ops: Op[]): void {
    if (ops.length === 0) return;
    const s = { anchor: this.d.positionAt(0), head: this.d.positionAt(0) };
    this.history.record({ ops, before: s, after: s, time: this.step++ });
  }

  private start(p: number): number {
    return this.d.paragraphs()[p]!.start;
  }

  insertText(p: number, at: number, text: string): void {
    this.record([{ type: 'insert', ids: this.d.insertText(this.start(p) + at, text) }]);
  }

  deleteText(p: number, at: number, len: number): void {
    const a = this.start(p) + at;
    this.record(this.d.deleteRange(a, a + len));
  }

  split(p: number, at: number): void {
    this.insertText(p, at, '\n');
  }

  merge(p: number): void {
    const end = this.d.paragraphs()[p]!.end;
    this.record(this.d.deleteRange(end, end + 1));
  }

  /** 시나리오의 move(from, to): 옮긴 뒤 인덱스가 to가 되게 */
  move(from: number, to: number): void {
    const n = this.d.paragraphs().length;
    const target = to >= n - 1 ? n : to < from ? to : to + 1;
    this.record(this.d.moveParagraphs(from, from, target));
  }

  deletePara(p: number): void {
    this.record(this.d.hideParagraphs(p, p));
  }

  undo(): boolean {
    return this.history.undo(this.d) !== null;
  }

  paragraphs(): string[] {
    return this.d.paragraphs().map((p) => p.text);
  }

  invariantViolation(): string | null {
    try {
      this.d.checkInvariants();
      if (this.d.rawText() !== this.bridge.loro.getText('body').toString()) return 'Doc과 Loro 텍스트가 다름';
      const a = JSON.stringify(this.d.paragraphs());
      if (a !== JSON.stringify(this.d.paragraphsFromScratch())) return '문단 목록이 처음부터 계산한 것과 다름';
      return null;
    } catch (e) {
      return String(e).slice(0, 120);
    }
  }
}

export const Q: Model = {
  name: 'Q 제품 구현 (Doc + 브리지)',
  createBase(paragraphs) {
    const b = SyncBridge.create(paragraphs.join('\n'), { peer: 1, batchMs: null });
    const snap = b.snapshot();
    b.destroy();
    return snap;
  },
  replica(snapshot, peer) {
    return new QuireReplica(SyncBridge.fromSnapshot(snapshot, { peer, batchMs: null }));
  },
};
