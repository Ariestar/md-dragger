import { BlockType } from '../block/block-types';
import type { RejectReason } from '../result';

export type InsertionSlotContext =
    | 'inside_list'
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

type RuleKey = `${BlockType}|${InsertionSlotContext}`;

const ALL_TYPES = Object.values(BlockType) as BlockType[];

function rejectEntries(
    types: BlockType[],
    slot: InsertionSlotContext,
    reason: RejectReason
): [RuleKey, RejectReason][] {
    return types.map((t): [RuleKey, RejectReason] => [`${t}|${slot}`, reason]);
}

const REJECT_RULES: ReadonlyMap<RuleKey, RejectReason> = new Map<RuleKey, RejectReason>([
    ...rejectEntries(
        ALL_TYPES.filter((t) => t !== BlockType.ListItem),
        'inside_list',
        'inside_list'
    ),
    ...rejectEntries(
        ALL_TYPES.filter((t) => t !== BlockType.Blockquote),
        'inside_quote_run',
        'inside_quote_run'
    ),
    ...rejectEntries([BlockType.Callout], 'quote_before', 'quote_boundary'),
    ...rejectEntries(
        ALL_TYPES.filter((t) => t !== BlockType.Blockquote),
        'quote_after',
        'quote_boundary'
    ),
    ...rejectEntries(ALL_TYPES, 'callout_after', 'callout_after'),
    ...rejectEntries(ALL_TYPES, 'table_before', 'table_before'),
    ...rejectEntries(ALL_TYPES, 'hr_before', 'hr_before'),
]);

export function resolveInsertionRule(input: InsertionRuleInput): InsertionRuleDecision {
    const key: RuleKey = `${input.sourceType}|${input.slotContext}`;
    const rejectReason = REJECT_RULES.get(key) ?? null;
    return {
        allowDrop: rejectReason === null,
        rejectReason,
    };
}
