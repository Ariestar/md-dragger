import type { Doc } from '../markdown/document-types';
import { BlockType, type Block } from './block-types';
import { getLineMap, getLineMetaAt, peekCachedLineMap } from '../markdown/line-map';
import { isTableLine } from './block-guards';
import { findCodeBlockRange, findMathBlockRange } from '../markdown/fence-scanner';
import { parseLine, isListLine } from '../parse/parse-line';

/**
 * Detect block type from one line of text (uses parseLine — single classification path).
 */
export function detectBlockType(lineText: string, tabSize: number): BlockType {
    const p = parseLine(lineText, tabSize);
    if (p.marker?.kind === 'heading') return BlockType.Heading;
    if (p.marker?.kind === 'hr') return BlockType.HorizontalRule;
    if (p.marker?.kind === 'list') return BlockType.ListItem;
    if (p.marker?.kind === 'fence') {
        return p.marker.fence === 'code' ? BlockType.CodeBlock : BlockType.MathBlock;
    }
    if (p.marker?.kind === 'table-row') return BlockType.Table;
    if (p.marker?.kind === 'callout') return BlockType.Callout;
    if (p.quote.depth > 0) return BlockType.Blockquote;
    if (p.body.trim().length === 0 && !p.marker) return BlockType.Unknown;
    return BlockType.Paragraph;
}

export function getHeadingLevel(lineText: string, tabSize: number): number | null {
    const p = parseLine(lineText, tabSize);
    return p.marker?.kind === 'heading' ? p.marker.level : null;
}

export function getHeadingSectionRange(doc: Doc, lineNumber: number, tabSize: number): { startLine: number; endLine: number } | null {
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const currentHeadingLevel = getHeadingLevel(doc.line(lineNumber).text, tabSize);
    if (!currentHeadingLevel) return null;

    let endLine = lineNumber;
    for (let i = lineNumber + 1; i <= doc.lines; i++) {
        const nextHeadingLevel = getHeadingLevel(doc.line(i).text, tabSize);
        if (nextHeadingLevel !== null && nextHeadingLevel <= currentHeadingLevel) {
            break;
        }
        endLine = i;
    }

    return { startLine: lineNumber, endLine };
}

function isCalloutHeaderLine(text: string, tabSize: number): boolean {
    return parseLine(text, tabSize).marker?.kind === 'callout';
}

function isInsideCalloutContainer(doc: Doc, lineNumber: number, depth: number, tabSize: number): boolean {
    for (let i = lineNumber; i >= 1; i--) {
        const text = doc.line(i).text;
        const p = parseLine(text, tabSize);
        if (p.quote.depth === 0 || p.quote.depth < depth) break;
        if (p.marker?.kind === 'callout' || isCalloutHeaderLine(text, tabSize)) return true;
    }
    return false;
}

function getBlockquoteContainerRange(doc: Doc, lineNumber: number, depth: number, tabSize: number): { startLine: number; endLine: number } {
    let startLine = lineNumber;
    for (let i = lineNumber - 1; i >= 1; i--) {
        const d = parseLine(doc.line(i).text, tabSize).quote.depth;
        if (d === 0 || d < depth) break;
        startLine = i;
    }

    let endLine = lineNumber;
    for (let i = lineNumber + 1; i <= doc.lines; i++) {
        const d = parseLine(doc.line(i).text, tabSize).quote.depth;
        if (d === 0 || d < depth) break;
        endLine = i;
    }
    return { startLine, endLine };
}

function getListItemSubtreeRange(doc: Doc, lineNumber: number, tabSize: number): { startLine: number; endLine: number } {
    const current = parseLine(doc.line(lineNumber).text, tabSize);
    const currentIndent = current.indent.width;
    let endLine = lineNumber;

    for (let i = lineNumber + 1; i <= doc.lines; i++) {
        const nextText = doc.line(i).text;

        if (nextText.trim().length === 0) {
            const lookahead = findNextNonEmptyLine(doc, i + 1, tabSize);
            if (
                !lookahead
                || (lookahead.isList && lookahead.indentWidth <= currentIndent)
                || lookahead.indentWidth <= currentIndent
            ) {
                break;
            }
            endLine = i;
            continue;
        }

        const next = parseLine(nextText, tabSize);
        if (isListLine(next) && next.indent.width <= currentIndent) {
            break;
        }

        if (isListLine(next) || next.indent.width > currentIndent) {
            endLine = i;
            continue;
        }

        break;
    }

    return { startLine: lineNumber, endLine };
}

function findNextNonEmptyLine(
    doc: Doc,
    fromLine: number,
    tabSize: number
): { isList: boolean; indentWidth: number } | null {
    for (let i = fromLine; i <= doc.lines; i++) {
        const text = doc.line(i).text;
        if (text.trim().length === 0) continue;
        const p = parseLine(text, tabSize);
        return { isList: isListLine(p), indentWidth: p.indent.width };
    }
    return null;
}

const blockDetectionCache = new WeakMap<Doc, Map<number, Map<number, Block | null>>>();
const LINE_MAP_EAGER_MAX = 30_000;

const YAML_FENCE_RE = /^-{3}\s*$/;
const yamlEndCache = new WeakMap<Doc, number>();

