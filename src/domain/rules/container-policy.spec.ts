import { describe, expect, it } from 'vitest';
import { detectBlock } from '../block/block-detector';
import { type Block, BlockType } from '../block/block-types';
import { gapAt } from '../markdown/gap';
import { getLineMap } from '../markdown/line-map';
import { planMove } from '../move/move-plan';
import { selectOne } from '../selection/block-selection';
import { stringDoc } from '../transaction/string-doc';
import { canDropAt, isNestedBlock } from './container-policy';

const TAB_SIZE = 4;

/** One-block source documents, so a drop is never a self no-op. */
const SOURCES = {
    paragraph: 'source',
    callout: '> [!note] c\n> body',
    listItem: '- item',
    quotedItem: '> - quoted item',
    blockquote: '> quoted',
    deeperQuote: '> > deeper',
    codeBlock: '```\ncode\n```',
} as const;
type Source = keyof typeof SOURCES;

function sourceBlock(source: Source): { doc: ReturnType<typeof stringDoc>; block: Block } {
    const doc = stringDoc(SOURCES[source]);
    const block = detectBlock(doc, 1, { tabSize: TAB_SIZE });
    if (!block) throw new Error(`no ${source} block`);
    return { doc, block };
}

/** Plan dropping the source block at a seam of `docText`: 'ok' or the reject reason. */
function drop(docText: string, source: Source, line: number): string {
    const { doc: sourceDoc, block } = sourceBlock(source);
    const result = planMove({
        sourceDoc,
        selection: selectOne(block),
        position: { doc: stringDoc(docText), line, parent: null },
        tabSize: TAB_SIZE,
        indentUnit: 4,
    });
    return result.type === 'ok' ? 'ok' : result.reason;
}

/** canDropAt for the source block at the gap of a raw seam. */
function decide(docText: string, source: Source, line: number) {
    const { doc: sourceDoc, block } = sourceBlock(source);
    const doc = stringDoc(docText);
    const lineMap = getLineMap(doc, { tabSize: TAB_SIZE });
    const at = gapAt(doc, line, { lineMap, tabSize: TAB_SIZE });
    if (at.type !== 'gap') throw new Error(`seam ${line} is ${at.reason}`);
    return canDropAt({ blocks: [block], content: SOURCES[source] }, at.gap, { lineMap, tabSize: TAB_SIZE, sourceDoc });
}

function nested(docText: string, line: number): boolean {
    const doc = stringDoc(docText);
    const block = detectBlock(doc, line, { tabSize: TAB_SIZE });
    if (!block) throw new Error(`no block at line ${line}`);
    return isNestedBlock(doc, block, { lineMap: getLineMap(doc, { tabSize: TAB_SIZE }), tabSize: TAB_SIZE });
}

