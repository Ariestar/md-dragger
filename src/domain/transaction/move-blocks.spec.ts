import { describe, expect, it } from 'vitest';
import { detectBlock } from '../block/block-detector';
import type { Block } from '../block/block-types';
import type { DropPosition } from '../command/drop-position';
import type { Doc } from '../markdown/document-types';
import { locateDropPosition, snapDrop } from '../markdown/drop-locate';
import { planMove } from '../move/move-plan';
import { selectBlocks, selectOne } from '../selection/block-selection';
import type { DocEdit } from './block-transaction';
import { moveTx } from './move-blocks';
import { stringDoc } from './string-doc';

const tabSize = 4;
const indentUnit = 4;

/** Move the block at fromLine to the seam before toLine and apply the edits. */
function moveAndApply(text: string, fromLine: number, toLine: number): string {
    const doc = stringDoc(text);
    const block = detectBlock(doc, fromLine, { tabSize });
    if (!block) throw new Error(`no block at line ${fromLine}`);
    const position: DropPosition = { doc, line: toLine, parent: null };
    const planned = planMove({ sourceDoc: doc, selection: selectOne(block), position, tabSize, indentUnit });
    if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
    const edits = moveTx({ sourceDoc: doc, plan: planned.value });
    if (!Array.isArray(edits)) throw new Error(`move rejected: ${edits.reason}`);
    return applyEdits(text, edits);
}

function blockAt(doc: Doc, line: number): Block {
    const block = detectBlock(doc, line, { tabSize });
    if (!block) throw new Error(`no block at line ${line}`);
    return block;
}

/** Move the blocks at fromLines to the raw seam before toLine, nested under the list item at parentLine (or at the root). */
function moveUnder(text: string, fromLines: number[], toLine: number, parentLine: number | null): string {
    const doc = stringDoc(text);
    const selection = selectBlocks(fromLines.map((line) => blockAt(doc, line)));
    const parent = parentLine === null ? null : blockAt(doc, parentLine);
    const planned = planMove({
        sourceDoc: doc,
        selection,
        position: { doc, line: toLine, parent },
        tabSize,
        indentUnit,
    });
    if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
    const edits = moveTx({ sourceDoc: doc, plan: planned.value });
    if (!Array.isArray(edits)) throw new Error(`move rejected: ${edits.reason}`);
    return applyEdits(text, edits);
}

/** DocEdit changes are sorted descending by offset; apply in order. */
function applyEdits(text: string, edits: DocEdit[]): string {
    let out = text;
    for (const edit of edits) {
        for (const c of edit.changes) {
            out = out.slice(0, c.from) + c.insert + out.slice(c.to);
        }
    }
    return out;
}

