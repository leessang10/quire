export { Doc, PARA, BRK_CHAR, MARK_KEYS, INHERITED_MARKS } from './doc';
export type { ElementId, Side, Position, ParagraphInfo, SegId, SegState, RawChange, TextDelta, MarkSet, MarkKey, ParaAttrs, ParaKey } from './doc';
export { History, applyOp, invertOp } from './history';
export type { Op, Selection, Transaction } from './history';