describe('domain/rules/container-policy', () => {
    it('rejects seams inside a fenced code block', () => {
        const doc = '```ts\nconst x = 1;\n```\nafter';
        expect(drop(doc, 'paragraph', 2)).toBe('inside_code_block');
        expect(drop(doc, 'paragraph', 3)).toBe('inside_code_block');
        expect(drop(doc, 'listItem', 2)).toBe('inside_code_block');
    });

    it('allows seams at and around the code block fences', () => {
        const doc = '```ts\nconst x = 1;\n```\nafter';
        expect(drop(doc, 'paragraph', 1)).toBe('ok');
        expect(drop(doc, 'paragraph', 4)).toBe('ok');
        expect(drop(doc, 'paragraph', 5)).toBe('ok');
    });

    it('rejects seams inside a fenced math block', () => {
        const doc = '$$\nx^2 + 1\n$$\nafter';
        expect(drop(doc, 'paragraph', 2)).toBe('inside_math_block');
        expect(drop(doc, 'paragraph', 3)).toBe('inside_math_block');
        expect(drop(doc, 'listItem', 2)).toBe('inside_math_block');
    });

    it('allows seams at and around math block fences, and inside single-line or unclosed math', () => {
        const doc = '$$\nx^2 + 1\n$$\nafter';
        expect(drop(doc, 'paragraph', 1)).toBe('ok');
        expect(drop(doc, 'paragraph', 4)).toBe('ok');
        expect(drop(doc, 'paragraph', 5)).toBe('ok');

        // Single-line math ($$ x $$) has no interior seam.
        expect(drop('$$ x^2 $$', 'paragraph', 1)).toBe('ok');
        // Unclosed math fence keeps historical behavior: only the fence line counts.
        expect(drop('$$\nunclosed', 'paragraph', 1)).toBe('ok');
        expect(drop('$$\nunclosed', 'paragraph', 2)).toBe('ok');
    });

    it('classifies fence interior before quote/list content inside it', () => {
        expect(drop('```\n> fake quote\n```', 'paragraph', 2)).toBe('inside_code_block');
        expect(drop('```\n- fake item\n```', 'paragraph', 2)).toBe('inside_code_block');
        expect(drop('$$\n- fake item\n$$', 'paragraph', 2)).toBe('inside_math_block');
    });

    it('lets only a plain quote line of the same depth into a tight quote run', () => {
        const doc = '> one\n> two';
        expect(drop(doc, 'blockquote', 2)).toBe('ok');
        expect(drop(doc, 'deeperQuote', 2)).toBe('inside_quote_run');
        expect(drop(doc, 'paragraph', 2)).toBe('inside_quote_run');
        expect(drop(doc, 'callout', 2)).toBe('inside_quote_run');
        expect(drop(doc, 'listItem', 2)).toBe('inside_quote_run');
        expect(decide(doc, 'paragraph', 2)).toEqual({
            allowDrop: false,
            rejectReason: 'inside_quote_run',
            region: { startLine: 1, endLine: 2 },
        });
    });

    it('rejects every source at every seam inside a callout', () => {
        const doc = 'intro\n\n> [!note] T\n> a\n> b\n\nend';
        for (const source of Object.keys(SOURCES) as Source[]) {
            for (const line of [4, 5]) {
                expect(drop(doc, source, line)).toBe('inside_quote_run');
            }
        }
        expect(decide(doc, 'blockquote', 4)).toMatchObject({ region: { startLine: 3, endLine: 5 } });
    });

    it('keeps a root quote line out of a quote run inside a list item', () => {
        expect(drop('- item\n    > q1\n    > q2\n- next', 'blockquote', 3)).toBe('inside_list');
    });

    it('rejects a deeper plain quote line inside a callout’s nested quote', () => {
        expect(drop('> [!note] Outer\n> > a\n> > b', 'deeperQuote', 3)).toBe('inside_quote_run');
    });

    it('rejects a list item between the items of a quoted list', () => {
        expect(drop('> [!note] T\n> - a\n>     - b\n\n- x', 'listItem', 3)).toBe('inside_quote_run');
    });

    it('accepts every source beside quotes and callouts across a blank line', () => {
        const doc = '> [!note] A\n> a\n\n> quoted\n\npara';
        for (const source of Object.keys(SOURCES) as Source[]) {
            for (const line of [1, 3, 4, 5, 6, 7]) expect(drop(doc, source, line)).toBe('ok');
        }
    });

    it('lets list items, and blocks a list turns into items, into a list, but no other block', () => {
        const doc = '- one\n  - nested';
        expect(drop(doc, 'listItem', 2)).toBe('ok');
        expect(drop(doc, 'paragraph', 2)).toBe('ok');
        expect(drop(doc, 'blockquote', 2)).toBe('ok');
        expect(drop(doc, 'callout', 2)).toBe('inside_list');
        expect(drop(doc, 'codeBlock', 2)).toBe('inside_list');
        expect(drop(doc, 'quotedItem', 2)).toBe('inside_list');
    });

    it('treats the seam between sibling list items as outside the list', () => {
        expect(drop('- one\n- two', 'paragraph', 2)).toBe('ok');
    });

    it('rejects a block a list keeps as it is between two child lines of an item', () => {
        const doc = '- a\n    child1\n    child2\n\npara';
        expect(drop(doc, 'codeBlock', 3)).toBe('inside_list');
        expect(drop(doc, 'paragraph', 3)).toBe('ok');
        expect(decide(doc, 'codeBlock', 3)).toEqual({
            allowDrop: false,
            rejectReason: 'inside_list',
            region: { startLine: 1, endLine: 3 },
        });
    });

    it('rejects a block a list keeps as it is deep inside a long item, beyond any fixed radius', () => {
        const children = Array.from({ length: 12 }, (_, i) => `    - child ${i + 1}`).join('\n');
        const doc = `- root\n${children}\n\npara`;
        for (const line of [2, 8, 12, 13]) expect(drop(doc, 'codeBlock', line)).toBe('inside_list');
        expect(decide(doc, 'codeBlock', 12)).toMatchObject({ region: { startLine: 1, endLine: 13 } });
    });

    it('rejects a block a list keeps as it is between an item and its quote-prefixed child', () => {
        const doc = '- item\n    > [!note] x\n    > body\n- next';
        expect(drop(doc, 'codeBlock', 2)).toBe('inside_list');
        expect(drop(doc, 'codeBlock', 4)).toBe('ok');
    });

    it('accepts every block at both document edges', () => {
        const doc = '> [!note] A\n> a';
        for (const source of Object.keys(SOURCES) as Source[]) {
            expect(drop(doc, source, 1)).toBe('ok');
            expect(drop(doc, source, 3)).toBe('ok');
        }
    });

    it('keeps a quoted list item out of an unquoted item’s subtree', () => {
        expect(drop('- a\n    - b\n- c', 'quotedItem', 2)).toBe('inside_list');
    });

    it('planMove rejects a drop into a code block interior', () => {
        const sourceDoc = stringDoc('source');
        const targetDoc = stringDoc('```\ncode\n```');
        const result = planMove({
            sourceDoc,
            selection: selectOne({ type: BlockType.Paragraph, lines: { startLine: 1, endLine: 1 } }),
            position: { doc: targetDoc, line: 2, parent: null },
            tabSize: TAB_SIZE,
            indentUnit: 4,
        });
        expect(result).toEqual({ type: 'reject', reason: 'inside_code_block' });
    });
});

