/**
 * Single reject vocabulary for the whole domain.
 * planMove / moveTx / planDelete / rules all use this.
 */
export type RejectReason =
    | 'empty_selection'
    | 'no_target'
    | 'no_insert_text'
    | 'self_range_blocked'
    | 'self_embedding'
    | 'inside_code_block'
    | 'inside_list'
    | 'inside_math_block'
    | 'inside_comment_block'
    | 'inside_quote_run'
    | 'inside_table'
    | 'inside_frontmatter'
    | 'nested_block'
    | 'frontmatter_fence'
    | 'table_cell'
    | 'unsupported_command';

export type Reject = {
    type: 'reject';
    reason: RejectReason;
};

export function reject(reason: RejectReason): Reject {
    return { type: 'reject', reason };
}

export function isReject(value: unknown): value is Reject {
    return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'reject';
}
