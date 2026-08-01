import { describe, expect, it } from 'vitest';
import { type Block, BlockType } from '../block/block-types';
import { planMove } from '../move/move-plan';
import { selectOne } from '../selection/block-selection';
import { stringDoc } from '../transaction/string-doc';
import { canDropAt } from './container-policy';

const TAB_SIZE = 4;

const paragraph: Block = { type: BlockType.Paragraph, lines: { startLine: 1, endLine: 1 } };
const callout: Block = { type: BlockType.Callout, lines: { startLine: 1, endLine: 1 } };
const listItem: Block = { type: BlockType.ListItem, lines: { startLine: 1, endLine: 1 } };
const blockquote: Block = { type: BlockType.Blockquote, lines: { startLine: 1, endLine: 1 } };

function drop(docText: string, source: Block, line: number) {
    return canDropAt(stringDoc(docText), source, line, { tabSize: TAB_SIZE });
}

describe('domain/rules/container-policy', () => {
    it('rejects seams inside a fenced code block', () => {
        const doc = '```ts\nconst x = 1;\n```\nafter';
        expect(drop(doc, paragraph, 2).decision).toEqual({ allowDrop: false, rejectReason: 'inside_code_block' });
        expect(drop(doc, paragraph, 3).decision).toEqual({ allowDrop: false, rejectReason: 'inside_code_block' });
        expect(drop(doc, listItem, 2).decision).toEqual({ allowDrop: false, rejectReason: 'inside_code_block' });
    });

    it('allows seams at and around the code block fences', () => {
        const doc = '```ts\nconst x = 1;\n```\nafter';
        expect(drop(doc, paragraph, 1).decision.allowDrop).toBe(true);
        expect(drop(doc, paragraph, 4).decision.allowDrop).toBe(true);
        expect(drop(doc, paragraph, 5).decision.allowDrop).toBe(true);
    });

    it('classifies fence interior before quote/list content inside it', () => {
        const quoteLike = '```\n> fake quote\n```';
        expect(drop(quoteLike, paragraph, 2).decision.rejectReason).toBe('inside_code_block');

        const listLike = '```\n- fake item\n```';
        expect(drop(listLike, paragraph, 2).decision.rejectReason).toBe('inside_code_block');
    });

    it('rejects inside a quote run unless the source is a blockquote', () => {
        const doc = '> one\n> two';
        expect(drop(doc, paragraph, 2).decision).toEqual({ allowDrop: false, rejectReason: 'inside_quote_run' });
        expect(drop(doc, blockquote, 2).decision.allowDrop).toBe(true);
    });

    it('restricts the seam above a quote only for callouts', () => {
        const doc = '> quoted\nafter';
        expect(drop(doc, paragraph, 1).decision.allowDrop).toBe(true);
        expect(drop(doc, callout, 1).decision).toEqual({ allowDrop: false, rejectReason: 'quote_boundary' });
    });

    it('restricts the seam below a quote unless the source is a blockquote', () => {
        const doc = '> quoted\nafter';
        expect(drop(doc, paragraph, 2).decision).toEqual({ allowDrop: false, rejectReason: 'quote_boundary' });
        expect(drop(doc, blockquote, 2).decision.allowDrop).toBe(true);
    });

    it('restricts the seam inside a list unless the source is a list item', () => {
        const doc = '- one\n  - nested';
        expect(drop(doc, listItem, 2).decision.allowDrop).toBe(true);
        expect(drop(doc, paragraph, 2).decision).toEqual({ allowDrop: false, rejectReason: 'inside_list' });
    });

    it('treats the seam between sibling list items as outside the list', () => {
        const doc = '- one\n- two';
        expect(drop(doc, paragraph, 2).decision.allowDrop).toBe(true);
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
