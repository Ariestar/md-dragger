import type { Doc } from '../markdown/document-types';

export type ListDropTarget = {
    mode: 'sibling' | 'child' | 'outdent';
    contextLineNumber?: number;
    targetIndentWidth?: number;
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
};
