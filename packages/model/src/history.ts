/**
 * 연산, 트랜잭션, 실행 취소 (0단계: 단일 사용자)
 * 설계: docs/design/01-document-model.md §5, 05-collaboration-and-history.md §4
 */
import type { Op, Position } from './doc';

export type { Op } from './doc';

export interface Selection {
  anchor: Position;
  head: Position;
  /** 선택이 있는 스토리 (표 셀 등, 11 §2.5). 없으면 본문 */
  story?: string;
}

export interface Transaction {
  ops: Op[];
  before: Selection;
  after: Selection;
  /** 같은 mergeKey의 연속 트랜잭션은 실행 취소 단위로 합쳐진다 */
  mergeKey?: string;
  time: number;
}

/** 연산을 적용할 수 있는 것: Doc 하나, 또는 여러 스토리를 가진 Document */
export interface OpTarget {
  apply(op: Op): void;
}

export function applyOp(doc: OpTarget, op: Op): void {
  doc.apply(op);
}

export function invertOp(op: Op): Op {
  switch (op.type) {
    case 'insert':
      return { type: 'delete', ids: op.ids };
    case 'delete':
      return { type: 'insert', ids: op.ids };
    case 'move':
      // 옮긴 구획들을 옮기기 전 바로 뒤에 있던 구획 앞으로 (그 사이 다른 피어가 옮긴 구획은 건드리지 않음)
      return { type: 'move', segs: op.segs, before: op.back, back: op.before };
    case 'hidden':
      return { type: 'hidden', segs: op.segs, value: !op.value };
    case 'format':
      // 되돌리기: 지금 값이 after인 원소만 바꾸기 전 값으로 (10 §2.5, 05 §4)
      return { ...op, undo: !op.undo };
    case 'para':
      return { type: 'para', ctr: op.ctr, key: op.key, before: op.after, after: op.before };
    case 'style':
      return { type: 'style', name: op.name, before: op.after, after: op.before };
    case 'list':
      return { type: 'list', id: op.id, before: op.after, after: op.before };
    case 'obj':
      return { type: 'obj', ctr: op.ctr, key: op.key, before: op.after, after: op.before };
    case 'story':
      return { type: 'story', story: op.story, op: invertOp(op.op) };
    case 'tableMap':
      return { ...op, before: op.after, after: op.before };
  }
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

  undo(doc: OpTarget): Selection | null {
    const tr = this.undoStack.pop();
    if (!tr) return null;
    for (let i = tr.ops.length - 1; i >= 0; i--) applyOp(doc, invertOp(tr.ops[i]!));
    this.redoStack.push(tr);
    return tr.before;
  }

  redo(doc: OpTarget): Selection | null {
    const tr = this.redoStack.pop();
    if (!tr) return null;
    for (const op of tr.ops) applyOp(doc, op);
    this.undoStack.push(tr);
    return tr.after;
  }
}
