// md-dragger/domain — pure calculation layer.
// Public surface: host-facing types and plan/edit/parse APIs only.
// Internals (line-map, guards, capture details) stay unexported.

export { detectBlock } from './block/block-detector';
export { type ConvertTo, planConvert } from './block/block-type-conversion';

// --- block identity ---
export { type Block, BlockType } from './block/block-types';
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
export { rebaseAppendChange, resolveInsertionChange } from './mutation';
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
    selectBlocksInLineRanges,
    selectionLineRanges,
    selectOne,
} from './selection/block-selection';
export type { DocEdit, TextChange } from './transaction/block-transaction';
export { planDelete } from './transaction/delete-blocks';
export { moveTx } from './transaction/move-blocks';
