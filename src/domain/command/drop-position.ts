import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';

/**
 * Drop site for one drag frame / commit.
 * - line: insert-before (1-based seam in Doc). It names a gap and a boundary
 *   in it: in an interior gap with blank lines, the gap's blank lines above
 *   `line` stay above the payload. locateDropPosition gives the boundary under
 *   the pointer in a gap of two or more blank lines and the gap's canonical
 *   seam elsewhere; planMove gives the boundary the write uses, which the
 *   indicator paints (seamRow)
 * - parent: container to nest under; null = document root (top-level)
 *
 * No index (no full tree). Indent is derived from parent in paint/compile.
 */
export type DropPosition = {
    doc: Doc;
    line: number;
    parent: Block | null;
};