describe('moveTx ordered-list renumber', () => {
    it('renumbers the run when an item is moved to the top', () => {
        expect(moveAndApply('1. a\n2. b\n3. c', 2, 1)).toBe('1. b\n2. a\n3. c');
    });

    it('renumbers the run when an item is moved out of the middle', () => {
        expect(moveAndApply('1. a\n2. b\n3. c', 2, 4)).toBe('1. a\n2. c\n3. b');
    });

    it('renumbers when the top item is moved to the end', () => {
        expect(moveAndApply('1. a\n2. b\n3. c', 1, 4)).toBe('1. b\n2. c\n3. a');
    });

    it('keeps geometry-only edits when the numbers are already sequential', () => {
        // Moving a paragraph after the list does not renumber (no spurious
        // whole-document replace): the list stays 1., 2.
        expect(moveAndApply('para\n1. a\n2. b', 1, 4)).toBe('1. a\n2. b\npara');
    });

    it('composes renumber as precise marker edits, not a document replace', () => {
        // A whole-document replace makes the editor lose its scroll anchor
        // (viewport jumps to the top) and re-renders everything; the move
        // must emit only the marker edits it needs, nothing spanning the
        // document body.
        const text = 'prefix\n1. a\n2. b\n3. c\nsuffix';
        const doc = stringDoc(text);
        const block = detectBlock(doc, 3, { tabSize });
        if (!block) throw new Error('no block at line 3');
        const position: DropPosition = { doc, line: 2, parent: null };
        const planned = planMove({ sourceDoc: doc, selection: selectOne(block), position, tabSize, indentUnit });
        if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
        const edits = moveTx({ sourceDoc: doc, plan: planned.value });
        if (!Array.isArray(edits)) throw new Error(`move rejected: ${edits.reason}`);

        expect(edits).toHaveLength(1);
        // Marker edits + the source delete; nothing larger than the moved
        // block itself.
        expect(edits[0].changes.length).toBeLessThanOrEqual(2);
        for (const c of edits[0].changes) {
            expect(c.to - c.from).toBeLessThanOrEqual(5);
        }
        expect(applyEdits(text, edits)).toBe('prefix\n1. b\n2. a\n3. c\nsuffix');
    });

    it('leaves an unrelated non-sequential run untouched', () => {
        // '3. c\n5. d' is a pre-existing non-sequential run, separated from
        // the moved paragraph by blank lines — the move must not rewrite it.
        expect(moveAndApply('1. a\n2. b\n\npara\n\n3. c\n5. d', 4, 1)).toBe('para\n1. a\n2. b\n\n\n3. c\n5. d');
    });

    it('leaves a run untouched when a paragraph lands next to it', () => {
        // Moving 'para' to the top puts it before the run; a paragraph does
        // not join a list, so '3. c\n5. d' stays as-is.
        expect(moveAndApply('3. c\n5. d\n\npara', 4, 1)).toBe('para\n3. c\n5. d\n');
    });

    it('renumbers a run the moved item joins, folding its new marker into the insert', () => {
        // '1. x' lands after the run (seam 5 = end of the 4-line doc) and
        // joins it; the whole run renumbers and the moved item's own marker
        // is rewritten inside the inserted text. The blank line that
        // separated the blocks stays as the document's first line.
        expect(moveAndApply('1. x\n\n2. a\n3. b', 1, 5)).toBe('\n1. a\n2. b\n3. x');
    });

    it('renumbers the run that merges across the deleted paragraph', () => {
        // Deleting the paragraph between two run segments joins them into one
        // non-sequential run, which the move must renumber.
        expect(moveAndApply('1. a\npara\n3. c', 2, 4)).toBe('1. a\n2. c\npara');
    });

    it('renumbers no ordered run across a bullet item', () => {
        // `1. a` lands under `- x`: it starts a new ordered list, which is not `1. d`'s run.
        expect(moveAndApply('1. a\n2. d\n- x\n- y\n', 1, 4)).toBe('1. d\n- x\n1. a\n- y\n');
        expect(moveUnder('1. a\n    1. b\n    2. c\n2. d\n- x\n- y\n', [4], 6, 5)).toBe(
            '1. a\n    1. b\n    2. c\n- x\n    2. d\n- y\n',
        );
    });

    it('leaves the run above a block moved out of the end of the document untouched', () => {
        // The removal reaches the document end: no row follows it, so `3. c\n5. d` is not the moved block's run.
        const sourceDoc = stringDoc('3. c\n5. d\npara');
        const block = detectBlock(sourceDoc, 3, { tabSize });
        if (!block) throw new Error('no block at line 3');
        const planned = planMove({
            sourceDoc,
            selection: selectOne(block),
            position: { doc: stringDoc('x'), line: 1, parent: null },
            tabSize,
            indentUnit,
        });
        if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
        const edits = moveTx({ sourceDoc, plan: planned.value });
        if (!Array.isArray(edits)) throw new Error(`move rejected: ${edits.reason}`);
        const source = edits.find((e) => e.doc === sourceDoc);
        if (!source) throw new Error('missing source edit');
        expect(applyEdits('3. c\n5. d\npara', [source])).toBe('3. c\n5. d');
    });

    it('renumbers the target run when moving into another document', () => {
        // Cross-doc: the inserted item joins the target doc's run (folding
        // its new marker into the insert) and the source doc just loses the
        // block.
        const sourceDoc = stringDoc('1. x\n');
        const targetDoc = stringDoc('2. a\n3. b');
        const block = detectBlock(sourceDoc, 1, { tabSize });
        if (!block) throw new Error('no block at line 1');
        const position: DropPosition = { doc: targetDoc, line: 3, parent: null };
        const planned = planMove({
            sourceDoc,
            selection: selectOne(block),
            position,
            tabSize,
            indentUnit,
        });
        if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
        const edits = moveTx({ sourceDoc, plan: planned.value });
        if (!Array.isArray(edits)) throw new Error(`move rejected: ${edits.reason}`);

        expect(edits).toHaveLength(2);
        const target = edits.find((e) => e.doc === targetDoc);
        const source = edits.find((e) => e.doc === sourceDoc);
        expect(target).toBeDefined();
        expect(source).toBeDefined();
        if (!target || !source) return;
        expect(applyEdits('2. a\n3. b', [target])).toBe('1. a\n2. b\n3. x');
        expect(applyEdits('1. x\n', [source])).toBe('');
    });
});

