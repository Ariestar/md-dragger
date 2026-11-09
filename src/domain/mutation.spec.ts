import { describe, expect, it } from 'vitest';
import { BlockType } from './block/block-types';
import { gapAt } from './markdown/gap';
import { getLineMap } from './markdown/line-map';
import { insertIntoGap, type PayloadEnd, relevelListText } from './mutation';
import { formatIndent, parseLine } from './parse/parse-line';
import { isStandalone } from './rules/separation';
import { stringDoc } from './transaction/string-doc';

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

const TAB = 4;

describe('insertIntoGap', () => {
    const paragraphEnd: PayloadEnd = { type: BlockType.Paragraph, run: 'paragraph@0', standalone: false };
    const standaloneEnd: PayloadEnd = { ...paragraphEnd, standalone: true };

    function insertion(text: string, seam: number, end: PayloadEnd, payload = 'X'): string {
        const doc = stringDoc(text);
        const lineMap = getLineMap(doc, { tabSize: TAB });
        const at = gapAt(doc, seam, { lineMap, tabSize: TAB });
        if (at.type !== 'gap') throw new Error(`seam ${seam} is ${at.reason}`);
        const change = insertIntoGap(
            doc,
            at.gap,
            { text: payload, first: end, last: end },
            {
                lineMap,
                tabSize: TAB,
                parent: null,
                standalone: (block) => isStandalone(doc, block, { lineMap }),
            },
        );
        expect(change.from).toBe(change.to);
        return text.slice(0, change.from) + change.insert + text.slice(change.to);
    }

    it('writes a tight line into a tight gap, and separates a standalone block', () => {
        expect(insertion('a\nb', 2, paragraphEnd)).toBe('a\nX\nb');
        expect(insertion('a\nb', 2, standaloneEnd)).toBe('a\n\nX\n\nb');
    });

    it('keeps a one- or two-line gap on both sides', () => {
        expect(insertion('a\n\nb', 3, paragraphEnd)).toBe('a\n\nX\n\nb');
        expect(insertion('a\n\n\nb', 4, paragraphEnd)).toBe('a\n\n\nX\n\n\nb');
    });

    it('writes at the top edge below padding and frontmatter', () => {
        expect(insertion('a\nb', 1, paragraphEnd)).toBe('X\na\nb');
        // A line never joins a standalone paragraph.
        expect(insertion('a', 1, paragraphEnd)).toBe('X\n\na');
        expect(insertion('\na', 1, standaloneEnd)).toBe('\nX\n\na');
        expect(insertion('---\nt\n---\na', 4, standaloneEnd)).toBe('---\nt\n---\nX\n\na');
    });

    it('writes at the bottom edge above trailing padding and the final newline', () => {
        expect(insertion('a\nb', 3, paragraphEnd)).toBe('a\nb\nX');
        expect(insertion('a\n', 2, standaloneEnd)).toBe('a\n\nX\n');
        expect(insertion('a\n\n', 3, standaloneEnd)).toBe('a\n\nX\n\n');
    });

    it('writes into a document with no block', () => {
        expect(insertion('', 1, standaloneEnd)).toBe('X');
        expect(insertion('\n', 1, standaloneEnd)).toBe('X\n\n');
        expect(insertion('---\nt\n---', 4, standaloneEnd)).toBe('---\nt\n---\nX');
        expect(insertion('---\nt\n---\n', 4, standaloneEnd)).toBe('---\nt\n---\nX\n');
    });
});
