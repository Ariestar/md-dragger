import { describe, expect, it } from 'vitest';
import { BlockType } from '../block/block-types';
import { createSingleBlockSelection } from '../selection/block-selection';
import { planMove, type MoveDeps } from './move-plan';
import { moveTx } from '../transaction/move-blocks';
import type { DropTarget } from '../command/drop-target';
import type { Doc } from '../markdown/document-types';
import type { InsertionSlotContext } from '../rules/insertion-rules';

function makeDoc(lines: string[]): Doc {
    const fullText = lines.join('\n');
    let offset = 0;
    const ranges = lines.map((text) => {
        const from = offset;
        const to = from + text.length;
        offset = to + 1;
        return { text, from, to };
    });
    return {
        lines: lines.length,
        length: fullText.length,
        line: (n: number) => ranges[n - 1],
        lineAt: () => ({ number: 1 }),
        sliceString: (from: number, to: number) => fullText.slice(from, to),
    };
}

const stubDeps: MoveDeps = {
    tabSize: 4,
    slotAt: () => ({ slotContext: 'outside' as InsertionSlotContext, decision: { allowDrop: true } }),
    parseLine: (text) => ({
        text,
        quotePrefix: '',
        quoteDepth: 0,
        rest: text,
        isListItem: false,
        indentRaw: '',
        indentWidth: 0,
        marker: '',
        markerType: 'unordered',
        content: text,
    }),
    listCtx: () => null,
    insertText: (_doc, _block, _line, sourceContent) => sourceContent,
};

const sourceBlock = {
    type: BlockType.Paragraph,
    startLine: 0,
    endLine: 0,
    from: 0,
    to: 5,
    indentLevel: 0,
    content: 'alpha',
};

describe('cross-document move', () => {
    it('produces two edits (source delete + target insert) for different documents', () => {
        const sourceDoc = makeDoc(['alpha']);
        const targetDoc = makeDoc(['beta', 'gamma']);
        const target: DropTarget = { targetDoc, targetLineNumber: 2, placement: 'before' };

        const planned = planMove({ sourceDoc, selection: createSingleBlockSelection(sourceBlock), target, deps: stubDeps });
        expect(planned.type).toBe('ok');
        if (planned.type !== 'ok') return;

        const edits = moveTx({ sourceDoc, plan: planned.value });
        expect(Array.isArray(edits)).toBe(true);
        if (!Array.isArray(edits)) return;
        expect(edits).toHaveLength(2);

        const sourceEdit = edits.find((e) => e.doc === sourceDoc);
        expect(sourceEdit?.changes.every((c) => c.insert === '')).toBe(true);

        const targetEdit = edits.find((e) => e.doc === targetDoc);
        expect(targetEdit?.changes.some((c) => c.insert.includes('alpha'))).toBe(true);
    });

    it('produces a single merged edit for the same document', () => {
        const doc = makeDoc(['alpha', 'beta', 'gamma']);
        const target: DropTarget = { targetDoc: doc, targetLineNumber: 3, placement: 'before' };

        const planned = planMove({ sourceDoc: doc, selection: createSingleBlockSelection(sourceBlock), target, deps: stubDeps });
        expect(planned.type).toBe('ok');
        if (planned.type !== 'ok') return;

        const edits = moveTx({ sourceDoc: doc, plan: planned.value });
        expect(Array.isArray(edits)).toBe(true);
        if (!Array.isArray(edits)) return;
        expect(edits).toHaveLength(1);
        expect(edits[0].doc).toBe(doc);
    });
});