describe('moveTx in-place list indent change', () => {
    it('replaces an in-place list indent change in place', () => {
        const text = '- a\n- b\n\npara';
        const doc = stringDoc(text);
        const position: DropPosition = { doc, line: 2, parent: blockAt(doc, 1) };
        const planned = planMove({
            sourceDoc: doc,
            selection: selectOne(blockAt(doc, 2)),
            position,
            tabSize,
            indentUnit,
        });
        if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
        expect(planned.value.allowIndent).toBe(true);
        const edits = moveTx({ sourceDoc: doc, plan: planned.value });
        if (!Array.isArray(edits)) throw new Error(`move rejected: ${edits.reason}`);
        expect(edits[0].changes).toEqual([{ from: 4, to: 7, insert: '    - b' }]);
        expect(applyEdits(text, edits)).toBe('- a\n    - b\n\npara');
    });

    it('indents every selected segment in place, once', () => {
        expect(moveUnder('- a\n- b\n- c', [2, 3], 2, 1)).toBe('- a\n    - b\n    - c');
        // Two segments: b and c are separated by the unselected x.
        expect(moveUnder('- a\n- b\n- x\n- c', [2, 4], 2, 1)).toBe('- a\n    - b\n- x\n    - c');
        // Each segment once; the numbers are the renumberer's own (it numbers runs split by indent separately).
        expect(moveUnder('1. a\n2. b\n3. x\n4. c\n', [2, 4], 2, 1)).toBe('1. a\n    2. b\n1. x\n    4. c\n');
    });

    it('changes an ordered item’s level in place without duplicating it when renumbering fires', () => {
        // Outdent, at the gap below the source and at its own line.
        expect(moveUnder('1. a\n    1. b\n2. c', [2], 3, null)).toBe('1. a\n2. b\n3. c');
        expect(moveUnder('1. a\n    1. b\n2. c', [2], 2, null)).toBe('1. a\n2. b\n3. c');
        // Nest, at the gap below the source and at its own line.
        expect(moveUnder('3. a\n4. b\n', [2], 3, 1)).toBe('1. a\n    4. b\n');
        expect(moveUnder('3. a\n4. b\n', [2], 2, 1)).toBe('1. a\n    4. b\n');
    });

    it('renumbers an empty ordered item, and the sublist it leaves, when its level changes in place', () => {
        expect(moveUnder('1. a\n    1. \n2. c', [2], 2, null)).toBe('1. a\n2. \n3. c');
        // The sublist `b` leaves restarts at 1; `2. c` keeps its number (runs split by indent are numbered apart).
        expect(moveUnder('1. a\n    1. b\n    2. x\n2. c', [2], 2, null)).toBe('1. a\n2. b\n    1. x\n2. c');
    });

    it('outdents an ordered child through the pointer pipeline without duplicating it', () => {
        const text = '1. a\n    1. b\n    2. c\n2. d\n';
        const doc = stringDoc(text);
        const selection = selectOne(blockAt(doc, 3));
        const locate = {
            doc,
            sourceDoc: doc,
            selection,
            sourceIndentWidth: 4,
            targetIndentWidth: 0,
            tabSize,
            indentUnit,
        };
        const raw = locateDropPosition({ ...locate, hitLine: 3, belowMid: true });
        const position = snapDrop({
            raw,
            sourceDoc: doc,
            selection,
            sourceIndentWidth: 4,
            targetIndentWidth: 0,
            tabSize,
            indentUnit,
        });
        expect(position).toMatchObject({ line: 4, parent: null });
        const planned = planMove({ sourceDoc: doc, selection, position, tabSize, indentUnit });
        if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
        const edits = moveTx({ sourceDoc: doc, plan: planned.value });
        if (!Array.isArray(edits)) throw new Error(`move rejected: ${edits.reason}`);
        expect(applyEdits(text, edits)).toBe('1. a\n    1. b\n1. c\n2. d\n');
    });
});

