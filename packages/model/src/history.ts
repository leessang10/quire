/**
 * 연산, 트랜잭션, 실행 취소 (0단계: 단일 사용자)
 * 설계: docs/design/01-document-model.md §5, 05-collaboration-and-history.md §4
 */
import type { Doc, ElementId, Position } from './doc';

/** 연산은 "어떤 원소들이 보이게/안 보이게 되었는가"로 기록한다 */
export type Op =
  | { type: 'insert'; ids: ElementId[] }
  | { type: 'delete'; ids: ElementId[] };

export interface Selection {
  anchor: Position;
  head: Position;
}

export interface Transaction {
  ops: Op[];
  before: Selection;
  after: Selection;
  /** 같은 mergeKey의 연속 트랜잭션은 실행 취소 단위로 합쳐진다 */
  mergeKey?: string;
  time: number;
}

export function applyOp(doc: Doc, op: Op): void {
  if (op.type === 'insert') doc.revive(op.ids);
  else doc.hide(op.ids);
}

export function invertOp(op: Op): Op {
  return op.type === 'insert' ? { type: 'delete', ids: op.ids } : { type: 'insert', ids: op.ids };
}

export class History {
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];

  constructor(private readonly mergeWindowMs = 1000) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(tr: Transaction): void {
    if (tr.ops.length === 0) return;
    this.redoStack = [];
    const last = this.undoStack[this.undoStack.length - 1];
    if (
      last &&
      tr.mergeKey !== undefined &&
      last.mergeKey === tr.mergeKey &&
      tr.time - last.time <= this.mergeWindowMs
    ) {
      last.ops.push(...tr.ops);
      last.after = tr.after;
      last.time = tr.time;
      return;
    }
    this.undoStack.push({ ...tr, ops: [...tr.ops] });
  }

  /** 끊어서 다음 트랜잭션이 합쳐지지 않게 한다 (캐럿 이동 등) */
  seal(): void {
    const last = this.undoStack[this.undoStack.length - 1];
    if (last) last.mergeKey = undefined;
  }

  undo(doc: Doc): Selection | null {
    const tr = this.undoStack.pop();
    if (!tr) return null;
    for (let i = tr.ops.length - 1; i >= 0; i--) applyOp(doc, invertOp(tr.ops[i]!));
    this.redoStack.push(tr);
    return tr.before;
  }

  redo(doc: Doc): Selection | null {
    const tr = this.redoStack.pop();
    if (!tr) return null;
    for (const op of tr.ops) applyOp(doc, op);
    this.undoStack.push(tr);
    return tr.after;
  }
}
