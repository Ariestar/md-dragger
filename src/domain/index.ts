// md-dragger/domain — public core API for markdown block detection,
// selection, drop planning and transaction building.
//
// This barrel is an explicit allow-list, NOT `export *`. Internal rule
// engines (container-policy, insertion-rules, self-drop), mutation
// assembly (list-mutation, text-mutation-policy, document-change),
// transaction internals (delete-blocks, list-renumber) and low-level
// parsing (line-parser, indent-calculator) are deliberately NOT exported —
// they are the internals of moveTx/planMove. Optional performance hooks
// live on the separate `md-dragger/domain/perf` entry point.

// --- block ---
export { BlockType, type BlockInfo } from './block/block-types';
export {
  detectBlock,
  detectBlockType,
  getHeadingLevel,
  getHeadingSectionRange,
} from './block/block-detector';
export {
  type BlockTypeConversion,
  type BlockTypeConversionChange,
  planBlockTypeConversionChanges,
} from './block/block-type-conversion';
export {
  isHorizontalRuleLine,
  isBlockquoteLine,
  isCalloutLine,
  isTableLine,
  isMathFenceLine,
  isCodeFenceLine,
  isListItemLine,
} from './block/block-guards';

// --- command ---
export { type BlockCommand } from './command/block-command';
export { type DropTarget, type ListDropTarget } from './command/drop-target';
export { type MoveBlockCommand, createMoveCommand } from './command/move-command';
export { type DeleteBlockCommand, createDeleteCommand } from './command/delete-command';

// --- selection ---
export {
  type BlockSelection,
  type BlockSelectionRange,
  type RangeSelectionOperation,
  createBlockSelection,
  createSingleBlockSelection,
} from './selection/block-selection';
export {
  type SelectedBlockRange,
  type BlockSelectionSegment,
  normalizeSelectedBlockRange,
  mergeSelectedBlocks,
  subtractSelectedBlocks,
  groupSelectedBlocksIntoSegments,
} from './selection/block-ranges';
export {
  type RangeSelectionBoundary,
  type RangeSelectionBoundaryResolver,
  buildSelectedBlockRangeFromBlockInfo,
  buildRangeSelectionBoundaryFromBlock,
  collectSelectedBlocksBetween,
} from './selection/range-selection';
export {
  type BlockRangeSelectionState,
  createBlockRangeSelectionState,
  updateBlockRangeSelectionState,
} from './selection/block-range-selection';
export { type CompositeLineRange, normalizeCompositeRanges } from './selection/selection-ranges';

// --- move planning ---
export {
  planMove,
  checkDrop,
  type MovePlan,
  type MoveResult,
  type MoveDeps,
  type DropInput,
  type DropRejectReason,
  type MoveRejectReason,
} from './move/move-plan';

// --- transaction (result types + top-level builders) ---
export { type TextChange, type DocEdit } from './transaction/block-transaction';
export {
  moveTx,
  planSourceDeletion,
  captureMoveSource,
  type CapturedMoveSource,
  type MoveSourcePayload,
  type MoveSourceSegment,
} from './transaction/move-blocks';
export { type CommandReject, type CommandRejectReason, rejectCommand } from './transaction/command-reject';
export {
  planBlockCommandTransaction,
  planDeleteCommandTransaction,
} from './transaction/block-command-transaction';

// --- markdown ---
export {
  type ParsedLine,
  type ParsedListLine,
  type ListContext,
  type ListContextValue,
  type MarkerType,
  type Doc,
  type DocLine,
} from './markdown/document-types';
export { type LineParsingContext, createLineParsingContext } from './markdown/line-parsing-service';
export {
  getLineMap,
  getLineMetaAt,
  peekCachedLineMap,
  getNearestListLineAtOrBefore,
  type LineMap,
  type LineMeta,
} from './markdown/line-map';
export { type LineRange } from './markdown/line-range-types';
export {
  computeListIntent,
  resolveReferenceListLineNumber,
  getListAncestorLineNumbers,
  findParentLineNumberByIndent,
  type ListIntent,
  type ListIntentMode,
} from './markdown/list-target';
export {
  normalizeLineRange,
  mergeLineRanges,
  cloneLineRanges,
  isLineNumberInRanges,
  isLineRangeCoveredByRanges,
  subtractLineRange,
} from './markdown/line-range';
export { clampLineNumber } from './markdown/line-number';
export { clampTargetLineNumber } from './markdown/line-target-number';
export { type FenceRange, findCodeBlockRange, findMathBlockRange } from './markdown/fence-scanner';
