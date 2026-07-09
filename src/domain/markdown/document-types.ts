export type MarkerType = 'ordered' | 'unordered' | 'task';

export interface ListContextValue {
    indentWidth: number;
    indentRaw: string;
    markerType: MarkerType;
}

export type ListContext = ListContextValue | null;

export interface ParsedListLine {
    isListItem: boolean;
    indentRaw: string;
    indentWidth: number;
    marker: string;
    markerType: MarkerType;
    content: string;
}

export interface ParsedLine {
    text: string;
    quotePrefix: string;
    quoteDepth: number;
    rest: string;
    isListItem: boolean;
    indentRaw: string;
    indentWidth: number;
    marker: string;
    markerType: MarkerType;
    content: string;
}

// A line in a document — text plus its character span.
export interface DocLine {
    text: string;
    from: number;
    to: number;
}

// The single document shape every doc satisfies (CodeMirror's editor doc in
// production). Inspection (block detection, line maps) and mutation (move/delete
// transactions) both use it — the old Doc/Doc split only
// fragmented capability and forced ad-hoc `& {...}` extensions wherever a
// function actually needed offsets or `lineAt`.
export interface Doc {
    lines: number;
    length: number;
    line: (n: number) => DocLine;
    lineAt: (pos: number) => { number: number };
    sliceString: (from: number, to: number) => string;
}

