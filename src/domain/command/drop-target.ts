import type { Doc } from '../markdown/document-types';

export type ListDropTarget = {
    mode: 'sibling' | 'child' | 'outdent';
    contextLineNumber?: number;
    targetIndentWidth?: number;
};

/**
 * Host-agnostic drop indicator geometry.
 * Adapter only maps these line/char indices to pixels — no indent math there.
 *
 * left  = content start of `leftLine` at `leftChars` (reuse a list line's indent)
 * right / y from `bandLine`'s line box
 */
export type DropGuide = {
    /** Line whose box defines right edge and seam Y. */
    bandLine: number;
    /** Line used for left X (prefer a list item already at the drop indent). */
    leftLine: number;
    /** Char offset from leftLine start to the left edge (indent out, marker in). */
    leftChars: number;
};

// A drop location is incomplete without the document it lands in — a line
// number alone is ambiguous across editors. `targetDoc` carries that identity,
// so cross-document drops emerge automatically: the runtime compares it against
// the source doc and selects the cross-doc transaction path with no flags.
export type DropTarget = {
    targetDoc: Doc;
    targetLineNumber: number;
    placement: 'before' | 'after' | 'inside';
    listIntent?: ListDropTarget;
    /** Set by locateDropTarget for paint. Move/mutation paths may omit it. */
    guide?: DropGuide;
};
