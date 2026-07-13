import { describe, expect, it } from 'vitest';
import { computeListIntent, listAncestors, listRoot } from './list-target';
import { getLineMap } from './line-map';
import type { Doc } from './document-types';

function docFrom(text: string): Doc {
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
        const doc = docFrom('- a\n- b');
        const lineMap = getLineMap(doc, { tabSize: 4 });

        const intent = computeListIntent({
            doc,
            lineMap,
            refLine: 2,
            offset: 0,
            indentUnit: 2,
            allowChild: true,
        });

        expect(intent).toEqual({ mode: 'sibling', contextLineNumber: 2, targetIndentWidth: 0 });
    });

    it('returns child when cursor is one indent to the right', () => {
        const doc = docFrom('- a\n- b');
        const lineMap = getLineMap(doc, { tabSize: 4 });

        const intent = computeListIntent({
            doc,
            lineMap,
            refLine: 2,
            offset: 2,
            indentUnit: 2,
            allowChild: true,
        });

        expect(intent?.mode).toBe('child');
        expect(intent?.contextLineNumber).toBe(2);
        expect(intent?.targetIndentWidth).toBe(2);
    });

    it('returns outdent to the ancestor when cursor is to the left', () => {
        const doc = docFrom('- parent\n  - child');
        const lineMap = getLineMap(doc, { tabSize: 4 });

        const intent = computeListIntent({
            doc,
            lineMap,
            refLine: 2,
            offset: -2,
            indentUnit: 2,
            allowChild: true,
        });

        expect(intent?.mode).toBe('outdent');
        expect(intent?.contextLineNumber).toBe(1);
        expect(intent?.targetIndentWidth).toBe(0);
    });

    it('forbids child when allowChild is false (self-target)', () => {
        const doc = docFrom('- a\n- b');
        const lineMap = getLineMap(doc, { tabSize: 4 });

        const intent = computeListIntent({
            doc,
            lineMap,
            refLine: 2,
            offset: 2,
            indentUnit: 2,
            allowChild: false,
        });

        expect(intent?.mode).toBe('sibling');
    });

    it('returns null when the reference line is not a list item', () => {
        const doc = docFrom('# heading\n\nplain paragraph');
        const lineMap = getLineMap(doc, { tabSize: 4 });

        const intent = computeListIntent({
            doc,
            lineMap,
            refLine: 3,
            offset: 0,
            indentUnit: 2,
            allowChild: true,
        });

        expect(intent).toBeNull();
    });
});

describe('listAncestors', () => {
    it('walks up the parent chain to the root', () => {
        const doc = docFrom('- a\n  - b\n    - c');
        const lineMap = getLineMap(doc, { tabSize: 4 });

        const ancestors = listAncestors(doc, 3, lineMap);

        expect(ancestors).toContain(1);
        expect(ancestors[ancestors.length - 1]).toBe(1);
        expect(ancestors[0]).toBeLessThanOrEqual(3);
    });
});

describe('listRoot', () => {
    it('returns a list line at or above the input', () => {
        const doc = docFrom('- a\n  - b\n  - c');
        const lineMap = getLineMap(doc, { tabSize: 4 });

        const ref = listRoot(3, lineMap);
        expect(ref).not.toBeNull();
        expect(ref).toBeGreaterThanOrEqual(1);
        expect(ref).toBeLessThanOrEqual(3);
    });
});
