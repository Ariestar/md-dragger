import type { Block } from '../block/block-types';
import { clampLine } from '../markdown/line-number';
import { mergeSelectedBlocks } from './block-ranges';
import type { LineRange } from '../markdown/line-range-types';

export type RangeSelectionBoundary = {
    startLine: number;
    endLine: number;
    representativeLine: number;
};

export type RangeSelectionBoundaryResolver = (
    lineNumber: number
) => { startLine: number; endLine: number };

export function buildSelectedBlockRangeFromBlock(block: Block): LineRange {
    return { ...block.lines };
}

export function buildRangeSelectionBoundaryFromBlock(
    docLines: number,
    block: Block
): RangeSelectionBoundary {
    const startLine = clampLine(docLines, block.lines.startLine);
    const endLine = clampLine(docLines, block.lines.endLine);
    return {
        startLine,
        endLine,
        representativeLine: startLine,
    };
}

export function collectSelectedBlocksBetween(
    docLines: number,
    anchorStartLine: number,
    anchorEndLine: number,
    targetBlockStartLine: number,
    targetBlockEndLine: number,
    resolveBoundary: RangeSelectionBoundaryResolver
): LineRange[] {
    const startLine = Math.max(
        1,
        Math.min(docLines, Math.min(anchorStartLine, targetBlockStartLine))
    );
    const endLine = Math.max(
        1,
        Math.min(docLines, Math.max(anchorEndLine, targetBlockEndLine))
    );

    const blocks: LineRange[] = [];
    let cursor = startLine;
    while (cursor <= endLine) {
        const boundary = resolveBoundary(cursor);
        blocks.push({
            startLine: boundary.startLine,
            endLine: boundary.endLine,
        });
        cursor = Math.max(cursor + 1, boundary.endLine + 1);
    }

    return mergeSelectedBlocks(docLines, blocks);
}
