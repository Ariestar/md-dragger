import type { ParsedLine, DocLikeWithRange } from '../markdown/document-types';
import type { TextChange } from './block-transaction';

export function planOrderedListRenumberChanges(
    doc: DocLikeWithRange,
    parseLineWithQuote: (line: string) => ParsedLine,
    lineNumber: number
): TextChange[] {
    if (lineNumber < 1 || lineNumber > doc.lines) return [];

    const findOrderedAt = (n: number) => {
        const parsed = parseLineWithQuote(doc.line(n).text);
        if (parsed.isListItem && parsed.markerType === 'ordered') {
            return { indentWidth: parsed.indentWidth, quoteDepth: parsed.quoteDepth };
        }
        return null;
    };

    let anchor = findOrderedAt(lineNumber);
    if (!anchor && lineNumber > 1) anchor = findOrderedAt(lineNumber - 1);
    if (!anchor && lineNumber < doc.lines) anchor = findOrderedAt(lineNumber + 1);
    if (!anchor) return [];

    let start = lineNumber;
    while (start > 1) {
        const info = findOrderedAt(start - 1);
        if (!info || info.indentWidth !== anchor.indentWidth || info.quoteDepth !== anchor.quoteDepth) break;
        start -= 1;
    }

    let end = lineNumber;
    while (end < doc.lines) {
        const info = findOrderedAt(end + 1);
        if (!info || info.indentWidth !== anchor.indentWidth || info.quoteDepth !== anchor.quoteDepth) break;
        end += 1;
    }

    const changes: TextChange[] = [];
    let number = 1;
    for (let i = start; i <= end; i++) {
        const line = doc.line(i);
        const parsed = parseLineWithQuote(line.text);
        if (!parsed.isListItem || parsed.markerType !== 'ordered' || parsed.indentWidth !== anchor.indentWidth) continue;

        const newMarker = `${number}. `;
        const markerStart = line.from + parsed.quotePrefix.length + parsed.indentRaw.length;
        const markerEnd = markerStart + parsed.marker.length;
        changes.push({ from: markerStart, to: markerEnd, insert: newMarker });
        number += 1;
    }

    return changes;
}
