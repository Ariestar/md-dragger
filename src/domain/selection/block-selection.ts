import type { Block } from '../block/block-types';
import { mergeLineRanges } from '../markdown/line-range';
import type { LineRange } from '../markdown/line-range-types';

/**
 * Result selection for a gesture/command.
 * How UX built it (click, range-drag, …) is irrelevant here.
 */
export type BlockSelection = {
    blocks: Block[];
};

function blockKey(block: Block): string {
    return `${block.lines.startLine}:${block.lines.endLine}`;
}

export function selectOne(block: Block): BlockSelection {
    return { blocks: [block] };
}

/** Sort by document order. */
export function selectBlocks(blocks: Block[]): BlockSelection {
    const sorted = [...blocks].sort(
        (a, b) => a.lines.startLine - b.lines.startLine || a.lines.endLine - b.lines.endLine
    );
    return { blocks: sorted };
}

/** Union by line span identity. */
export function addBlocks(selection: BlockSelection, blocks: Block[]): BlockSelection {
    const map = new Map(selection.blocks.map((b) => [blockKey(b), b]));
    for (const block of blocks) {
        map.set(blockKey(block), block);
    }
    return selectBlocks([...map.values()]);
}

/** Subtract by line span identity. */
export function removeBlocks(selection: BlockSelection, blocks: Block[]): BlockSelection {
    const remove = new Set(blocks.map(blockKey));
    return selectBlocks(selection.blocks.filter((b) => !remove.has(blockKey(b))));
}

export function hasBlock(selection: BlockSelection, block: Block): boolean {
    const key = blockKey(block);
    return selection.blocks.some((b) => blockKey(b) === key);
}

export function selectionLineRanges(selection: BlockSelection): LineRange[] {
    return selection.blocks.map((block) => block.lines);
}

export function selectionMergedLineRanges(docLines: number, selection: BlockSelection): LineRange[] {
    return mergeLineRanges(docLines, selectionLineRanges(selection));
}
