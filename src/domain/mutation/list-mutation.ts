import { BlockType } from '../block/block-types';
import type { Doc, ListContext, ListContextValue } from '../markdown/document-types';
import type { ParsedLine } from '../parse/types';
import { isListLine, listMarkerType } from '../parse/parse-line';

export interface ListContextNearLineOptions {
    scanUp?: number;
    scanDown?: number;
    skipBlankLines?: boolean;
    stopAtNonListContent?: boolean;
}

function parseListContextFromLine(
    doc: Doc,
    lineNumber: number,
    parse: (line: string) => ParsedLine
): { context: ListContextValue | null; isBlank: boolean; isList: boolean } {
    if (lineNumber < 1 || lineNumber > doc.lines) {
        return { context: null, isBlank: true, isList: false };
    }
    const text = doc.line(lineNumber).text;
    const isBlank = text.trim().length === 0;
    const parsed = parse(text);
    if (!isListLine(parsed)) {
        return { context: null, isBlank, isList: false };
    }
    return {
        context: {
            indentWidth: parsed.indent.width,
            indentRaw: parsed.indent.raw,
            markerType: listMarkerType(parsed) ?? 'unordered',
        },
        isBlank,
        isList: true,
    };
}

export function getListContextNearLine(
    doc: Doc,
    lineNumber: number,
    parse: (line: string) => ParsedLine,
    options?: ListContextNearLineOptions
): ListContext {
    const scanUp = Math.max(0, options?.scanUp ?? 8);
    const scanDown = Math.max(0, options?.scanDown ?? 3);
    const skipBlankLines = options?.skipBlankLines ?? true;
    const stopAtNonListContent = options?.stopAtNonListContent ?? true;

    const current = parseListContextFromLine(doc, lineNumber, parse);
    if (current.context) return current.context;
    if (!skipBlankLines && current.isBlank) return null;

    let stopUp = false;
    let stopDown = false;
    for (let distance = 1; distance <= Math.max(scanUp, scanDown); distance++) {
        if (!stopUp && distance <= scanUp) {
            const upLineNumber = lineNumber - distance;
            if (upLineNumber >= 1) {
                const up = parseListContextFromLine(doc, upLineNumber, parse);
                if (up.context) return up.context;
                if (!up.isBlank && !up.isList && stopAtNonListContent) {
                    stopUp = true;
                }
            }
        }

        if (!stopDown && distance <= scanDown) {
            const downLineNumber = lineNumber + distance;
            if (downLineNumber <= doc.lines) {
                const down = parseListContextFromLine(doc, downLineNumber, parse);
                if (down.context) return down.context;
                if (!down.isBlank && !down.isList && stopAtNonListContent) {
                    stopDown = true;
                }
            }
        }

        if (stopUp && stopDown) break;
    }

    return null;
}

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

export interface ListIndentPlan {
    listContextLineNumber: number;
    targetContext: ListContext;
    indentSample: string;
    indentUnitWidth: number;
    indentDelta: number;
    targetIndentWidth: number;
    sourceBaseIndentWidth: number;
}

export function computeListIndentPlan(params: {
    doc: Doc;
    sourceBase: { indentWidth: number; indentRaw: string };
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getListContext?: (doc: Doc, lineNumber: number) => ListContext;
    targetIndentWidth?: number;
    contextLineNumber?: number;
}): ListIndentPlan {
    const {
        doc,
        sourceBase,
        targetLineNumber,
        parseLineWithQuote,
        getListContext: getListContextFn,
        targetIndentWidth: explicitTargetIndent,
        contextLineNumber,
    } = params;

    const listContextLineNumber = contextLineNumber ?? targetLineNumber;
    const targetContext = getListContextFn
        ? getListContextFn(doc, listContextLineNumber)
        : getListContextNearLine(doc, listContextLineNumber, parseLineWithQuote);
    const indentSample = targetContext ? targetContext.indentRaw : sourceBase.indentRaw;

    const indentDelta = typeof explicitTargetIndent === 'number'
        ? explicitTargetIndent - sourceBase.indentWidth
        : (targetContext ? targetContext.indentWidth : 0) - sourceBase.indentWidth;

    return {
        listContextLineNumber,
        targetContext,
        indentSample,
        indentUnitWidth: Math.abs(indentDelta),
        indentDelta,
        targetIndentWidth: sourceBase.indentWidth + indentDelta,
        sourceBaseIndentWidth: sourceBase.indentWidth,
    };
}

export function adjustListToTargetContext(params: {
    doc: Doc;
    sourceContent: string;
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    buildIndentStringFromSample: (sample: string, width: number) => string;
    getListContext?: (doc: Doc, lineNumber: number) => ListContext;
    targetIndentWidth?: number;
    contextLineNumber?: number;
}): string {
    const {
        doc,
        sourceContent,
        targetLineNumber,
        parseLineWithQuote,
        buildIndentStringFromSample: buildIndent,
        getListContext: getListContextFn,
        targetIndentWidth,
        contextLineNumber,
    } = params;

    const lines = sourceContent.split('\n');
    const sourceBase = getSourceListBase(lines, parseLineWithQuote);
    if (!sourceBase) return sourceContent;
    const indentPlan = computeListIndentPlan({
        doc,
        sourceBase,
        targetLineNumber,
        parseLineWithQuote,
        getListContext: getListContextFn,
        targetIndentWidth,
        contextLineNumber,
    });

    const quoteAdjustedLines = lines.map((line) => {
        if (line.trim().length === 0) return line;
        const parsed = parseLineWithQuote(line);
        const afterIndent = (() => {
            // rest after quote = indent.raw + marker + body (or body only)
            if (parsed.marker && 'text' in parsed.marker) {
                return parsed.indent.raw + parsed.marker.text + parsed.body;
            }
            return parsed.indent.raw + parsed.body;
        })();

        if (!isListLine(parsed)) {
            if (parsed.indent.width >= sourceBase.indentWidth) {
                const newIndent = buildIndent(
                    indentPlan.indentSample,
                    parsed.indent.width + indentPlan.indentDelta
                );
                return `${parsed.quote.prefix}${newIndent}${afterIndent.slice(parsed.indent.raw.length)}`;
            }
            return line;
        }

        const newIndent = buildIndent(
            indentPlan.indentSample,
            parsed.indent.width + indentPlan.indentDelta
        );
        const markerText = parsed.marker && parsed.marker.kind === 'list' ? parsed.marker.text : '';
        return `${parsed.quote.prefix}${newIndent}${markerText}${parsed.body}`;
    });

    return quoteAdjustedLines.join('\n');
}

export function buildInsertText(params: {
    sourceBlockType: BlockType;
    sourceContent: string;
    adjustListToTargetContext: (sourceContent: string) => string;
}): string {
    const {
        sourceBlockType,
        sourceContent,
        adjustListToTargetContext: adjustList,
    } = params;

    let text = sourceContent;
    if (sourceBlockType !== BlockType.Blockquote) {
        text = adjustList(text);
    }
    text += '\n';
    return text;
}
