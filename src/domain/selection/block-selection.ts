import type { Block } from '../block/block-types';
import { mergeLineRanges } from '../markdown/line-range';
import type { LineRange } from '../markdown/line-range-types';

/**
 * Blocks involved in one gesture/command.
 * Non-empty after normalize; sorted by startLine; non-overlapping.
 */
export type BlockSelection = {
    blocks: Block[];
};

export function selectOne(block: Block): BlockSelection {
    return { blocks: [block] };
}

/** Sort by document order; drop empty. Does not merge overlapping blocks. */
export function selectBlocks(blocks: Block[]): BlockSelection {
    const sorted = [...blocks].sort(
        (a, b) => a.lines.startLine - b.lines.startLine || a.lines.endLine - b.lines.endLine
    );
    return { blocks: sorted };
}

export function selectionLineRanges(selection: BlockSelection): LineRange[] {
    return selection.blocks.map((block) => block.lines);
}

export function selectionMergedLineRanges(docLines: number, selection: BlockSelection): LineRange[] {
    return mergeLineRanges(docLines, selectionLineRanges(selection));
}
