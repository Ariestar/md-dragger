import type { BlockInfo } from '../block/block-types';
import type { DocLikeWithRange } from '../markdown/document-types';
import { clampLineNumber } from '../markdown/line-number';
import {
    mergeSelectedBlocks,
    type SelectedBlockRange,
} from './block-ranges';

type DocWithLineAt = DocLikeWithRange & {
    lineAt: (pos: number) => { number: number };
};

export type RangeSelectionBoundary = {
    startLineNumber: number;
    endLineNumber: number;
    representativeLineNumber: number;
};

export type RangeSelectionBoundaryResolver = (
    lineNumber: number
) => { startLineNumber: number; endLineNumber: number };

export function buildSelectedBlockRangeFromBlockInfo(block: BlockInfo): SelectedBlockRange {
    return {
        startLineNumber: block.startLine + 1,
        endLineNumber: block.endLine + 1,
    };
}

export function buildRangeSelectionBoundaryFromBlock(
    doc: DocWithLineAt,
    block: BlockInfo
): RangeSelectionBoundary {
    const startLineNumber = clampLineNumber(doc.lines, block.startLine + 1);
    const endLineNumber = clampLineNumber(doc.lines, block.endLine + 1);
    const representativeLineNumber = Math.max(
        startLineNumber,
        Math.min(endLineNumber, doc.lineAt(block.from).number)
    );
    return {
        startLineNumber,
        endLineNumber,
        representativeLineNumber,
    };
}

export function collectSelectedBlocksBetween(
    docLines: number,
    anchorStartLineNumber: number,
    anchorEndLineNumber: number,
    targetBlockStartLineNumber: number,
    targetBlockEndLineNumber: number,
    resolveBoundary: RangeSelectionBoundaryResolver
): SelectedBlockRange[] {
    const startLineNumber = Math.max(
        1,
        Math.min(docLines, Math.min(anchorStartLineNumber, targetBlockStartLineNumber))
    );
    const endLineNumber = Math.max(
        1,
        Math.min(docLines, Math.max(anchorEndLineNumber, targetBlockEndLineNumber))
    );

    const blocks: SelectedBlockRange[] = [];
    let cursor = startLineNumber;
    while (cursor <= endLineNumber) {
        const boundary = resolveBoundary(cursor);
        blocks.push({
            startLineNumber: boundary.startLineNumber,
            endLineNumber: boundary.endLineNumber,
        });
        cursor = Math.max(cursor + 1, boundary.endLineNumber + 1);
    }

    return mergeSelectedBlocks(docLines, blocks);
}
