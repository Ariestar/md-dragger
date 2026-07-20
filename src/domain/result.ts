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
    | 'container_policy'
    | 'inside_list'
    | 'inside_quote_run'
    | 'quote_boundary'
    | 'callout_after'
    | 'table_before'
    | 'hr_before'
    | 'table_cell'
    | 'insertion_inside_deleted_range'
    | 'unsupported_command';

export type Reject = {
    type: 'reject';
    reason: RejectReason;
};

export function reject(reason: RejectReason): Reject {
    return { type: 'reject', reason };
}

export function isReject(value: unknown): value is Reject {
    return typeof value === 'object'
        && value !== null
        && (value as { type?: unknown }).type === 'reject';
}
