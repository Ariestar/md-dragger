import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';

/**
 * Structural where — the only drop type.
 * Paint fields are not stored; indent for list relevel is on `out` only.
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
    }
    | {
        /**
         * List relevel without nesting into a container:
         * sibling of a list item, or outdent to an ancestor level (incl. root).
         */
        kind: 'out';
        doc: Doc;
        /** Insert-before line (same seam geometry as `seam`) */
        line: number;
        /** Absolute indent width for the moved list root after drop */
        indent: number;
        /** Sample list line for marker/indent style (1-based) */
        contextLine: number;
    };
