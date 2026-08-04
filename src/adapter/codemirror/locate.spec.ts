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

    it('snaps a seam inside a code fence to the nearest seam', () => {
        // Fence 2..4; seam 3 snaps to the before-fence edge (2) — the seam
        // right after the source block, accepted as a self/no-op target so
        // the indicator hugs the fence top like any block would.
        const position = snapAt('a\n```ts\nx\n```\nb', 1, 3);
        expect(position.line).toBe(2);
    });

    it('snaps a seam near the bottom of a tall fence after the block', () => {
        // Fence 2..6; seam 5 is 3 from the top edge and 2 from the after-fence edge.
        const position = snapAt('a\n```ts\nx\ny\nz\n```\nb', 1, 5);
        expect(position.line).toBe(7);
    });

    it('snaps a non-quote seam inside a short quote run to the run edge', () => {
        // Quote run 2..3; seam 3 snaps to the before-run seam (2) — the
        // source-adjacent seam, preferred over the after-run seam (5).
        const position = snapAt('a\n> q1\n> q2\nb', 1, 3);
        expect(position.line).toBe(2);
    });

    it('snaps to the source-adjacent seam when no far seam is in reach', () => {
        // 7-line quote run 2..8; every far seam within ±4 is rejected, so the
        // snap lands on the before-run seam (2), the source's own no-op edge.
        const position = snapAt('p\n> q1\n> q2\n> q3\n> q4\n> q5\n> q6\n> q7\n> q8', 1, 6);
        expect(position.line).toBe(2);
    });

    it('keeps the grey seam when hovering back over the source block', () => {
        const position = snapAt('- item one\n- item two', 1, 1);
        expect(position.line).toBe(1);
    });

    it("snaps the source fence's own body to its own edges, like any block", () => {
        // The fence's own body rejects as a container (inside_code_block),
        // and the snap hugs the fence's own top/bottom edge — the same
        // behaviour as dragging any other block over it.
        const text = 'intro\n```ts\nx\n```\noutro';
        expect(snapAt(text, 2, 3).line).toBe(2); // upper half → own top edge
        expect(snapAt(text, 2, 4).line).toBe(5); // lower half → own bottom edge
        // The no-op seam right below the fence (endLine + 1) stays grey.
        expect(snapAt(text, 2, 5).line).toBe(5);
        // Outside the source fence, normal seams still resolve.
        expect(snapAt(text, 2, 1).line).toBe(1);
        expect(snapAt(text, 2, 6).line).toBe(6);
    });

    it('snaps past a rule even when the seam is right below the source', () => {
        // Seam 2 is the source-adjacent no-op seam and also hr_before; the
        // container rule governs, so the snap lands after the rule (3).
        expect(snapAt('a\n---\nb', 1, 2).line).toBe(3);
    });

    it('snaps a non-list seam inside a nested list subtree to the boundary', () => {
        // '- a' subtree 2..4; seam 4 (before "- c") is inside the subtree for
        // a non-list source; the after-subtree seam 5 is 1 away.
        const position = snapAt('p\n- a\n    - b\n    - c\nq', 1, 4);
        expect(position.line).toBe(5);
    });

    it('snaps a table_before seam to the nearest accepted seam', () => {
        // The source is not adjacent to the table (blank line between), so
        // the seam is a genuine container rejection; the domain treats the
        // seam between the header row and the separator (5) as outside.
        const position = snapAt('x\npara\n\n| a | b |\n|---|', 2, 4);
        expect(position.line).toBe(5);
    });

    it('snaps a callout_after seam past the callout', () => {
        // The seam at the document end (5) sits right after the callout body
        // and is rejected; the nearest accepted seam is before the callout
        // (3), so the snap lands there.
        const position = snapAt('para\n\n> [!note] Callout\n> body', 1, 5);
        expect(position.line).toBe(3);
    });

    it('snaps an hr_before seam after the rule', () => {
        // Source is not adjacent to the hr, so the seam is a genuine
        // hr_before rejection and the snap lands right after the rule.
        const position = snapAt('a\nb\n---\nc', 1, 3);
        expect(position.line).toBe(4);
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
