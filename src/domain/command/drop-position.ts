import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';

/**
 * Structural drop site: place in the block tree.
 * - parent null → document root sequence
 * - index: insert before this child under parent (0-based; may be children.length for end)
 * - line: insert-before line in linear Doc (1-based), projection of (parent, index)
 *
 * List depth / indent is NOT stored here — derived in compile/paint from parent.
 */
export type DropPosition = {
    doc: Doc;
    parent: Block | null;
    index: number;
    line: number;
};
