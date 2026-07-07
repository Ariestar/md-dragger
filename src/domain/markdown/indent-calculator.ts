import { DocLike, ParsedLine } from './document-types';
import { parseLineWithQuote as parseLineWithQuoteByTabSize } from './line-parser';

const indentUnitWidthCache = new WeakMap<object, number>();

export function normalizeTabSize(tabSize?: number): number {
    const safe = tabSize ?? 4;
    return safe > 0 ? safe : 4;
}

export function parseLineWithQuote(line: string, tabSize: number): ParsedLine {
    return parseLineWithQuoteByTabSize(line, normalizeTabSize(tabSize));
}

export function buildIndentStringFromSample(sample: string, width: number, tabSize: number): string {
    const safeTabSize = normalizeTabSize(tabSize);
    const safeWidth = Math.max(0, width);
    if (safeWidth === 0) return '';
    if (sample.includes('\t')) {
        const tabs = Math.max(0, Math.floor(safeWidth / safeTabSize));
        const spaces = Math.max(0, safeWidth - tabs * safeTabSize);
        return '\t'.repeat(tabs) + ' '.repeat(spaces);
    }
    return ' '.repeat(safeWidth);
}

export function getIndentUnitWidth(sample: string, tabSize: number): number {
    const safeTabSize = normalizeTabSize(tabSize);
    if (sample.includes('\t')) return safeTabSize;
    if (sample.length >= safeTabSize) return safeTabSize;
    return sample.length > 0 ? sample.length : safeTabSize;
}

export function getIndentUnitWidthFromDoc(
    doc: DocLike,
    parseLine: (line: string) => ParsedLine,
    fallbackTabSize?: number
): number | undefined {
    let best = Number.POSITIVE_INFINITY;
    let prevIndent: number | null = null;

    for (let i = 1; i <= doc.lines; i++) {
        const text = doc.line(i).text;
        const parsed = parseLine(text);
        if (!parsed.isListItem) continue;
        if (prevIndent !== null && parsed.indentWidth > prevIndent) {
            const delta = parsed.indentWidth - prevIndent;
            if (delta > 0 && delta < best) best = delta;
        }
        prevIndent = parsed.indentWidth;
    }

    if (!isFinite(best)) {
        return normalizeTabSize(fallbackTabSize);
    }
    return Math.max(2, best);
}

export function getIndentUnitWidthForDoc(
    doc: DocLike,
    parseLine: (line: string) => ParsedLine,
    fallbackTabSize?: number
): number {
    if (doc && typeof doc === 'object') {
        const cached = indentUnitWidthCache.get(doc);
        if (typeof cached === 'number') {
            return cached;
        }
    }
    const fromDoc = getIndentUnitWidthFromDoc(doc, parseLine, fallbackTabSize);
    const resolved = typeof fromDoc === 'number' ? fromDoc : normalizeTabSize(fallbackTabSize);
    if (doc && typeof doc === 'object') {
        indentUnitWidthCache.set(doc, resolved);
    }
    return resolved;
}
