import { describe, expect, it } from 'vitest';
import {
    type Block,
    BlockType,
    type DropPosition,
    detectBlock,
    listLevel,
    locateDropPosition,
    parseLine,
    planMove,
    seamRow,
    selectBlocks,
    selectOne,
    snapDrop,
} from '../index';
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

/** Locate a drop of the item at sourceLine below hitLine, one indent step in. */
function nestUnder(sourceText: string, sourceLine: number, hitLine: number, targetText?: string): DropPosition {
    const sourceDoc = stringDoc(sourceText);
    const block = detectBlock(sourceDoc, sourceLine, { tabSize });
    if (!block) throw new Error(`no block at line ${sourceLine}`);
    return locateDropPosition({
        doc: targetText === undefined ? sourceDoc : stringDoc(targetText),
        sourceDoc,
        selection: selectOne(block),
        hitLine,
        belowMid: true,
        sourceIndentWidth: 0,
        targetIndentWidth: indentUnit,
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
        // Edge 2 is the source's own gap at the same distance; ties go below.
        const position = snapAt('a\n> q1\n> q2\nb', 1, 3);
        expect(position.line).toBe(4);
    });

    it('snaps to the far edge of a quote run when it is as near as the source-adjacent one', () => {
        const position = snapAt('p\n> q1\n> q2\n> q3\n> q4\n> q5\n> q6\n> q7\n> q8', 1, 6);
        expect(position.line).toBe(10);
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

    it('keeps the seam right below the source grey even above a rule', () => {
        expect(snapAt('a\n---\nb', 1, 2).line).toBe(2);
    });

    it('snaps a non-adaptable block seam inside a nested list subtree to the boundary', () => {
        const position = snapAt('```\ncode\n```\n- a\n    - b\n    - c\nq', 1, 6);
        expect(position.line).toBe(7);
    });

    it("keeps the gap above a table grey when it is the source's own gap below", () => {
        const position = snapAt('x\npara\n\n| a | b |\n|---|', 2, 4);
        expect(position.line).toBe(4);
    });

    it('accepts the gap after a callout', () => {
        const position = snapAt('para\n\n> [!note] Callout\n> body', 1, 5);
        expect(position.line).toBe(5);
    });

    it('accepts the gap above a blank-separated rule', () => {
        const position = snapAt('a\n\nb\n\n---\n\nc', 1, 5);
        expect(position.line).toBe(5);
    });

    it('snaps out of a callout to its nearest edge', () => {
        const text = 'intro\n\n> [!note] T\n> a\n> b\n> c\n\nmid\n\nend';
        expect(snapAt(text, 10, 4).line).toBe(3);
        expect(snapAt(text, 10, 6).line).toBe(8);
    });

    it('snaps out of a 12-line quote run with no radius limit', () => {
        const quote = Array.from({ length: 12 }, (_, i) => `> q${i + 1}`).join('\n');
        const text = `top\n\n${quote}\n\nend\n\nsrc`;
        expect(snapAt(text, 18, 5).line).toBe(3);
        expect(snapAt(text, 18, 9).line).toBe(16);
        expect(snapAt(text, 18, 13).line).toBe(16);
    });

    it('snaps out of a long fence with no radius limit', () => {
        const body = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n');
        const text = `top\n\n\`\`\`\n${body}\n\`\`\`\n\nend\n\nsrc`;
        expect(snapAt(text, 18, 6).line).toBe(3);
        expect(snapAt(text, 18, 11).line).toBe(16);
    });

    it('measures the nearer edge of a fence from a pointer on its blank lines', () => {
        for (const fence of ['```', '$$']) {
            const doc = stringDoc(`Intro\n\n${fence}\nx\n\n\nz\n${fence}\n\nend\n\nsrc`);
            const block = detectBlock(doc, 12, { tabSize });
            if (!block) throw new Error('no block');
            const input = { sourceDoc: doc, selection: selectOne(block), sourceIndentWidth: 0, targetIndentWidth: 0 };
            const raw = locateDropPosition({ ...input, doc, hitLine: 5, belowMid: false, tabSize, indentUnit });
            expect(snapDrop({ ...input, raw, tabSize, indentUnit }).line).toBe(3);
        }
    });

    it('snaps out of a comment block to its nearest edge', () => {
        const text = 'x\n\n%%\nnote\nmore\n%%\n\nmid\n\npara';
        expect(snapAt(text, 10, 4).line).toBe(3);
        expect(snapAt(text, 10, 6).line).toBe(8);
    });

    it('snaps out of a table to its nearest edge', () => {
        const text = 'x\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nmid\n\npara';
        expect(snapAt(text, 9, 4).line).toBe(3);
        expect(snapAt(text, 9, 5).line).toBe(7);
    });

    it('snaps out of a nested list to the outermost item’s edges', () => {
        const text = 'p\n\n- a\n    - b\n        - c\n        - d\n    - e\n\nend\n\n```\nsrc\n```';
        expect(snapAt(text, 11, 4).line).toBe(3);
        expect(snapAt(text, 11, 6).line).toBe(9);
    });

    it('snaps out of a list inside a callout to the callout’s edges', () => {
        expect(snapAt('para\n\n> [!note] T\n> - a\n>     - b\n> - c\n\nend', 1, 5).line).toBe(8);
    });

    it('snaps out of the list item a fence or table nested in it belongs to', () => {
        expect(snapAt('$$\nm\n$$\n\n- a\n    ```\n    code\n    more\n    ```\n    tail\n- b\n\nend', 1, 8).line).toBe(
            11,
        );
        expect(
            snapAt('$$\nm\n$$\n\n- a\n    | x | y |\n    |---|---|\n    | 1 | 2 |\n    tail\n- b\n\nend', 1, 8).line,
        ).toBe(10);
    });

    it('snaps out of a quote run inside a list item to the item’s edges', () => {
        expect(snapAt('- item\n    > [!note] x\n    > body\n    more text\n- next\n\npara\n', 7, 3).line).toBe(5);
        expect(snapAt('- item\n    > q1\n    > q2\n    child\n- next\n\npara\n', 7, 3).line).toBe(5);
    });

    it('snaps frontmatter seams to the first gap below it', () => {
        const text = '---\nt: x\n---\n\n# H\n\npara';
        expect(snapAt(text, 7, 1).line).toBe(5);
        expect(snapAt(text, 7, 2).line).toBe(5);
        expect(snapAt(text, 7, 3).line).toBe(5);
    });

    it('snaps to the lower edge of a region at the first blank line of a wider gap below it', () => {
        const text = 'p\n\n```\na\n\nb\n```\n\n\nq\n\nr';
        expect(snapAt(text, 12, 6).line).toBe(8);
        expect(snapAt(text, 12, 4).line).toBe(3);
    });

    it('snaps to the upper edge of a region at the last boundary of a wider gap above it', () => {
        expect(snapAt('p\n\n\n```\na\n\nb\n```\n\nq', 10, 5).line).toBe(4);
    });

    it('measures the nearer edge from the canonical seam of a wider gap, wherever the pointer is in it', () => {
        // `- a`'s subtree (lines 1–4) rejects the table, which snaps below the subtree from every row of the gap.
        const listText = '- a\n\n\n    - b\n\nP\n\n| t |\n|---|\n| 1 |';
        const listDoc = stringDoc(listText);
        const table = selectOne(detectBlock(listDoc, 8, { tabSize }) as Block);
        const input = {
            sourceDoc: listDoc,
            selection: table,
            sourceIndentWidth: 0,
            targetIndentWidth: 0,
            tabSize,
            indentUnit,
        };
        for (const hitLine of [2, 3]) {
            for (const belowMid of [false, true]) {
                const raw = locateDropPosition({ ...input, doc: listDoc, hitLine, belowMid });
                expect(snapDrop({ ...input, raw }).line).toBe(6);
            }
        }
        // `1. i3`'s subtree rejects the fence: the edge below it is a real move, not the fence's own gap above.
        const fenceText = '```\ncode1\n\n\ncode2\n```\n\n\n1. i3\n\n\n    2. i4';
        const fenceDoc = stringDoc(fenceText);
        const fence = selectOne(detectBlock(fenceDoc, 1, { tabSize }) as Block);
        const fenceInput = { ...input, sourceDoc: fenceDoc, selection: fence };
        for (const [hitLine, belowMid] of [
            [9, true],
            [10, false],
        ] as const) {
            const raw = locateDropPosition({ ...fenceInput, doc: fenceDoc, hitLine, belowMid });
            const snapped = snapDrop({ ...fenceInput, raw });
            expect(snapped.line).toBe(13);
            expect(
                planMove({ sourceDoc: fenceDoc, selection: fence, position: snapped, tabSize, indentUnit }),
            ).toMatchObject({
                type: 'ok',
            });
        }
    });

    it('measures the nearer edge from the seam of a gap of one blank line, wherever the pointer is in it', () => {
        // `- a`'s subtree (lines 3–9) rejects the fence; the pointer is over the blank line between b1 and b2.
        const text = 'p\n\n- a\n\n    b1\n\n    b2\n\n    b3\n\n```\nsrc\n```';
        const doc = stringDoc(text);
        const selection = selectOne(detectBlock(doc, 11, { tabSize }) as Block);
        const input = { sourceDoc: doc, selection, sourceIndentWidth: 0, targetIndentWidth: 0, tabSize, indentUnit };
        for (const belowMid of [false, true]) {
            const raw = locateDropPosition({ ...input, doc, hitLine: 6, belowMid });
            expect(raw.line).toBe(7);
            expect(snapDrop({ ...input, raw }).line).toBe(11);
        }
    });

    it('keeps the raw grey seam for a nested source', () => {
        const text = '> [!outer]\n> > [!note] A\n> > a\n\n```\nx\n```';
        expect(snapAt(text, 2, 5).line).toBe(5);
        expect(snapAt(text, 2, 6).line).toBe(6);
        // A quoted list item under an unquoted item, over its own line: it does not leave the item.
        expect(snapAt('- a\n    > - q\n    > - r\n- b', 2, 2).line).toBe(2);
    });

    it('re-derives the parent when snapping a list seam', () => {
        const position = snapAt('- a\n    - b\n- x\n    - y\n```ts\nz\n```', 2, 6);
        expect(position.line).toBe(5);
        expect(position.parent?.type).toBe(BlockType.ListItem);
        expect(position.parent?.lines.startLine).toBe(3);
    });
});

describe('domain locateDropPosition', () => {
    function locate(text: string, hitLine: number, belowMid: boolean, targetIndentWidth = 0): DropPosition {
        const sourceDoc = stringDoc('- source');
        const block = detectBlock(sourceDoc, 1, { tabSize });
        if (!block) throw new Error('missing source block');
        return locateDropPosition({
            doc: stringDoc(text),
            sourceDoc,
            selection: selectOne(block),
            hitLine,
            belowMid,
            sourceIndentWidth: 0,
            targetIndentWidth,
            tabSize,
            indentUnit,
        });
    }

    it('returns the canonical seam of the gap under the pointer', () => {
        const text = 'a\n\n> [!note] B\n> b\n\nc';
        expect(locate(text, 1, true).line).toBe(3);
        expect(locate(text, 2, false).line).toBe(3);
        expect(locate(text, 3, false).line).toBe(3);
        expect(locate(text, 4, true).line).toBe(6);
        expect(locate(text, 5, true).line).toBe(6);
        expect(locate(text, 7, false).line).toBe(7);
    });

    it('returns the boundary under the pointer in a gap of two or more blank lines', () => {
        const text = 'a\n\n\nb\n\n\n\nc';
        expect(locate(text, 1, true).line).toBe(2);
        expect(locate(text, 2, false).line).toBe(2);
        expect(locate(text, 2, true).line).toBe(3);
        expect(locate(text, 3, true).line).toBe(4);
        expect(locate(text, 4, false).line).toBe(4);
        expect(locate(text, 4, true).line).toBe(5);
        expect(locate(text, 6, false).line).toBe(6);
        expect(locate(text, 7, true).line).toBe(8);
        expect(locate(text, 8, false).line).toBe(8);
    });

    it('derives the parent from the gap’s seam, not the boundary under the pointer', () => {
        // On the first blank line under a quoted list, one step in: no item across the blank lines is a parent, so
        // the item is not written as indented code in a new quote.
        const doc = stringDoc('> - s\n> - a\n\n\nP');
        const position = locateDropPosition({
            doc,
            sourceDoc: doc,
            selection: selectOne(detectBlock(doc, 1, { tabSize }) as Block),
            hitLine: 2,
            belowMid: true,
            sourceIndentWidth: 0,
            targetIndentWidth: indentUnit,
            tabSize,
            indentUnit,
        });
        expect(position.line).toBe(3);
        expect(position.parent).toBeNull();
    });

    it('derives the list parent across a loose list’s blank line', () => {
        const position = locate('- a\n\n- b\n\npara', 5, false, indentUnit);
        expect(position.line).toBe(5);
        expect(position.parent?.lines.startLine).toBe(3);
    });

    it('takes no list item of another quote as the parent', () => {
        // Nesting under a callout's item would write `    - source` outside the callout: an indented code block.
        expect(
            locate('> [!todo] Today\n> - buy milk\n> - call mom\n\n- a\n- b', 5, false, indentUnit).parent,
        ).toBeNull();
        expect(locate('> [!todo] T\n> - m\n- a\n- b', 3, false, indentUnit).parent).toBeNull();
        // A quoted item's quote ends at a blank line.
        expect(nestUnder('> [!todo] T\n> - m\n\n> - q\n> - r', 4, 3).parent).toBeNull();
    });
});

describe('domain locateDropPosition quoted parent', () => {
    it('takes a quoted parent only in the quote the payload moves within', () => {
        // Under another quote the payload is written apart from it: `>     - a` after a blank line is code.
        expect(nestUnder('> - a\n> - b\n\n> [!todo] T\n> - x\n> - y', 1, 6).parent).toBeNull();
        expect(nestUnder('> - move', 1, 2, '> - q\n> - r').parent).toBeNull();
        expect(nestUnder('> - a\n> - b\n# H', 1, 2).parent?.lines.startLine).toBe(2);
    });

    it('lets a plain quote a list turns into an item take an unquoted parent, outside a quote', () => {
        expect(nestUnder('- parent\n\n> quote', 3, 1).parent?.lines.startLine).toBe(1);
        expect(nestUnder('> - parent\n\n> quote', 3, 1).parent).toBeNull();
        // Across a blank line below an item's quoted child, the seam is outside the quote.
        expect(nestUnder('- a\n    > q\n\nend\n\n> zz', 6, 2).parent?.lines.startLine).toBe(1);
        // Tight below the child too, where a paragraph nests: the seam is not between two quoted lines.
        expect(nestUnder('- a\n    > q\n- b\n\n> zz', 5, 2).parent?.lines.startLine).toBe(1);
    });

    it('offers a quoted parent only to list items, a nested block selected with its item included', () => {
        expect(nestUnder('> x\n> - a\n> - b', 1, 3).parent).toBeNull();
        // Between two quoted lines too, where the line would join the item's text.
        expect(nestUnder('> x\n> - a\n> - b', 1, 2).parent).toBeNull();
        const text = '> - b\n>     ```\n>     c\n>     ```\n> - a\n> - z';
        const doc = stringDoc(text);
        const blocks = [1, 2].map((line) => detectBlock(doc, line, { tabSize }) as Block);
        const position = locateDropPosition({
            doc,
            selection: selectBlocks(blocks),
            hitLine: 5,
            belowMid: true,
            sourceIndentWidth: 0,
            targetIndentWidth: indentUnit,
            tabSize,
            indentUnit,
        });
        expect(position.parent?.lines.startLine).toBe(5);
    });

    it('turns nothing without text into an item, so it keeps its quote', () => {
        expect(nestUnder('- a\n\n>', 3, 1).parent).toBeNull();
    });
});

describe('domain seamRow', () => {
    it('maps a drop line to the row the indicator sits on and its edge', () => {
        // a · · b c · callout(7–8) · · d
        const doc = stringDoc('a\n\n\nb\nc\n\n> [!note] C\n> c\n\n\nd');
        const row = (line: number) => seamRow({ doc, line, parent: null });
        expect(row(1)).toEqual({ row: 1, edge: 'top' });
        // The first blank line of a gap: its top, not the block above.
        expect(row(2)).toEqual({ row: 2, edge: 'top' });
        expect(row(3)).toEqual({ row: 2, edge: 'below' });
        expect(row(4)).toEqual({ row: 3, edge: 'below' });
        expect(row(5)).toEqual({ row: 4, edge: 'below' });
        expect(row(6)).toEqual({ row: 6, edge: 'top' });
        expect(row(7)).toEqual({ row: 6, edge: 'below' });
        // Under a callout, whose rows are hidden in its widget.
        expect(row(9)).toEqual({ row: 9, edge: 'top' });
        expect(row(11)).toEqual({ row: 10, edge: 'below' });
        expect(row(12)).toEqual({ row: 11, edge: 'below' });
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
