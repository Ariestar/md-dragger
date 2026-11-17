import { describe, expect, it } from 'vitest';
import { detectBlock } from '../block/block-detector';
import type { Block } from '../block/block-types';
import { selectBlocks } from '../selection/block-selection';
import { planDelete } from './delete-blocks';
import { stringDoc } from './string-doc';

const tabSize = 4;

/** Delete the blocks at `lines` and apply the edit. */
function deleteAndApply(text: string, lines: number[]): string {
    const doc = stringDoc(text);
    const blocks = lines.map((line): Block => {
        const block = detectBlock(doc, line, { tabSize });
        if (!block) throw new Error(`no block at line ${line}`);
        return block;
    });
    const result = planDelete({ doc, selection: selectBlocks(blocks), tabSize });
    if ('type' in result) throw new Error(`delete rejected: ${result.reason}`);
    let out = text;
    for (const c of result.changes) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
    return out;
}

describe('planDelete', () => {
    it('deletes a middle block, leaving the larger of its two gaps between its neighbours', () => {
        expect(deleteAndApply('A\n\nB\n\nC', [3])).toBe('A\n\nC');
        expect(deleteAndApply('A\n\nB\n\n\nC', [3])).toBe('A\n\n\nC');
        expect(deleteAndApply('A\n\n\nB\n\nC', [4])).toBe('A\n\n\nC');
        expect(deleteAndApply('A\nB\n\nC', [2])).toBe('A\n\nC');
        expect(deleteAndApply('alpha\nbeta\ngamma', [2])).toBe('alpha\ngamma');
    });

    it('deletes the first block with its blank lines below, keeping padding and frontmatter', () => {
        expect(deleteAndApply('A\n\nB', [1])).toBe('B');
        expect(deleteAndApply('\nA\n\nB', [2])).toBe('\nB');
        expect(deleteAndApply('\n\nA\n\nB', [3])).toBe('\n\nB');
        expect(deleteAndApply('---\nt\n---\n\nA\n\nB', [5])).toBe('---\nt\n---\n\nB');
        expect(deleteAndApply('---\nt: x\n---\nA\n\nB', [4])).toBe('---\nt: x\n---\nB');
    });

    it('deletes the last block with its blank lines above, keeping the final newline', () => {
        expect(deleteAndApply('A\n\nB\n', [3])).toBe('A\n');
        expect(deleteAndApply('A\n\nB', [3])).toBe('A');
        expect(deleteAndApply('A\n\nB\n\n', [3])).toBe('A\n\n');
        expect(deleteAndApply('alpha\nbeta', [2])).toBe('alpha');
    });

    it('deletes the only block', () => {
        expect(deleteAndApply('1. x\n', [1])).toBe('');
        expect(deleteAndApply('x', [1])).toBe('');
        expect(deleteAndApply('\nx', [2])).toBe('');
        expect(deleteAndApply('x\n\n', [1])).toBe('\n');
        expect(deleteAndApply('---\nt: x\n---\nx', [4])).toBe('---\nt: x\n---');
    });

    it('deletes two non-contiguous blocks', () => {
        expect(deleteAndApply('A\n\nB\n\nC\n\nD\n', [3, 7])).toBe('A\n\nC\n');
        // Blocks separated only by blank lines go as one segment, with those blank lines.
        expect(deleteAndApply('A\n\nB1\n\nB2\n\nC', [3, 5])).toBe('A\n\nC');
        expect(deleteAndApply('> [!a] A\n> a\n\nkeep\n\n> [!b] B\n> b', [1, 6])).toBe('keep');
    });

    it('keeps the paragraphs around a deleted block apart', () => {
        expect(deleteAndApply('p1\n# H\np2', [2])).toBe('p1\n\np2');
        expect(deleteAndApply('p1\n> q\np2', [2])).toBe('p1\n\np2');
        expect(deleteAndApply('> [!a] A\n# H\n> [!b] B', [2])).toBe('> [!a] A\n\n> [!b] B');
    });

    it('keeps the lines of one paragraph joined when a line between them goes', () => {
        expect(deleteAndApply('l1\nl2\nl3', [2])).toBe('l1\nl3');
        // So do other neighbours that may touch.
        expect(deleteAndApply('# H\npara\n# I', [2])).toBe('# H\n# I');
        expect(deleteAndApply('- a\n- b\n- c', [2])).toBe('- a\n- c');
    });

    it('deletes a list item and its child once', () => {
        expect(deleteAndApply('- a\n    child\n- b', [1, 2])).toBe('- b');
        expect(deleteAndApply('- a\n- b\n    child\n- c', [2, 3])).toBe('- a\n- c');
    });

    it('leaves the gap a list boundary had, so no list turns loose or tight', () => {
        // The sublist's last item goes: the root list stays tight, as the end of `o`'s subtree was before `p`.
        expect(deleteAndApply('- o\n    - o1\n\n    - o2\n- p', [4])).toBe('- o\n    - o1\n- p');
        // The first child goes: the next child takes the parent-to-first-child spacing.
        expect(deleteAndApply('- x\n    - c1\n\n    - c2', [2])).toBe('- x\n    - c2');
        // Between siblings of one list the larger gap stays.
        expect(deleteAndApply('- a\n\n- b\n- c', [3])).toBe('- a\n\n- c');
    });

    it('keeps a callout whole when a block nested in it is deleted', () => {
        expect(deleteAndApply('> [!outer]\n>\n> > [!note] A\n> > a\n>\n> > [!note] B\n> > b', [3])).toBe(
            '> [!outer]\n>\n>\n> > [!note] B\n> > b',
        );
        // Also where no `>` line stands beside the deleted block.
        expect(deleteAndApply('> [!note] T\n> a\n> # H\n> c', [3])).toBe('> [!note] T\n> a\n> c');
    });

    it('keeps the rest of an item’s paragraph joined when one of its lines is deleted', () => {
        expect(deleteAndApply('- a\n    c1\n    c2\n- b', [2])).toBe('- a\n    c2\n- b');
        // A different block between the item line and the paragraph keeps them apart.
        expect(deleteAndApply('- a\n    ```\n    code\n    ```\n    tail\n- b', [2])).toBe('- a\n\n    tail\n- b');
    });

    it('separates two quotes the deleted block stood between', () => {
        expect(deleteAndApply('> [!note] N\n> n\n# H\n> - a\n> - b', [3])).toBe('> [!note] N\n> n\n\n> - a\n> - b');
        expect(deleteAndApply('> - a\n> - b\n> - c', [2])).toBe('> - a\n> - c');
    });

    it('keeps a quote whole when a nested quote between its paragraphs is deleted', () => {
        expect(deleteAndApply('> a\n> > b\n>\n> c\n\nend', [2])).toBe('> a\n>\n> c\n\nend');
        expect(deleteAndApply('> a\n>\n> > b\n> c\n\nend', [3])).toBe('> a\n>\n> c\n\nend');
    });

    it('separates a list inside a quote from the list below it', () => {
        expect(deleteAndApply('> - a\n> - b\n1. x\n2. y', [3])).toBe('> - a\n> - b\n\n2. y');
    });

    it('separates an ordered item it does not renumber from the paragraph above', () => {
        // `2. b` cannot interrupt a paragraph; a delete does not renumber it.
        expect(deleteAndApply('intro:\n1. a\n2. b', [2])).toBe('intro:\n\n2. b');
    });

    it('rejects deleting the first block when that would turn the note into frontmatter', () => {
        const doc = stringDoc('Intro\n\n---\n\nsecret: content\n\n---\n\nstay');
        const block = detectBlock(doc, 1, { tabSize });
        if (!block) throw new Error('no block');
        expect(planDelete({ doc, selection: selectBlocks([block]), tabSize })).toEqual({
            type: 'reject',
            reason: 'frontmatter_fence',
        });
        expect(deleteAndApply('Intro\n\n---\n\nstay', [1])).toBe('---\n\nstay');
    });

    it('keeps a quote whole when a quote line without text follows the deleted lines', () => {
        expect(deleteAndApply('> - x\n> - y\n>\n> 1. a', [2])).toBe('> - x\n>\n> 1. a');
    });

    it('keeps a blank line above an ordered item left starting a list under a list line', () => {
        // A delete renumbers nothing, and only a list starting at 1 can interrupt the line above.
        expect(deleteAndApply('- p\n    - q\n        - r\n\n1. a\n2. b\n\nend', [3, 5])).toBe(
            '- p\n    - q\n\n2. b\n\nend',
        );
        expect(deleteAndApply('- x\n- y\n\n1. a\n2. b', [2, 4])).toBe('- x\n\n2. b');
        // No number lets an empty item interrupt the line above, `1.` included.
        expect(deleteAndApply('- x\n- y\n\n0. a\n1. \n2. c', [2, 4])).toBe('- x\n\n1. \n2. c');
        // Inside a quote a blank line would split it.
        expect(deleteAndApply('> [!note] t\n> - x\n> 1. a\n> 2. b', [3])).toBe('> [!note] t\n> - x\n> 2. b');
        // An item that continues its list across a nested child stays tight.
        expect(deleteAndApply('1. a\n    - n\n    - m\n2. b', [3])).toBe('1. a\n    - n\n2. b');
    });

    it('keeps a blank line above an empty bullet item left starting a list under a list line', () => {
        // No empty item can interrupt the line above: one that does not continue a bullet list at its indent keeps
        // the blank line the deleted lines held, nested or not.
        expect(deleteAndApply('1. x\n2. y\n\n- a\n- \n- c', [2, 4])).toBe('1. x\n\n- \n- c');
        expect(deleteAndApply('1. x\n    1. y\n\n    - a\n    - \n    - c', [2, 4])).toBe('1. x\n\n    - \n    - c');
        // A blank line inside a deleted block goes with it.
        expect(deleteAndApply('1. a\n    - b\n1. c\n\n    - d\n* \n* e', [3])).toBe('1. a\n    - b\n* \n* e');
    });

    it('deletes a nested item with its quoted child list, and not the sibling after it', () => {
        expect(deleteAndApply('- root\n    - a\n        > - q\n    - b\n- end', [2])).toBe('- root\n    - b\n- end');
        expect(deleteAndApply('- root\n    - a\n        > - q\n    # tail\n- end', [2])).toBe(
            '- root\n    # tail\n- end',
        );
    });

    it('rejects an empty selection', () => {
        const doc = stringDoc('a');
        expect(planDelete({ doc, selection: { blocks: [] }, tabSize })).toEqual({
            type: 'reject',
            reason: 'empty_selection',
        });
    });
});
