import { describe, expect, it } from 'vitest';
import { BlockType } from '../block/block-types';
import { createSingleBlockSelection } from '../selection/block-selection';
import type { Doc } from './document-types';
import { locateDropTarget } from './drop-locate';

function docFrom(text: string): Doc {
    const lines = text.split('\n');
    let offset = 0;
    const froms: number[] = [0];
    for (const line of lines) {
        offset += line.length + 1;
        froms.push(offset);
    }
    return {
        lines: lines.length,
        length: text.length,
        line: (n: number) => ({
            number: n,
            from: froms[n - 1] ?? 0,
            to: (froms[n - 1] ?? 0) + (lines[n - 1] ?? '').length,
            text: lines[n - 1] ?? '',
            length: (lines[n - 1] ?? '').length,
        }),
        sliceString: (a: number, b: number) => text.slice(a, b),
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
            hitLine: 2,
            belowMid: false,
            pastMarker: false,
            markerOffset: () => 0,
            tabSize: 4,
            indentUnit: 2,
        });
        expect(upper?.targetLineNumber).toBe(2);

        const lower = locateDropTarget({
            doc,
            selection,
            hitLine: 2,
            belowMid: true,
            pastMarker: false,
            markerOffset: () => 0,
            tabSize: 4,
            indentUnit: 2,
        });
        expect(lower?.targetLineNumber).toBe(3);
    });

    it('nests one level into the hovered list row', () => {
        const doc = docFrom('- a\n- b\n- c');
        const selection = listSelection(doc, 1);

        const result = locateDropTarget({
            doc,
            selection,
            hitLine: 2,
            belowMid: false,
            pastMarker: true,
            markerOffset: () => 2,
            tabSize: 4,
            indentUnit: 2,
        });

        expect(result?.targetLineNumber).toBe(3);
        expect(result?.listIntent?.mode).toBe('child');
        expect(result?.listIntent?.targetIndentWidth).toBe(2);
        expect(result?.listIntent?.contextLineNumber).toBe(2);
    });

    it('keeps nested indent when dropping as sibling of an inner list item', () => {
        // 2-space nest:
        // 1: - parent
        // 2:   - child a
        // 3:   - child b
        const doc = docFrom('- parent\n  - child a\n  - child b');
        const selection = listSelection(doc, 3);

        // Hover lower half of child a, at its marker (sibling, not nest).
        const result = locateDropTarget({
            doc,
            selection,
            hitLine: 2,
            belowMid: true,
            pastMarker: false,
            markerOffset: () => 0,
            tabSize: 4,
            indentUnit: 2,
        });

        expect(result?.targetLineNumber).toBe(3);
        expect(result?.listIntent?.targetIndentWidth).toBe(2);
        expect(result?.listIntent?.mode).toBe('sibling');
    });

    it('never forces targetIndentWidth 0 when reference is a nested list line', () => {
        const doc = docFrom('- parent\n  - child\n- other');
        const selection = listSelection(doc, 3);

        // Measurement fails → must still keep nested indent, not collapse to 0.
        const result = locateDropTarget({
            doc,
            selection,
            hitLine: 2,
            belowMid: true,
            pastMarker: false,
            markerOffset: () => null,
            tabSize: 4,
            indentUnit: 2,
        });

        expect(result?.listIntent?.targetIndentWidth).toBe(2);
        expect(result?.listIntent?.contextLineNumber).toBe(2);
    });
});
