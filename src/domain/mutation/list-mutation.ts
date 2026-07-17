import type { ParsedLine } from '../parse/types';
import { isListLine } from '../parse/parse-line';

/** First list line's indent in a multi-line source blob. */
export function getSourceListBase(
    lines: string[],
    parse: (line: string) => ParsedLine
): { indentWidth: number; indentRaw: string } | null {
    for (const line of lines) {
        const parsed = parse(line);
        if (isListLine(parsed)) {
            return { indentWidth: parsed.indent.width, indentRaw: parsed.indent.raw };
        }
    }
    return null;
}

/**
 * Shift every list line (and deeper continuations) so the root list indent
 * becomes targetIndentWidth. Structure-driven: caller supplies target from
 * dropIndentWidth(position); no scanning nearby doc lines for "context".
 */
export function relevelListText(params: {
    sourceContent: string;
    parse: (line: string) => ParsedLine;
    formatIndentFn: (sample: string, width: number) => string;
    targetIndentWidth: number;
}): string {
    const { sourceContent, parse, formatIndentFn, targetIndentWidth } = params;
    const lines = sourceContent.split('\n');
    const sourceBase = getSourceListBase(lines, parse);
    if (!sourceBase) return sourceContent;

    const delta = targetIndentWidth - sourceBase.indentWidth;
    if (delta === 0) return sourceContent;

    return lines.map((line) => {
        if (line.trim().length === 0) return line;
        const parsed = parse(line);
        const markerText = parsed.marker && parsed.marker.kind === 'list' ? parsed.marker.text : '';
        const afterIndent = markerText + parsed.body;

        if (!isListLine(parsed)) {
            if (parsed.indent.width >= sourceBase.indentWidth) {
                const newIndent = formatIndentFn(
                    sourceBase.indentRaw,
                    Math.max(0, parsed.indent.width + delta),
                );
                return `${parsed.quote.prefix}${newIndent}${afterIndent}`;
            }
            return line;
        }

        const newIndent = formatIndentFn(
            sourceBase.indentRaw,
            Math.max(0, parsed.indent.width + delta),
        );
        return `${parsed.quote.prefix}${newIndent}${markerText}${parsed.body}`;
    }).join('\n');
}
