import { isCalloutLine, isCodeFenceLine, isHorizontalRuleLine, isMathFenceLine, isTableLine } from '../block/block-guards';
import type { MarkerType } from '../markdown/document-types';
import type { Indent, LineMarker, ParsedLine } from './types';

function indentWidth(raw: string, tabSize: number): number {
    const unit = tabSize > 0 ? tabSize : 4;
    let width = 0;
    for (const ch of raw) {
        width += ch === '\t' ? unit : 1;
    }
    return width;
}

function splitQuote(line: string): { prefix: string; depth: number; rest: string } {
    const match = line.match(/^(\s*> ?)+/);
    if (!match) return { prefix: '', depth: 0, rest: line };
    const prefix = match[0];
    return {
        prefix,
        depth: (prefix.match(/>/g) || []).length,
        rest: line.slice(prefix.length),
    };
}

function parseMarkerAndBody(rest: string): { indent: Indent; marker: LineMarker | null; body: string } {
    const indentMatch = rest.match(/^(\s*)/);
    const indentRaw = indentMatch?.[1] ?? '';
    // indent width filled by caller with tabSize
    const afterIndent = rest.slice(indentRaw.length);

    // heading
    const headingMatch = afterIndent.match(/^(#{1,6})\s+/);
    if (headingMatch) {
        const text = headingMatch[0];
        const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
        return {
            indent: { raw: indentRaw, width: 0 },
            marker: { kind: 'heading', text, level },
            body: afterIndent.slice(text.length),
        };
    }

    // hr (whole remaining line)
    if (isHorizontalRuleLine(afterIndent)) {
        return {
            indent: { raw: indentRaw, width: 0 },
            marker: { kind: 'hr', text: afterIndent },
            body: '',
        };
    }

    // fences
    if (isCodeFenceLine(afterIndent)) {
        const info = afterIndent.replace(/^```\s*/, '').trim() || undefined;
        return {
            indent: { raw: indentRaw, width: 0 },
            marker: { kind: 'fence', text: afterIndent, fence: 'code', info },
            body: '',
        };
    }
    if (isMathFenceLine(afterIndent)) {
        return {
            indent: { raw: indentRaw, width: 0 },
            marker: { kind: 'fence', text: afterIndent, fence: 'math' },
            body: '',
        };
    }

    // table row
    if (isTableLine(afterIndent)) {
        return {
            indent: { raw: indentRaw, width: 0 },
            marker: { kind: 'table-row', text: afterIndent },
            body: '',
        };
    }

    // callout header (often after quote stripped: [!NOTE] title)
    if (isCalloutLine(afterIndent) || /^\[![^\]]+\]/.test(afterIndent)) {
        const m = afterIndent.match(/^\[!([^\]]+)\]\s*/);
        if (m) {
            return {
                indent: { raw: indentRaw, width: 0 },
                marker: { kind: 'callout', text: m[0], calloutType: m[1] },
                body: afterIndent.slice(m[0].length),
            };
        }
    }

    // list: task / unordered / ordered
    const taskMatch = afterIndent.match(/^([-*+])\s\[([ xX])\]\s+/);
    if (taskMatch) {
        const text = taskMatch[0];
        const checked = taskMatch[2] !== ' ';
        return {
            indent: { raw: indentRaw, width: 0 },
            marker: { kind: 'list', text, markerType: 'task' as MarkerType, checked },
            body: afterIndent.slice(text.length),
        };
    }
    const unorderedMatch = afterIndent.match(/^([-*+])\s+/);
    if (unorderedMatch) {
        const text = unorderedMatch[0];
        return {
            indent: { raw: indentRaw, width: 0 },
            marker: { kind: 'list', text, markerType: 'unordered' },
            body: afterIndent.slice(text.length),
        };
    }
    const orderedMatch = afterIndent.match(/^(\d+)[.)]\s+/);
    if (orderedMatch) {
        const text = orderedMatch[0];
        return {
            indent: { raw: indentRaw, width: 0 },
            marker: { kind: 'list', text, markerType: 'ordered' },
            body: afterIndent.slice(text.length),
        };
    }

    return {
        indent: { raw: indentRaw, width: 0 },
        marker: null,
        body: afterIndent,
    };
}

/**
 * Parse one MD line. Pure: only text + tabSize.
 * Does not embed DocLine / Block.
 */
export function parseLine(text: string, tabSize: number): ParsedLine {
    const safeTab = tabSize > 0 ? tabSize : 4;
    const { prefix, depth, rest } = splitQuote(text);
    const { indent, marker, body } = parseMarkerAndBody(rest);
    return {
        raw: text,
        quote: { depth, prefix },
        indent: {
            raw: indent.raw,
            width: indentWidth(indent.raw, safeTab),
        },
        marker,
        body,
    };
}

export function isListLine(p: ParsedLine): boolean {
    return p.marker?.kind === 'list';
}

export function listMarkerText(p: ParsedLine): string {
    return p.marker?.kind === 'list' ? p.marker.text : '';
}

export function listMarkerType(p: ParsedLine): MarkerType | null {
    return p.marker?.kind === 'list' ? p.marker.markerType : null;
}

/** Build indent string of `width` columns, matching sample's space/tab style. */
export function formatIndent(width: number, tabSize: number, sample = ' '): string {
    const unit = tabSize > 0 ? tabSize : 4;
    const safeWidth = Math.max(0, width);
    if (safeWidth === 0) return '';
    if (sample.includes('\t')) {
        const tabs = Math.floor(safeWidth / unit);
        const spaces = safeWidth - tabs * unit;
        return '\t'.repeat(tabs) + ' '.repeat(spaces);
    }
    return ' '.repeat(safeWidth);
}

export function normalizeTabSize(tabSize: number): number {
    if (!(tabSize > 0)) {
        throw new Error(`tabSize must be positive, got ${String(tabSize)}`);
    }
    return tabSize;
}

/** Nesting step width from a concrete indent sample (spaces length, or tabSize if tabs). */
export function indentUnit(sample: string, tabSize: number): number {
    if (sample.length === 0) {
        throw new Error('indentUnit: empty indent sample');
    }
    if (sample.includes('\t')) return normalizeTabSize(tabSize);
    return sample.length;
}

const indentUnitDocCache = new WeakMap<object, number>();

/** Smallest positive nested-list indent delta in the document. */
export function indentUnitFromDoc(
    doc: { lines: number; line: (n: number) => { text: string } },
    tabSize: number,
): number {
    if (doc && typeof doc === 'object') {
        const cached = indentUnitDocCache.get(doc);
        if (typeof cached === 'number') return cached;
    }

    let best = Number.POSITIVE_INFINITY;
    let prevIndent: number | null = null;
    for (let i = 1; i <= doc.lines; i++) {
        const parsed = parseLine(doc.line(i).text, tabSize);
        if (!isListLine(parsed)) continue;
        if (prevIndent !== null && parsed.indent.width > prevIndent) {
            const delta = parsed.indent.width - prevIndent;
            if (delta > 0 && delta < best) best = delta;
        }
        prevIndent = parsed.indent.width;
    }
    if (!isFinite(best)) {
        throw new Error('indentUnitFromDoc: document has no nested list sample');
    }
    if (doc && typeof doc === 'object') {
        indentUnitDocCache.set(doc, best);
    }
    return best;
}
