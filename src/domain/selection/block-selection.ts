import type { BlockInfo } from '../block/block-types';

export type BlockSelectionRange = {
    startLine: number;
    endLine: number;
};

export type BlockSelection = {
    anchorBlock: BlockInfo;
    focusBlock: BlockInfo;
    ranges: BlockSelectionRange[];
};

export type RangeSelectionOperation = 'add' | 'remove';

export function createBlockSelection(
    anchorBlock: BlockInfo,
    ranges: BlockSelectionRange[],
    focusBlock: BlockInfo = anchorBlock
): BlockSelection {
    return { anchorBlock, focusBlock, ranges };
}

export function createSingleBlockSelection(block: BlockInfo): BlockSelection {
    return createBlockSelection(block, [{ startLine: block.startLine, endLine: block.endLine }]);
}
