import { describe, expect, it } from 'vitest';
import { computeListIntent, getListAncestorLineNumbers, resolveReferenceListLineNumber } from './list-target';
import { getLineMap } from './line-map';
import type { DocLikeWithRange } from './document-types';

function docFrom(text: string): DocLikeWithRange {
    const lines = text.split('\n');
    const lineText: string[] = [''];
    const lineFrom: number[] = [0];
    let offset = 0;
    for (const line of lines) {
        offset += line.length + 1; // +1 for the '\n' (1-indexed: from is post-separator)
        lineText.push(line);
        lineFrom.push(offset);
    }
    return {
        lines: lines.length,
        length: text.length,
        line: (n: number) => ({
            number: n,
            from: (lineFrom[n - 1] ?? 0),
            to: (lineFrom[n - 1] ?? 0) + (lineText[n] ?? '').length,
            text: lineText[n] ?? '',
            length: (lineText[n] ?? '').length,
        }),
        sliceString: (from: number, to: number) => text.slice(from, to),
    };
}

describe('computeListIntent', () => {
    it('returns sibling at the marker with base indent', () => {
        // Two sibling list items at indent 0.
        const doc = docFrom('- a\n- b');
        const lineMap = getLineMap({ doc }, { tabSize: 4 });

        const intent = computeListIntent({
            doc,
            lineMap,
            referenceLineNumber: 2,
            cursorOffsetColumns: 0,
            indentUnit: 2,
            allowChild: true,
        });

        expect(intent).toEqual({ mode: 'sibling', contextLineNumber: 2, targetIndentWidth: 0 });
    });

    it('returns child when cursor is one indent to the right', () => {
        const doc = docFrom('- a\n- b');
        const lineMap = getLineMap({ doc }, { tabSize: 4 });

        const intent = computeListIntent({
            doc,
            lineMap,
            referenceLineNumber: 2,
            cursorOffsetColumns: 2,
            indentUnit: 2,
            allowChild: true,
        });

        expect(intent?.mode).toBe('child');
        expect(intent?.contextLineNumber).toBe(2);
        expect(intent?.targetIndentWidth).toBe(2);
    });

    it('returns outdent to the ancestor when cursor is to the left', () => {
        // Nested: item 1 is parent (indent 0), item 2 is child (indent 2).
        const doc = docFrom('- parent\n  - child');
        const lineMap = getLineMap({ doc }, { tabSize: 4 });

        const intent = computeListIntent({
            doc,
            lineMap,
            referenceLineNumber: 2,
            cursorOffsetColumns: -2,
            indentUnit: 2,
            allowChild: true,
        });

        expect(intent?.mode).toBe('outdent');
        expect(intent?.contextLineNumber).toBe(1);
        expect(intent?.targetIndentWidth).toBe(0);
    });

    it('forbids child when allowChild is false (self-target)', () => {
        const doc = docFrom('- a\n- b');
        const lineMap = getLineMap({ doc }, { tabSize: 4 });

        const intent = computeListIntent({
            doc,
            lineMap,
            referenceLineNumber: 2,
            cursorOffsetColumns: 2,
            indentUnit: 2,
            allowChild: false,
        });

        // No child slot, cursor is between sibling(0) and where child would be;
        // nearest is sibling.
        expect(intent?.mode).toBe('sibling');
    });

    it('returns null when the reference line is not a list item', () => {
        const doc = docFrom('# heading\n\nplain paragraph');
        const lineMap = getLineMap({ doc }, { tabSize: 4 });

        const intent = computeListIntent({
            doc,
            lineMap,
            referenceLineNumber: 3,
            cursorOffsetColumns: 0,
            indentUnit: 2,
            allowChild: true,
        });

        expect(intent).toBeNull();
    });
});

describe('getListAncestorLineNumbers', () => {
    it('walks up the parent chain to the root', () => {
        const doc = docFrom('- a\n  - b\n    - c');
        const lineMap = getLineMap({ doc }, { tabSize: 4 });

        const ancestors = getListAncestorLineNumbers(doc, 3, lineMap);

        // From the deepest item, ancestors climb to the root (line 1).
        expect(ancestors).toContain(1);
        expect(ancestors[ancestors.length - 1]).toBe(1);
        // The starting line's own subtree root is included; it must not be
        // deeper than the starting line.
        expect(ancestors[0]).toBeLessThanOrEqual(3);
    });
});

describe('resolveReferenceListLineNumber', () => {
    it('returns a list line at or above the input', () => {
        const doc = docFrom('- a\n  - b\n  - c');
        const lineMap = getLineMap({ doc }, { tabSize: 4 });

        // Line 3 is a list line inside line 1's subtree.
        const ref = resolveReferenceListLineNumber(3, lineMap);
        expect(ref).not.toBeNull();
        expect(ref).toBeGreaterThanOrEqual(1);
        expect(ref).toBeLessThanOrEqual(3);
    });
});
