export type ListDropTarget = {
    mode: 'sibling' | 'child' | 'outdent';
    contextLineNumber?: number;
    targetIndentWidth?: number;
};

export type DropTarget = {
    targetLineNumber: number;
    placement: 'before' | 'after' | 'inside';
    listIntent?: ListDropTarget;
};