describe('domain/rules/container-policy isNestedBlock', () => {
    it('is true for a callout nested in a callout', () => {
        expect(nested('> [!outer]\n>\n> > [!note] A\n> > a\n>\n> > [!note] B\n> > b', 3)).toBe(true);
    });

    it('is true for a plain quote line and a list item inside a callout', () => {
        const doc = '> [!note] Outer\n> body\n> > nested quote\n> - item';
        expect(nested(doc, 3)).toBe(true);
        expect(nested(doc, 4)).toBe(true);
    });

    it('is true for a list child paragraph and a callout indented under an item', () => {
        expect(nested('- item\n    para in item', 2)).toBe(true);
        expect(nested('- item\n    > [!note] x\n    > body\n- next', 2)).toBe(true);
    });

    it('is true for a quoted list item under an unquoted item', () => {
        expect(nested('- a\n    > - q\n    > - r\n- b', 2)).toBe(true);
        expect(nested('- a\n    > - q\n    >     - r\n- b', 3)).toBe(true);
    });

    it('is false for a top-level callout, a plain quote line and a nested list item', () => {
        expect(nested('para\n\n> [!note] A\n> a', 3)).toBe(false);
        expect(nested('> q1\n> > q2\n> q3', 2)).toBe(false);
        expect(nested('- a\n    - b', 2)).toBe(false);
        expect(nested('> - a\n>     - b', 2)).toBe(false);
    });
});
