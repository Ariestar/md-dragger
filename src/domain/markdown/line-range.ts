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

export function cloneLineRanges(ranges: LineRange[]): LineRange[] {
    return ranges.map((range) => ({ ...range }));
}

export function isLineNumberInRanges(line: number, ranges: LineRange[]): boolean {
    for (const range of ranges) {
        if (line >= range.startLine && line <= range.endLine) return true;
    }
    return false;
}

export function isLineRangeCoveredByRanges(docLines: number, target: LineRange, ranges: LineRange[]): boolean {
    const normalizedTarget = normalizeLineRange(docLines, target.startLine, target.endLine);
    return mergeLineRanges(docLines, ranges).some(
        (range) =>
            range.startLine <= normalizedTarget.startLine
            && range.endLine >= normalizedTarget.endLine
    );
}

export function subtractLineRange(
    docLines: number,
    sourceRanges: LineRange[],
    rangeToSubtract: LineRange
): LineRange[] {
    const normalizedSource = mergeLineRanges(docLines, sourceRanges);
    const target = normalizeLineRange(docLines, rangeToSubtract.startLine, rangeToSubtract.endLine);
    const result: LineRange[] = [];
    for (const source of normalizedSource) {
        if (target.endLine < source.startLine || target.startLine > source.endLine) {
            result.push({ ...source });
            continue;
        }
        if (target.startLine > source.startLine) {
            result.push({
                startLine: source.startLine,
                endLine: target.startLine - 1,
            });
        }
        if (target.endLine < source.endLine) {
            result.push({
                startLine: target.endLine + 1,
                endLine: source.endLine,
            });
        }
    }
    return mergeLineRanges(docLines, result);
}

export function lineCount(range: LineRange): number {
    return Math.max(0, range.endLine - range.startLine + 1);
}
