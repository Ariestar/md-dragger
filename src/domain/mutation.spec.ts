import { describe, expect, it } from 'vitest';
import { rebaseAppendChange, relevelListText } from './mutation';
import { formatIndent, parseLine } from './parse/parse-line';
import { stringDoc } from './transaction/string-doc';

describe('rebaseAppendChange', () => {
    it('rebases an append insertion without duplicating its newline separator', () => {
        const snapshot = stringDoc('target');
        const current = stringDoc('newer target text');

        expect(
            rebaseAppendChange(snapshot, { from: snapshot.length, to: snapshot.length, insert: '\nsource' }, current),
        ).toEqual({ pos: current.length, text: '\nsource' });
    });

    it('adds the separator when a formerly empty target now has content', () => {
        const snapshot = stringDoc('');
        const current = stringDoc('new content');

        expect(rebaseAppendChange(snapshot, { from: 0, to: 0, insert: 'source' }, current)).toEqual({
            pos: current.length,
            text: '\nsource',
        });
    });

    it('does not add a separator when the current document already ends with a newline', () => {
        const snapshot = stringDoc('target');
        const current = stringDoc('newer\n');

        expect(
            rebaseAppendChange(snapshot, { from: snapshot.length, to: snapshot.length, insert: '\nsource' }, current),
        ).toEqual({ pos: current.length, text: 'source' });
    });

    it('rejects changes that are not a pure end-of-document insertion', () => {
        const snapshot = stringDoc('target');
        const current = stringDoc('current');

        expect(rebaseAppendChange(snapshot, { from: 0, to: 1, insert: 'x' }, current)).toBeNull();
    });
});

describe('relevelListText', () => {
    const relevel = (sourceContent: string, targetIndentWidth: number) =>
        relevelListText({
            sourceContent,
            parse: (line) => parseLine(line, 4),
            formatIndentFn: (sample, width) => formatIndent(width, 4, sample),
            targetIndentWidth,
        });

    it("keeps the text of an item's fence, table, heading, rule and math children", () => {
        const fence = '```';
        expect(relevel(`- b\n    ${fence}js\n    code\n    ${fence}`, 4)).toBe(
            `    - b\n        ${fence}js\n        code\n        ${fence}`,
        );
        expect(relevel('- x\n    | h |\n    |---|', 4)).toBe('    - x\n        | h |\n        |---|');
        expect(relevel('- b\n    # Sub\n    ***\n    $$\n    x\n    $$', 4)).toBe(
            '    - b\n        # Sub\n        ***\n        $$\n        x\n        $$',
        );
    });
});
