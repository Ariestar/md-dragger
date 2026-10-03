import { describe, expect, it } from 'vitest';
import { BlockType, type DropPosition, detectBlock, listLevel, parseLine, selectOne, snapDrop } from '../index';
import { stringDoc } from '../transaction/string-doc';

const tabSize = 4;
const indentUnit = 4;

/** Snap the block at sourceLine with the raw seam at `seam`. */
function snapAt(text: string, sourceLine: number, seam: number): DropPosition {
    const doc = stringDoc(text);
    const block = detectBlock(doc, sourceLine, { tabSize });
    if (!block) throw new Error(`no block at line ${sourceLine}`);
    const selection = selectOne(block);
    const parsed = parseLine(doc.line(sourceLine).text, tabSize);
    const sourceIndentWidth = block.type === BlockType.ListItem ? parsed.indent.width : 0;
    const raw: DropPosition = { doc, line: seam, parent: null };
    return snapDrop({
        raw,
        sourceDoc: doc,
        selection,
        sourceIndentWidth,
        targetIndentWidth: sourceIndentWidth,
        tabSize,
        indentUnit,
    });
}

describe('domain snapDrop', () => {
    it('keeps destination list parents when snapping a drop from another document', () => {
        const sourceDoc = stringDoc('- source');
        const targetDoc = stringDoc('- target\n    - child\n```ts\nbody\n```\nend');
        const block = detectBlock(sourceDoc, 1, { tabSize });
        if (!block) throw new Error('missing source block');
        const position = snapDrop({
            raw: { doc: targetDoc, line: 4, parent: null },
            sourceDoc,
            selection: selectOne(block),
            sourceIndentWidth: 0,
            targetIndentWidth: indentUnit,
            tabSize,
            indentUnit,
        });
        expect(position.line).toBe(3);
        expect(position.parent?.lines.startLine).toBe(1);
    });

    it('keeps a valid seam untouched', () => {
        const position = snapAt('a\nb\nc', 1, 2);
        expect(position.line).toBe(2);
        expect(position.parent).toBeNull();
    });

    it('snaps a seam inside a code fence to the nearest seam', () => {
        const position = snapAt('a\n```ts\nx\n```\nb', 1, 3);
        expect(position.line).toBe(2);
    });

    it('snaps a seam near the bottom of a tall fence after the block', () => {
        const position = snapAt('a\n```ts\nx\ny\nz\n```\nb', 1, 5);
        expect(position.line).toBe(7);
    });

    it('snaps a non-quote seam inside a short quote run to the run edge', () => {
        const position = snapAt('a\n> q1\n> q2\nb', 1, 3);
        expect(position.line).toBe(2);
    });

    it('snaps to the source-adjacent seam when no far seam is in reach', () => {
        const position = snapAt('p\n> q1\n> q2\n> q3\n> q4\n> q5\n> q6\n> q7\n> q8', 1, 6);
        expect(position.line).toBe(2);
    });

    it('keeps the grey seam when hovering back over the source block', () => {
        const position = snapAt('- item one\n- item two', 1, 1);
        expect(position.line).toBe(1);
    });

    it("snaps the source fence's own body to its own edges, like any block", () => {
        const text = 'intro\n```ts\nx\n```\noutro';
        expect(snapAt(text, 2, 3).line).toBe(2);
        expect(snapAt(text, 2, 4).line).toBe(5);
        expect(snapAt(text, 2, 5).line).toBe(5);
        expect(snapAt(text, 2, 1).line).toBe(1);
        expect(snapAt(text, 2, 6).line).toBe(6);
    });

    it('snaps past a rule even when the seam is right below the source', () => {
        expect(snapAt('a\n---\nb', 1, 2).line).toBe(3);
    });

    it('snaps a non-list seam inside a nested list subtree to the boundary', () => {
        const position = snapAt('p\n- a\n    - b\n    - c\nq', 1, 4);
        expect(position.line).toBe(5);
    });

    it('snaps a table_before seam to the nearest accepted seam', () => {
        const position = snapAt('x\npara\n\n| a | b |\n|---|', 2, 4);
        expect(position.line).toBe(5);
    });

    it('snaps a callout_after seam past the callout', () => {
        const position = snapAt('para\n\n> [!note] Callout\n> body', 1, 5);
        expect(position.line).toBe(3);
    });

    it('snaps an hr_before seam after the rule', () => {
        const position = snapAt('a\nb\n---\nc', 1, 3);
        expect(position.line).toBe(4);
    });

    it('re-derives the parent when snapping a list seam', () => {
        const position = snapAt('- a\n    - b\n- x\n    - y\n```ts\nz\n```', 2, 6);
        expect(position.line).toBe(5);
        expect(position.parent?.type).toBe(BlockType.ListItem);
        expect(position.parent?.lines.startLine).toBe(3);
    });
});

describe('domain listLevel', () => {
    it.each([0, -4, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'rejects invalid indent unit %s explicitly',
        (unit) => {
            expect(() => listLevel('    - child', 4, unit)).toThrow(
                'md-dragger: indentUnit must be finite and greater than zero',
            );
        },
    );

    it('rejects a non-finite computed level explicitly', () => {
        expect(() => listLevel('    - child', 4, Number.MIN_VALUE)).toThrow('md-dragger: list level must be finite');
    });

    it('computes 0 for non-list items', () => {
        expect(listLevel('hello world', 4, 4)).toBe(0);
        expect(listLevel('> quote', 4, 4)).toBe(0);
        expect(listLevel('# heading', 4, 4)).toBe(0);
    });

    it('computes nesting levels for list items', () => {
        expect(listLevel('- root item', 4, 4)).toBe(0);
        expect(listLevel('    - nested item', 4, 4)).toBe(1);
        expect(listLevel('        - deep item', 4, 4)).toBe(2);
    });
});
