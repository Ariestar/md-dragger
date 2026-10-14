import { detectBlock } from './block/block-detector';
import { formatBlockContent, resolveBlockTemplate, stripPrefix } from './block/block-type-conversion';
import type { Block } from './block/block-types';
import { BlockType } from './block/block-types';
import type { DropPosition } from './command/drop-position';
import type { Doc } from './markdown/document-types';
import { dropIndentWidth } from './markdown/drop-locate';
import { getLineMap, getLineMetaAt } from './markdown/line-map';
import { formatIndent, isListLine, listMarkerType, parseLine } from './parse/parse-line';
import type { ParsedLine } from './parse/types';
import { ADAPTABLE_BLOCKS } from './rules/insertion-rules';
import type { TextChange } from './transaction/block-transaction';

export function resolveInsertionChange(
    doc: Doc,
    targetLineNumber: number,
    insertText: string,
    options?: {
        lengthAfterDelete?: number;
    },
): { pos: number; text: string } {
    if (targetLineNumber <= doc.lines) {
        return {
            pos: doc.line(targetLineNumber).from,
            text: insertText,
        };
    }
    const normalized = insertText.endsWith('\n') ? insertText.slice(0, -1) : insertText;
    if (!normalized.length) {
        return { pos: doc.length, text: normalized };
    }
    const lengthAfterDelete = options?.lengthAfterDelete ?? doc.length;
    if (lengthAfterDelete <= 0) {
        return { pos: 0, text: normalized };
    }
    return {
        pos: doc.length,
        text: `\n${normalized}`,
    };
}

/** Rebase an end-of-document insertion planned against a stale snapshot. */
export function rebaseAppendChange(
    snapshotDoc: Doc,
    change: TextChange,
    currentDoc: Doc,
): { pos: number; text: string } | null {
    if (change.from !== snapshotDoc.length || change.to !== snapshotDoc.length || !change.insert.length) {
        return null;
    }
    const payload = snapshotDoc.length > 0 && change.insert.startsWith('\n') ? change.insert.slice(1) : change.insert;
    if (currentDoc.length > 0 && currentDoc.sliceString(currentDoc.length - 1, currentDoc.length) === '\n') {
        return { pos: currentDoc.length, text: payload };
    }
    return resolveInsertionChange(currentDoc, currentDoc.lines + 1, payload);
}

export function resolveDeleteRange(doc: Doc, sourceFrom: number, sourceTo: number): { from: number; to: number } {
    if (sourceTo < doc.length) {
        return {
            from: sourceFrom,
            to: Math.min(sourceTo + 1, doc.length),
        };
    }

    if (sourceFrom > 0) {
        return {
            from: sourceFrom - 1,
            to: sourceTo,
        };
    }

    return {
        from: sourceFrom,
        to: sourceTo,
    };
}

/** First list line's indent in a multi-line source blob. */
function getSourceListBase(
    lines: string[],
    parse: (line: string) => ParsedLine,
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

    return lines
        .map((line) => {
            if (line.trim().length === 0) return line;
            const parsed = parse(line);

            if (!isListLine(parsed) && parsed.indent.width < sourceBase.indentWidth) return line;
            const newIndent = formatIndentFn(sourceBase.indentRaw, Math.max(0, parsed.indent.width + delta));
            // The line's own text after its indent: a list marker, fence, table row, heading, rule or body.
            return `${parsed.quote.prefix}${newIndent}${line.slice(parsed.quote.prefix.length + parsed.indent.raw.length)}`;
        })
        .join('\n');
}

/**
 * Text to insert for a move: relevel list indent from DropPosition.parent only,
 * then ensure a trailing newline.
 */
function isBetweenListItems(doc: Doc, line: number, tabSize: number): boolean {
    if (line <= 1 || line > doc.lines) return false;
    const lineMap = getLineMap(doc, { tabSize });
    return !!getLineMetaAt(lineMap, line - 1)?.isList && !!getLineMetaAt(lineMap, line)?.isList;
}

export function insertTextForMove(params: {
    doc: Doc;
    sourceBlock: Block;
    targetLineNumber: number;
    sourceContent: string;
    position: DropPosition;
    tabSize: number;
    indentUnit: number;
}): string {
    const { doc, sourceBlock, sourceContent, position, tabSize, indentUnit } = params;

    const parse = (line: string) => parseLine(line, tabSize);
    let text = sourceContent;

    const targetListBlock =
        position.parent?.type === BlockType.ListItem
            ? position.parent
            : isBetweenListItems(doc, position.line, tabSize)
              ? detectBlock(doc, position.line, { tabSize })
              : null;

    if (sourceBlock.type !== BlockType.ListItem && ADAPTABLE_BLOCKS.has(sourceBlock.type) && targetListBlock) {
        const headText = doc.line(targetListBlock.lines.startLine).text;
        const parsedMarker = listMarkerType(parse(headText));
        const markerType = parsedMarker === 'ordered' ? 'ordered' : parsedMarker === 'task' ? 'task' : 'unordered';
        const template = resolveBlockTemplate({ type: BlockType.ListItem, markerType });
        text = formatBlockContent(text.split('\n').map(stripPrefix), template);
    }

    const nestList = sourceBlock.type === BlockType.ListItem || targetListBlock !== null;
    if (sourceBlock.type !== BlockType.Blockquote && nestList) {
        const targetIndentWidth = dropIndentWidth(position, { tabSize, indentUnit });
        text = relevelListText({
            sourceContent: text,
            parse,
            formatIndentFn: (sample, width) => formatIndent(width, tabSize, sample),
            targetIndentWidth,
        });
    }

    return text.endsWith('\n') ? text : `${text}\n`;
}
