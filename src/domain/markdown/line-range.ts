import type { LineRange } from './line-range-types';

export function normalizeLineRange(docLines: number, startLineNumber: number, endLineNumber: number): LineRange {
    const safeStart = Math.max(1, Math.min(docLines, Math.min(startLineNumber, endLineNumber)));
    const safeEnd = Math.max(1, Math.min(docLines, Math.max(startLineNumber, endLineNumber)));
    return {
        startLineNumber: safeStart,
        endLineNumber: safeEnd,
    };
}

export function mergeLineRanges(docLines: number, ranges: LineRange[]): LineRange[] {
    const normalized = ranges
        .map((range) => normalizeLineRange(docLines, range.startLineNumber, range.endLineNumber))
        .sort((a, b) => a.startLineNumber - b.startLineNumber);
    const merged: LineRange[] = [];
    for (const range of normalized) {
        const last = merged[merged.length - 1];
        if (!last || range.startLineNumber > last.endLineNumber + 1) {
            merged.push({ ...range });
            continue;
        }
        if (range.endLineNumber > last.endLineNumber) {
            last.endLineNumber = range.endLineNumber;
        }
    }
    return merged;
}

export function cloneLineRanges(ranges: LineRange[]): LineRange[] {
    return ranges.map((range) => ({ ...range }));
}

export function isLineNumberInRanges(lineNumber: number, ranges: LineRange[]): boolean {
    for (const range of ranges) {
        if (lineNumber >= range.startLineNumber && lineNumber <= range.endLineNumber) {
            return true;
        }
    }
    return false;
}

export function isLineRangeCoveredByRanges(docLines: number, target: LineRange, ranges: LineRange[]): boolean {
    const normalizedTarget = normalizeLineRange(
        docLines,
        target.startLineNumber,
        target.endLineNumber
    );
    const merged = mergeLineRanges(docLines, ranges);
    return merged.some((range) =>
        range.startLineNumber <= normalizedTarget.startLineNumber
        && range.endLineNumber >= normalizedTarget.endLineNumber
    );
}

export function subtractLineRange(
    docLines: number,
    sourceRanges: LineRange[],
    rangeToSubtract: LineRange
): LineRange[] {
    const normalizedSource = mergeLineRanges(docLines, sourceRanges);
    const target = normalizeLineRange(
        docLines,
        rangeToSubtract.startLineNumber,
        rangeToSubtract.endLineNumber
    );

    const result: LineRange[] = [];
    for (const source of normalizedSource) {
        if (target.endLineNumber < source.startLineNumber || target.startLineNumber > source.endLineNumber) {
            result.push({ ...source });
            continue;
        }

        if (target.startLineNumber > source.startLineNumber) {
            result.push({
                startLineNumber: source.startLineNumber,
                endLineNumber: target.startLineNumber - 1,
            });
        }
        if (target.endLineNumber < source.endLineNumber) {
            result.push({
                startLineNumber: target.endLineNumber + 1,
                endLineNumber: source.endLineNumber,
            });
        }
    }

    return mergeLineRanges(docLines, result);
}
