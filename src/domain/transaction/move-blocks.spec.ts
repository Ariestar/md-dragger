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
});
