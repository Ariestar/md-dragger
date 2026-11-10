import { describe, expect, it } from 'vitest';
import { detectBlock } from '../block/block-detector';
import { BlockType } from '../block/block-types';
import { getLineMap } from '../markdown/line-map';
import { parseLine } from '../parse/parse-line';
import { stringDoc } from '../transaction/string-doc';
import { type Facing, isStandalone, needsBlankLine, runKind } from './separation';

const tabSize = 4;

function facing(type: BlockType, text: string): Facing {
    return { type, line: parseLine(text, tabSize) };
}

const paragraph = facing(BlockType.Paragraph, 'text');
const childParagraph = facing(BlockType.Paragraph, '    child text');
const heading = facing(BlockType.Heading, '# Heading');
const callout = facing(BlockType.Callout, '> [!note] Title');
const quote = facing(BlockType.Blockquote, '> quote');
const deeperQuote = facing(BlockType.Blockquote, '> > deeper');
const bullet = facing(BlockType.ListItem, '- item');
const quotedBullet = facing(BlockType.ListItem, '> - item');
const orderedOne = facing(BlockType.ListItem, '1. item');
const orderedThree = facing(BlockType.ListItem, '3. item');
const emptyBullet = facing(BlockType.ListItem, '- ');
const emptyOrderedOne = facing(BlockType.ListItem, '1. ');
const emptyTask = facing(BlockType.ListItem, '- [ ] ');
const rule = facing(BlockType.HorizontalRule, '---');
const table = facing(BlockType.Table, '| a | b |');
const code = facing(BlockType.CodeBlock, '```');
const math = facing(BlockType.MathBlock, '$$');
const comment = facing(BlockType.Comment, '%%');

describe('domain/rules/separation needsBlankLine', () => {
    it.each([
        ['Callout over Callout', callout, callout, true],
        ['Callout over Paragraph', callout, paragraph, true],
        ['Paragraph over Callout', paragraph, callout, false],
        ['ListItem over Paragraph', bullet, paragraph, true],
        ['Paragraph over bullet', paragraph, bullet, false],
        ['Paragraph over `1.`', paragraph, orderedOne, false],
        ['Paragraph over `3.`', paragraph, orderedThree, true],
        ['Paragraph over an empty bullet (a setext underline)', paragraph, emptyBullet, true],
        ['Paragraph over an empty `1.`', paragraph, emptyOrderedOne, true],
        ['Paragraph over an empty task', paragraph, emptyTask, false],
        ['Paragraph over rule', paragraph, rule, true],
        ['Paragraph over math', paragraph, math, false],
        ['Blockquote over math', quote, math, false],
        ['Math over Paragraph', math, paragraph, false],
        // Obsidian comments are inline: the paragraph lines around one would be one paragraph.
        ['Paragraph over comment', paragraph, comment, true],
        ['Comment over Paragraph', comment, paragraph, true],
        ['Comment over heading', comment, heading, false],
        ['Paragraph over code', paragraph, code, false],
        ['Paragraph over heading', paragraph, heading, false],
        ['Heading over Paragraph', heading, paragraph, false],
        ['Heading over Callout', heading, callout, false],
        ['Heading over Heading', heading, heading, false],
        ['Rule over Paragraph', rule, paragraph, false],
        ['Code over Paragraph', code, paragraph, false],
        ['Paragraph over Table', paragraph, table, true],
        ['Heading over Table', heading, table, true],
        ['Table over Paragraph', table, paragraph, false],
        ['Table over ListItem', table, bullet, false],
        ['Table over Blockquote', table, quote, false],
        ['Table over Table', table, table, true],
        ['Blockquote over Blockquote at equal depth', quote, quote, false],
        ['Blockquote over Blockquote at another depth', deeperQuote, quote, true],
        ['Blockquote over Callout', quote, callout, true],
        ['Blockquote over Paragraph', quote, paragraph, true],
        ['ListItem over ListItem', bullet, orderedThree, false],
        ['indent-4 child Paragraph over indent-0 Paragraph', childParagraph, paragraph, true],
        ['Paragraph over Paragraph at equal indent', paragraph, paragraph, false],
        ['quoted ListItem over ListItem', quotedBullet, bullet, true],
        ['quoted ListItem over Callout', quotedBullet, callout, true],
    ])('%s → %s', (_name, upper, lower, expected) => {
        expect(needsBlankLine(upper, lower)).toBe(expected);
    });
});

describe('domain/rules/separation isStandalone', () => {
    function standalone(text: string, line: number): boolean {
        const doc = stringDoc(text);
        const block = detectBlock(doc, line, { tabSize });
        if (!block) throw new Error(`no block at line ${line}`);
        return isStandalone(doc, block, { lineMap: getLineMap(doc, { tabSize }) });
    }

    it('is true at the document edges and between blank lines', () => {
        expect(standalone('a', 1)).toBe(true);
        expect(standalone('a\n\nb\n\nc', 3)).toBe(true);
        expect(standalone('a\n\n> [!note] c\n> body\n', 3)).toBe(true);
    });

    it('is true directly after frontmatter', () => {
        expect(standalone('---\nt: x\n---\npara\n\nend', 4)).toBe(true);
    });

    it('is false for a line of a larger paragraph or quote', () => {
        expect(standalone('a\nb\n\nc', 1)).toBe(false);
        expect(standalone('a\nb\n\nc', 2)).toBe(false);
        expect(standalone('# H\n> a\n> b', 2)).toBe(false);
    });

    it('is true for a paragraph or quote line touched only by other kinds of lines', () => {
        expect(standalone('# H\n> a', 2)).toBe(true);
        expect(standalone('# A\nalpha\n# B', 2)).toBe(true);
        expect(standalone('> q\npara\n- item', 2)).toBe(true);
        expect(standalone('> q\n> > deeper\n> q', 2)).toBe(true);
    });

    it('is false for another block with a tight neighbour', () => {
        expect(standalone('p1\n# H\np2', 2)).toBe(false);
        expect(standalone('para\n> [!note] c', 2)).toBe(false);
    });
});

describe('domain/rules/separation runKind', () => {
    it('names the paragraph indent, the quote depth and list subtrees', () => {
        const doc = stringDoc('para\n> q\n> > qq\n- item\n    child\n    > [!note] x\n# H\n> [!note] c');
        const options = { lineMap: getLineMap(doc, { tabSize }), tabSize };
        expect([1, 2, 3, 4, 5, 6, 7, 8].map((line) => runKind(doc, line, options))).toEqual([
            'paragraph@0',
            'quote@1',
            'quote@2',
            'list',
            'list',
            'list',
            null,
            null,
        ]);
    });

    it('gives a list inside a quote no run kind: it belongs to its quote', () => {
        const doc = stringDoc('> - a\n>     - b');
        const options = { lineMap: getLineMap(doc, { tabSize }), tabSize };
        expect([1, 2].map((line) => runKind(doc, line, options))).toEqual([null, null]);
    });
});
