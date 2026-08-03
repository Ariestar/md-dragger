import { isCalloutLine, isHorizontalRuleLine } from '../block/block-guards';
import { isListLine, parseLine } from '../parse/parse-line';
import type { Doc } from './document-types';

export interface LineMeta {
    isEmpty: boolean;
    isList: boolean;
    isQuote: boolean;
    isCallout: boolean;
    isTable: boolean;
    isHr: boolean;
    indentWidth: number;
    quoteDepth: number;
}

export interface LineMap {
    doc: Doc;
    lineMeta: LineMeta[];
    prevNonEmpty: Int32Array;
    nextNonEmpty: Int32Array;
    prevListLine: Int32Array;
    listParentLine: Int32Array;
    listSubtreeEndLine: Int32Array;
    tabSize: number;
}

const lineMapCache = new WeakMap<object, Map<number, LineMap>>();

const EMPTY_LINE_META: LineMeta = {
    isEmpty: true,
    isList: false,
    isQuote: false,
    isCallout: false,
    isTable: false,
    isHr: false,
    indentWidth: 0,
    quoteDepth: 0,
};

function createLineMetaFromText(text: string, tabSize: number): LineMeta {
    const parsed = parseLine(text, tabSize);
    const isEmpty = text.trim().length === 0;
    return {
        isEmpty,
        isList: isListLine(parsed),
        isQuote: parsed.quote.depth > 0,
        isCallout: isCalloutLine(text),
        isTable: text.trimStart().startsWith('|'),
        isHr: isHorizontalRuleLine(text),
        indentWidth: parsed.indent.width,
        quoteDepth: parsed.quote.depth,
    };
}

function createLineMetaArray(doc: Doc, tabSize: number): LineMeta[] {
    const lineMeta = Array<LineMeta>(doc.lines + 1);
    lineMeta[0] = EMPTY_LINE_META;
    for (let i = 1; i <= doc.lines; i++) {
        lineMeta[i] = createLineMetaFromText(doc.line(i).text ?? '', tabSize);
    }
    return lineMeta;
}

function buildLineMapIndexes(
    lineMeta: LineMeta[],
    totalLines: number,
): {
    prevNonEmpty: Int32Array;
    nextNonEmpty: Int32Array;
    prevListLine: Int32Array;
    listParentLine: Int32Array;
    listSubtreeEndLine: Int32Array;
} {
    const prevNonEmpty = new Int32Array(totalLines + 2);
    const nextNonEmpty = new Int32Array(totalLines + 2);
    const prevListLine = new Int32Array(totalLines + 2);
    const listParentLine = new Int32Array(totalLines + 2);
    const listSubtreeEndLine = new Int32Array(totalLines + 2);

    let previous = 0;
    let previousList = 0;
    const listStack: number[] = [];
    for (let i = 1; i <= totalLines; i++) {
        const meta = lineMeta[i] ?? EMPTY_LINE_META;
        if (!meta.isEmpty) {
            previous = i;
        }
        prevNonEmpty[i] = previous;

        if (meta.isEmpty) {
            prevListLine[i] = previousList;
            continue;
        }

        while (listStack.length > 0) {
            const topLine = listStack[listStack.length - 1];
            const topMeta = lineMeta[topLine] ?? EMPTY_LINE_META;
            if (meta.indentWidth > topMeta.indentWidth) {
                break;
            }
            listStack.pop();
        }

        for (const ancestorLine of listStack) {
            listSubtreeEndLine[ancestorLine] = i;
        }

        prevListLine[i] = previousList;
        if (!meta.isList) {
            continue;
        }
        listParentLine[i] = listStack.length > 0 ? listStack[listStack.length - 1] : 0;
        listSubtreeEndLine[i] = i;
        listStack.push(i);
        previousList = i;
    }

    let next = 0;
    for (let i = totalLines; i >= 1; i--) {
        const meta = lineMeta[i] ?? EMPTY_LINE_META;
        if (!meta.isEmpty) {
            next = i;
        }
        nextNonEmpty[i] = next;
    }

    return {
        prevNonEmpty,
        nextNonEmpty,
        prevListLine,
        listParentLine,
        listSubtreeEndLine,
    };
}

function createLineMapFromMeta(doc: Doc, tabSize: number, lineMeta: LineMeta[]): LineMap {
    const indexes = buildLineMapIndexes(lineMeta, doc.lines);
    return {
        doc,
        lineMeta,
        prevNonEmpty: indexes.prevNonEmpty,
        nextNonEmpty: indexes.nextNonEmpty,
        prevListLine: indexes.prevListLine,
        listParentLine: indexes.listParentLine,
        listSubtreeEndLine: indexes.listSubtreeEndLine,
        tabSize,
    };
}

export function buildLineMap(doc: Doc, options: { tabSize: number }): LineMap {
    const tabSize = options.tabSize;
    const lineMeta = createLineMetaArray(doc, tabSize);
    return createLineMapFromMeta(doc, tabSize, lineMeta);
}

function getCachedLineMapForDoc(doc: Doc | null | undefined, tabSize: number): LineMap | null {
    if (!doc || typeof doc !== 'object') return null;
    return lineMapCache.get(doc)?.get(tabSize) ?? null;
}

function setCachedLineMapForDoc(doc: Doc, tabSize: number, lineMap: LineMap): void {
    const byTabSize = lineMapCache.get(doc);
    if (byTabSize) {
        byTabSize.set(tabSize, lineMap);
        return;
    }
    lineMapCache.set(doc, new Map<number, LineMap>([[tabSize, lineMap]]));
}

export function getLineMap(doc: Doc, options: { tabSize: number }): LineMap {
    const tabSize = options.tabSize;
    if (!doc || typeof doc !== 'object') {
        return buildLineMap(doc, { tabSize });
    }
    const cached = getCachedLineMapForDoc(doc, tabSize);
    if (cached) {
        return cached;
    }

    const built = buildLineMap(doc, { tabSize });
    setCachedLineMapForDoc(doc, tabSize, built);
    return built;
}

export function peekCachedLineMap(doc: Doc, options: { tabSize: number }): LineMap | null {
    const tabSize = options.tabSize;
    if (!doc || typeof doc !== 'object') return null;
    return getCachedLineMapForDoc(doc, tabSize);
}

export function getLineMetaAt(lineMap: LineMap, lineNumber: number): LineMeta | null {
    if (lineNumber < 1 || lineNumber >= lineMap.lineMeta.length) return null;
    return lineMap.lineMeta[lineNumber] ?? null;
}

export function listLineAtOrAbove(lineMap: LineMap, lineNumber: number): number | null {
    if (lineMap.doc.lines <= 0) return null;
    const clamped = Math.max(1, Math.min(lineMap.doc.lines, lineNumber));
    const meta = getLineMetaAt(lineMap, clamped);
    if (meta?.isList) return clamped;
    const prevListLine = lineMap.prevListLine[clamped];
    return prevListLine > 0 ? prevListLine : null;
}