describe('moveTx list re-levelling', () => {
    const fence = '```';

    it("keeps a nested item's fence, heading and rule children when it nests", () => {
        expect(moveUnder(`- a\n- c\n- b\n    ${fence}js\n    code\n    ${fence}\n`, [3], 2, 1)).toBe(
            `- a\n    - b\n        ${fence}js\n        code\n        ${fence}\n- c\n`,
        );
        expect(moveUnder('- a\n- c\n- b\n    # Sub\n    ***\n', [3], 2, 1)).toBe(
            '- a\n    - b\n        # Sub\n        ***\n- c\n',
        );
    });

    it("keeps a nested item's table and math children when it nests", () => {
        expect(moveUnder('- a\n- b\n\n- x\n\n    | h |\n    |---|\n    | c |\n    tail', [4], 2, 1)).toBe(
            '- a\n    - x\n\n        | h |\n        |---|\n        | c |\n        tail\n- b\n',
        );
        expect(moveUnder('- a\n- c\n- b\n    $$\n    x^2\n    $$\n', [3], 2, 1)).toBe(
            '- a\n    - b\n        $$\n        x^2\n        $$\n- c\n',
        );
    });

    it("keeps an item's fence child when it moves out to the root", () => {
        expect(moveUnder(`- a\n    - b\n        ${fence}\n        code\n        ${fence}\n- c\n`, [2], 7, null)).toBe(
            `- a\n- c\n- b\n    ${fence}\n    code\n    ${fence}\n`,
        );
    });
});

describe('moveTx copy mode', () => {
    function copyAndApply(text: string, fromLine: number, toLine: number): string {
        const doc = stringDoc(text);
        const block = detectBlock(doc, fromLine, { tabSize });
        if (!block) throw new Error(`no block at line ${fromLine}`);
        const position: DropPosition = { doc, line: toLine, parent: null };
        const planned = planMove({
            sourceDoc: doc,
            selection: selectOne(block),
            position,
            tabSize,
            indentUnit,
            mode: 'copy',
        });
        if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
        const edits = moveTx({ sourceDoc: doc, plan: planned.value });
        if (!Array.isArray(edits)) throw new Error(`copy rejected: ${edits.reason}`);
        return applyEdits(text, edits);
    }

    it('duplicates a paragraph at the target position while keeping the source', () => {
        expect(copyAndApply('first\n\nsecond', 1, 3)).toBe('first\n\nfirst\nsecond');
    });

    it('duplicates an ordered list item and renumbers correctly', () => {
        expect(copyAndApply('1. a\n2. b', 1, 3)).toBe('1. a\n2. b\n3. a');
    });

    it('duplicates an item right below itself in place', () => {
        expect(copyAndApply('- item 1\n- item 2', 1, 2)).toBe('- item 1\n- item 1\n- item 2');
    });
});

describe('moveTx context adaptation', () => {
    function nestAndApply(text: string, fromLine: number, toLine: number, parentLine: number): string {
        const doc = stringDoc(text);
        const block = detectBlock(doc, fromLine, { tabSize });
        if (!block) throw new Error(`no block at line ${fromLine}`);
        const parent = detectBlock(doc, parentLine, { tabSize });
        const position: DropPosition = { doc, line: toLine, parent };
        const planned = planMove({
            sourceDoc: doc,
            selection: selectOne(block),
            position,
            tabSize,
            indentUnit,
        });
        if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
        const edits = moveTx({ sourceDoc: doc, plan: planned.value });
        if (!Array.isArray(edits)) throw new Error(`move rejected: ${edits.reason}`);
        return applyEdits(text, edits);
    }

    it('adapts a paragraph into a child list item when nested under a list item', () => {
        expect(nestAndApply('- item 1\n- item 2\n\nparagraph', 4, 2, 1)).toBe('- item 1\n    - paragraph\n- item 2\n');
    });

    it('adapts a heading into an ordered child list item and renumbers correctly', () => {
        expect(nestAndApply('1. item 1\n2. item 2\n\n### Heading', 4, 2, 1)).toBe(
            '1. item 1\n    1. Heading\n2. item 2\n',
        );
    });
});
