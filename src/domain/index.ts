// md-dragger/domain — pure calculation layer.
// Public surface: host-facing types and plan/edit/parse APIs only.
// Internals (line-map, guards, capture details) stay unexported.

// --- document ---
export type { Doc, DocLine, MarkerType } from './markdown/document-types';
export type { LineRange } from './markdown/line-range-types';

// --- block identity ---
export { BlockType, type Block, isContainerType } from './block/block-types';
export {
  detectBlock,
  detectBlockType,
  getHeadingLevel,
  getHeadingSectionRange,
} from './block/block-detector';
export { type ConvertTo, planConvert } from './block/block-type-conversion';

// --- selection ---
export {
  type BlockSelection,
  selectOne,
  selectBlocks,
  addBlocks,
  removeBlocks,
  hasBlock,
  selectionLineRanges,
} from './selection/block-selection';

// --- structure parse (not DocLine / not Block) ---
export {
  type Indent,
  type LineMarker,
  type ParsedLine,
  type ParsedBlock,
  parseLine,
  parseBlock,
  formatIndent,
  isListLine,
  listMarkerText,
  listMarkerType,
} from './parse';

// --- drop ---
export type { DropPosition } from './command/drop-position';
export {
  locateDropPosition,
  dropIndentWidth,
  type DropLocateInput,
} from './markdown/drop-locate';

// --- commands (type only; construct as object literals) ---
export type { BlockCommand } from './command/block-command';

// --- plan / edit ---
export { type Reject, type RejectReason, reject, isReject } from './result';
export {
  planMove,
  type MovePlan,
  type MoveResult,
  type PlanMoveInput,
} from './move/move-plan';
export { type TextChange, type DocEdit } from './transaction/block-transaction';
export { moveTx } from './transaction/move-blocks';
export { planDelete } from './transaction/delete-blocks';
