import type { BlockSelection } from '../selection/block-selection';
import type { Doc } from '../markdown/document-types';

export type TextChange = {
    from: number;
    to: number;
    insert: string;
};

export type BlockEffect =
    | { type: 'restore-fold-state'; lineNumber: number }
    | { type: 'renumber-ordered-list'; lineNumber: number };

// A document's worth of landed changes, labeled with the doc they apply to.
// `doc` is the identity the host uses to route the edit to the right editor
// (source view for an in-file move, target view for a cross-file move).
// Same-document moves produce one DocEdit; cross-document moves produce two
// (source deletes, target inserts).
export type DocEdit = {
    doc: Doc;
    changes: TextChange[];
    selectionAfter?: BlockSelection | null;
    effects?: BlockEffect[];
};
