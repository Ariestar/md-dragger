import { describe, expect, it } from 'vitest';
import { stringDoc } from '../transaction/string-doc';
import { type BlockTemplate, planConvert, resolveBlockTemplate } from './block-type-conversion';
import { BlockType } from './block-types';

describe('domain/block-type-conversion', () => {
    describe('built-in type conversions', () => {
        it('converts a paragraph to heading 1', () => {
            const doc = stringDoc('Hello world');
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 1 },
                to: { type: BlockType.Heading, level: 1 },
            });
            expect(changes).toEqual([{ from: 0, to: 11, insert: '# Hello world' }]);
        });

        it('converts a paragraph to heading 3', () => {
            const doc = stringDoc('Sub heading');
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 1 },
                to: { type: BlockType.Heading, level: 3 },
            });
            expect(changes).toEqual([{ from: 0, to: 11, insert: '### Sub heading' }]);
        });

        it('converts a multi-line paragraph to a bullet list', () => {
            const doc = stringDoc('Alpha\nBeta');
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 2 },
                to: { type: BlockType.ListItem, markerType: 'unordered' },
            });
            expect(changes).toEqual([{ from: 0, to: 10, insert: '- Alpha\n- Beta' }]);
        });

        it('converts a multi-line paragraph to an ordered list', () => {
            const doc = stringDoc('Alpha\nBeta');
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 2 },
                to: { type: BlockType.ListItem, markerType: 'ordered' },
            });
            expect(changes).toEqual([{ from: 0, to: 10, insert: '1. Alpha\n2. Beta' }]);
        });

        it('converts a multi-line paragraph to a task list', () => {
            const doc = stringDoc('Task 1\nTask 2');
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 2 },
                to: { type: BlockType.ListItem, markerType: 'task' },
            });
            expect(changes).toEqual([{ from: 0, to: 13, insert: '- [ ] Task 1\n- [ ] Task 2' }]);
        });

        it('converts a paragraph to a blockquote', () => {
            const doc = stringDoc('Quote line 1\nQuote line 2');
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 2 },
                to: { type: BlockType.Blockquote },
            });
            expect(changes).toEqual([{ from: 0, to: 25, insert: '> Quote line 1\n> Quote line 2' }]);
        });

        it('converts a paragraph to a code block', () => {
            const doc = stringDoc('const a = 1;\nconst b = 2;');
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 2 },
                to: { type: BlockType.CodeBlock },
            });
            expect(changes).toEqual([{ from: 0, to: 25, insert: '```\nconst a = 1;\nconst b = 2;\n```' }]);
        });

        it('converts a code block back to a paragraph', () => {
            const doc = stringDoc('```\nconst a = 1;\nconst b = 2;\n```');
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 4 },
                to: { type: BlockType.Paragraph },
            });
            expect(changes).toEqual([{ from: 0, to: 33, insert: 'const a = 1;\nconst b = 2;' }]);
        });

        it('converts a code block to a math block', () => {
            const doc = stringDoc('```\nx^2 + y^2\n```');
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 3 },
                to: { type: BlockType.MathBlock },
            });
            expect(changes).toEqual([{ from: 0, to: 17, insert: '$$\nx^2 + y^2\n$$' }]);
        });

        it('returns empty changes when converting code block to code block', () => {
            const doc = stringDoc('```\nx = 1\n```');
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 3 },
                to: { type: BlockType.CodeBlock },
            });
            expect(changes).toEqual([]);
        });
    });

    describe('custom template conversions', () => {
        it('interpolates only the template and keeps content and variable values literal', () => {
            const doc = stringDoc("${HOME}\n${content}\n$& $$ $` $'");
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 3 },
                to: {
                    template: '${title}\n${content}\n${content}',
                    linePrefix: '> ',
                    variables: { title: '${HOME}', HOME: 'unexpected replacement', content: 'not the body' },
                },
            });
            const body = "> ${HOME}\n> ${content}\n> $& $$ $` $'";
            expect(changes).toEqual([{ from: 0, to: doc.length, insert: `\${HOME}\n${body}\n${body}` }]);
            expect(
                planConvert({
                    doc,
                    lines: { startLine: 1, endLine: 3 },
                    to: { type: BlockType.Heading, level: 1 },
                }),
            ).toEqual([{ from: 0, to: doc.length, insert: `# ${doc.sliceString(0, doc.length)}` }]);
        });

        it('converts a paragraph to a Callout with variables', () => {
            const doc = stringDoc('Important message\nCheck this out');
            const template: BlockTemplate = {
                template: '> [!${type}] ${title}\n${content}',
                linePrefix: '> ',
                variables: { type: 'tip', title: 'Useful Tip' },
            };
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 2 },
                to: template,
            });
            expect(changes).toEqual([
                {
                    from: 0,
                    to: 32,
                    insert: '> [!tip] Useful Tip\n> Important message\n> Check this out',
                },
            ]);
        });

        it('converts a Callout to a standard paragraph stripping callout prefix', () => {
            const doc = stringDoc('> [!tip] Useful Tip\n> Line 1\n> Line 2');
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 3 },
                to: { type: BlockType.Paragraph },
            });
            expect(changes).toEqual([
                {
                    from: 0,
                    to: 37,
                    insert: 'Useful Tip\nLine 1\nLine 2',
                },
            ]);
        });

        it('converts a block to a custom HTML div with class variable', () => {
            const doc = stringDoc('Card line 1\nCard line 2');
            const template: BlockTemplate = {
                template: '<div class="${class}">\n${content}\n</div>',
                variables: { class: 'custom-card' },
            };
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 2 },
                to: template,
            });
            expect(changes).toEqual([
                {
                    from: 0,
                    to: 23,
                    insert: '<div class="custom-card">\nCard line 1\nCard line 2\n</div>',
                },
            ]);
        });

        it('converts a block to a code block with language variable', () => {
            const doc = stringDoc('table file.name\nfrom #tag');
            const template: BlockTemplate = {
                template: '```${lang}\n${content}\n```',
                variables: { lang: 'dataview' },
            };
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 2 },
                to: template,
            });
            expect(changes).toEqual([
                {
                    from: 0,
                    to: 25,
                    insert: '```dataview\ntable file.name\nfrom #tag\n```',
                },
            ]);
        });

        it('preserves line indentation when converting nested items', () => {
            const doc = stringDoc('- Parent item\n  - Child item');
            const template: BlockTemplate = {
                template: '${content}',
                linePrefix: '> ',
            };
            const changes = planConvert({
                doc,
                lines: { startLine: 1, endLine: 2 },
                to: template,
            });
            expect(changes).toEqual([
                {
                    from: 0,
                    to: 28,
                    insert: '> Parent item\n  > Child item',
                },
            ]);
        });
    });

    describe('resolveBlockTemplate helper', () => {
        it('resolves built-in types to matching template definitions', () => {
            expect(resolveBlockTemplate({ type: BlockType.Paragraph })).toEqual({ template: '${content}' });
            expect(resolveBlockTemplate({ type: BlockType.Heading, level: 2 })).toEqual({ template: '## ${content}' });
            expect(resolveBlockTemplate({ type: BlockType.Blockquote })).toEqual({
                template: '${content}',
                linePrefix: '> ',
            });
            expect(resolveBlockTemplate({ type: BlockType.ListItem, markerType: 'unordered' })).toEqual({
                template: '${content}',
                linePrefix: '- ',
            });
            expect(resolveBlockTemplate({ type: BlockType.ListItem, markerType: 'ordered' })).toEqual({
                template: '${content}',
                linePrefix: '${ordinal}. ',
            });
        });

        it('returns existing custom template directly', () => {
            const custom: BlockTemplate = { template: '::: ${type}\n${content}\n:::', variables: { type: 'info' } };
            expect(resolveBlockTemplate(custom)).toBe(custom);
        });
    });
});
