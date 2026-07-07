export type SelectedBlockRange = {
    startLineNumber: number;
    endLineNumber: number;
};

export type BlockSelectionSegment = {
    startLineNumber: number;
    endLineNumber: number;
    startBlockLineNumber: number;
    endBlockLineNumber: number;
};

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function keyForBlockRange(range: SelectedBlockRange): string {
    return `${range.startLineNumber}:${range.endLineNumber}`;
}

export function normalizeSelectedBlockRange(
    docLines: number,
    startLineNumber: number,
    endLineNumber: number
): SelectedBlockRange {
    const safeStart = clamp(Math.min(startLineNumber, endLineNumber), 1, docLines);
    const safeEnd = clamp(Math.max(startLineNumber, endLineNumber), safeStart, docLines);
    return {
        startLineNumber: safeStart,
        endLineNumber: safeEnd,
    };
}

export function cloneSelectedBlocks(blocks: SelectedBlockRange[]): SelectedBlockRange[] {
    return blocks.map((block) => ({
        startLineNumber: block.startLineNumber,
        endLineNumber: block.endLineNumber,
    }));
}

export function mergeSelectedBlocks(
    docLines: number,
    blocks: SelectedBlockRange[]
): SelectedBlockRange[] {
    const normalized = blocks
        .map((block) => normalizeSelectedBlockRange(docLines, block.startLineNumber, block.endLineNumber))
        .sort((a, b) => (
            a.startLineNumber - b.startLineNumber
            || a.endLineNumber - b.endLineNumber
        ));

    const seen = new Set<string>();
    const result: SelectedBlockRange[] = [];
    for (const block of normalized) {
        const key = keyForBlockRange(block);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(block);
    }
    return result;
}

export function subtractSelectedBlocks(
    docLines: number,
    sourceBlocks: SelectedBlockRange[],
    blocksToRemove: SelectedBlockRange[]
): SelectedBlockRange[] {
    const removeKeys = new Set(
        mergeSelectedBlocks(docLines, blocksToRemove).map((block) => keyForBlockRange(block))
    );
    return mergeSelectedBlocks(docLines, sourceBlocks)
        .filter((block) => !removeKeys.has(keyForBlockRange(block)));
}

export function isSelectedBlockCoveredByBlocks(
    docLines: number,
    target: SelectedBlockRange,
    blocks: SelectedBlockRange[]
): boolean {
    const normalizedTarget = normalizeSelectedBlockRange(
        docLines,
        target.startLineNumber,
        target.endLineNumber
    );
    const targetKey = keyForBlockRange(normalizedTarget);
    return mergeSelectedBlocks(docLines, blocks)
        .some((block) => keyForBlockRange(block) === targetKey);
}

export function groupSelectedBlocksIntoSegments(
    docLines: number,
    blocks: SelectedBlockRange[]
): BlockSelectionSegment[] {
    return groupSegments(mergeSelectedBlocks(docLines, blocks));
}

export function groupSegments(
    normalized: SelectedBlockRange[]
): BlockSelectionSegment[] {
    if (normalized.length === 0) return [];

    const segments: BlockSelectionSegment[] = [];
    let current: BlockSelectionSegment = {
        startLineNumber: normalized[0].startLineNumber,
        endLineNumber: normalized[0].endLineNumber,
        startBlockLineNumber: normalized[0].startLineNumber,
        endBlockLineNumber: normalized[0].startLineNumber,
    };

    for (let i = 1; i < normalized.length; i++) {
        const block = normalized[i];
        if (block.startLineNumber <= current.endLineNumber + 1) {
            current.endLineNumber = Math.max(current.endLineNumber, block.endLineNumber);
            current.endBlockLineNumber = block.startLineNumber;
            continue;
        }
        segments.push(current);
        current = {
            startLineNumber: block.startLineNumber,
            endLineNumber: block.endLineNumber,
            startBlockLineNumber: block.startLineNumber,
            endBlockLineNumber: block.startLineNumber,
        };
    }
    segments.push(current);
    return segments;
}
