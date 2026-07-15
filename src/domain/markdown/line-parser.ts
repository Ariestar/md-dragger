/**
 * Thin re-exports for call sites still under markdown/.
 * Prefer: import { parseLine, formatIndent } from '../parse'
 */
export { parseLine, formatIndent, isListLine, listMarkerText, listMarkerType } from '../parse/parse-line';
export type { ParsedLine, Indent, LineMarker } from '../parse/types';

export function getIndentWidthFromIndentRaw(indentRaw: string, tabSize: number): number {
    const safeTabSize = tabSize > 0 ? tabSize : 4;
    let width = 0;
    for (const ch of indentRaw) {
        width += ch === '\t' ? safeTabSize : 1;
    }
    return width;
}

export function splitBlockquotePrefix(line: string): { prefix: string; rest: string } {
    const match = line.match(/^(\s*> ?)+/);
    if (!match) return { prefix: '', rest: line };
    return { prefix: match[0], rest: line.slice(match[0].length) };
}

export function getBlockquoteDepthFromLine(line: string): number {
    const match = line.match(/^(\s*> ?)+/);
    if (!match) return 0;
    return (match[0].match(/>/g) || []).length;
}
