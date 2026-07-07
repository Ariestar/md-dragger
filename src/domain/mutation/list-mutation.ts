import { BlockType } from '../block/block-types';
import type { ListDropTarget } from '../command/drop-target';
import { DocLike, ListContext, ListContextValue, ParsedLine } from '../markdown/document-types';

export function getListContext(
    doc: DocLike,
    lineNumber: number,
    parseLineWithQuote: (line: string) => ParsedLine
): ListContext {
    return getListContextNearLine(doc, lineNumber, parseLineWithQuote);
}

export interface ListContextNearLineOptions {
    scanUp?: number;
    scanDown?: number;
    skipBlankLines?: boolean;
    stopAtNonListContent?: boolean;
}

function parseListContextFromLine(
    doc: DocLike,
    lineNumber: number,
    parseLineWithQuote: (line: string) => ParsedLine
): { context: ListContextValue | null; isBlank: boolean; isList: boolean } {
    if (lineNumber < 1 || lineNumber > doc.lines) {
        return { context: null, isBlank: true, isList: false };
    }
    const text = doc.line(lineNumber).text;
    const isBlank = text.trim().length === 0;
    const parsed = parseLineWithQuote(text);
    if (!parsed.isListItem) {
        return { context: null, isBlank, isList: false };
    }
    return {
        context: {
            indentWidth: parsed.indentWidth,
            indentRaw: parsed.indentRaw,
            markerType: parsed.markerType,
        },
        isBlank,
        isList: true,
    };
}

export function getListContextNearLine(
    doc: DocLike,
    lineNumber: number,
    parseLineWithQuote: (line: string) => ParsedLine,
    options?: ListContextNearLineOptions
): ListContext {
    const scanUp = Math.max(0, options?.scanUp ?? 8);
    const scanDown = Math.max(0, options?.scanDown ?? 3);
    const skipBlankLines = options?.skipBlankLines ?? true;
    const stopAtNonListContent = options?.stopAtNonListContent ?? true;

    const current = parseListContextFromLine(doc, lineNumber, parseLineWithQuote);
    if (current.context) return current.context;
    if (!skipBlankLines && current.isBlank) return null;

    let stopUp = false;
    let stopDown = false;
    for (let distance = 1; distance <= Math.max(scanUp, scanDown); distance++) {
        if (!stopUp && distance <= scanUp) {
            const upLineNumber = lineNumber - distance;
            if (upLineNumber >= 1) {
                const up = parseListContextFromLine(doc, upLineNumber, parseLineWithQuote);
                if (up.context) return up.context;
                if (!up.isBlank && !up.isList && stopAtNonListContent) {
                    stopUp = true;
                }
            }
        }

        if (!stopDown && distance <= scanDown) {
            const downLineNumber = lineNumber + distance;
            if (downLineNumber <= doc.lines) {
                const down = parseListContextFromLine(doc, downLineNumber, parseLineWithQuote);
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
    parseLineWithQuote: (line: string) => ParsedLine
): { indentWidth: number; indentRaw: string } | null {
    for (const line of lines) {
        const parsed = parseLineWithQuote(line);
        if (parsed.isListItem) {
            return { indentWidth: parsed.indentWidth, indentRaw: parsed.indentRaw };
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
    doc: DocLike;
    sourceBase: { indentWidth: number; indentRaw: string };
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getIndentUnitWidth: (sample: string) => number;
    getListContext?: (doc: DocLike, lineNumber: number) => ListContext;
    listIntent?: ListDropTarget;
}): ListIndentPlan {
    const {
        doc,
        sourceBase,
        targetLineNumber,
        parseLineWithQuote,
        getIndentUnitWidth: getIndentUnitWidthFn,
        getListContext: getListContextFn,
        listIntent,
    } = params;

    const listContextLineNumber = listIntent?.contextLineNumber ?? targetLineNumber;
    const targetContext = getListContextFn
        ? getListContextFn(doc, listContextLineNumber)
        : getListContextNearLine(doc, listContextLineNumber, parseLineWithQuote);
    const indentSample = targetContext ? targetContext.indentRaw : sourceBase.indentRaw;
    const indentUnitWidth = getIndentUnitWidthFn(indentSample || sourceBase.indentRaw);
    const indentDeltaBase = (targetContext ? targetContext.indentWidth : 0) - sourceBase.indentWidth;
    const intentIndentDelta = listIntent?.mode === 'child'
        ? 1
        : listIntent?.mode === 'outdent'
            ? -1
            : 0;
    let indentDelta = indentDeltaBase + (intentIndentDelta * indentUnitWidth);

    if (typeof listIntent?.targetIndentWidth === 'number') {
        indentDelta = listIntent.targetIndentWidth - sourceBase.indentWidth;
    }

    return {
        listContextLineNumber,
        targetContext,
        indentSample,
        indentUnitWidth,
        indentDelta,
        targetIndentWidth: sourceBase.indentWidth + indentDelta,
        sourceBaseIndentWidth: sourceBase.indentWidth,
    };
}

export function adjustListToTargetContext(params: {
    doc: DocLike;
    sourceContent: string;
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getIndentUnitWidth: (sample: string) => number;
    buildIndentStringFromSample: (sample: string, width: number) => string;
    getListContext?: (doc: DocLike, lineNumber: number) => ListContext;
    listIntent?: ListDropTarget;
}): string {
    const {
        doc,
        sourceContent,
        targetLineNumber,
        parseLineWithQuote,
        getIndentUnitWidth: getIndentUnitWidthFn,
        buildIndentStringFromSample: buildIndentStringFromSampleFn,
        getListContext: getListContextFn,
        listIntent,
    } = params;

    const lines = sourceContent.split('\n');
    const sourceBase = getSourceListBase(lines, parseLineWithQuote);
    if (!sourceBase) return sourceContent;
    const indentPlan = computeListIndentPlan({
        doc,
        sourceBase,
        targetLineNumber,
        parseLineWithQuote,
        getIndentUnitWidth: getIndentUnitWidthFn,
        getListContext: getListContextFn,
        listIntent,
    });

    const quoteAdjustedLines = lines.map((line) => {
        if (line.trim().length === 0) return line;
        const parsed = parseLineWithQuote(line);
        const rest = parsed.rest;
        if (!parsed.isListItem) {
            if (parsed.indentWidth >= sourceBase.indentWidth) {
                const newIndent = buildIndentStringFromSampleFn(
                    indentPlan.indentSample,
                    parsed.indentWidth + indentPlan.indentDelta
                );
                return `${parsed.quotePrefix}${newIndent}${rest.slice(parsed.indentRaw.length)}`;
            }
            return line;
        }

        const newIndent = buildIndentStringFromSampleFn(
            indentPlan.indentSample,
            parsed.indentWidth + indentPlan.indentDelta
        );
        return `${parsed.quotePrefix}${newIndent}${parsed.marker}${parsed.content}`;
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
        adjustListToTargetContext: adjustListToTargetContextFn,
    } = params;

    let text = sourceContent;

    // Quote line moves should behave like plain text moves:
    // keep source content unchanged instead of re-shaping markers/indent by target list context.
    if (sourceBlockType !== BlockType.Blockquote) {
        text = adjustListToTargetContextFn(text);
    }

    text += '\n';
    return text;
}
