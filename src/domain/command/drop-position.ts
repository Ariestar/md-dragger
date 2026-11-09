import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';

/**
 * Where in a gap a line payload (a line cut from a larger paragraph or quote)
 * lands: joined to the line above, apart in its own paragraph or quote, or
 * joined to the line below.
 */
export type DropZone = 'joinAbove' | 'apart' | 'joinBelow';

/**
 * Drop site for one drag frame / commit.
 * - line: insert-before (1-based seam in Doc)
 * - parent: container to nest under; null = document root (top-level)
 * - zone: where a line payload lands in the gap, as the pointer chose it;
 *   absent when nothing chose one or zones do not apply (no line payload),
 *   and the spacing rules alone place the payload
 *
 * No index (no full tree). Indent is derived from parent in paint/compile.
 */
export type DropPosition = {
    doc: Doc;
    line: number;
    parent: Block | null;
    zone?: DropZone;
};
