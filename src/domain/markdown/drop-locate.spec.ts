import { describe, expect, it } from 'vitest';
import { BlockType } from '../block/block-types';
import { createSingleBlockSelection } from '../selection/block-selection';
import type { Doc } from './document-types';
import { locateDropTarget } from './drop-locate';

function docFrom(text: string): Doc {
    const lines = text.split('\n');
    return {
        lines: lines.length,
        length: text.length,
        line: (n: number) => ({
            number: n,
            from: 0,
            to: (lines[n - 1] ?? '').length,
            text: lines[n - 1] ?? '',
            length: (lines[n - 1] ?? '').length,
        }),
        sliceString: () => text,
    } as Doc;
}

function listSelection(doc: Doc, lineNumber: number) {
    const line = doc.line(lineNumber);
    return createSingleBlockSelection({
        type: BlockType.ListItem,
        startLine: lineNumber - 1,
        endLine: lineNumber - 1,
        from: line.from,
        to: line.to,
        content: line.text,
    });
}

describe('locateDropTarget', () => {
    it('upper half inserts before the hit line; lower half inserts after', () => {
        const doc = docFrom('- a\n- b\n- c');
        const selection = listSelection(doc, 1);

        const upper = locateDropTarget({
            doc,
            selection,
            hitLineNumber: 2,
            belowMidLine: false,
            pastListContentStart: false,
            cursorOffsetColumnsFromMarker: () => 0,
            tabSize: 4,
            indentUnit: 2,
        });
        expect(upper?.targetLineNumber).toBe(2);

        const lower = locateDropTarget({
            doc,
            selection,
            hitLineNumber: 2,
            belowMidLine: true,
            pastListContentStart: false,
            cursorOffsetColumnsFromMarker: () => 0,
            tabSize: 4,
            indentUnit: 2,
        });
        expect(lower?.targetLineNumber).toBe(3);
    });

    it('nests one level into the hovered list row (not two)', () => {
        const doc = docFrom('- a\n- b\n- c');
        const selection = listSelection(doc, 1);

        const result = locateDropTarget({
            doc,
            selection,
            hitLineNumber: 2,
            belowMidLine: false,
            pastListContentStart: true,
            // Far enough right of marker to prefer child slot at +indentUnit.
            cursorOffsetColumnsFromMarker: () => 2,
            tabSize: 4,
            indentUnit: 2,
        });

        expect(result?.targetLineNumber).toBe(3);
        expect(result?.listIntent?.mode).toBe('child');
        expect(result?.listIntent?.targetIndentWidth).toBe(2);
        expect(result?.listIntent?.contextLineNumber).toBe(2);
    });

    it('does not force nest when pointer is in the lower half', () => {
        const doc = docFrom('- a\n- b\n- c');
        const selection = listSelection(doc, 1);

        const result = locateDropTarget({
            doc,
            selection,
            hitLineNumber: 2,
            belowMidLine: true,
            pastListContentStart: true,
            cursorOffsetColumnsFromMarker: () => 0,
            tabSize: 4,
            indentUnit: 2,
        });

        // Lower half of line 2 → target 3; reference is prev non-empty (line 2) via target-1.
        expect(result?.targetLineNumber).toBe(3);
    });
});
