import type { BlockSelection } from '../selection/block-selection';
import type { Doc } from '../markdown/document-types';

export type TextChange = {
    from: number;
    to: number;
    insert: string;
};

/** One document's worth of character patches. No selection UX fields. */
export type DocEdit = {
    doc: Doc;
    changes: TextChange[];
};
