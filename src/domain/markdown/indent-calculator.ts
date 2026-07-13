import { Doc, ParsedLine } from './document-types';
import { parseLineWithQuote as parseLineWithQuoteByTabSize } from './line-parser';

const indentUnitWidthCache = new WeakMap<object, number>();

export function normalizeTabSize(tabSize: number): number {
    if (!(tabSize > 0)) {
        throw new Error(`tabSize must be positive, got ${String(tabSize)}`);
    }
    return tabSize;
}

export function parseLineWithQuote(line: string, tabSize: number): ParsedLine {
    return parseLineWithQuoteByTabSize(line, normalizeTabSize(tabSize));
}

export function buildIndentStringFromSample(sample: string, width: number, tabSize: number): string {
    const unit = normalizeTabSize(tabSize);
    const safeWidth = Math.max(0, width);
    if (safeWidth === 0) return '';
    if (sample.includes('\t')) {
        const tabs = Math.floor(safeWidth / unit);
        const spaces = safeWidth - tabs * unit;
        return '\t'.repeat(tabs) + ' '.repeat(spaces);
    }
    return ' '.repeat(safeWidth);
}

// One nesting step from a concrete indent sample. Empty sample is an error.
export function getIndentUnitWidth(sample: string, tabSize: number): number {
    if (sample.length === 0) {
        throw new Error('getIndentUnitWidth: empty indent sample');
    }
    if (sample.includes('\t')) return normalizeTabSize(tabSize);
    return sample.length;
}

// Smallest positive nested list delta in the document. Flat docs throw.
export function getIndentUnitWidthFromDoc(
    doc: Doc,
    parseLine: (line: string) => ParsedLine,
): number {
    let best = Number.POSITIVE_INFINITY;
    let prevIndent: number | null = null;

    for (let i = 1; i <= doc.lines; i++) {
        const parsed = parseLine(doc.line(i).text);
        if (!parsed.isListItem) continue;
        if (prevIndent !== null && parsed.indentWidth > prevIndent) {
            const delta = parsed.indentWidth - prevIndent;
            if (delta > 0 && delta < best) best = delta;
        }
        prevIndent = parsed.indentWidth;
    }

    if (!isFinite(best)) {
        throw new Error('getIndentUnitWidthFromDoc: document has no nested list sample');
    }
    return best;
}

export function getIndentUnitWidthForDoc(
    doc: Doc,
    parseLine: (line: string) => ParsedLine,
): number {
    if (doc && typeof doc === 'object') {
        const cached = indentUnitWidthCache.get(doc);
        if (typeof cached === 'number') return cached;
    }
    const resolved = getIndentUnitWidthFromDoc(doc, parseLine);
    if (doc && typeof doc === 'object') {
        indentUnitWidthCache.set(doc, resolved);
    }
    return resolved;
}
