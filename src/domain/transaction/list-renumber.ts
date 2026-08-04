import type { Doc } from '../markdown/document-types';
import { isListLine, listMarkerText, listMarkerType } from '../parse/parse-line';
import type { ParsedLine } from '../parse/types';
import type { TextChange } from './block-transaction';

/**
 * Renumber one contiguous ordered-list run that contains `line`
 * (same indent + quote depth). Returns marker-only TextChanges on `doc`.
 */
export function renumberList(doc: Doc, parse: (line: string) => ParsedLine, line: number): TextChange[] {
    if (line < 1 || line > doc.lines) return [];

    const at = (n: number) => {
        const p = parse(doc.line(n).text);
        if (!isListLine(p) || listMarkerType(p) !== 'ordered') return null;
        return { indent: p.indent.width, quote: p.quote.depth, p };
    };

    let seed = at(line);
    if (!seed && line > 1) seed = at(line - 1);
    if (!seed && line < doc.lines) seed = at(line + 1);
    if (!seed) return [];

    let start = line;
    while (start > 1) {
        const prev = at(start - 1);
        if (!prev || prev.indent !== seed.indent || prev.quote !== seed.quote) break;
        start -= 1;
    }

    let end = line;
    while (end < doc.lines) {
        const next = at(end + 1);
        if (!next || next.indent !== seed.indent || next.quote !== seed.quote) break;
        end += 1;
    }

    const changes: TextChange[] = [];
    let n = 1;
    for (let i = start; i <= end; i++) {
        const row = at(i);
        if (!row) continue;
        const lineObj = doc.line(i);
        const marker = listMarkerText(row.p);
        const from = lineObj.from + row.p.quote.prefix.length + row.p.indent.raw.length;
        const to = from + marker.length;
        const insert = `${n}. `;
        if (marker !== insert) {
            changes.push({ from, to, insert });
        }
        n += 1;
    }
    return changes;
}

/**
 * Renumber every ordered-list run touched by a move, identified by anchor
 * rows around its insertion/deletion boundaries. Runs elsewhere in the
 * document are left alone — a move must not rewrite unrelated numbering.
 * Identical changes (the same run seen from two anchors) are emitted once.
 */
export function renumberRunsNear(doc: Doc, parse: (line: string) => ParsedLine, anchors: number[]): TextChange[] {
    const changes: TextChange[] = [];
    const seen = new Set<string>();
    for (const anchor of anchors) {
        for (const c of renumberList(doc, parse, anchor)) {
            const key = `${c.from}:${c.to}:${c.insert}`;
            if (seen.has(key)) continue;
            seen.add(key);
            changes.push(c);
        }
    }
    return changes;
}
