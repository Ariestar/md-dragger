import type { Doc, DocLine } from '../markdown/document-types';
import type { TextChange } from './block-transaction';

/** Apply changes relative to the same base string (CodeMirror-style). High `from` first. */
export function applyChanges(text: string, changes: TextChange[]): string {
    if (changes.length === 0) return text;
    let out = text;
    for (const c of [...changes].sort((a, b) => b.from - a.from || b.to - a.to)) {
        out = out.slice(0, c.from) + c.insert + out.slice(c.to);
    }
    return out;
}

/**
 * Map a position on the document *after* `base` changes back onto the original.
 * `base` are simultaneous edits against the original (same as applyChanges).
 */
export function posToOriginal(posAfter: number, base: TextChange[]): number {
    let pos = posAfter;
    for (const c of [...base].sort((a, b) => a.from - b.from || a.to - b.to)) {
        const insertedEnd = c.from + c.insert.length;
        const delta = c.insert.length - (c.to - c.from);
        if (pos >= insertedEnd) {
            pos -= delta;
        } else if (pos > c.from) {
            pos = c.from;
        }
    }
    return Math.max(0, pos);
}

export function changesToOriginal(after: TextChange[], base: TextChange[]): TextChange[] {
    return after.map((c) => ({
        from: posToOriginal(c.from, base),
        to: posToOriginal(c.to, base),
        insert: c.insert,
    }));
}

/** Minimal Doc over a flat string (1-based lines). */
export function stringDoc(text: string): Doc {
    const parts = text.split('\n');
    const starts: number[] = [0];
    for (let i = 0; i < parts.length - 1; i++) {
        starts.push(starts[i] + parts[i].length + 1);
    }
    const lineCount = Math.max(1, parts.length);

    const line = (n: number): DocLine => {
        if (n < 1 || n > lineCount) {
            throw new Error(`stringDoc.line: ${n} not in 1..${lineCount}`);
        }
        const from = starts[n - 1] ?? 0;
        const to = n < lineCount ? starts[n] - 1 : text.length;
        return { text: text.slice(from, to), from, to };
    };

    return {
        lines: lineCount,
        length: text.length,
        line,
        lineAt: (pos: number) => {
            const p = Math.max(0, Math.min(text.length, pos));
            for (let i = lineCount; i >= 1; i--) {
                if ((starts[i - 1] ?? 0) <= p) return { number: i };
            }
            return { number: 1 };
        },
        sliceString: (from, to) => text.slice(from, to),
    };
}
