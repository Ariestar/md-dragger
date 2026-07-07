import type { BlockSelection } from '../selection/block-selection';

export type TextChange = {
    from: number;
    to: number;
    insert: string;
};

export type BlockEffect =
    | { type: 'restore-fold-state'; lineNumber: number }
    | { type: 'renumber-ordered-list'; lineNumber: number };

export type BlockTransaction = {
    changes: TextChange[];
    selectionAfter?: BlockSelection | null;
    effects?: BlockEffect[];
};
