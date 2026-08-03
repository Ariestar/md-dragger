import type { LineRange } from './line-range-types';

export function normalizeLineRange(docLines: number, startLine: number, endLine: number): LineRange {
    if (docLines <= 0) {
        return { startLine: 1, endLine: 1 };
    }
    const safeStart = Math.max(1, Math.min(docLines, Math.min(startLine, endLine)));
    const safeEnd = Math.max(1, Math.min(docLines, Math.max(startLine, endLine)));
    return { startLine: safeStart, endLine: safeEnd };
}

export function mergeLineRanges(docLines: number, ranges: LineRange[]): LineRange[] {
    const normalized = ranges
        .map((range) => normalizeLineRange(docLines, range.startLine, range.endLine))
        .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    const merged: LineRange[] = [];
    for (const range of normalized) {
        const last = merged[merged.length - 1];
        if (!last || range.startLine > last.endLine + 1) {
            merged.push({ ...range });
            continue;
        }
        if (range.endLine > last.endLine) {
            last.endLine = range.endLine;
        }
    }
    return merged;
}

export function isLineNumberInRanges(line: number, ranges: LineRange[]): boolean {
    for (const range of ranges) {
        if (line >= range.startLine && line <= range.endLine) return true;
    }
    return false;
}
