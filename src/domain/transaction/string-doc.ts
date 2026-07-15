import type { Doc, DocLine } from '../markdown/document-types';
import type { TextChange } from './block-transaction';

/** Apply changes that are all relative to the same base string (high `from` first). */
export function applyChanges(text: string, changes: TextChange[]): string {
    if (changes.length === 0) return text;
    let out = text;
    for (const c of [...changes].sort((a, b) => b.from - a.from || b.to - a.to)) {
        out = out.slice(0, c.from) + c.insert + out.slice(c.to);
    }
    return out;
}

/** Minimal Doc over a flat string (1-based lines). */
export function stringDoc(text: string): Doc {
    const parts = text.length === 0 ? [''] : text.split('\n');
    const starts: number[] = [0];
    for (let i = 0; i < parts.length - 1; i++) {
        starts.push(starts[i] + parts[i].length + 1);
    }
    const lineCount = parts.length;

    const line = (n: number): DocLine => {
        if (n < 1 || n > lineCount) {
            throw new Error(`stringDoc.line: ${n} not in 1..${lineCount}`);
        }
        const from = starts[n - 1];
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
                if (starts[i - 1] <= p) return { number: i };
            }
            return { number: 1 };
        },
        sliceString: (from, to) => text.slice(from, to),
    };
}
