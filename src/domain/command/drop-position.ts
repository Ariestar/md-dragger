import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';

/**
 * Drop site for one drag frame / commit.
 * - line: insert-before (1-based seam in Doc)
 * - parent: container to nest under; null = document root (top-level)
 *
 * No index (no full tree). Indent is derived from parent in paint/compile.
 */
export type DropPosition = {
    doc: Doc;
    line: number;
    parent: Block | null;
};
