import type { LineRange } from '../markdown/line-range-types';
import { mergeSelectedBlocks } from './block-ranges';

/** Resolve the block line span covering a document line. */
export type LineRangeResolver = (lineNumber: number) => LineRange;

/**
 * Walk from anchor span through target span, collecting each block's LineRange.
 */
export function collectSelectedBlocksBetween(
    docLines: number,
    anchor: LineRange,
    target: LineRange,
    resolveRange: LineRangeResolver
): LineRange[] {
    const startLine = Math.max(
        1,
        Math.min(docLines, Math.min(anchor.startLine, target.startLine))
    );
    const endLine = Math.max(
        1,
        Math.min(docLines, Math.max(anchor.endLine, target.endLine))
    );

    const blocks: LineRange[] = [];
    let cursor = startLine;
    while (cursor <= endLine) {
        const range = resolveRange(cursor);
        blocks.push({
            startLine: range.startLine,
            endLine: range.endLine,
        });
        cursor = Math.max(cursor + 1, range.endLine + 1);
    }

    return mergeSelectedBlocks(docLines, blocks);
}
