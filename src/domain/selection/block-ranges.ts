import type { LineRange } from '../markdown/line-range-types';
import { mergeLineRanges, normalizeLineRange } from '../markdown/line-range';

export type BlockSelectionSegment = {
    startLine: number;
    endLine: number;
    startBlockLine: number;
    endBlockLine: number;
};

function keyFor(range: LineRange): string {
    return `${range.startLine}:${range.endLine}`;
}

export function normalizeSelectedBlockRange(
    docLines: number,
    startLine: number,
    endLine: number
): LineRange {
    return normalizeLineRange(docLines, startLine, endLine);
}

export function cloneSelectedBlocks(blocks: LineRange[]): LineRange[] {
    return blocks.map((block) => ({ ...block }));
}

export function mergeSelectedBlocks(docLines: number, blocks: LineRange[]): LineRange[] {
    const normalized = mergeLineRanges(docLines, blocks);
    const seen = new Set<string>();
    const result: LineRange[] = [];
    for (const block of normalized) {
        const key = keyFor(block);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(block);
    }
    return result;
}

export function subtractSelectedBlocks(
    docLines: number,
    sourceBlocks: LineRange[],
    blocksToRemove: LineRange[]
): LineRange[] {
    const removeKeys = new Set(mergeSelectedBlocks(docLines, blocksToRemove).map(keyFor));
    return mergeSelectedBlocks(docLines, sourceBlocks).filter((block) => !removeKeys.has(keyFor(block)));
}

export function isSelectedBlockCoveredByBlocks(
    docLines: number,
    target: LineRange,
    blocks: LineRange[]
): boolean {
    const normalizedTarget = normalizeSelectedBlockRange(docLines, target.startLine, target.endLine);
    const targetKey = keyFor(normalizedTarget);
    return mergeSelectedBlocks(docLines, blocks).some((block) => keyFor(block) === targetKey);
}

export function groupSelectedBlocksIntoSegments(
    docLines: number,
    blocks: LineRange[]
): BlockSelectionSegment[] {
    return groupSegments(mergeSelectedBlocks(docLines, blocks));
}

export function groupSegments(normalized: LineRange[]): BlockSelectionSegment[] {
    if (normalized.length === 0) return [];

    const segments: BlockSelectionSegment[] = [];
    let current: BlockSelectionSegment = {
        startLine: normalized[0].startLine,
        endLine: normalized[0].endLine,
        startBlockLine: normalized[0].startLine,
        endBlockLine: normalized[0].startLine,
    };

    for (let i = 1; i < normalized.length; i++) {
        const block = normalized[i];
        if (block.startLine <= current.endLine + 1) {
            current.endLine = Math.max(current.endLine, block.endLine);
            current.endBlockLine = block.startLine;
            continue;
        }
        segments.push(current);
        current = {
            startLine: block.startLine,
            endLine: block.endLine,
            startBlockLine: block.startLine,
            endBlockLine: block.startLine,
        };
    }
    segments.push(current);
    return segments;
}
