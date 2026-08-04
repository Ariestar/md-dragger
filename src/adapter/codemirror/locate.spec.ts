import { describe, expect, it } from 'vitest';
import { BlockType, type DropPosition, detectBlock, parseLine, selectOne } from '../../domain';
import { stringDoc } from '../../domain/transaction/string-doc';
import { snapDropPosition } from './locate';

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
    return snapDropPosition({
        raw,
        sourceDoc: doc,
        selection,
        sourceIndentWidth,
        targetIndentWidth: sourceIndentWidth,
        tabSize,
        indentUnit,
    });
}

describe('adapter/codemirror snapDropPosition', () => {
    it('keeps a valid seam untouched', () => {
        const position = snapAt('a\nb\nc', 1, 2);
        expect(position.line).toBe(2);
        expect(position.parent).toBeNull();
    });

    it('snaps a seam inside a code fence to the nearest fence edge', () => {
        // Fence 2..4; seam 3 is inside. The before-fence edge (2) is the seam
        // right after the source block — a self-range no-op — so the after-
        // fence edge (5) wins.
        const position = snapAt('a\n```ts\nx\n```\nb', 1, 3);
        expect(position.line).toBe(5);
    });

    it('snaps a seam near the bottom of a tall fence after the block', () => {
        // Fence 2..6; seam 5 is 3 from the top edge and 2 from the after-fence edge.
        const position = snapAt('a\n```ts\nx\ny\nz\n```\nb', 1, 5);
        expect(position.line).toBe(7);
    });

    it('snaps a non-quote seam inside a short quote run outside it', () => {
        // Quote run 2..3 forbids adjacency (quote_boundary); nearest valid
        // seams are 1 and 5 — the equidistant tie prefers the one below.
        const position = snapAt('a\n> q1\n> q2\nb', 1, 3);
        expect(position.line).toBe(5);
    });

    it('keeps the grey seam when no valid seam is within reach', () => {
        // 7-line quote run 2..8; every seam within ±4 is inside the run or a
        // rejected quote_boundary edge, so the raw seam survives.
        const position = snapAt('p\n> q1\n> q2\n> q3\n> q4\n> q5\n> q6\n> q7\n> q8', 1, 6);
        expect(position.line).toBe(6);
    });

    it('keeps the grey seam when hovering back over the source block', () => {
        const position = snapAt('- item one\n- item two', 1, 1);
        expect(position.line).toBe(1);
    });

    it('snaps a non-list seam inside a nested list subtree to the boundary', () => {
        // '- a' subtree 2..4; seam 4 (before "- c") is inside the subtree for
        // a non-list source; the after-subtree seam 5 is 1 away.
        const position = snapAt('p\n- a\n    - b\n    - c\nq', 1, 4);
        expect(position.line).toBe(5);
    });

    it('snaps a table_before seam to the nearest accepted seam', () => {
        // Seam 2 (before the table) is rejected; the domain treats the seam
        // between the header row and the separator (3) as outside, so the
        // snap lands there rather than jumping above the previous block.
        const position = snapAt('para\n| a | b |\n|---|', 1, 2);
        expect(position.line).toBe(3);
    });

    it('snaps a callout_after seam past the line after the callout', () => {
        const position = snapAt('> [!note] Callout\n> body\nnext', 1, 3);
        expect(position.line).toBe(4);
    });

    it('snaps an hr_before seam after the rule', () => {
        const position = snapAt('a\n---\nb', 1, 2);
        expect(position.line).toBe(3);
    });

    it('re-derives the parent when snapping a list seam', () => {
        // A nested item dragged over a fence snaps to the seam before the
        // fence; the parent is re-derived from that seam line (as a child of
        // the second list's head) instead of staying null.
        const position = snapAt('- a\n    - b\n- x\n    - y\n```ts\nz\n```', 2, 6);
        expect(position.line).toBe(5);
        expect(position.parent?.type).toBe(BlockType.ListItem);
        expect(position.parent?.lines.startLine).toBe(3);
    });
});
