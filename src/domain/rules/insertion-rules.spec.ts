import { describe, expect, it } from 'vitest';
import { BlockType } from '../block/block-types';
import {
    resolveInsertionRule,
} from './insertion-rules';

describe('insertion-rule-matrix', () => {
    it('blocks non-list blocks inside list context', () => {
        const rule = resolveInsertionRule({
            sourceType: BlockType.Paragraph,
            slotContext: 'inside_list',
        });

        expect(rule.allowDrop).toBe(false);
        expect(rule.rejectReason).toBe('inside_list');
    });

    it('allows list blocks inside list context', () => {
        const rule = resolveInsertionRule({
            sourceType: BlockType.ListItem,
            slotContext: 'inside_list',
        });

        expect(rule.allowDrop).toBe(true);
        expect(rule.rejectReason).toBeNull();
    });

    it('blocks non-quote source inside quote run', () => {
        const rule = resolveInsertionRule({
            sourceType: BlockType.Paragraph,
            slotContext: 'inside_quote_run',
        });

        expect(rule.allowDrop).toBe(false);
        expect(rule.rejectReason).toBe('inside_quote_run');
    });

    it('blocks callout source inside quote run', () => {
        const rule = resolveInsertionRule({
            sourceType: BlockType.Callout,
            slotContext: 'inside_quote_run',
        });

        expect(rule.allowDrop).toBe(false);
        expect(rule.rejectReason).toBe('inside_quote_run');
    });

    it('allows non-quote source at quote first-line boundary', () => {
        const rule = resolveInsertionRule({
            sourceType: BlockType.Paragraph,
            slotContext: 'quote_before',
        });

        expect(rule.allowDrop).toBe(true);
        expect(rule.rejectReason).toBeNull();
    });

    it('blocks non-quote source at quote tail boundary', () => {
        const rule = resolveInsertionRule({
            sourceType: BlockType.Paragraph,
            slotContext: 'quote_after',
        });

        expect(rule.allowDrop).toBe(false);
        expect(rule.rejectReason).toBe('quote_boundary');
    });

    it('allows blockquote source at quote boundaries', () => {
        const beforeRule = resolveInsertionRule({
            sourceType: BlockType.Blockquote,
            slotContext: 'quote_before',
        });
        const afterRule = resolveInsertionRule({
            sourceType: BlockType.Blockquote,
            slotContext: 'quote_after',
        });

        expect(beforeRule.allowDrop).toBe(true);
        expect(beforeRule.rejectReason).toBeNull();
        expect(afterRule.allowDrop).toBe(true);
        expect(afterRule.rejectReason).toBeNull();
    });

    it('blocks callout source at quote boundaries', () => {
        const beforeRule = resolveInsertionRule({
            sourceType: BlockType.Callout,
            slotContext: 'quote_before',
        });
        const afterRule = resolveInsertionRule({
            sourceType: BlockType.Callout,
            slotContext: 'quote_after',
        });

        expect(beforeRule.allowDrop).toBe(false);
        expect(beforeRule.rejectReason).toBe('quote_boundary');
        expect(afterRule.allowDrop).toBe(false);
        expect(afterRule.rejectReason).toBe('quote_boundary');
    });

    it('blocks any source in callout-after slot', () => {
        const paragraphRule = resolveInsertionRule({
            sourceType: BlockType.Paragraph,
            slotContext: 'callout_after',
        });
        const calloutRule = resolveInsertionRule({
            sourceType: BlockType.Callout,
            slotContext: 'callout_after',
        });

        expect(paragraphRule.allowDrop).toBe(false);
        expect(paragraphRule.rejectReason).toBe('callout_after');
        expect(calloutRule.allowDrop).toBe(false);
        expect(calloutRule.rejectReason).toBe('callout_after');
    });

    it('blocks insertion before table and horizontal rule slots', () => {
        const tableRule = resolveInsertionRule({
            sourceType: BlockType.Paragraph,
            slotContext: 'table_before',
        });
        const hrRule = resolveInsertionRule({
            sourceType: BlockType.Paragraph,
            slotContext: 'hr_before',
        });

        expect(tableRule.allowDrop).toBe(false);
        expect(tableRule.rejectReason).toBe('table_before');
        expect(hrRule.allowDrop).toBe(false);
        expect(hrRule.rejectReason).toBe('hr_before');
    });

});