function yamlEndLine(doc: Doc): number {
    const cached = yamlEndCache.get(doc);
    if (cached !== undefined) return cached;

    let endLine = 0;
    if (doc.lines >= 2 && YAML_FENCE_RE.test(doc.line(1).text)) {
        for (let i = 2; i <= doc.lines; i++) {
            if (YAML_FENCE_RE.test(doc.line(i).text)) {
                endLine = i;
                break;
            }
        }
    }
    yamlEndCache.set(doc, endLine);
    return endLine;
}

function inYamlFrontmatter(doc: Doc, lineNumber: number): boolean {
    const endLine = yamlEndLine(doc);
    return endLine > 0 && lineNumber >= 1 && lineNumber <= endLine;
}

type DetectPerfKey = 'detect_block_uncached';

let detectBlockPerfRecorder: ((key: DetectPerfKey, durationMs: number) => void) | null = null;

function recordDetectPerf(key: DetectPerfKey, durationMs: number): void {
    if (!detectBlockPerfRecorder) return;
    if (!isFinite(durationMs) || durationMs < 0) return;
    detectBlockPerfRecorder(key, durationMs);
}

export function setDetectPerf(
    recorder: ((key: DetectPerfKey, durationMs: number) => void) | null
): void {
    detectBlockPerfRecorder = recorder;
}

function detectBlockUncached(doc: Doc, lineNumber: number, tabSize: number): Block | null {
    if (lineNumber < 1 || lineNumber > doc.lines) {
        return null;
    }

    if (inYamlFrontmatter(doc, lineNumber)) {
        return null;
    }

    const lineText = doc.line(lineNumber).text;
    let blockType = detectBlockType(lineText, tabSize);

    const codeRange = findCodeBlockRange(doc, lineNumber);
    const mathRange = findMathBlockRange(doc, lineNumber);
    if (codeRange) {
        blockType = BlockType.CodeBlock;
    }
    if (mathRange) {
        blockType = BlockType.MathBlock;
    }

    if (blockType === BlockType.Unknown) {
        return null;
    }

    let startLine = lineNumber;
    let endLine = lineNumber;

    if (blockType === BlockType.CodeBlock && codeRange) {
        startLine = codeRange.startLine;
        endLine = codeRange.endLine;
    }

    if (blockType === BlockType.MathBlock && mathRange) {
        startLine = mathRange.startLine;
        endLine = mathRange.endLine;
    }

    if (blockType === BlockType.ListItem) {
        let lineMap = peekCachedLineMap(doc, { tabSize });
        if (!lineMap && doc.lines <= LINE_MAP_EAGER_MAX) {
            lineMap = getLineMap(doc, { tabSize });
        }

        const lineMeta = lineMap ? getLineMetaAt(lineMap, lineNumber) : null;
        const subtreeEndLine = lineMeta?.isList && lineMap
            ? lineMap.listSubtreeEndLine[lineNumber]
            : 0;

        if (subtreeEndLine >= lineNumber) {
            endLine = subtreeEndLine;
        } else {
            endLine = getListItemSubtreeRange(doc, lineNumber, tabSize).endLine;
        }
    }

    if (blockType === BlockType.Blockquote || blockType === BlockType.Callout) {
        const quoteDepth = parseLine(lineText, tabSize).quote.depth;
        const inCallout = blockType === BlockType.Callout
            || isInsideCalloutContainer(doc, lineNumber, quoteDepth, tabSize);
        if (inCallout) {
            const range = getBlockquoteContainerRange(doc, lineNumber, quoteDepth, tabSize);
            startLine = range.startLine;
            endLine = range.endLine;
            blockType = BlockType.Callout;
        } else {
            startLine = lineNumber;
            endLine = lineNumber;
            blockType = BlockType.Blockquote;
        }
    }

    if (blockType === BlockType.Table) {
        for (let i = lineNumber - 1; i >= 1; i--) {
            if (isTableLine(doc.line(i).text)) startLine = i;
            else break;
        }
        for (let i = lineNumber + 1; i <= doc.lines; i++) {
            if (isTableLine(doc.line(i).text)) endLine = i;
            else break;
        }
    }

    return {
        type: blockType,
        lines: { startLine, endLine },
    };
}

function nowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

export function detectBlock(
    doc: Doc,
    lineNumber: number,
    options: { tabSize: number }
): Block | null {
    const tabSize = options.tabSize;

    let cacheByTabSize = blockDetectionCache.get(doc);
    if (!cacheByTabSize) {
        cacheByTabSize = new Map<number, Map<number, Block | null>>();
        blockDetectionCache.set(doc, cacheByTabSize);
    }
    let perDocCache = cacheByTabSize.get(tabSize);
    if (!perDocCache) {
        perDocCache = new Map<number, Block | null>();
        cacheByTabSize.set(tabSize, perDocCache);
    }

    if (perDocCache.has(lineNumber)) {
        return perDocCache.get(lineNumber) ?? null;
    }

    const started = nowMs();
    const block = detectBlockUncached(doc, lineNumber, tabSize);
    recordDetectPerf('detect_block_uncached', nowMs() - started);

    // Cache every line of the block for this query
    if (block) {
        for (let n = block.lines.startLine; n <= block.lines.endLine; n++) {
            perDocCache.set(n, block);
        }
    } else {
        perDocCache.set(lineNumber, null);
    }

    return block;
}
