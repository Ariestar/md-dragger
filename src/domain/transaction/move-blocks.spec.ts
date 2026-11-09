import { describe, expect, it } from 'vitest';
import { detectBlock } from '../block/block-detector';
import type { Block } from '../block/block-types';
import type { DropPosition, DropZone } from '../command/drop-position';
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

/** Plan moving the blocks at fromLines to the raw seam before toLine: the plan result. */
function planBlocks(text: string, fromLines: number[], toLine: number) {
    const doc = stringDoc(text);
    const selection = selectBlocks(fromLines.map((line) => blockAt(doc, line)));
    return planMove({ sourceDoc: doc, selection, position: { doc, line: toLine, parent: null }, tabSize, indentUnit });
}

/** Plan moving the blocks at fromLines of sourceText to the raw seam before toLine of targetText. */
function planAcross(sourceText: string, fromLines: number[], targetText: string, toLine: number) {
    const sourceDoc = stringDoc(sourceText);
    const selection = selectBlocks(fromLines.map((line) => blockAt(sourceDoc, line)));
    const position = { doc: stringDoc(targetText), line: toLine, parent: null };
    return { sourceDoc, planned: planMove({ sourceDoc, selection, position, tabSize, indentUnit }) };
}

/** Move the blocks at fromLines of sourceText to the raw seam before toLine of targetText: [target, source]. */
function moveAcross(sourceText: string, fromLines: number[], targetText: string, toLine: number): string[] {
    const { sourceDoc, planned } = planAcross(sourceText, fromLines, targetText, toLine);
    if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
    const edits = moveTx({ sourceDoc, plan: planned.value });
    if (!Array.isArray(edits)) throw new Error(`move rejected: ${edits.reason}`);
    const docs = [planned.value.position.doc, sourceDoc];
    return [targetText, sourceText].map((text, i) =>
        applyEdits(
            text,
            edits.filter((e) => e.doc === docs[i]),
        ),
    );
}

