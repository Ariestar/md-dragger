import type { Doc } from '../markdown/document-types';
import type { ParsedLine } from '../parse/types';
import { isListLine, listMarkerText, listMarkerType } from '../parse/parse-line';
import type { TextChange } from './block-transaction';

export function planOrderedListRenumberChanges(
    doc: Doc,
    parse: (line: string) => ParsedLine,
    lineNumber: number
): TextChange[] {
    if (lineNumber < 1 || lineNumber > doc.lines) return [];

    const findOrderedAt = (n: number) => {
        const parsed = parse(doc.line(n).text);
        if (isListLine(parsed) && listMarkerType(parsed) === 'ordered') {
            return { indentWidth: parsed.indent.width, quoteDepth: parsed.quote.depth };
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
        const parsed = parse(line.text);
        if (
            !isListLine(parsed)
            || listMarkerType(parsed) !== 'ordered'
            || parsed.indent.width !== anchor.indentWidth
        ) {
            continue;
        }

        const newMarker = `${number}. `;
        const markerStart = line.from + parsed.quote.prefix.length + parsed.indent.raw.length;
        const markerEnd = markerStart + listMarkerText(parsed).length;
        changes.push({ from: markerStart, to: markerEnd, insert: newMarker });
        number += 1;
    }

    return changes;
}
