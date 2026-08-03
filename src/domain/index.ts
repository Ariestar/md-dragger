// md-dragger/domain — pure calculation layer.
// Public surface: host-facing types and plan/edit/parse APIs only.
// Internals (line-map, guards, capture details) stay unexported.

export {
    detectBlock,
    detectBlockType,
} from './block/block-detector';
export { type ConvertTo, planConvert } from './block/block-type-conversion';

// --- block identity ---
export { type Block, BlockType } from './block/block-types';
// --- commands (type only; construct as object literals) ---
export type { BlockCommand } from './command/block-command';
// --- drop ---
export type { DropPosition } from './command/drop-position';
// --- document ---
export type { Doc, DocLine, MarkerType } from './markdown/document-types';
export {
    type DropLocateInput,
    dropIndentWidth,
    locateDropPosition,
} from './markdown/drop-locate';
// --- line ranges ---
export { isLineNumberInRanges } from './markdown/line-range';
export type { LineRange } from './markdown/line-range-types';
export {
    type MovePlan,
    type MoveResult,
    type PlanMoveInput,
    planMove,
} from './move/move-plan';
// --- structure parse (not DocLine / not Block) ---
export {
    formatIndent,
    type Indent,
    isListLine,
    type LineMarker,
    listMarkerText,
    listMarkerType,
    type ParsedLine,
    parseLine,
} from './parse';
// --- plan / edit ---
export { isReject, type Reject, type RejectReason, reject } from './result';
// --- selection ---
export {
    addBlocks,
    type BlockSelection,
    hasBlock,
    removeBlocks,
    selectBlocks,
    selectionLineRanges,
    selectOne,
} from './selection/block-selection';
export type { DocEdit, TextChange } from './transaction/block-transaction';
export { planDelete } from './transaction/delete-blocks';
export { moveTx } from './transaction/move-blocks';
