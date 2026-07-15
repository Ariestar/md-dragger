import type { Doc } from './document-types';
import type { ParsedLine } from '../parse/types';
import { formatIndent, parseLine } from '../parse/parse-line';
import { isListLine } from '../parse/parse-line';

const indentUnitWidthCache = new WeakMap<object, number>();

export function normalizeTabSize(tabSize: number): number {
    if (!(tabSize > 0)) {
        throw new Error(`tabSize must be positive, got ${String(tabSize)}`);
    }
    return tabSize;
}

/** @deprecated use parseLine from domain/parse */
export function parseLineWithQuote(line: string, tabSize: number): ParsedLine {
    return parseLine(line, normalizeTabSize(tabSize));
}

/** @deprecated use formatIndent from domain/parse */
export function buildIndentStringFromSample(sample: string, width: number, tabSize: number): string {
    return formatIndent(width, normalizeTabSize(tabSize), sample);
}

export function getIndentUnitWidth(sample: string, tabSize: number): number {
    if (sample.length === 0) {
        throw new Error('getIndentUnitWidth: empty indent sample');
    }
    if (sample.includes('\t')) return normalizeTabSize(tabSize);
    return sample.length;
}

export function getIndentUnitWidthFromDoc(
    doc: Doc,
    parse: (line: string) => ParsedLine,
): number {
    let best = Number.POSITIVE_INFINITY;
    let prevIndent: number | null = null;

    for (let i = 1; i <= doc.lines; i++) {
        const parsed = parse(doc.line(i).text);
        if (!isListLine(parsed)) continue;
        if (prevIndent !== null && parsed.indent.width > prevIndent) {
            const delta = parsed.indent.width - prevIndent;
            if (delta > 0 && delta < best) best = delta;
        }
        prevIndent = parsed.indent.width;
    }

    if (!isFinite(best)) {
        throw new Error('getIndentUnitWidthFromDoc: document has no nested list sample');
    }
    return best;
}

export function getIndentUnitWidthForDoc(
    doc: Doc,
    parse: (line: string) => ParsedLine,
): number {
    if (doc && typeof doc === 'object') {
        const cached = indentUnitWidthCache.get(doc);
        if (typeof cached === 'number') return cached;
    }
    const resolved = getIndentUnitWidthFromDoc(doc, parse);
    if (doc && typeof doc === 'object') {
        indentUnitWidthCache.set(doc, resolved);
    }
    return resolved;
}
