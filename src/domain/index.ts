// md-dragger/domain — pure calculation: detect, select, drop position, plan, compile.

// --- block ---
export { BlockType, type Block, isContainerType } from './block/block-types';
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

// --- command / drop ---
export { type BlockCommand } from './command/block-command';
export { type DropPosition } from './command/drop-position';
export { type MoveBlockCommand, createMoveCommand } from './command/move-command';
export { type DeleteBlockCommand, createDeleteCommand } from './command/delete-command';

// --- selection ---
export {
  type BlockSelection,
  selectOne,
  selectBlocks,
  selectionLineRanges,
  selectionMergedLineRanges,
} from './selection/block-selection';
export {
  type BlockSelectionSegment,
  normalizeSelectedBlockRange,
  mergeSelectedBlocks,
  subtractSelectedBlocks,
  groupSelectedBlocksIntoSegments,
} from './selection/block-ranges';
export {
  type LineRangeResolver,
  collectSelectedBlocksBetween,
} from './selection/range-selection';
export {
  type BlockRangeSelectionState,
  type RangeSelectionOperation,
  createBlockRangeSelectionState,
  updateBlockRangeSelectionState,
} from './selection/block-range-selection';

// --- move planning ---
export {
  planMove,
  checkDrop,
  type MovePlan,
  type MoveResult,
  type PlanMoveInput,
  type DropRejectReason,
  type MoveRejectReason,
} from './move/move-plan';

// --- transaction ---
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
  planDelete,
  planBlockCommandTransaction,
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
  listRoot,
  listAncestors,
  type ListIntent,
  type ListIntentMode,
} from './markdown/list-target';
export {
  locateDropPosition,
  dropIndentWidth,
  type DropLocateInput,
} from './markdown/drop-locate';
export {
  normalizeLineRange,
  mergeLineRanges,
  cloneLineRanges,
  isLineNumberInRanges,
  isLineRangeCoveredByRanges,
  subtractLineRange,
  lineCount,
} from './markdown/line-range';
export { clampLine, clampInsertLine } from './markdown/line-number';
export { type FenceRange, findCodeBlockRange, findMathBlockRange } from './markdown/fence-scanner';