/** Move the blocks at fromLines to the raw seam before toLine, nested under the list item at parentLine (or at the root). */
function moveUnder(text: string, fromLines: number[], toLine: number, parentLine: number | null = null): string {
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

/** Plan moving the blocks at fromLines to the raw seam before toLine (under the item at parentLine), landing in
 * `zone` of the gap. */
function planZone(text: string, fromLines: number[], toLine: number, zone: DropZone, parentLine: number | null = null) {
    const doc = stringDoc(text);
    const selection = selectBlocks(fromLines.map((line) => blockAt(doc, line)));
    const parent = parentLine === null ? null : blockAt(doc, parentLine);
    return planMove({
        sourceDoc: doc,
        selection,
        position: { doc, line: toLine, parent, zone },
        tabSize,
        indentUnit,
    });
}

/** Move the blocks at fromLines to the raw seam before toLine (under the item at parentLine), landing in `zone` of
 * the gap, and apply the edits. */
function moveZone(
    text: string,
    fromLines: number[],
    toLine: number,
    zone: DropZone,
    parentLine: number | null = null,
): string {
    const planned = planZone(text, fromLines, toLine, zone, parentLine);
    if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
    const edits = moveTx({ sourceDoc: planned.value.position.doc, plan: planned.value });
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
        // whole-document replace): the list stays 1., 2. A paragraph after
        // a list item needs a blank line, or it continues the item.
        expect(moveAndApply('para\n1. a\n2. b', 1, 4)).toBe('1. a\n2. b\n\npara');
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
        expect(moveAndApply('1. a\n2. b\n\npara\n\n3. c\n5. d', 4, 1)).toBe('para\n\n1. a\n2. b\n\n3. c\n5. d');
    });

    it('leaves a run untouched when a paragraph lands next to it', () => {
        // Moving 'para' to the top puts it before the run; a paragraph does
        // not join a list, so '3. c\n5. d' stays as-is.
        expect(moveAndApply('3. c\n5. d\n\npara', 4, 1)).toBe('para\n\n3. c\n5. d');
    });

    it('renumbers a run the moved item joins, folding its new marker into the insert', () => {
        // '1. x' lands after the run (seam 5 = end of the 4-line doc) and
        // joins it with the run's own spacing; the whole run renumbers and
        // the moved item's own marker is rewritten inside the inserted text.
        // Its blank line goes with it.
        expect(moveAndApply('1. x\n\n2. a\n3. b', 1, 5)).toBe('1. a\n2. b\n3. x');
    });

    it('renumbers the run that merges across the deleted paragraph', () => {
        // Deleting the paragraph between two run segments joins them into one
        // non-sequential run, which the move must renumber.
        expect(moveAndApply('1. a\npara\n3. c', 2, 4)).toBe('1. a\n2. c\n\npara');
    });

    it('renumbers no ordered run across a bullet item', () => {
        // `1. a` lands under `- x`: it starts a new ordered list, which is not `1. d`'s run.
        expect(moveAndApply('1. a\n2. d\n- x\n- y\n', 1, 4)).toBe('1. d\n- x\n1. a\n- y\n');
        expect(moveUnder('1. a\n    1. b\n    2. c\n2. d\n- x\n- y\n', [4], 6, 5)).toBe(
            '1. a\n    1. b\n    2. c\n- x\n    1. d\n- y\n',
        );
    });

    it('renumbers from 1 an ordered item the move leaves starting a list under a list line', () => {
        // Only a list starting at 1 can interrupt the line above; any other number makes the item part of its text.
        expect(moveAndApply('1. a\n2. b\n3. c\n\n- x', 5, 3)).toBe('1. a\n2. b\n- x\n1. c');
        expect(moveAndApply('- x\n- y\n\n2. b', 4, 2)).toBe('- x\n1. b\n- y');
        // Nested as a parent's first child.
        expect(moveUnder('- x\n\n1. a\n2. b\n    1. c\n\nend', [4], 2, 1)).toBe(
            '- x\n    1. b\n        1. c\n\n1. a\n\nend',
        );
        // Where the removed segment closes: its head left with a bullet.
        expect(moveUnder('- p\n    - q\n        - r\n\n1. a\n2. b\n\nend', [3, 5], 9)).toBe(
            '- p\n    - q\n1. b\n\nend\n- r\n\n1. a',
        );
        expect(moveUnder('- [ ] t\n    - [x] u\n\n1. a\n2. b\n\nend', [2, 4], 8)).toBe(
            '- [ ] t\n1. b\n\nend\n- [x] u\n\n1. a',
        );
        // Where the payload's own segments meet.
        expect(moveUnder('top\n\n- a\n- b\n\n1. x\n2. y', [3, 7], 1)).toBe('- a\n1. y\n\ntop\n\n- b\n\n1. x');
    });

    it('keeps a blank line above an empty ordered item left starting a list under a list line', () => {
        // No number lets an empty item interrupt the line above: it keeps the blank line the removed lines held,
        // and its run is renumbered from 1.
        expect(moveUnder('- x\n- y\n\n1. a\n2. \n3. c\n\nend', [2, 4], 9)).toBe('- x\n\n1. \n2. c\n\nend\n- y\n\n1. a');
        expect(moveUnder('- x\n- y\n\n1. a\n    - k\n2. \n3. c\n\nend', [2, 4], 10)).toBe(
            '- x\n\n1. \n2. c\n\nend\n- y\n\n1. a\n    - k',
        );
        expect(moveUnder('- x\n- y\n\n0. a\n1. \n2. c\n\nend', [2, 4], 9)).toBe('- x\n\n1. \n2. c\n\nend\n- y\n\n0. a');
        // Nested under the list line too.
        expect(moveUnder('- x\n    - y\n\n    1. a\n    2. \n    3. c\n\nend', [2, 4], 9)).toBe(
            '- x\n\n    1. \n    2. c\n\nend\n- y\n\n1. a',
        );
        // Without a blank line between them none is added: inside an ordered list the item interrupts the line,
        // and where the payload lands in the hole the item continues its run.
        expect(moveAndApply('1. p\n    - q\n    1. a\n    2. \n    3. c\n2. s\n\nend', 3, 9)).toBe(
            '1. p\n    - q\n    1. \n    2. c\n2. s\n\nend\n1. a',
        );
        expect(moveUnder('- a\n1. b\n2. \n3. c\n\nend', [2, 4], 3)).toBe('- a\n1. b\n2. c\n3. \n\nend');
    });

    it('keeps a blank line above an empty bullet item left starting a list under a list line', () => {
        // No empty item can interrupt the line above: one that does not continue a bullet list at its indent keeps
        // the blank line the removed lines held.
        expect(moveUnder('1. x\n2. y\n\n- a\n- \n- c\n\nend', [2, 4], 9)).toBe('1. x\n\n- \n- c\n\nend\n\n2. y\n\n- a');
        // Nested under the list line too.
        expect(moveUnder('1. x\n    1. y\n\n    - a\n    - \n    - c\n\nend', [2, 4], 9)).toBe(
            '1. x\n\n    - \n    - c\n\nend\n1. y\n\n- a',
        );
        // One that continues its bullet list stays tight.
        expect(moveUnder('- p\n- q\n\n- a\n- \n- c\n\nend', [2, 4], 9)).toBe('- p\n- \n- c\n\nend\n- q\n\n- a');
    });

    it('keeps the number of an ordered item that continues its list across a nested child', () => {
        expect(moveAndApply('1. a\n    - n\n    - m\n2. b\n3. c\n\nend', 3, 8)).toBe(
            '1. a\n    - n\n2. b\n3. c\n\nend\n- m',
        );
        // Across a blank line inside the item above.
        expect(moveAndApply('1. a\n\n    - n\n    - m\n2. b\n3. c\n\nend', 4, 9)).toBe(
            '1. a\n\n    - n\n2. b\n3. c\n\nend\n- m',
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

    it('leaves the items of a loose ordered list that a moved item was blank-separated from untouched', () => {
        expect(moveAndApply('# Top\n\n1. a\n\n2. b\n\n3. c\n', 7, 1)).toBe('3. c\n\n# Top\n\n1. a\n\n2. b\n');
        expect(moveAndApply('# Top\n\n1. a\n\n2. b\n\n3. c', 7, 1)).toBe('3. c\n\n# Top\n\n1. a\n\n2. b');
        expect(moveAndApply('# Top\n\n1. a\n\n\n2. b\n\n3. c', 6, 1)).toBe('2. b\n\n# Top\n\n1. a\n\n\n3. c');
        // The item below a removed head becomes the head: numbered 1.
        expect(moveAndApply('1. a\n\n2. b\n\n3. c', 1, 6)).toBe('1. b\n\n3. c\n\n1. a');
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
        // Each segment once; each nested item starts a list under its parent's line, so it is numbered 1.
        expect(moveUnder('1. a\n2. b\n3. x\n4. c\n', [2, 4], 2, 1)).toBe('1. a\n    1. b\n1. x\n    1. c\n');
    });

    it('changes an ordered item’s level in place without duplicating it when renumbering fires', () => {
        // Outdent, at the gap below the source and at its own line.
        expect(moveUnder('1. a\n    1. b\n2. c', [2], 3, null)).toBe('1. a\n2. b\n3. c');
        expect(moveUnder('1. a\n    1. b\n2. c', [2], 2, null)).toBe('1. a\n2. b\n3. c');
        // Nest, at the gap below the source and at its own line.
        expect(moveUnder('3. a\n4. b\n', [2], 3, 1)).toBe('1. a\n    1. b\n');
        expect(moveUnder('3. a\n4. b\n', [2], 2, 1)).toBe('1. a\n    1. b\n');
    });

    it('renumbers an empty ordered item, and the sublist it leaves, when its level changes in place', () => {
        expect(moveUnder('1. a\n    1. \n2. c', [2], 2, null)).toBe('1. a\n2. \n3. c');
        // The sublist `b` leaves restarts at 1; `2. c` keeps its number (runs split by indent are numbered apart).
        expect(moveUnder('1. a\n    1. b\n    2. x\n2. c', [2], 2, null)).toBe('1. a\n2. b\n    1. x\n2. c');
    });

    it('refuses an in-place level change of several items when the selection has non-list lines', () => {
        const fence = '```';
        for (const text of [
            '- a\n    - b\n- c\n    > [!note] x\n    > body\n- d',
            `- a\n    - b\n- c\n    ${fence}js\n    code\n    ${fence}\n- d`,
        ]) {
            const doc = stringDoc(text);
            const selection = selectBlocks([blockAt(doc, 2), blockAt(doc, 3)]);
            expect(
                planMove({ sourceDoc: doc, selection, position: { doc, line: 2, parent: null }, tabSize, indentUnit }),
            ).toEqual({
                type: 'reject',
                reason: 'self_range_blocked',
            });
        }
    });

    it('changes the level of an item with non-list children in place', () => {
        expect(moveUnder('- a\n- b\n    > [!note] x\n    > body', [2], 2, 1)).toBe(
            '- a\n    - b\n        > [!note] x\n        > body',
        );
        expect(moveUnder('- a\n    - b\n        > [!note] x\n        > body\n- c', [2], 2, null)).toBe(
            '- a\n- b\n    > [!note] x\n    > body\n- c',
        );
        expect(moveUnder('- a\n- b\n    para child\n- c', [2], 2, 1)).toBe('- a\n    - b\n        para child\n- c');
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

/** The repro page: blank-separated callouts after an intro line, with a final newline. */
const CALLOUT_PAGE = [
    'Intro line.',
    '',
    '> [!note]+ First',
    '> First body.',
    '',
    '> [!note]+ Second',
    '> Second body.',
    '> More second body.',
    '',
    '> [!note]- Third (folded)',
    '> Hidden body.',
    '',
    '> [!note] Fourth (title only)',
    '',
].join('\n');

const PAIR_PAGE = 'alpha\n\n> [!note] First\n> first body\n\nbravo\n\n> [!tip] Second\n> second body\n\ncharlie\n';

describe('moveTx blank-line separation', () => {
    it('keeps a quote whole when a quote line without text follows the removed lines', () => {
        expect(moveAndApply('> - x\n> - y\n>\n> 1. a\n> 2. b\n\nend', 2, 8)).toBe(
            '> - x\n>\n> 1. a\n> 2. b\n\nend\n> - y',
        );
    });

    it.each([
        {
            drag: 'Third onto Second (R1)',
            from: 10,
            seam: 6,
            after: 'Intro line.\n\n> [!note]+ First\n> First body.\n\n> [!note]- Third (folded)\n> Hidden body.\n\n> [!note]+ Second\n> Second body.\n> More second body.\n\n> [!note] Fourth (title only)\n',
        },
        {
            drag: "First onto Third's lower half (R2)",
            from: 3,
            seam: 12,
            after: 'Intro line.\n\n> [!note]+ Second\n> Second body.\n> More second body.\n\n> [!note]- Third (folded)\n> Hidden body.\n\n> [!note]+ First\n> First body.\n\n> [!note] Fourth (title only)\n',
        },
        {
            drag: 'Fourth onto First (R3)',
            from: 13,
            seam: 3,
            after: 'Intro line.\n\n> [!note] Fourth (title only)\n\n> [!note]+ First\n> First body.\n\n> [!note]+ Second\n> Second body.\n> More second body.\n\n> [!note]- Third (folded)\n> Hidden body.\n',
        },
        {
            drag: 'Second onto First (R4)',
            from: 6,
            seam: 3,
            after: 'Intro line.\n\n> [!note]+ Second\n> Second body.\n> More second body.\n\n> [!note]+ First\n> First body.\n\n> [!note]- Third (folded)\n> Hidden body.\n\n> [!note] Fourth (title only)\n',
        },
    ])('drops $drag into the indicated gap with one blank line on each side', ({ from, seam, after }) => {
        expect(moveAndApply(CALLOUT_PAGE, from, seam)).toBe(after);
    });

    it("rejects Second onto Third's upper half: its own gap below (R5)", () => {
        expect(planBlocks(CALLOUT_PAGE, [6], 10)).toEqual({ type: 'reject', reason: 'self_range_blocked' });
        expect(planBlocks(CALLOUT_PAGE, [6], 9)).toEqual({ type: 'reject', reason: 'self_range_blocked' });
    });

    it("lands a callout between two paragraphs from either side's half", () => {
        const after = 'alpha\n\nbravo\n\n> [!note] First\n> first body\n\n> [!tip] Second\n> second body\n\ncharlie\n';
        expect(moveAndApply(PAIR_PAGE, 3, 7)).toBe(after);
        expect(moveAndApply(PAIR_PAGE, 3, 8)).toBe(after);
        expect(moveAndApply(PAIR_PAGE, 6, 3)).toBe(after);
    });

    it('keeps a paragraph moved below a callout from continuing it', () => {
        expect(moveAndApply('move me\n\n> [!note] Q\n> body\n\nTail', 1, 5)).toBe(
            '> [!note] Q\n> body\n\nmove me\n\nTail',
        );
    });

    it('splits a loose list around a paragraph dropped between its items', () => {
        expect(moveAndApply('- a\n\n- b\n\npara', 5, 3)).toBe('- a\n\npara\n\n- b');
    });

    it('separates a standalone paragraph dropped under a heading from its neighbours', () => {
        expect(moveAndApply('# H\npara\n\nother', 4, 2)).toBe('# H\n\nother\n\npara');
    });

    it('reorders the lines of one paragraph tight', () => {
        expect(moveAndApply('l1\nl2\nl3\n\nnext', 3, 1)).toBe('l3\nl1\nl2\n\nnext');
    });

    it('moves a paragraph line into another paragraph tight', () => {
        expect(moveAndApply('p1\np2\n\nq1\nq2', 2, 5)).toBe('p1\n\nq1\np2\nq2');
    });

    it('never merges a standalone paragraph into a paragraph', () => {
        expect(moveAndApply('x\n\nl1\nl2', 1, 4)).toBe('l1\n\nx\n\nl2');
    });

    it('reorders the lines of one quote tight', () => {
        expect(moveAndApply('# H\n> a\n> b\n> c', 4, 2)).toBe('# H\n> c\n> a\n> b');
    });

    it('lets one stack of quote lines into a tight quote run, not two separate quotes', () => {
        expect(planBlocks('> a\n> b\n\n> x\n\n---\n\n> y', [4, 8], 2)).toEqual({
            type: 'reject',
            reason: 'inside_quote_run',
        });
        expect(moveUnder('> a\n> b\n\n> x\n> y', [4, 5], 2)).toBe('> a\n> x\n> y\n> b');
    });

    it('lets a quote line of the same depth join a quote, and no other depth', () => {
        expect(moveAndApply('> a\n> b\n\n> z', 4, 2)).toBe('> a\n> z\n> b');
        expect(planBlocks('> a\n> b\n\n> > z', [4], 2)).toEqual({ type: 'reject', reason: 'inside_quote_run' });
    });

    it('joins a list item to a tight list after it', () => {
        expect(moveAndApply('- a\n- b\n\npara\n\n- x', 6, 4)).toBe('- a\n- b\n- x\n\npara');
    });

    it('joins a list item to a loose list after it, keeping it loose', () => {
        expect(moveAndApply('- a\n\n- b\n\npara\n\n- x', 7, 5)).toBe('- a\n\n- b\n\n- x\n\npara');
    });

    it('keeps a two-line gap two lines on both sides', () => {
        expect(moveAndApply('A\n\n\nB\n\nC', 6, 2)).toBe('A\n\n\nC\n\n\nB');
        expect(moveAndApply('A\n\n\nB\n\nC', 6, 4)).toBe('A\n\n\nC\n\n\nB');
    });

    it('writes no blank line below a table or next to math', () => {
        expect(moveAndApply('| a | b |\n|---|---|\n- x\n- y', 4, 3)).toBe('| a | b |\n|---|---|\n- y\n- x');
        expect(moveAndApply('- a\n- b\n$$\nx\n$$', 1, 3)).toBe('- b\n- a\n$$\nx\n$$');
    });

    it('keeps a paragraph dropped above a table out of the table', () => {
        expect(moveAndApply('x\n\n| a | b |\n|---|---|\n\npara', 6, 3)).toBe('x\n\npara\n\n| a | b |\n|---|---|');
    });

    it('never writes a setext heading', () => {
        expect(moveAndApply('# Head\n---\n\np', 4, 2)).toBe('# Head\n\np\n\n---');
    });

    it('never writes an empty item under a paragraph, where it would be a setext underline', () => {
        expect(moveAndApply('- x\n- \n\n# H\npara\n# H2', 2, 6)).toBe('- x\n\n# H\npara\n\n- \n# H2');
    });

    it('moves a fence with an inner blank line to the end, unchanged', () => {
        const fence = '```\nx\n\ny\n```';
        expect(moveAndApply(`a\n\n${fence}\n\nb`, 3, 10)).toBe(`a\n\nb\n\n${fence}`);
    });

    it('separates the paragraphs a removed heading stood between', () => {
        expect(moveAndApply('p1\n# H\np2\n\nend', 2, 6)).toBe('p1\n\np2\n\nend\n# H');
    });

    it('moves a callout to the top edge, separated from the paragraph below', () => {
        expect(moveAndApply('Intro\n\n> [!note] A\n> a', 3, 1)).toBe('> [!note] A\n> a\n\nIntro');
    });

    it('moves two blank-separated callouts as one group', () => {
        expect(moveUnder('intro\n\n> [!a] A\n> a body\n\n> [!b] B\n> b body\n\nend', [3, 6], 10)).toBe(
            'intro\n\nend\n\n> [!a] A\n> a body\n\n> [!b] B\n> b body',
        );
    });

    it('moves two separated blocks into a gap one of them borders', () => {
        expect(moveUnder('A\n\nB\n\nC\n\nD', [1, 5], 2)).toBe('A\n\nC\n\nB\n\nD');
    });

    it('closes the hole between selected segments the way it closes at the source', () => {
        expect(moveUnder('A\n\nB\n\nC\n\nD', [1, 5], 8)).toBe('B\n\nD\n\nA\n\nC');
        // a1 and a2 rejoin as one paragraph, which stays apart from the standalone `end`.
        expect(moveUnder('a1\nh\na2\n\nend', [1, 3], 6)).toBe('h\n\nend\n\na1\na2');
        expect(moveUnder('# H\np1\n# I\np2\n\nend', [2, 4], 7)).toBe('# H\n# I\n\nend\n\np1\n\np2');
    });

    it('keeps an ordered list tight under a paragraph when its head moves', () => {
        expect(moveAndApply('intro:\n1. a\n2. b\n3. c', 2, 4)).toBe('intro:\n1. b\n2. a\n3. c');
        expect(moveAndApply('intro:\n1. a\n2. b\n3. c', 3, 2)).toBe('intro:\n1. b\n2. a\n3. c');
        expect(moveAndApply('intro:\n1. a\n2. b\n3. c', 2, 5)).toBe('intro:\n1. b\n2. c\n3. a');
    });

    it('moves a list item with its quote-prefixed child', () => {
        expect(moveAndApply('top\n\n- item\n    > [!note] x\n    > body\n- next', 3, 1)).toBe(
            '- item\n    > [!note] x\n    > body\n\ntop\n\n- next',
        );
    });

    it('keeps the quoted children of a moved item apart from the child it lands above', () => {
        // Its quoted list line does not adopt the paragraph, and its callout does not join the quote below.
        expect(moveAndApply('- source\n    > - q\n\n- target\n    child\n- end', 1, 5)).toBe(
            '- target\n- source\n    > - q\n\n    child\n- end',
        );
        expect(moveAndApply('- a\n    > [!note] A\n    > body\n- b\n    > # B\n\nend', 1, 5)).toBe(
            '- b\n- a\n    > [!note] A\n    > body\n\n    > # B\n\nend',
        );
    });

    it('nests a list item with its quote-prefixed child, shifting the whitespace before `>`', () => {
        const text = '- a\n- b\n- item\n    > [!note] x\n    > body';
        const doc = stringDoc(text);
        const position: DropPosition = { doc, line: 2, parent: blockAt(doc, 1) };
        const planned = planMove({
            sourceDoc: doc,
            selection: selectOne(blockAt(doc, 3)),
            position,
            tabSize,
            indentUnit,
        });
        if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
        const edits = moveTx({ sourceDoc: doc, plan: planned.value });
        if (!Array.isArray(edits)) throw new Error(`move rejected: ${edits.reason}`);
        expect(applyEdits(text, edits)).toBe('- a\n    - item\n        > [!note] x\n        > body\n- b');
    });

    it('rejects a nested callout and anything inside its container', () => {
        const text = '> [!outer]\n>\n> > [!note] A\n> > a\n>\n> > [!note] B\n> > b\n\nend';
        expect(planBlocks(text, [3], 9)).toEqual({ type: 'reject', reason: 'nested_block' });
        expect(planBlocks(text, [3], 1)).toEqual({ type: 'reject', reason: 'nested_block' });
        expect(planBlocks(text, [9], 4)).toEqual({ type: 'reject', reason: 'inside_quote_run' });
    });

    it('moves an outer callout once when its nested callout is selected too', () => {
        const text = 'top\n\n> [!outer]\n> > [!note] A\n> > a\n\nend';
        expect(moveUnder(text, [3, 4], 8)).toBe('top\n\nend\n\n> [!outer]\n> > [!note] A\n> > a');
    });

    it('snaps nothing into frontmatter and never writes inside it', () => {
        expect(planBlocks('---\nt: x\n---\n\n# H\n\npara\n', [7], 2)).toEqual({
            type: 'reject',
            reason: 'inside_frontmatter',
        });
        expect(moveAndApply('---\nt: x\n---\n\n# H\n\npara\n', 7, 4)).toBe('---\nt: x\n---\n\npara\n\n# H\n');
    });

    it('rejects a move that would turn the top of a document into frontmatter', () => {
        expect(planBlocks('Intro\n\n---\n\nA\n\n---\n\nB', [1], 10)).toEqual({
            type: 'reject',
            reason: 'frontmatter_fence',
        });
        expect(planBlocks('A\n\n---\n\nB\n\n---', [7], 1)).toEqual({ type: 'reject', reason: 'frontmatter_fence' });
        expect(moveAndApply('A\n\n---\n\nB', 5, 1)).toBe('B\n\nA\n\n---');
    });

    it('rejects a move into or out of another document that would create frontmatter there', () => {
        const crossPlan = (sourceText: string, lines: number[], targetText: string, seam: number) =>
            planAcross(sourceText, lines, targetText, seam).planned;
        const rejected = { type: 'reject', reason: 'frontmatter_fence' };
        // A second `---` lands under a document that starts with one.
        expect(crossPlan('---', [1], '---\n\nfoo', 4)).toEqual(rejected);
        // A `---` lands on top of a document that has one further down.
        expect(crossPlan('---', [1], 'foo\n\n---', 1)).toEqual(rejected);
        // Removing the first block exposes a `---` with another below it.
        expect(crossPlan('A\n\n---\n\nB\n\n---', [1], 'x', 2)).toEqual(rejected);
        expect(crossPlan('A\n\n---\n\nB', [1], 'x', 2)).toMatchObject({ type: 'ok' });
        // A note with no block takes the payload on its first line, above any padding.
        const group = 'A\n\n---\n\nB\n\n---\n\nC\n';
        expect(crossPlan(group, [3, 5, 7], '', 1)).toEqual(rejected);
        expect(crossPlan(group, [3, 5, 7], '\n', 1)).toEqual(rejected);
        expect(crossPlan(group, [3, 5, 7], '\n\n', 1)).toEqual(rejected);
        expect(crossPlan(group, [3, 5, 7], '---\nt: x\n---\n', 4)).toMatchObject({ type: 'ok' });
    });

    it('moves two segments whose removal alone would read as frontmatter', () => {
        expect(moveUnder('Intro\n\n---\n\nA\n\n---\n\nB', [1, 5], 3)).toBe('Intro\n\nA\n\n---\n\n---\n\nB');
    });

    it('reorders the lines of a two-line paragraph or quote tight', () => {
        expect(moveAndApply('a\nb', 2, 1)).toBe('b\na');
        expect(moveAndApply('a\nb', 1, 3)).toBe('b\na');
        expect(moveAndApply('> a\n> b', 2, 1)).toBe('> b\n> a');
        expect(moveUnder('l1\nl2\nl3\n\nnext', [2, 3], 1)).toBe('l2\nl3\nl1\n\nnext');
    });

    it('keeps a paragraph or quote bounded by headings apart from the one it lands next to', () => {
        expect(moveAndApply('# A\nalpha\n# B\nbeta\n', 2, 4)).toBe('# A\n# B\n\nalpha\n\nbeta\n');
        expect(moveAndApply('# A\nalpha\n# B\nbeta\n', 2, 6)).toBe('# A\n# B\nbeta\n\nalpha\n');
        expect(moveAndApply('# A\n> qa\n# B\n> qb', 2, 4)).toBe('# A\n# B\n\n> qa\n\n> qb');
        // A line of a larger paragraph stays apart from a heading-bounded paragraph it lands beside.
        expect(moveAndApply('# A\nbeta\n## C\n\ngamma\ndelta', 6, 3)).toBe('# A\nbeta\n\ndelta\n## C\n\ngamma');
    });

    it('keeps a whole paragraph or quote moved as a unit apart from the one it lands next to', () => {
        expect(moveUnder('l1\nl2\n\nx\ny', [1, 2], 5)).toBe('x\n\nl1\nl2\n\ny');
        expect(moveUnder('l1\nl2\n\nx\ny', [1, 2], 6)).toBe('x\ny\n\nl1\nl2');
        expect(moveUnder('> a\n> b\n\nx\n\n> c\n> d', [1, 2], 8)).toBe('x\n\n> c\n> d\n\n> a\n> b');
    });

    it('keeps a quoted line apart from a quote it does not come from, and in its own quote', () => {
        // Quoted lines written directly under another quote would join it.
        expect(moveAndApply('> - a\n> - b\n\n> [!todo] T\n> - x\n> - y', 1, 7)).toBe(
            '> - b\n\n> [!todo] T\n> - x\n> - y\n\n> - a',
        );
        expect(moveAndApply('# A\n> [!note] N\n> # H\n# B\n> q\n\nend', 2, 5)).toBe(
            '# A\n# B\n> [!note] N\n> # H\n\n> q\n\nend',
        );
        expect(moveAndApply('> - a\n> - b\n\n> q\n# H', 1, 5)).toBe('> - b\n\n> q\n\n> - a\n# H');
        expect(moveUnder('> - a\n# H\n> - b\n\nend', [1, 3], 6)).toBe('# H\n\nend\n> - a\n\n> - b');
        // A quoted item still reorders at the edges of its own quote.
        expect(moveAndApply('> - a\n> - b\n# H', 1, 3)).toBe('> - b\n> - a\n# H');
        expect(moveAndApply('> - a\n> - b\n> - c', 3, 1)).toBe('> - c\n> - a\n> - b');
    });

    it('keeps a quoted item dropped into another document apart from the quote it lands under', () => {
        expect(moveAcross('> - a\n> - b', [1], '> [!todo] T\n> - x\n', 4)[0]).toBe('> [!todo] T\n> - x\n\n> - a\n');
    });

    it('rejects a move whose gap an unclosed fence it removes turns into a fence', () => {
        // Without the unclosed ``` the math fences below pair up, and seam 4 lies inside them.
        const planned = planBlocks('```\n\n$$\nx\n$$\n\nend', [1], 4);
        if (planned.type !== 'ok') throw new Error(`plan rejected: ${planned.reason}`);
        expect(moveTx({ sourceDoc: planned.value.position.doc, plan: planned.value })).toEqual({
            type: 'reject',
            reason: 'inside_math_block',
        });
    });

    it('moves into an empty document and into a blank-separated one', () => {
        const cross = (targetText: string, line: number) =>
            moveAcross('keep\n\n> [!note] moved\n> body\n', [3], targetText, line);
        expect(cross('', 1)).toEqual(['> [!note] moved\n> body', 'keep\n']);
        expect(cross('one\n\ntwo\n', 3)).toEqual(['one\n\n> [!note] moved\n> body\n\ntwo\n', 'keep\n']);
        expect(cross('one\n\ntwo\n', 5)).toEqual(['one\n\ntwo\n\n> [!note] moved\n> body\n', 'keep\n']);
    });
});

describe('moveTx list spacing: an item takes the spacing of the list it joins', () => {
    it('keeps a tight sublist tight and the root list loose when an item joins the sublist', () => {
        expect(moveUnder('- a\n    - a1\n    - a2\n\n- b\n\n- x\n', [7], 5, 1)).toBe(
            '- a\n    - a1\n    - a2\n    - x\n\n- b\n',
        );
    });

    it('keeps a loose sublist loose and the root list tight when an item joins the sublist', () => {
        expect(moveUnder('- a\n\n    - a1\n\n    - a2\n- b\n\n- x\n', [8], 6, 1)).toBe(
            '- a\n\n    - a1\n\n    - a2\n\n    - x\n- b\n',
        );
    });

    it('joins no list inside a quote or callout', () => {
        const todo = '> [!todo] Today\n> - buy milk\n> - call mom\n\n- a\n- b';
        expect(moveAndApply(todo, 6, 5)).toBe('> [!todo] Today\n> - buy milk\n> - call mom\n\n- b\n- a');
        expect(moveAndApply('> [!todo] T\n> - m\n\npara\n\n1. a\n2. b', 7, 4)).toBe(
            '> [!todo] T\n> - m\n\n2. b\n\npara\n\n1. a',
        );
        expect(moveAndApply('1. a\n2. b\n3. c\n\n> [!todo] T\n> - m\n> - n', 5, 2)).toBe(
            '1. a\n\n> [!todo] T\n> - m\n> - n\n\n2. b\n3. c',
        );
    });

    it('writes an item that starts a sublist tight under its parent', () => {
        expect(moveUnder('- x\n- y\n- z\n\npara\n\n- a', [7], 4, 3)).toBe('- x\n- y\n- z\n    - a\n\npara');
        expect(moveUnder('- z\n    child text\n\npara\n\n- a', [6], 4, 1)).toBe('- z\n    child text\n    - a\n\npara');
    });

    it('writes an item nested across its own blank line above with the spacing of the list it joins', () => {
        // The usual gesture: the lower half of the item above, or the blank line, one step right.
        expect(moveUnder('- a\n- b\n\n- x', [4], 4, 2)).toBe('- a\n- b\n    - x');
        expect(moveUnder('- a\n- b\n    - b1\n\n- x', [5], 5, 2)).toBe('- a\n- b\n    - b1\n    - x');
        expect(moveUnder('- a\n    - b\n    - c\n\n- x', [5], 5, 3)).toBe('- a\n    - b\n    - c\n        - x');
        expect(moveUnder('- a\n- b\n\n- x\n- y', [4], 4, 2)).toBe('- a\n- b\n    - x\n\n- y');
    });

    it('keeps an item that adopts the continuation line under it tight', () => {
        expect(moveAndApply('- a\n  child\n- c\n\n- x', 5, 2)).toBe('- a\n- x\n  child\n- c');
    });

    it('keeps the spacing of a list an item joins at its own level', () => {
        expect(moveUnder('- a\n- b\n\npara\n\n- x', [6], 2, null)).toBe('- a\n- x\n- b\n\npara');
        expect(moveUnder('- a\n\n- b\n\npara\n\n- x', [7], 3, null)).toBe('- a\n\n- x\n\n- b\n\npara');
    });
});

describe('moveTx line drop zones: a line cut from a paragraph joins the line the pointer chose', () => {
    const page = 'x\n\na\nb\n\ny';

    it.each([
        ['b onto the upper half of a', [4], 3, 'joinBelow', 'x\n\nb\na\n\ny'],
        ['b onto the lower half of x', [4], 3, 'joinAbove', 'x\nb\n\na\n\ny'],
        ['b onto the blank line between x and a', [4], 3, 'apart', 'x\n\nb\n\na\n\ny'],
        ['a onto the upper half of y', [3], 6, 'joinBelow', 'x\n\nb\n\na\ny'],
        ['a onto the lower half of b, its own gap below', [3], 6, 'joinAbove', 'x\n\nb\na\n\ny'],
    ] as const)('moves %s', (_name, from, seam, zone, after) => {
        expect(moveZone(page, [...from], seam, zone)).toBe(after);
    });

    it('joins quote lines the same way', () => {
        const quotes = '> x\n\n> a\n> b\n\n> y';
        expect(moveZone(quotes, [4], 3, 'joinBelow')).toBe('> x\n\n> b\n> a\n\n> y');
        expect(moveZone(quotes, [4], 3, 'joinAbove')).toBe('> x\n> b\n\n> a\n\n> y');
    });

    it('joins nothing of another run kind', () => {
        expect(moveZone('a\nb\n\n> q\n> r', [2], 4, 'joinBelow')).toBe('a\n\nb\n\n> q\n> r');
        expect(planZone('a\nb\n\n> q\n> r', [2], 4, 'joinBelow')).toMatchObject({
            value: { position: { zone: 'apart' } },
        });
    });

    it('joins the only neighbour at a document edge', () => {
        expect(moveZone('p\nq\n\nr\ns', [5], 1, 'joinBelow')).toBe('s\np\nq\n\nr');
        expect(moveZone('p\nq\n\nr\ns', [1], 6, 'joinAbove')).toBe('q\n\nr\ns\np');
        expect(moveZone('\np\nq\n\nr\ns\n', [6], 1, 'apart')).toBe('\ns\n\np\nq\n\nr\n');
    });

    it('joins no quote line inside a callout', () => {
        const page = '> [!note] t\n> > q\n\n> > a\n> > b';
        expect(planZone(page, [5], 4, 'joinAbove')).toMatchObject({ value: { position: { zone: 'apart' } } });
        expect(moveZone(page, [5], 4, 'joinAbove')).toBe('> [!note] t\n> > q\n\n> > b\n\n> > a');
    });

    it('joins no line that would become a setext heading underline', () => {
        expect(planZone('===\nb\n\nx', [1], 5, 'joinAbove')).toMatchObject({ value: { position: { zone: 'apart' } } });
        expect(moveZone('===\nb\n\nx', [1], 5, 'joinAbove')).toBe('b\n\nx\n\n===');
        expect(moveZone('a\nb\n\n===\n\nz', [1], 4, 'joinBelow')).toBe('b\n\na\n\n===\n\nz');
        expect(moveZone('> a\n> b\n\n> --\n> y', [2], 4, 'joinBelow')).toBe('> a\n\n> b\n\n> --\n> y');
    });

    it('joins nothing under a list parent, whose item takes the payload as its content', () => {
        const page = '- a\n\nx\ny\n\n- target\n\np\nq';
        expect(planZone(page, [1, 3], 8, 'joinBelow', 6)).toMatchObject({ value: { position: { zone: 'apart' } } });
        expect(moveZone(page, [1, 3], 8, 'joinBelow', 6)).toBe('y\n\n- target\n    - a\n\n    x\n\np\nq');
    });

    it('joins a two-line line payload by its facing end', () => {
        expect(moveZone('x\n\na\nb\nc\n\ny', [4, 5], 3, 'joinAbove')).toBe('x\nb\nc\n\na\n\ny');
        expect(moveZone('x\n\na\nb\nc\n\ny', [3, 4], 7, 'joinBelow')).toBe('x\n\nc\n\na\nb\ny');
    });

    it('keeps a line released over itself a no-op', () => {
        const doc = stringDoc(page);
        for (const line of [3, 4]) {
            const selection = selectOne(blockAt(doc, line));
            for (const belowMid of [false, true]) {
                const position = locateDropPosition({
                    doc,
                    selection,
                    hitLine: line,
                    belowMid,
                    sourceIndentWidth: 0,
                    targetIndentWidth: 0,
                    tabSize,
                    indentUnit,
                });
                expect(planMove({ sourceDoc: doc, selection, position, tabSize, indentUnit })).toEqual({
                    type: 'reject',
                    reason: 'self_range_blocked',
                });
            }
        }
    });

    it('makes a join or a split in the source’s own gap a real move, and a no-op only when nothing changes', () => {
        expect(moveZone('x\n\na\nb', [3], 3, 'joinAbove')).toBe('x\na\n\nb');
        expect(moveZone(page, [3], 3, 'apart')).toBe('x\n\na\n\nb\n\ny');
        expect(moveZone('x\n\na\nb', [4], 5, 'apart')).toBe('x\n\na\n\nb');
        expect(planZone('a\nb', [2], 2, 'joinAbove')).toEqual({ type: 'reject', reason: 'self_range_blocked' });
        expect(planZone('x\n\na\nb', [4], 4, 'joinAbove')).toEqual({ type: 'reject', reason: 'self_range_blocked' });
    });

    it('rejects a move in the source’s own gap that cannot be written', () => {
        // Removing the unclosed fence pairs the `$$` lines: `y` would lie inside a math block.
        expect(planZone('```\n$$\nx\ny\n$$', [1, 3], 4, 'joinBelow')).toEqual({
            type: 'reject',
            reason: 'inside_math_block',
        });
    });

    it('keeps the gap’s blank lines on the side away from a join, even next to a list', () => {
        expect(moveZone('- a\n- b\n\nx1\nx2\n\n- m\n\np\nq', [7, 9], 4, 'joinBelow')).toBe(
            '- a\n- b\n\n- m\n\np\nx1\nx2\n\nq',
        );
    });

    it('ignores zones for a standalone payload or a whole paragraph', () => {
        const solo = 'solo\n\nx\n\nl1\nl2';
        expect(moveZone(solo, [1], 5, 'joinBelow')).toBe('x\n\nsolo\n\nl1\nl2');
        expect(planZone(solo, [1], 5, 'joinBelow')).toMatchObject({ value: { position: { zone: undefined } } });
        expect(moveZone('l1\nl2\n\nx\n\ny\nz', [1, 2], 6, 'joinBelow')).toBe('x\n\nl1\nl2\n\ny\nz');
        const callout = 'x\n\n> [!note] A\n> body\n\ny';
        for (const zone of ['joinAbove', 'apart', 'joinBelow'] as const) {
            expect(moveZone(callout, [3], 7, zone)).toBe('x\n\ny\n\n> [!note] A\n> body');
        }
    });

    it('ignores zones for a callout that ends in a nested quote line', () => {
        const page = '# H\n> [!note] t\n> > q\n\nx\n\n> > a\n> > b';
        expect(planZone(page, [2], 7, 'joinBelow')).toMatchObject({ value: { position: { zone: undefined } } });
        expect(moveZone(page, [2], 7, 'joinBelow')).toBe('# H\n\nx\n\n> [!note] t\n> > q\n\n> > a\n> > b');
        expect(planZone(page, [2], 5, 'apart')).toEqual({ type: 'reject', reason: 'self_range_blocked' });
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
            '- a\n    - x\n\n        | h |\n        |---|\n        | c |\n        tail\n- b',
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
        expect(copyAndApply('first\n\nsecond', 1, 3)).toBe('first\n\nfirst\n\nsecond');
    });

    it('duplicates an ordered list item and renumbers correctly', () => {
        expect(copyAndApply('1. a\n2. b', 1, 3)).toBe('1. a\n2. b\n3. a');
    });

    it('duplicates an item right below itself in place', () => {
        expect(copyAndApply('- item 1\n- item 2', 1, 2)).toBe('- item 1\n- item 1\n- item 2');
    });

    it('joins a quote line copied within its own quote', () => {
        expect(copyAndApply('> a\n> b', 2, 1)).toBe('> b\n> a\n> b');
    });

    it('refuses a copy that would turn the top of the note into frontmatter', () => {
        const doc = stringDoc('a\n\n---\n\nb');
        const position: DropPosition = { doc, line: 1, parent: null };
        const selection = selectOne(blockAt(doc, 3));
        expect(planMove({ sourceDoc: doc, selection, position, tabSize, indentUnit, mode: 'copy' })).toEqual({
            type: 'reject',
            reason: 'frontmatter_fence',
        });
    });
});

describe('moveTx context adaptation', () => {
    it('adapts a paragraph into a child list item when nested under a list item', () => {
        expect(moveUnder('- item 1\n- item 2\n\nparagraph', [4], 2, 1)).toBe('- item 1\n    - paragraph\n- item 2');
    });

    it('adapts a heading into an ordered child list item and renumbers correctly', () => {
        expect(moveUnder('1. item 1\n2. item 2\n\n### Heading', [4], 2, 1)).toBe(
            '1. item 1\n    1. Heading\n2. item 2',
        );
    });

    it('keeps list-like text in a heading title', () => {
        expect(moveUnder('- parent\n\n# - [x] Keep', [3], 2, 1)).toBe('- parent\n    - - [x] Keep');
    });

    it('indents a blockquote adapted into a child list item', () => {
        expect(moveUnder('- parent\n\n> quote', [3], 2, 1)).toBe('- parent\n    - quote');
    });

    it('leaves a code block verbatim when a paragraph in the same selection is dropped into a list', () => {
        const moved = moveUnder('- parent\n- next\n\nparagraph\n```\ncode\n```', [4, 5], 2, 1);
        expect(moved).toMatch(/```\n *code\n *```/);
        expect(moved).not.toContain('- ```');
        expect(moved).not.toContain('- code');
        expect(moved).not.toContain('- paragraph');
    });

    it('turns each block into one item of the root list between two tight items, with no blank line between them', () => {
        expect(moveUnder('- a\n- b\n\n# H\n\n> q', [4, 6], 2)).toBe('- a\n- H\n- q\n- b');
        expect(moveUnder('1. a\n2. b\n\np', [4], 2)).toBe('1. a\n2. p\n3. b');
    });

    it('turns a paragraph dropped inside an item’s subtree into an item of the root list', () => {
        expect(moveUnder('- a\n    - b\n\np', [4], 2)).toBe('- a\n- p\n    - b');
    });

    it('keeps a paragraph a paragraph between the items of a loose list, and in a quoted list', () => {
        expect(moveUnder('- a\n\n- b\n\np', [5], 3)).toBe('- a\n\np\n\n- b');
        expect(planBlocks('> - a\n> - b\n\np', [4], 2)).toMatchObject({ type: 'reject', reason: 'inside_quote_run' });
    });

    it('takes the heading text of a quoted heading, and makes no item of a line without text', () => {
        expect(moveUnder('- a\n- b\n\n> ## Title', [4], 2)).toBe('- a\n- Title\n- b');
        expect(moveUnder('- a\n- b\n\n> x\n>\n> y', [5, 6], 2, 1)).toBe('- a\n    - y\n- b\n\n> x');
        expect(moveUnder('- a\n- b\n\n> x\n>\n> y', [5], 2, 1)).not.toMatch(/^\s*- $/m);
    });

    it('takes the marker of the list the items join', () => {
        expect(moveUnder('- a\n    1. b\n    2. c\n\npara', [5], 3, 1)).toBe('- a\n    1. b\n    2. para\n    3. c');
        expect(moveUnder('- a\n    1. b\n    2. c\n\npara', [5], 3)).toBe('- a\n    1. b\n- para\n    1. c');
        expect(moveUnder('* a\n* b\n\npara', [4], 2)).toBe('* a\n* para\n* b');
        expect(moveUnder('1. a\n    > - q\n\npara', [4], 3, 1)).toBe('1. a\n    > - q\n\n    1. para');
        expect(moveUnder('- [x] a\n- [ ] b\n\np', [4], 2)).toBe('- [x] a\n- [ ] p\n- [ ] b');
        expect(moveUnder('* [x] a\n* [ ] b\n\np', [4], 2)).toBe('* [x] a\n* [ ] p\n* [ ] b');
        expect(moveUnder('1) a\n2) b\n\np', [4], 2)).toBe('1. a\n2. p\n3. b');
    });

    it('turns a paragraph into an item between two tight items, whatever ends the item above', () => {
        expect(moveUnder('- a\n    child\n- b\n\npara', [5], 3)).toBe('- a\n    child\n- para\n- b');
    });

    it('turns nothing into an item next to a quoted list line', () => {
        expect(moveUnder('- a\n> - q\n\np', [4], 2)).not.toContain('- p');
    });

    it('turns nothing into an item under a quoted parent', () => {
        expect(moveUnder('p\n\n> - a\n> - b', [1], 5, 4)).toBe('> - a\n> - b\n\np');
    });

    it('turns nothing into an item inside a quote under an item', () => {
        const text = '- a\n    > q1\n    > q2\n\n> x';
        expect(() => moveUnder(text, [5], 3, 1)).toThrow('plan rejected: inside_list');
        expect(planBlocks(text, [5], 3)).toMatchObject({ type: 'reject', reason: 'inside_list' });
    });
});
