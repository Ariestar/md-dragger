import { Doc, ParsedLine } from './document-types';
import { parseLineWithQuote as parseLineWithQuoteByTabSize } from './line-parser';

const indentUnitWidthCache = new WeakMap<object, number>();

/** Space-list step when the document has no nested sample. Not tabSize. */
const SPACE_LIST_INDENT_UNIT = 2;

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

// Unit for one list nesting step.
// - tab indent sample → tab width
// - non-empty space sample → that sample's width
// - empty sample → SPACE_LIST_INDENT_UNIT (never tabSize)
export function getIndentUnitWidth(sample: string, tabSize: number): number {
    if (sample.includes('\t')) return normalizeTabSize(tabSize);
    if (sample.length > 0) return sample.length;
    return SPACE_LIST_INDENT_UNIT;
}

// Smallest positive nested delta in the doc, or SPACE_LIST_INDENT_UNIT if flat.
export function getIndentUnitWidthFromDoc(
    doc: Doc,
    parseLine: (line: string) => ParsedLine,
): number {
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

    if (!isFinite(best)) return SPACE_LIST_INDENT_UNIT;
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
