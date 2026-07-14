import type { Doc } from '../markdown/document-types';
import type { LineRange } from '../markdown/line-range-types';
import { isSelectedBlockCoveredByBlocks, mergeSelectedBlocks, subtractSelectedBlocks } from './block-ranges';
import { collectSelectedBlocksBetween, type LineRangeResolver } from './range-selection';

export type RangeSelectionOperation = 'add' | 'remove';

export type BlockRangeSelectionState = {
    anchor: LineRange;
    operation: RangeSelectionOperation;
    baseBlocks: LineRange[];
    activeBlocks: LineRange[];
    selectionBlocks: LineRange[];
};

export function createBlockRangeSelectionState(options: {
    doc: Doc;
    anchor: LineRange;
    initial?: LineRange;
    selectedBlocks: LineRange[];
    operation?: RangeSelectionOperation;
    resolveRange?: LineRangeResolver;
}): BlockRangeSelectionState | null {
    const anchor = options.anchor;
    if (
        anchor.startLine < 1
        || anchor.endLine > options.doc.lines
        || anchor.startLine > anchor.endLine
    ) {
        return null;
    }

    const initial = options.initial ?? anchor;
    const activeBlocks = options.resolveRange
        ? collectSelectedBlocksBetween(
            options.doc.lines,
            anchor,
            initial,
            options.resolveRange
        )
        : [{ startLine: anchor.startLine, endLine: anchor.endLine }];
    const activeBlock = activeBlocks[0] ?? {
        startLine: anchor.startLine,
        endLine: anchor.endLine,
    };
    const operation = options.operation ?? (isSelectedBlockCoveredByBlocks(
        options.doc.lines,
        activeBlock,
        options.selectedBlocks
    ) ? 'remove' : 'add');
    const baseBlocks = operation === 'add'
        ? subtractSelectedBlocks(options.doc.lines, options.selectedBlocks, activeBlocks)
        : options.selectedBlocks;
    return applyBlockRangeSelection({
        docLines: options.doc.lines,
        operation,
        baseBlocks,
        activeBlocks,
        anchor,
    });
}

export function updateBlockRangeSelectionState(
    state: Pick<BlockRangeSelectionState, 'anchor' | 'operation' | 'baseBlocks'>,
    options: {
        docLines: number;
        target: LineRange;
        resolveRange: LineRangeResolver;
    }
): BlockRangeSelectionState {
    const activeBlocks = collectSelectedBlocksBetween(
        options.docLines,
        state.anchor,
        options.target,
        options.resolveRange
    );
    return applyBlockRangeSelection({
        docLines: options.docLines,
        operation: state.operation,
        baseBlocks: state.baseBlocks,
        activeBlocks,
        anchor: state.anchor,
    });
}

function applyBlockRangeSelection(options: {
    docLines: number;
    operation: RangeSelectionOperation;
    baseBlocks: LineRange[];
    activeBlocks: LineRange[];
    anchor: LineRange;
}): BlockRangeSelectionState {
    const selectionBlocks = options.operation === 'remove'
        ? subtractSelectedBlocks(options.docLines, options.baseBlocks, options.activeBlocks)
        : mergeSelectedBlocks(options.docLines, [
            ...options.baseBlocks,
            ...options.activeBlocks,
        ]);
    return {
        anchor: options.anchor,
        operation: options.operation,
        baseBlocks: mergeSelectedBlocks(options.docLines, options.baseBlocks),
        activeBlocks: mergeSelectedBlocks(options.docLines, options.activeBlocks),
        selectionBlocks,
    };
}
