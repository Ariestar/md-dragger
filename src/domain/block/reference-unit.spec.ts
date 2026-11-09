import { describe, expect, it } from 'vitest';
import { stringDoc } from '../transaction/string-doc';
import { BlockType } from './block-types';
import { referenceUnit } from './reference-unit';

function unitAt(lines: string[], line: number, tabSize = 4) {
    return referenceUnit(stringDoc(lines.join('\n')), line, { tabSize });
}

const range = (startLine: number, endLine: number) => ({ startLine, endLine });
const paragraph = (startLine: number, endLine: number) => ({
    type: BlockType.Paragraph,
    lines: range(startLine, endLine),
});
const heading = (startLine: number, endLine: number) => ({ type: BlockType.Heading, lines: range(startLine, endLine) });
const item = (startLine: number, endLine: number) => ({ type: BlockType.ListItem, lines: range(startLine, endLine) });

/** The last line of each piece of a unit's text. */
function textEnds(lines: string[], line: number, tabSize = 4) {
    return unitAt(lines, line, tabSize)?.text.map((piece) => piece.lines.endLine);
}

describe('domain/reference-unit', () => {
    describe('paragraphs', () => {
        it('joins every line of a paragraph into the whole paragraph', () => {
            const lines = ['intro', '', 'one', 'two', 'three', '', 'outro'];

            for (const line of [3, 4, 5]) {
                expect(unitAt(lines, line)).toEqual({ block: paragraph(3, 5), text: [paragraph(3, 5)] });
            }
        });

        it('takes indented lines as continuation lines', () => {
            expect(unitAt(['one', '  two', '        three'], 1)?.block).toEqual(paragraph(1, 3));
        });

        it.each([
            ['a heading', ['# next']],
            ['a rule', ['***']],
            ['a code fence', ['```', 'x', '```']],
            ['a math fence', ['$$', 'x', '$$']],
            ['a comment fence', ['%%', 'x', '%%']],
            ['a bullet item', ['- next']],
            ['an empty bullet item', ['- ']],
            ['a bare list marker, an empty item', ['-']],
            ['an ordered item starting at 1', ['1. next']],
            ['a task item', ['- [ ] next']],
            ['a quote', ['> next']],
        ])('ends the paragraph above %s', (_, next) => {
            expect(unitAt(['one', 'two', ...next], 1)?.block).toEqual(paragraph(1, 2));
        });

        it.each([
            ['2.', '2. two'],
            ['0.', '0. two'],
        ])('continues the paragraph through an ordered marker %s, which cannot interrupt it', (_, next) => {
            expect(unitAt(['one', next], 2)?.block).toEqual(paragraph(1, 2));
        });

        it('continues the paragraph through a list line indented as code, which is no list item there', () => {
            expect(unitAt(['one', '    - two'], 1)?.block).toEqual(paragraph(1, 2));
        });

        it('continues the paragraph through table rows, a callout marker and one-line math or comments', () => {
            const lines = ['one', '| a | b |', '| - | - |', '[!note] text', '$$x$$', '%% c %%', 'end'];

            expect(unitAt(lines, 2)?.block).toEqual(paragraph(1, 7));
        });

        it('takes a one-line math block on its own as a paragraph', () => {
            expect(unitAt(['$$x$$'], 1)).toEqual({ block: paragraph(1, 1), text: [paragraph(1, 1)] });
        });

        it('takes a math fence line that opens no fence, on the last line, as text', () => {
            expect(unitAt(['x', '$$'], 1)?.block).toEqual(paragraph(1, 2));
        });

        it('starts no paragraph in frontmatter or on a blank line', () => {
            expect(unitAt(['---', 'a: 1', '---', 'text'], 2)).toBeNull();
            expect(unitAt(['---', 'a: 1', '---', 'text'], 4)?.block).toEqual(paragraph(4, 4));
            expect(unitAt(['a', '', 'b'], 2)).toBeNull();
        });

        it('gives no block for a bare list marker, which the line map does not read as a list item', () => {
            expect(unitAt(['- a', '-', '- c'], 2)).toBeNull();
        });

        it('gives no block under a bare list marker, which Obsidian takes into that item, but a list item or paragraph', () => {
            expect(unitAt(['-', '> q', '-'], 2)).toBeNull();
            expect(unitAt(['-', 'text'], 2)?.block).toEqual(paragraph(2, 2));
            expect(unitAt(['-', '  text', '> q', '-'], 3)).toBeNull();
            expect(unitAt(['-', '', '    $$ x $$', '- b'], 3)).toBeNull();
            expect(unitAt(['-', '- b'], 2)?.block).toEqual(item(2, 2));
            expect(unitAt(['-', '', '  - b'], 3)?.block).toEqual(item(3, 3));
        });

        it('gives no block for a blank line, inside a list item too, but the fence holding one', () => {
            expect(unitAt(['- a', '', '  b'], 2)).toBeNull();
            expect(unitAt(['```', 'a', '', 'b', '```'], 3)?.block).toEqual({
                type: BlockType.CodeBlock,
                lines: range(1, 5),
            });
        });

        it('gives no block for a footnote definition, from any of its lines', () => {
            expect(unitAt(['[^1]: note', 'more'], 1)).toBeNull();
            expect(unitAt(['[^1]: note', 'more'], 2)).toBeNull();
            expect(unitAt(['para', '[^1]: note'], 2)?.block).toEqual(paragraph(1, 2));
        });

        it('reads a footnote definition on past blank lines into lines indented four columns, and their lazy lines', () => {
            const lines = ['[^1]: note', '', '    more', 'lazy', '%% c %%', '', '    > quoted', '', '  after'];

            for (const line of [3, 4, 5, 7]) expect(unitAt(lines, line)).toBeNull();
            expect(unitAt(['', '    code'], 2)?.block).toEqual({ type: BlockType.CodeBlock, lines: range(2, 2) });
            expect(unitAt(lines, 9)?.block).toEqual(paragraph(9, 9));
        });
    });

    describe('setext headings', () => {
        it.each([['==='], ['---'], ['--'], ['-']])(
            'makes one line of text over %s a heading, from either line',
            (line) => {
                const unit = { block: heading(1, 2), text: [heading(1, 1)] };

                expect(unitAt(['Title', line, '', 'text'], 1)).toEqual(unit);
                expect(unitAt(['Title', line, '', 'text'], 2)).toEqual(unit);
                expect(unitAt(['Title', line, 'text'], 3)?.block).toEqual(paragraph(3, 3));
                expect(unitAt(['Title', line, '> q'], 3)?.block.type).toEqual(BlockType.Blockquote);
            },
        );

        it('makes a line right after a heading or rule a setext heading too, but no heading itself', () => {
            expect(unitAt(['# H', 'T', '==='], 2)?.block).toEqual(heading(2, 3));
            expect(unitAt(['***', '   T', '---'], 2)?.block).toEqual(heading(2, 3));
            expect(unitAt(['# H', '==='], 2)?.block).toEqual(paragraph(2, 2));
        });

        it('makes a table row, a callout marker or one-line math or comment a setext heading', () => {
            for (const text of ['| a |', '[!note] T', '$$x$$', '%% c %%']) {
                expect(unitAt([text, '---'], 1)?.block).toEqual(heading(1, 2));
            }
        });

        it.each([
            ['the second line of a paragraph', ['a', 'b', '==='], 2, paragraph(1, 3)],
            ['an indented underline', ['a', ' ==='], 1, paragraph(1, 2)],
            ['an underline with spaces after it', ['a', '===  '], 1, paragraph(1, 2)],
            ['nothing, on the first line', ['===', 'text'], 1, paragraph(1, 2)],
            ['a lazy line of a list item', ['- a', 'Text', '==='], 2, item(1, 3)],
            ["a list item's paragraph", ['- a', '', '  T', '==='], 3, item(1, 4)],
        ])('takes no underline under %s', (_, lines, line, block) => {
            expect(unitAt(lines, line)?.block).toEqual(block);
        });

        it('takes no underline under a quoted line, whose paragraph it continues lazily', () => {
            expect(unitAt(['> T', '==='], 1)).toEqual({
                block: { type: BlockType.Blockquote, lines: range(1, 2) },
                text: [paragraph(1, 2)],
            });
        });

        it('takes a rule under the second line of a paragraph as a rule', () => {
            expect(unitAt(['a', 'b', '---'], 3)?.block).toEqual({ type: BlockType.HorizontalRule, lines: range(3, 3) });
        });
    });

    describe('indented code', () => {
        it('takes lines indented four columns, blank lines among them, as one code block', () => {
            const lines = ['para', '', '    code', '', '    more', '', 'after'];
            const code = { block: { type: BlockType.CodeBlock, lines: range(3, 5) }, text: [] };

            expect(unitAt(lines, 3)).toEqual(code);
            expect(unitAt(lines, 5)).toEqual(code);
        });

        it('starts indented code at the top of the note, right after a heading, but not under a paragraph', () => {
            expect(unitAt(['    code'], 1)?.block).toEqual({ type: BlockType.CodeBlock, lines: range(1, 1) });
            expect(unitAt(['# H', '    code'], 2)?.block).toEqual({ type: BlockType.CodeBlock, lines: range(2, 2) });
            expect(unitAt(['para', '    more'], 2)?.block).toEqual(paragraph(1, 2));
        });

        it('takes a list line indented four columns under no item as code', () => {
            expect(unitAt(['para', '', '\t- tab item'], 3)?.block).toEqual({
                type: BlockType.CodeBlock,
                lines: range(3, 3),
            });
            expect(unitAt(['> - x', '', '\t- tab item'], 3)?.block).toEqual({
                type: BlockType.CodeBlock,
                lines: range(3, 3),
            });
            expect(unitAt(['> - x', '\t- tab item'], 2)?.block).toEqual({
                type: BlockType.CodeBlock,
                lines: range(2, 2),
            });
            expect(unitAt(['> - x', 'lazy', '    code'], 3)?.block).toEqual({
                type: BlockType.CodeBlock,
                lines: range(3, 3),
            });
        });

        it('takes a line indented four columns after a list and blank lines as the list text', () => {
            expect(unitAt(['- a', 'lazy', '', '\t- b'], 4)?.block).toEqual(item(4, 4));
        });

        it('takes the lines under a list line indented as code as code too', () => {
            expect(unitAt(['para', '', '    - x', '      more'], 4)?.block).toEqual({
                type: BlockType.CodeBlock,
                lines: range(3, 4),
            });
        });

        it('keeps indented lines inside a list item as the item text', () => {
            expect(unitAt(['- a', '', '    para'], 3)?.block).toEqual(item(1, 3));
        });
    });

    describe('list items', () => {
        it("ends an item's own text before its child items, which hold their own", () => {
            const lines = ['- a', '    more', '    - b', '        b more', '    - c'];

            expect(unitAt(lines, 1)).toEqual({ block: item(1, 5), text: [paragraph(1, 2)] });
            expect(unitAt(lines, 3)).toEqual({ block: item(3, 4), text: [paragraph(3, 4)] });
        });

        it.each([
            ['bullet', '- a'],
            ['ordered', '3. a'],
            ['task', '- [x] a'],
        ])("ends a %s item's text on its last continuation line", (_, first) => {
            expect(unitAt([first, '  more', '- next'], 1)).toEqual({ block: item(1, 2), text: [paragraph(1, 2)] });
        });

        it('ends an item before a bare list marker, an empty item of its own', () => {
            expect(unitAt(['- a', '-', '- c'], 1)).toEqual({ block: item(1, 1), text: [paragraph(1, 1)] });
        });

        it('holds the paragraph of a quote that opens on the item line, lazy lines too', () => {
            expect(unitAt(['- > q', '  > r', '- b'], 1)).toEqual({ block: item(1, 2), text: [paragraph(1, 2)] });
            expect(textEnds(['1. > quoted', '   > more'], 2)).toEqual([2]);
            expect(textEnds(['- > > q', '  > r'], 1)).toEqual([2]);
            expect(textEnds(['- > q', '  r'], 1)).toEqual([2]);
        });

        it("runs an item's text through lazy continuation lines below its subtree", () => {
            expect(unitAt(['- a', 'lazy', '- b'], 1)).toEqual({ block: item(1, 2), text: [paragraph(1, 2)] });
        });

        it('gives a lazy continuation line to the item whose paragraph it continues', () => {
            expect(unitAt(['- a', '    - b', 'lazy'], 3)).toEqual({ block: item(2, 3), text: [paragraph(2, 3)] });
            expect(unitAt(['- a', '  b', '  - c', '  d'], 4)).toEqual({ block: item(3, 4), text: [paragraph(3, 4)] });
            expect(unitAt(['- a', '  b', '  - c', '  d'], 1)).toEqual({ block: item(1, 4), text: [paragraph(1, 2)] });
        });

        it('ends an item with an ordered child starting at 2 only where the child sits at its level', () => {
            expect(textEnds(['- a', '  2. b'], 1)).toEqual([2]);
            expect(textEnds(['- a', ' 3. b'], 1)).toEqual([1]);
            expect(textEnds(['- a', '2. b'], 1)).toEqual([1]);
            expect(textEnds(['- a', '0. b'], 1)).toEqual([1]);
        });

        it("measures that level by the item's own `>` markers", () => {
            expect(textEnds(['> - a', '2. b'], 1)).toEqual([2]);
            expect(textEnds(['- a', '    > text', '    > 2. b'], 1)).toEqual([1, 3]);
            expect(textEnds(['- a', '    > text', '2. b'], 1)).toEqual([1, 2]);
        });

        it('gives a line after a blank line to an item only when indented to its content', () => {
            expect(unitAt(['- a', '', ' para'], 3)?.block).toEqual(paragraph(3, 3));
            expect(unitAt(['- a', '', ' para'], 1)).toEqual({ block: item(1, 1), text: [paragraph(1, 1)] });
            expect(unitAt(['- a', '', '  para'], 3)?.block).toEqual(item(1, 3));
            expect(unitAt(['1. a', '', '  para'], 3)?.block).toEqual(paragraph(3, 3));
            expect(unitAt(['-   a', '', '  para'], 3)?.block).toEqual(paragraph(3, 3));
            expect(unitAt(['- [ ] a', '', '  para'], 3)?.block).toEqual(item(1, 3));
        });

        it('reads a list line indented less than the item content as no child of it', () => {
            expect(unitAt(['- a', '', ' - b'], 1)).toEqual({ block: item(1, 1), text: [paragraph(1, 1)] });
            expect(unitAt(['- a', '', ' - b'], 3)?.block).toEqual(item(3, 3));
            expect(unitAt(['- a', ' - b'], 1)?.block).toEqual(item(1, 1));
            expect(unitAt(['1. a', '  - b'], 1)?.block).toEqual(item(1, 1));
            expect(unitAt(['1. a', '  more'], 1)?.block).toEqual(item(1, 2));
        });

        it('ends an item at a heading or code or comment fence indented less than its content, not at other blocks', () => {
            expect(unitAt(['1. a', '  # h'], 2)?.block).toEqual(heading(2, 2));
            expect(unitAt(['1. a', '  ```', '  x', '  ```'], 1)?.block).toEqual(item(1, 1));
            expect(unitAt(['1. a', '  ```', '  x', '  ```'], 3)?.block).toEqual({
                type: BlockType.CodeBlock,
                lines: range(2, 4),
            });
            expect(unitAt(['1. a', '  %%', '  c', '  %%'], 1)?.block).toEqual(item(1, 1));
            expect(unitAt(['1. a', '  > q'], 2)?.block).toEqual(item(1, 2));
            expect(unitAt(['1. a', '  $$', '  x', '  $$'], 3)?.block).toEqual(item(1, 4));
        });

        it("measures a quoted item's lines inside its quote", () => {
            expect(unitAt(['- a', '  > 10. q', '  >     - r'], 2)?.block).toEqual(item(2, 3));
        });

        it('ends an item, its code fence too, at a line after a blank line indented less than its content', () => {
            expect(unitAt(['1. a', '   ```', '', '  x', '   ```'], 1)?.block).toEqual(item(1, 2));
        });

        it('gives a line after a blank line to the nearest item it is indented into, and ends the items after it', () => {
            const lines = ['- a', '    - b', '', '     para'];

            expect(unitAt(lines, 4)).toEqual({ block: item(1, 4), text: [paragraph(1, 1), paragraph(4, 4)] });
            expect(unitAt(lines, 2)?.block).toEqual(item(2, 2));
            expect(unitAt(['- a', '', ' para', '', '  more'], 5)?.block).toEqual(paragraph(5, 5));
        });

        it('reads an ordered item that cannot interrupt the paragraph above it as no item', () => {
            expect(unitAt(['para', '2. b', '', '   more'], 4)?.block).toEqual(paragraph(4, 4));
        });

        it("lists the item's other paragraphs, headings and quoted text after its own, outside child items", () => {
            const lines = [
                '- item',
                '    > [!note]',
                '    > body',
                '',
                '    para',
                '    # heading',
                '    - child',
                '',
                '        child para',
                '    ```',
                '    code ^x',
                '    ```',
                '    last',
            ];

            expect(unitAt(lines, 1)).toEqual({
                block: item(1, 13),
                text: [
                    paragraph(1, 1),
                    paragraph(2, 2),
                    paragraph(3, 3),
                    paragraph(5, 5),
                    heading(6, 6),
                    paragraph(13, 13),
                ],
            });
        });

        it('gives every block inside an item to the innermost item holding it', () => {
            const lines = [
                '- item',
                '  more',
                '    > [!note]',
                '    > body',
                '',
                '    para',
                '    ```',
                '    code',
                '    ```',
                '    | a | b |',
                '    | - | - |',
                '    - child',
                '',
                '        child para',
            ];
            const parent = {
                block: item(1, 14),
                text: [
                    paragraph(1, 2),
                    paragraph(3, 3),
                    paragraph(4, 4),
                    paragraph(6, 6),
                    { type: BlockType.Table, lines: range(10, 11) },
                ],
            };

            for (const line of [2, 3, 4, 6, 7, 8, 10]) expect(unitAt(lines, line)).toEqual(parent);
            expect(unitAt(lines, 14)).toEqual({ block: item(12, 14), text: [paragraph(12, 12), paragraph(14, 14)] });
        });

        it('takes a quoted item under an unquoted item as an item of its own', () => {
            const lines = ['- a', '    > - q', '    >   more', '- b'];

            expect(unitAt(lines, 3)).toEqual({ block: item(2, 3), text: [paragraph(2, 3)] });
            expect(textEnds(lines, 1)).toEqual([1]);
        });

        it('reads indentation with the given tab size', () => {
            const lines = ['1. a', '', '\tpara'];

            expect(unitAt(lines, 3, 4)).toEqual({ block: item(1, 3), text: [paragraph(1, 1), paragraph(3, 3)] });
            expect(unitAt(lines, 3, 2)?.block).toEqual(paragraph(3, 3));
        });

        it('types the text on an item line by the block it starts, a heading one line', () => {
            expect(unitAt(['- # H ^x ##'], 1)).toEqual({ block: item(1, 1), text: [heading(1, 1)] });
            expect(textEnds(['- [ ] ## H', '  more'], 1)).toEqual([1, 2]);
        });
    });

    describe('blocks written right under a list, which Obsidian takes into its last item', () => {
        it.each([
            ['a quote', ['> q'], [paragraph(2, 2)]],
            ['a callout', ['> [!note] T', '> body'], [paragraph(2, 2), paragraph(3, 3)]],
            ['a math block', ['$$', 'x', '$$'], []],
            ['a quote and the lazy lines under it', ['> q', 'lazy'], [paragraph(2, 3)]],
        ])('takes %s into the item above, from any of its lines', (_, block, text) => {
            const lines = ['- a', ...block, '- b'];
            const unit = { block: item(1, block.length + 1), text: [paragraph(1, 1), ...text] };

            for (let line = 1; line <= block.length + 1; line++) expect(unitAt(lines, line)).toEqual(unit);
            expect(unitAt(lines, block.length + 2)?.block).toEqual(item(block.length + 2, block.length + 2));
        });

        it('takes it into the innermost last item, and a line past blank lines into the item it is indented into', () => {
            const lines = ['- a', '  - b', '> q', '', '  more'];

            expect(unitAt(lines, 3)).toEqual({ block: item(2, 3), text: [paragraph(2, 2), paragraph(3, 3)] });
            expect(unitAt(lines, 5)).toEqual({ block: item(1, 5), text: [paragraph(1, 1), paragraph(5, 5)] });
            expect(unitAt(['1. a', '> q', '2. b'], 3)?.block).toEqual(item(3, 3));
        });

        it('takes a quoted list right under an item into the item, each quoted item a list item of its own', () => {
            const lines = ['- a', '> - x', '>   more', '- b'];

            expect(unitAt(lines, 1)).toEqual({ block: item(1, 3), text: [paragraph(1, 1)] });
            expect(unitAt(lines, 3)).toEqual({ block: item(2, 3), text: [paragraph(2, 3)] });
            expect(unitAt(['- a', '> - x', '> ', '> y'], 4)?.block).toEqual(item(1, 4));
            expect(textEnds(['- a', '> - x', '    more'], 2)).toEqual([3]);
        });

        it.each([
            ['a heading', ['# h'], heading(2, 2)],
            ['a code fence', ['```', 'x', '```'], { type: BlockType.CodeBlock, lines: range(2, 4) }],
            ['a comment fence', ['%%', 'x', '%%'], { type: BlockType.Comment, lines: range(2, 4) }],
            ['a rule', ['***'], { type: BlockType.HorizontalRule, lines: range(2, 2) }],
        ])('leaves %s out of the list', (_, block, unit) => {
            expect(unitAt(['- a', ...block], 2)?.block).toEqual(unit);
        });

        it('nests a list line indented to the content of the item above it in that item, a block under it too', () => {
            expect(unitAt(['- a', '> q', '\tb', '\t- c'], 4)?.block).toEqual(item(4, 4));
            expect(unitAt(['- a', '> q', '  - c', '> r'], 4)).toEqual({
                block: item(3, 4),
                text: [paragraph(3, 3), paragraph(4, 4)],
            });
        });

        it('takes a line past blank lines more than four columns in into the list, short of its content too', () => {
            expect(unitAt(['1000. a', '> q', '', '     more'], 4)?.block).toEqual(item(1, 4));
        });

        it('leaves out a block past a blank line, not indented to the item', () => {
            expect(unitAt(['- a', '> q', '', '> r'], 4)?.block).toEqual({
                type: BlockType.Blockquote,
                lines: range(4, 4),
            });
            expect(unitAt(['> - a', '> > q'], 2)?.block).toEqual({ type: BlockType.Blockquote, lines: range(1, 2) });
        });
    });

    describe('quotes', () => {
        it('joins every line of a top-level quote into the whole quote, lazy lines included', () => {
            const lines = ['> one', '> two', '>', '> > deeper', '> three', 'lazy', '', 'after'];
            const quote = {
                block: { type: BlockType.Blockquote, lines: range(1, 6) },
                text: [paragraph(1, 2), paragraph(4, 6)],
            };

            for (const line of [1, 2, 3, 4, 5, 6]) expect(unitAt(lines, line)).toEqual(quote);
        });

        it('starts a quote above a lazy line that continues it, and goes on into quoted lines below one', () => {
            expect(unitAt(['> one', 'lazy', '>', '> two'], 4)?.block.lines).toEqual(range(1, 4));
            expect(unitAt(['> one', 'lazy', '> - x'], 1)?.block.lines).toEqual(range(1, 3));
        });

        it('keeps a paragraph directly above a quote out of it', () => {
            expect(unitAt(['para', '> q'], 2)?.block).toEqual({ type: BlockType.Blockquote, lines: range(2, 2) });
        });

        it('takes in the unquoted lines under a quote, whatever block it ends with', () => {
            const quote = {
                block: { type: BlockType.Blockquote, lines: range(1, 2) },
                text: [heading(1, 1), paragraph(2, 2)],
            };

            expect(unitAt(['> # h', 'text'], 1)).toEqual(quote);
            expect(unitAt(['> # h', 'text'], 2)).toEqual(quote);
            expect(unitAt(['> ```', '> x', '> ```', 'after'], 4)?.block).toEqual({
                type: BlockType.Blockquote,
                lines: range(1, 4),
            });
            expect(unitAt(['> q', '| a |', '| - |'], 1)?.block).toEqual({
                type: BlockType.Blockquote,
                lines: range(1, 3),
            });
        });

        it('takes in a list line the line map reads as an item, where it ends no quote', () => {
            expect(unitAt(['> # h', '2. a'], 2)).toEqual({
                block: { type: BlockType.Blockquote, lines: range(1, 2) },
                text: [heading(1, 1), paragraph(2, 2)],
            });
        });

        it.each([
            ['a setext heading', ['> q', 'Text', '---'], heading(2, 3)],
            ['indented code', ['> q', '    code'], { type: BlockType.CodeBlock, lines: range(2, 2) }],
            ['a heading', ['> q', '# h'], heading(2, 2)],
            ['a bullet item', ['> q', '- a'], item(2, 2)],
            ['a math fence', ['> q', '$$', 'x', '$$'], { type: BlockType.MathBlock, lines: range(2, 4) }],
        ])('ends a top-level quote at a lazy line that starts %s', (_, lines, block) => {
            expect(unitAt(lines, 1)?.block).toEqual({ type: BlockType.Blockquote, lines: range(1, 1) });
            expect(unitAt(lines, 2)?.block).toEqual(block);
        });

        it('ends a paragraph of lazy lines under a top-level quote where the quote ends', () => {
            expect(unitAt(['>', 'para', '    ~~~', 'text'], 3)?.block).toEqual({
                type: BlockType.CodeBlock,
                lines: range(3, 3),
            });
        });

        it("continues a quote inside a list item through such a line, which the item's paragraph takes", () => {
            expect(unitAt(['- a', '    > q', 'Text', '---'], 3)?.block).toEqual(item(1, 3));
        });

        it('leaves the lines under a quote inside a list item to the item', () => {
            expect(unitAt(['- a', '    > # h', '  text'], 3)?.block).toEqual(item(1, 3));
        });

        it('joins a callout and every block inside it into the callout, its title a paragraph of its own', () => {
            const lines = ['> [!note] Title', '> body', '> - item', '>   more', '> # heading', '', 'after'];
            const callout = {
                block: { type: BlockType.Callout, lines: range(1, 5) },
                text: [paragraph(1, 1), paragraph(2, 2), paragraph(3, 4), heading(5, 5)],
            };

            for (const line of [1, 2, 3, 4, 5]) expect(unitAt(lines, line)).toEqual(callout);
        });

        it("takes the lines after a lone callout title as the callout's body, but not a heading", () => {
            expect(unitAt(['> [!note] Title', 'lazy', '> more'], 2)).toEqual({
                block: { type: BlockType.Callout, lines: range(1, 3) },
                text: [paragraph(1, 1), paragraph(2, 2), paragraph(3, 3)],
            });
            expect(unitAt(['> [!note] Title', '# h'], 1)?.block).toEqual({
                type: BlockType.Callout,
                lines: range(1, 1),
            });
        });

        it('reads a callout marker that opens no quote as text', () => {
            expect(textEnds(['> [!note] A', '>', '> [!tip] B', '> body'], 1)).toEqual([1, 4]);
        });

        it('gives an item inside a top-level quote to the quote', () => {
            expect(unitAt(['> - a', '>     - b', '> - c'], 2)).toEqual({
                block: { type: BlockType.Blockquote, lines: range(1, 3) },
                text: [paragraph(1, 1), paragraph(2, 2), paragraph(3, 3)],
            });
        });

        it('takes no text from a lazy line under a fence left open in a quote, which goes on in it', () => {
            expect(unitAt(['> ```', '> code', 'more ^x', '', 'para'], 1)).toEqual({
                block: { type: BlockType.Blockquote, lines: range(1, 3) },
                text: [],
            });
            expect(unitAt(['> ```', '> code', 'more', '```', 'after'], 5)).toBeNull();
        });

        it.each([
            ['code', ['> ```', '> code ^x', '> ```', '> after']],
            ['math', ['> $$', '> x ^x', '> $$', '> after']],
        ])('takes no text from a %s fence inside a quote', (_, lines) => {
            expect(unitAt(lines, 1)).toEqual({
                block: { type: BlockType.Blockquote, lines: range(1, 4) },
                text: [paragraph(4, 4)],
            });
        });
    });

    describe('other blocks', () => {
        it('takes a heading as its own text', () => {
            expect(unitAt(['# Title', 'text'], 1)).toEqual({ block: heading(1, 1), text: [heading(1, 1)] });
        });

        it.each([
            ['with outer pipes', ['| a | b |', '| - | :-: |', '| 1 | 2 |', 'x | y']],
            ['without outer pipes', ['a | b', '--- | ---', '1 | 2', '| x |']],
            ['whose delimiter row reads as a list item', ['a | b', '- | -', '1 | 2', '| x |']],
        ])('reads a row over a delimiter row as a table, %s, up to a row with the other kind', (_, lines) => {
            const table = { type: BlockType.Table, lines: range(1, 3) };

            expect(unitAt(lines, 3)).toEqual({ block: table, text: [table] });
            expect(unitAt(lines, 4)?.block).toEqual(paragraph(4, 4));
        });

        it.each([
            ['no delimiter row', ['| a |', 'more text']],
            ['a delimiter row with an empty cell', ['| a |', '| - | |']],
            ['a delimiter row with a leading pipe the row lacks', ['a | b', '|---|---|']],
        ])('reads a row over %s as a paragraph', (_, lines) => {
            expect(unitAt(lines, 1)?.block).toEqual(paragraph(1, 2));
        });

        it('ends a table at a row whose leading pipe or indent differs from the first row', () => {
            expect(unitAt(['| a |', '| - |', '  | 1 |'], 3)?.block).toEqual(paragraph(3, 3));
            expect(unitAt(['| a |', '| - |', '| 1', '| 2 |'], 1)?.block).toEqual({
                type: BlockType.Table,
                lines: range(1, 2),
            });
        });

        it('takes a table as its own text', () => {
            const table = { type: BlockType.Table, lines: range(1, 3) };

            expect(unitAt(['| a | b |', '| - | - |', '| 1 | 2 |', 'after'], 2)).toEqual({
                block: table,
                text: [table],
            });
        });

        it.each([
            ['code', ['```ts', 'x ^a', '```'], BlockType.CodeBlock],
            ['math', ['$$', 'x ^a', '$$'], BlockType.MathBlock],
            ['comment', ['%%', 'x ^a', '%%'], BlockType.Comment],
        ])('gives a %s block no text', (_, lines, type) => {
            expect(unitAt(lines, 2)).toEqual({ block: { type, lines: range(1, 3) }, text: [] });
        });

        it('gives a rule no text', () => {
            expect(unitAt(['a', '', '***', '', 'b'], 3)).toEqual({
                block: { type: BlockType.HorizontalRule, lines: range(3, 3) },
                text: [],
            });
        });
    });

    describe('fences', () => {
        it.each([
            ['code', ['```sh', '> out', '```'], BlockType.CodeBlock],
            ['math', ['$$', '> x', '$$'], BlockType.MathBlock],
            ['comment', ['%%', '> hidden', '%%'], BlockType.Comment],
        ])('takes a quoted line inside a %s fence as the fence', (_, lines, type) => {
            expect(unitAt(lines, 2)).toEqual({ block: { type, lines: range(1, 3) }, text: [] });
        });

        it.each([
            ['a tilde fence', ['~~~', 'code', '~~~', 'after'], [1, 2, 3, 4]],
            ['a fence nested in a longer one', ['````md', '```js', 'x', '```', '````'], [1, 3, 5]],
            ['a closer with an info string', ['```', 'code', '```js', 'more', '```'], [1, 4]],
            ['a closer indented four columns', ['```', 'code', '    ```', 'more', '```'], [1, 4]],
            [
                'a fence left open at the end of its list item',
                ['- a', '  ```', '  x', '- b', '', '```', 'y', '```'],
                [7],
            ],
            ['a fence line in frontmatter', ['---', 'a: |', '  ```', '---', '', '```', 'y', '```'], [7]],
            ['a code fence opened on a list item line', ['- ```js', '  x', '  ```', '', '```', 'y', '```'], [1, 6]],
            ['a tilde fence opened on a list item line', ['- ~~~', '  x', '  ~~~'], [1]],
            ['a math fence opened on a list item line', ['- $$', '  x', '  $$', '', '$$', 'y', '$$'], [1, 6]],
            ['a comment fence opened on a list item line', ['- %%', '  x', '  %%', '', '%%', 'y', '%%'], [1, 6]],
            ['a math fence never closed, which runs to the end', ['$$', 'x', '', 'para'], [2, 4]],
            ['a comment fence never closed', ['%%', 'hidden'], [2]],
            ['a math fence closed by text and dollars', ['$$', 'x', 'y $$', 'more', '$$'], [1, 4]],
            ['a comment fence closed inside a line', ['%%', 'x %% y', 'more'], [1, 3]],
            ['a comment fence closed on a line with text after', ['%%', 'x', '%% after'], [1, 3]],
            ['a math fence opened with three dollars, closed only by three', ['$$$', 'x', '$$', 'more', '$$$'], [4]],
            [
                'a tilde fence that ends the list item it is lazily under',
                ['1. a', '  ~~~', 'x', '2. b', '', 'p', '', '  ~~~'],
                [6],
            ],
            [
                'a code fence left open past a blank line at the end of its item',
                ['- a', '  ```', '  x', '', 'p', '  ```'],
                [5],
            ],
            ['a comment fence right under a footnote definition, its text', ['[^1]: a', '%%', '~~~', '%%'], [2, 4]],
            ['a code fence never closed', ['para', '```js', 'code', '', 'more'], [2, 3, 5]],
            ['a line that opens a fence to md-dragger only', ['$$x$$', '```x```'], [1]],
            ['a list item under one', ['~~~', '- x', '~~~', '', '    y'], [5]],
            ['a math fence that ends its bare list item', ['-', '$$', '```', '> $$', '', 'x'], [6]],
            ['a tilde fence that a bare list item does not hold', ['-', '~~~~', '', 'x'], [4]],
            ['a tilde fence right under a list item, which it ends', ['* x', '~~~~', '', 'a'], [4]],
            ['a list item inside a math fence', ['$$', '* ```js', ' $$', '    #', '    ````'], [4]],
            [
                'a math fence its list item ends, under one read otherwise',
                ['    $$', '  - ~~~', '    ~~~', '$$', '```', '> $$', '', 'x | y'],
                [8],
            ],
        ])('gives no block in or below %s, which md-dragger reads otherwise than Obsidian', (_, lines, picked) => {
            for (const line of picked) expect(unitAt(lines, line)).toBeNull();
        });

        it('gives no block that runs into one, which Obsidian ends there', () => {
            expect(unitAt(['one ^p1', '~~~', 'tilde', '~~~'], 1)).toBeNull();
            expect(unitAt(['> q', '```x```'], 1)).toBeNull();
        });

        it.each([
            ['above one', ['one', '', '~~~', 'x', '~~~'], 1, paragraph(1, 1)],
            ['below one past a heading', ['~~~', 'x', '~~~', '# far', 'para'], 5, paragraph(5, 5)],
            [
                'below one past a blank line, at the first column',
                ['````md', '```js', 'x', '```', '````', '', 'y'],
                7,
                paragraph(7, 7),
            ],
            ['below a quoted tilde fence, which it reads', ['> ~~~', '> x', '> ~~~', '', 'after'], 5, paragraph(5, 5)],
            ['below a tilde line in a code fence', ['```', '~~~', '```', '', 'after'], 5, paragraph(5, 5)],
            ['below a tilde line in indented code', ['para', '', '    ~~~', '    x', '', 'after'], 6, paragraph(6, 6)],
            [
                'below one-line math and comments on list items',
                ['- $$x$$', '- %% c %%', '', 'after'],
                4,
                paragraph(4, 4),
            ],
            ['below a fence in a list item', ['- a', '  ```', '  x', '  ```', '', 'after'], 6, paragraph(6, 6)],
        ])('reads a block %s', (_, lines, line, block) => {
            expect(unitAt(lines, line)?.block).toEqual(block);
        });
    });

    it('reads a wide list item and a long quote in time linear in their lines', () => {
        const wide = ['- root', ...Array.from({ length: 20_000 }, (_, i) => `    - child ${i}`)];
        const quote = Array.from({ length: 20_000 }, (_, i) => (i % 2 ? '>' : `> line ${i}`));
        const started = performance.now();

        expect(textEnds(wide, 1)).toEqual([1]);
        expect(unitAt(quote, 1)?.block.lines).toEqual(range(1, 20_000));
        // Quadratic reads took 1.6 s for 2,000 children and 5.8 s for a 5,000-line quote; linear ones take milliseconds.
        expect(performance.now() - started).toBeLessThan(2_000);
    });
});
