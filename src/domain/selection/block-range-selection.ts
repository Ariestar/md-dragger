import type { Doc } from '../markdown/document-types';
import type { LineRange } from '../markdown/line-range-types';
import { isSelectedBlockCoveredByBlocks, mergeSelectedBlocks, subtractSelectedBlocks } from './block-ranges';
import { collectSelectedBlocksBetween, type RangeSelectionBoundary, type RangeSelectionBoundaryResolver } from './range-selection';

export type RangeSelectionOperation = 'add' | 'remove';

export type BlockRangeSelectionState = {
    anchorStartLine: number;
    anchorEndLine: number;
    operation: RangeSelectionOperation;
    baseBlocks: LineRange[];
    activeBlocks: LineRange[];
    selectionBlocks: LineRange[];
};

export function createBlockRangeSelectionState(options: {
    doc: Doc;
    anchorBoundary: RangeSelectionBoundary;
    initialBoundary?: RangeSelectionBoundary;
    selectedBlocks: LineRange[];
    operation?: RangeSelectionOperation;
    resolveBoundary?: RangeSelectionBoundaryResolver;
}): BlockRangeSelectionState | null {
    const anchorStartLine = options.anchorBoundary.startLine;
    const anchorEndLine = options.anchorBoundary.endLine;
    if (
        anchorStartLine < 1
        || anchorEndLine > options.doc.lines
        || anchorStartLine > anchorEndLine
    ) {
        return null;
    }

    const initialBoundary = options.initialBoundary ?? options.anchorBoundary;
    const activeBlocks = options.resolveBoundary
        ? collectSelectedBlocksBetween(
            options.doc.lines,
            anchorStartLine,
            anchorEndLine,
            initialBoundary.startLine,
            initialBoundary.endLine,
            options.resolveBoundary
        )
        : [{
            startLine: anchorStartLine,
            endLine: anchorEndLine,
        }];
    const activeBlock = activeBlocks[0] ?? {
        startLine: anchorStartLine,
        endLine: anchorEndLine,
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
    }, {
        anchorStartLine,
        anchorEndLine,
    });
}

export function updateBlockRangeSelectionState(
    state: Pick<BlockRangeSelectionState, 'anchorStartLine' | 'anchorEndLine' | 'operation' | 'baseBlocks'>,
    options: {
        docLines: number;
        target: RangeSelectionBoundary;
        resolveBoundary: RangeSelectionBoundaryResolver;
    }
): BlockRangeSelectionState {
    const activeBlocks = collectSelectedBlocksBetween(
        options.docLines,
        state.anchorStartLine,
        state.anchorEndLine,
        options.target.startLine,
        options.target.endLine,
        options.resolveBoundary
    );
    return applyBlockRangeSelection({
        docLines: options.docLines,
        operation: state.operation,
        baseBlocks: state.baseBlocks,
        activeBlocks,
    }, {
        anchorStartLine: state.anchorStartLine,
        anchorEndLine: state.anchorEndLine,
    });
}

function applyBlockRangeSelection(
    options: {
        docLines: number;
        operation: RangeSelectionOperation;
        baseBlocks: LineRange[];
        activeBlocks: LineRange[];
    },
    anchor: Pick<BlockRangeSelectionState, 'anchorStartLine' | 'anchorEndLine'>
): BlockRangeSelectionState {
    const selectionBlocks = options.operation === 'remove'
        ? subtractSelectedBlocks(options.docLines, options.baseBlocks, options.activeBlocks)
        : mergeSelectedBlocks(options.docLines, [
            ...options.baseBlocks,
            ...options.activeBlocks,
        ]);
    return {
        ...anchor,
        operation: options.operation,
        baseBlocks: mergeSelectedBlocks(options.docLines, options.baseBlocks),
        activeBlocks: mergeSelectedBlocks(options.docLines, options.activeBlocks),
        selectionBlocks,
    };
}
