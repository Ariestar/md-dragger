export type MarkerType = 'ordered' | 'unordered' | 'task';

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
