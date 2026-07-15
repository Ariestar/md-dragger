export type MarkerType = 'ordered' | 'unordered' | 'task';

/** Nearby list style sample (for relevel). Not a parse result. */
export type ListContextValue = {
    indentWidth: number;
    indentRaw: string;
    markerType: MarkerType;
};

export type ListContext = ListContextValue | null;

// A line in a document — text plus its character span.
export interface DocLine {
    text: string;
    from: number;
    to: number;
}

// Host-agnostic document shape.
export interface Doc {
    lines: number;
    length: number;
    line: (n: number) => DocLine;
    lineAt: (pos: number) => { number: number };
    sliceString: (from: number, to: number) => string;
}
