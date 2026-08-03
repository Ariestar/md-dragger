import {
    isCalloutLine,
    isCodeFenceLine,
    isHorizontalRuleLine,
    isMathFenceLine,
    isTableLine,
} from '../block/block-guards';
import type { MarkerType } from '../markdown/document-types';
import type { Indent, LineMarker, ParsedLine } from './types';

function indentWidth(raw: string, tabSize: number): number {
    let width = 0;
    for (const ch of raw) {
        width += ch === '\t' ? tabSize : 1;
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
    const { prefix, depth, rest } = splitQuote(text);
    const { indent, marker, body } = parseMarkerAndBody(rest);
    return {
        raw: text,
        quote: { depth, prefix },
        indent: {
            raw: indent.raw,
            width: indentWidth(indent.raw, tabSize),
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
    const safeWidth = Math.max(0, width);
    if (safeWidth === 0) return '';
    if (sample.includes('\t')) {
        const tabs = Math.floor(safeWidth / tabSize);
        const spaces = safeWidth - tabs * tabSize;
        return '\t'.repeat(tabs) + ' '.repeat(spaces);
    }
    return ' '.repeat(safeWidth);
}
