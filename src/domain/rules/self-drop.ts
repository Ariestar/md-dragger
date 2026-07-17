import { BlockType } from '../block/block-types';
import type { BlockSelection } from '../selection/block-selection';
import { selectionLineRanges } from '../selection/block-selection';
import type { DropPosition } from '../command/drop-position';
import type { InsertionSlotContext } from './insertion-rules';
import { resolveInsertionRule } from './insertion-rules';
import { getLineMetaAt, type LineMap } from '../markdown/line-map';
import { dropIndentWidth } from '../markdown/drop-locate';
import type { Doc } from '../markdown/document-types';
import type { ParsedLine } from '../parse/types';
import { isListLine } from '../parse/parse-line';
import type { LineRange } from '../markdown/line-range-types';
import { isLineNumberInRanges } from '../markdown/line-range';
import type { RejectReason } from '../result';

export type SelfDropResult = {
    inSelfRange: boolean;
    allowInPlaceIndentChange: boolean;
    rejectReason?: RejectReason;
    targetIndentWidth?: number;
};

function isListSelection(params: {
    doc: Doc;
    source: BlockSelection;
    parse: (line: string) => ParsedLine;
    ranges: LineRange[];
}): boolean {
    const { doc, source, parse, ranges } = params;
    if (source.blocks[0]?.type !== BlockType.ListItem) return false;

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
 * Self-drop: dropping inside the source selection range.
 * Indent intent comes only from DropPosition (dropIndentWidth) — no near-line scan.
 */
export function selfDrop(params: {
    doc: Doc;
    source: BlockSelection;
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    slotContext?: InsertionSlotContext;
    lineMap?: LineMap;
    position?: DropPosition;
    tabSize: number;
    indentUnit: number;
}): SelfDropResult {
    const {
        doc,
        source,
        targetLineNumber,
        parseLineWithQuote: parse,
        slotContext,
        lineMap,
        position,
        tabSize,
        indentUnit,
    } = params;

    const sourceBlock = source.blocks[0];
    if (!sourceBlock) {
        return { inSelfRange: false, allowInPlaceIndentChange: false, rejectReason: 'self_range_blocked' };
    }

    if (typeof slotContext === 'string') {
        const containerRule = resolveInsertionRule({
            sourceType: sourceBlock.type,
            slotContext,
        });
        if (!containerRule.allowDrop) {
            return {
                inSelfRange: false,
                allowInPlaceIndentChange: false,
                rejectReason: containerRule.rejectReason ?? 'container_policy',
            };
        }
    }

    const sourceRanges = selectionLineRanges(doc.lines, source);
    if (sourceRanges.length === 0) {
        return { inSelfRange: false, allowInPlaceIndentChange: false };
    }
    const effectiveSourceRange = {
        startLine: sourceRanges[0].startLine,
        endLine: sourceRanges[sourceRanges.length - 1].endLine,
    };

    const inSelectedRange = isLineNumberInRanges(targetLineNumber, sourceRanges);
    const inSelfRange = inSelectedRange || targetLineNumber === effectiveSourceRange.endLine + 1;
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
    const hasListIntent = position.parent?.type === BlockType.ListItem
        || sourceBlock.type === BlockType.ListItem;
    if (!hasListIntent) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    if (!isListSelection({ doc, source, parse, ranges: sourceRanges })) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const sourceLineNumber = effectiveSourceRange.startLine;
    const sourceLineMeta = lineMap ? getLineMetaAt(lineMap, sourceLineNumber) : null;
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
    const isAfterSelf = targetLineNumber === effectiveSourceRange.endLine + 1;
    const isSameLine = targetLineNumber === effectiveSourceRange.startLine;

    // Nesting under self as child while dropping after self range = embedding
    if (
        isAfterSelf
        && position.parent
        && isLineNumberInRanges(position.parent.lines.startLine, sourceRanges)
        && targetIndentWidth > sourceIndent
    ) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_embedding',
            targetIndentWidth,
        };
    }

    const allowInPlaceIndentChange = (
        (isAfterSelf && targetIndentWidth !== sourceIndent)
        || (isSameLine && targetIndentWidth !== sourceIndent)
        || (!isAfterSelf && targetIndentWidth < sourceIndent)
    );

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
