import type { TextChange } from './block-transaction';

/** Maps positions between a doc and its edited version (one change set). */
export type PosMapper = {
    /** Original → edited. null = position is inside a deleted range. */
    forward: (pos: number) => number | null;
    /** Edited → original. 'insert' = position is inside inserted text. */
    backward: (pos: number) => number | 'insert';
};

/**
 * Build a position mapper for one set of non-overlapping changes.
 * Segments over the edited doc: 'orig' runs map to a run of the original
 * doc, 'insert' runs carry inserted text; deleted ranges have no edited
 * counterpart and map to null in forward.
 */
export function buildPosMapper(changes: TextChange[], originalLength: number): PosMapper {
    const sorted = [...changes].sort((a, b) => a.from - b.from);
    const segments: { mStart: number; oStart: number; len: number; insert: boolean }[] = [];
    let m = 0;
    let o = 0;
    for (const c of sorted) {
        if (c.from > o) {
            segments.push({ mStart: m, oStart: o, len: c.from - o, insert: false });
            m += c.from - o;
        }
        if (c.insert.length > 0) {
            segments.push({ mStart: m, oStart: c.from, len: c.insert.length, insert: true });
            m += c.insert.length;
        }
        o = c.to;
    }
    if (o < originalLength) {
        const len = originalLength - o;
        segments.push({ mStart: m, oStart: o, len, insert: false });
        m += len;
    }

    const deleted = sorted.filter((c) => c.to > c.from);

    const findSegment = (mPos: number): number => {
        for (let i = 0; i < segments.length; i++) {
            const s = segments[i];
            if (mPos >= s.mStart && mPos < s.mStart + s.len) return i;
        }
        return -1;
    };

    return {
        forward: (pos) => {
            for (const c of deleted) {
                if (pos >= c.from && pos < c.to) return null;
            }
            for (const s of segments) {
                if (s.insert) continue;
                if (pos >= s.oStart && pos < s.oStart + s.len) return s.mStart + (pos - s.oStart);
            }
            return m;
        },
        backward: (pos) => {
            const i = findSegment(pos);
            if (i >= 0) {
                const s = segments[i];
                return s.insert ? 'insert' : s.oStart + (pos - s.mStart);
            }
            // Position at the very end of the edited doc.
            const last = segments[segments.length - 1];
            return last ? (last.insert ? 'insert' : last.oStart + last.len) : pos;
        },
    };
}
