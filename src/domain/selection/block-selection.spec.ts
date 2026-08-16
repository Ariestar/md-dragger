import { describe, expect, it } from 'vitest';
import { BlockType } from '../block/block-types';
import { stringDoc } from '../transaction/string-doc';
import { selectBlocksInLineRanges } from './block-selection';

describe('selectBlocksInLineRanges', () => {
    it('expands a multi-paragraph editor range to complete semantic blocks', () => {
        const doc = stringDoc('alpha\n\nbeta\n\ngamma');

        expect(selectBlocksInLineRanges(doc, [{ startLine: 1, endLine: 3 }], { tabSize: 4 })).toEqual({
            blocks: [
                { type: BlockType.Paragraph, lines: { startLine: 1, endLine: 1 } },
                { type: BlockType.Paragraph, lines: { startLine: 3, endLine: 3 } },
            ],
        });
    });

    it('deduplicates nested and overlapping ranges in document order', () => {
        const doc = stringDoc('- parent\n  - child\n\nafter');

        const selection = selectBlocksInLineRanges(
            doc,
            [
                { startLine: 2, endLine: 2 },
                { startLine: 1, endLine: 2 },
            ],
            { tabSize: 4 },
        );

        expect(selection.blocks).toEqual([
            { type: BlockType.ListItem, lines: { startLine: 1, endLine: 2 } },
            { type: BlockType.ListItem, lines: { startLine: 2, endLine: 2 } },
        ]);
    });

    it('clamps ranges and ignores reversed ranges', () => {
        const doc = stringDoc('first\n\nlast');

        expect(
            selectBlocksInLineRanges(
                doc,
                [
                    { startLine: -2, endLine: 1 },
                    { startLine: 3, endLine: 99 },
                    { startLine: 3, endLine: 2 },
                ],
                { tabSize: 4 },
            ).blocks,
        ).toEqual([
            { type: BlockType.Paragraph, lines: { startLine: 1, endLine: 1 } },
            { type: BlockType.Paragraph, lines: { startLine: 3, endLine: 3 } },
        ]);
    });
});
