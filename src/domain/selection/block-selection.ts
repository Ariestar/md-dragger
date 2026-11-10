import { detectBlock } from '../block/block-detector';
import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';
import type { LineMap } from '../markdown/line-map';
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
        (a, b) => a.lines.startLine - b.lines.startLine || a.lines.endLine - b.lines.endLine,
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

/** Convert editor line ranges to complete semantic blocks. */
export function selectBlocksInLineRanges(
    doc: Doc,
    ranges: readonly LineRange[],
    options: { tabSize: number },
): BlockSelection {
    const blocks: Block[] = [];
    const seen = new Set<string>();
    for (const range of ranges) {
        if (range.startLine > range.endLine) continue;
        const start = Math.max(1, Math.min(doc.lines, range.startLine));
        const end = Math.max(1, Math.min(doc.lines, range.endLine));
        for (let line = start; line <= end; line += 1) {
            const block = detectBlock(doc, line, options);
            if (block && !seen.has(blockKey(block))) {
                seen.add(blockKey(block));
                blocks.push(block);
            }
        }
    }
    return selectBlocks(blocks);
}

/** Line ranges of the selection; adjacent/overlapping blocks are merged. */
export function selectionLineRanges(docLines: number, selection: BlockSelection): LineRange[] {
    return mergeLineRanges(
        docLines,
        selection.blocks.map((block) => block.lines),
    );
}

/**
 * The blocks a move or delete acts on, and the segments they form. A block
 * contained in another selected block is dropped (a list item and its child,
 * a callout and its nested callout); blocks separated only by blank lines
 * form one segment, those blank lines included, so a group keeps its spacing.
 */
export function selectionSegments(
    selection: BlockSelection,
    options: { lineMap: LineMap },
): { blocks: Block[]; segments: LineRange[] } {
    const unique = [...new Map(selection.blocks.map((block) => [blockKey(block), block])).values()];
    const { blocks } = selectBlocks(
        unique.filter(
            (block) =>
                !unique.some(
                    (other) =>
                        other !== block &&
                        other.lines.startLine <= block.lines.startLine &&
                        other.lines.endLine >= block.lines.endLine,
                ),
        ),
    );
    const segments: LineRange[] = [];
    for (const block of blocks) {
        const last = segments[segments.length - 1];
        if (
            last &&
            (block.lines.startLine <= last.endLine ||
                options.lineMap.nextNonEmpty[last.endLine + 1] === block.lines.startLine)
        ) {
            last.endLine = Math.max(last.endLine, block.lines.endLine);
            continue;
        }
        segments.push({ ...block.lines });
    }
    return { blocks, segments };
}
