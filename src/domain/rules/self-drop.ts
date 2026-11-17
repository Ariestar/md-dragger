import { type Block, BlockType } from '../block/block-types';
import type { DropPosition } from '../command/drop-position';
import type { Doc } from '../markdown/document-types';
import { dropIndentWidth } from '../markdown/drop-locate';
import { canonicalSeam } from '../markdown/gap';
import { getLineMetaAt, type LineMap } from '../markdown/line-map';
import { isLineNumberInRanges } from '../markdown/line-range';
import type { LineRange } from '../markdown/line-range-types';
import { isListLine } from '../parse/parse-line';
import type { ParsedLine } from '../parse/types';
import type { RejectReason } from '../result';

export type SelfDropResult = {
    inSelfRange: boolean;
    allowInPlaceIndentChange: boolean;
    rejectReason?: RejectReason;
    targetIndentWidth?: number;
};

function isListSelection(params: {
    doc: Doc;
    blocks: readonly Block[];
    parse: (line: string) => ParsedLine;
    ranges: readonly LineRange[];
}): boolean {
    const { doc, blocks, parse, ranges } = params;
    if (blocks[0]?.type !== BlockType.ListItem) return false;

    for (const range of ranges) {
        let foundContent = false;
        for (let lineNumber = range.startLine; lineNumber <= range.endLine; lineNumber++) {
            const text = doc.line(lineNumber).text;
            if (text.trim().length === 0) continue;
            foundContent = true;
            if (!isListLine(parse(text))) return false;
        }
        if (!foundContent) return false;
    }
    return true;
}

/**
 * Self-drop: dropping on the source segments or on the gap right below the
 * last one (a canonical seam, possibly past blank lines). Indent intent comes
 * only from DropPosition (dropIndentWidth) — no near-line scan.
 */
export function selfDrop(params: {
    doc: Doc;
    blocks: readonly Block[];
    segments: LineRange[];
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    lineMap: LineMap;
    position?: DropPosition;
    tabSize: number;
    indentUnit: number;
}): SelfDropResult {
    const { doc, blocks, segments, targetLineNumber, lineMap, position, tabSize, indentUnit } = params;
    const parse = params.parseLineWithQuote;

    const sourceBlock = blocks[0];
    if (!sourceBlock) {
        return { inSelfRange: false, allowInPlaceIndentChange: false, rejectReason: 'self_range_blocked' };
    }

    const effectiveSourceRange = {
        startLine: segments[0].startLine,
        endLine: segments[segments.length - 1].endLine,
    };
    const seamAfterSelf = canonicalSeam(doc, effectiveSourceRange.endLine + 1, { lineMap });

    const inSelectedRange = isLineNumberInRanges(targetLineNumber, segments);
    const inSelfRange = inSelectedRange || targetLineNumber === seamAfterSelf;
    if (!inSelfRange) {
        return { inSelfRange: false, allowInPlaceIndentChange: false };
    }

    if (!position) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const targetIndentWidth = dropIndentWidth(position, { tabSize, indentUnit });
    const hasListIntent = position.parent?.type === BlockType.ListItem || sourceBlock.type === BlockType.ListItem;
    if (!hasListIntent) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    if (!isListSelection({ doc, blocks, parse, ranges: segments })) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const sourceLineNumber = effectiveSourceRange.startLine;
    const sourceLineMeta = getLineMetaAt(lineMap, sourceLineNumber);
    if (sourceLineMeta && !sourceLineMeta.isList) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }
    const sourceParsed = parse(doc.line(sourceLineNumber).text);
    if (!isListLine(sourceParsed)) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const sourceIndent = sourceParsed.indent.width;
    const isAfterSelf = targetLineNumber === seamAfterSelf;
    const isSameLine = targetLineNumber === effectiveSourceRange.startLine;

    // Nesting one segment under the block above it, across blank lines, is a move into its own upper gap: the move
    // writes it with the spacing of the list it joins, where an in-place change would keep the blank lines.
    if (
        isSameLine &&
        segments.length === 1 &&
        targetIndentWidth > sourceIndent &&
        getLineMetaAt(lineMap, sourceLineNumber - 1)?.isEmpty
    ) {
        return { inSelfRange: false, allowInPlaceIndentChange: false };
    }

    // Nesting under self as child while dropping after self range = embedding
    if (
        isAfterSelf &&
        position.parent &&
        isLineNumberInRanges(position.parent.lines.startLine, segments) &&
        targetIndentWidth > sourceIndent
    ) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_embedding',
            targetIndentWidth,
        };
    }

    const allowInPlaceIndentChange =
        (isAfterSelf && targetIndentWidth !== sourceIndent) ||
        (isSameLine && targetIndentWidth !== sourceIndent) ||
        (!isAfterSelf && targetIndentWidth < sourceIndent);

    if (!allowInPlaceIndentChange) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
            targetIndentWidth,
        };
    }

    return {
        inSelfRange: true,
        allowInPlaceIndentChange: true,
        targetIndentWidth,
    };
}
