import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';

/**
 * Structural where — the only drop type.
 * Paint and indent are derived; not stored here.
 */
export type DropPosition =
    | {
        kind: 'seam';
        doc: Doc;
        /** Insert before this 1-based line; doc.lines+1 = end */
        line: number;
    }
    | {
        kind: 'inside';
        doc: Doc;
        parent: Block;
        /** Insert-before line inside / under the parent */
        line: number;
    };
