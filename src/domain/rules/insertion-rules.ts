import { BlockType } from '../block/block-types';
import type { RejectReason } from '../result';

export type InsertionSlotContext =
    | 'inside_code_block'
    | 'inside_list'
    | 'inside_math_block'
    | 'inside_quote_run'
    | 'quote_before'
    | 'quote_after'
    | 'callout_after'
    | 'table_before'
    | 'hr_before'
    | 'outside';

export interface InsertionRuleInput {
    sourceType: BlockType;
    slotContext: InsertionSlotContext;
}

export interface InsertionRuleDecision {
    allowDrop: boolean;
    rejectReason: RejectReason | null;
}

export function resolveInsertionRule(input: InsertionRuleInput): InsertionRuleDecision {
    const { sourceType, slotContext } = input;
    switch (slotContext) {
        case 'inside_code_block':
        case 'inside_math_block':
        case 'callout_after':
        case 'table_before':
        case 'hr_before':
            return { allowDrop: false, rejectReason: slotContext };
        case 'inside_list':
            return sourceType === BlockType.ListItem
                ? { allowDrop: true, rejectReason: null }
                : { allowDrop: false, rejectReason: 'inside_list' };
        case 'inside_quote_run':
            return sourceType === BlockType.Blockquote
                ? { allowDrop: true, rejectReason: null }
                : { allowDrop: false, rejectReason: 'inside_quote_run' };
        case 'quote_before':
            return sourceType === BlockType.Callout
                ? { allowDrop: false, rejectReason: 'quote_boundary' }
                : { allowDrop: true, rejectReason: null };
        case 'quote_after':
            return sourceType === BlockType.Blockquote
                ? { allowDrop: true, rejectReason: null }
                : { allowDrop: false, rejectReason: 'quote_boundary' };
        default:
            return { allowDrop: true, rejectReason: null };
    }
}
