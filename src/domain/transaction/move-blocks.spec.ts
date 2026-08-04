import { describe, expect, it } from 'vitest';
import { detectBlock } from '../block/block-detector';
import type { DropPosition } from '../command/drop-position';
import { planMove } from '../move/move-plan';
import { selectOne } from '../selection/block-selection';
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
