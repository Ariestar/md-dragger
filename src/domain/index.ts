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
  type ConvertTo,
  planConvert,
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
export { type DropPosition } from './command/drop-position';
export { type BlockCommand } from './command/block-command';

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

// --- results ---
export { type Reject, type RejectReason, reject } from './result';

// --- move planning ---
export {
  planMove,
  type MovePlan,
  type MoveResult,
  type PlanMoveInput,
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
export { planDelete } from './transaction/delete-blocks';

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
  dropContextLine,
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
export { type FenceRange, findCodeBlockRange, findMathBlockRange } from './markdown/fence-scanner';
