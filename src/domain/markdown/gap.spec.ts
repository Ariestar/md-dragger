import { describe, expect, it } from 'vitest';
import { BlockType } from '../block/block-types';
import { stringDoc } from '../transaction/string-doc';
import { canonicalSeam, gapAt } from './gap';
import { getLineMap } from './line-map';

const tabSize = 4;

function at(text: string, line: number) {
    const doc = stringDoc(text);
    return gapAt(doc, line, { lineMap: getLineMap(doc, { tabSize }), tabSize });
}

function seamOf(text: string, line: number): number {
    const doc = stringDoc(text);
    return canonicalSeam(doc, line, { lineMap: getLineMap(doc, { tabSize }) });
}

describe('domain/markdown/gap', () => {
    it('canonicalises raw seams past the last block to the end, and clamps out-of-range seams', () => {
        expect(seamOf('a\n\n', 2)).toBe(4);
        expect(seamOf('a\n\n', 4)).toBe(4);
        expect(seamOf('a', 9)).toBe(2);
        expect(seamOf('a', -3)).toBe(1);
    });

    it('describes an interior gap by its neighbours and blank lines', () => {
        expect(at('a\n\n> [!note] B\n> b\n\nc', 2)).toEqual({
            type: 'gap',
            gap: {
                seam: 3,
                above: { type: BlockType.Paragraph, lines: { startLine: 1, endLine: 1 } },
                below: { type: BlockType.Callout, lines: { startLine: 3, endLine: 4 } },
                blankLines: 1,
            },
        });
        expect(at('a\nb', 2)).toMatchObject({ type: 'gap', gap: { seam: 2, blankLines: 0 } });
        expect(at('a\n\n\nb', 3)).toMatchObject({ type: 'gap', gap: { seam: 4, blankLines: 2 } });
    });

    it('has no blank lines at the top edge: padding is not a separator', () => {
        expect(at('\n\na', 1)).toEqual({
            type: 'gap',
            gap: {
                seam: 3,
                above: null,
                below: { type: BlockType.Paragraph, lines: { startLine: 3, endLine: 3 } },
                blankLines: 0,
            },
        });
    });

    it('has no blank lines at the bottom edge, with or without a final newline', () => {
        const bottom = { above: { type: BlockType.Paragraph, lines: { startLine: 1, endLine: 1 } }, below: null };
        expect(at('a\n', 2)).toEqual({ type: 'gap', gap: { seam: 3, ...bottom, blankLines: 0 } });
        expect(at('a', 2)).toEqual({ type: 'gap', gap: { seam: 2, ...bottom, blankLines: 0 } });
    });

    it('starts the first gap after frontmatter at the top edge', () => {
        expect(at('---\nt: x\n---\n\n# H', 4)).toEqual({
            type: 'gap',
            gap: {
                seam: 5,
                above: null,
                below: { type: BlockType.Heading, lines: { startLine: 5, endLine: 5 } },
                blankLines: 0,
            },
        });
    });

    it('reports the interiors that are not gaps with their regions', () => {
        expect(at('a\n```\nx\n\ny\n```\nb', 4)).toEqual({
            type: 'interior',
            reason: 'inside_code_block',
            region: { startLine: 2, endLine: 6 },
        });
        expect(at('a\n```\nx\n```\nb', 4)).toMatchObject({ reason: 'inside_code_block' });
        expect(at('a\n$$\nx\n$$\nb', 3)).toEqual({
            type: 'interior',
            reason: 'inside_math_block',
            region: { startLine: 2, endLine: 4 },
        });
        expect(at('a\n\n%%\nx\n\ny\n%%\n\nb', 6)).toEqual({
            type: 'interior',
            reason: 'inside_comment_block',
            region: { startLine: 3, endLine: 7 },
        });
        expect(at('x\n\n| a | b |\n|---|---|\n| 1 | 2 |', 5)).toEqual({
            type: 'interior',
            reason: 'inside_table',
            region: { startLine: 3, endLine: 5 },
        });
        expect(at('---\nt: x\n---\n\n# H', 2)).toEqual({
            type: 'interior',
            reason: 'inside_frontmatter',
            region: { startLine: 1, endLine: 3 },
        });
        expect(at('---\nt: x\n---\n\n# H', 1)).toMatchObject({ reason: 'inside_frontmatter' });
    });

    it('treats the seams around a fence, math block and table as gaps', () => {
        expect(at('a\n```\nx\n```\nb', 2)).toMatchObject({ type: 'gap' });
        expect(at('a\n```\nx\n```\nb', 5)).toMatchObject({ type: 'gap' });
        expect(at('x\n\n| a | b |\n|---|---|', 5)).toMatchObject({ type: 'gap' });
    });
});
