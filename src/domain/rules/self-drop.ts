import { BlockType } from '../block/block-types';
import type { BlockSelection } from '../selection/block-selection';
import { selectionLineRanges } from '../selection/block-selection';
import type { DropPosition } from '../command/drop-position';
import { resolveInsertionRule, type InsertionSlotContext } from './insertion-rules';
import type { RejectReason } from '../result';
import { getLineMetaAt, type LineMap } from '../markdown/line-map';
import { computeListIndentPlan } from '../mutation/list-mutation';
import { dropContextLine, dropIndentWidth } from '../markdown/drop-locate';
import type { Doc, ListContext } from '../markdown/document-types';
import type { ParsedLine } from '../parse/types';
import { isListLine } from '../parse/parse-line';
import type { LineRange } from '../markdown/line-range-types';
import { isLineNumberInRanges } from '../markdown/line-range';

export type SelfDropResult = {
    inSelfRange: boolean;
    allowInPlaceIndentChange: boolean;
    rejectReason?: RejectReason;
    listContextLineNumber?: number;
    targetIndentWidth?: number;
};

function sourceRangesAreListStructured(params: {
    doc: Doc;
    source: BlockSelection;
    parseLine: (line: string) => ParsedLine;
    ranges: LineRange[];
}): boolean {
    const { doc, source, parseLine, ranges } = params;
    if (source.blocks[0]?.type !== BlockType.ListItem) return false;

    for (const range of ranges) {
        let foundContent = false;
        for (let lineNumber = range.startLine; lineNumber <= range.endLine; lineNumber++) {
            const text = doc.line(lineNumber).text;
            if (text.trim().length === 0) continue;
            foundContent = true;
            if (!isListLine(parseLine(text))) return false;
        }
        if (!foundContent) return false;
    }
    return true;
}

export function selfDrop(params: {
    doc: Doc;
    source: BlockSelection;
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getListContext: (doc: Doc, lineNumber: number) => ListContext;
    slotContext?: InsertionSlotContext;
    lineMap?: LineMap;
    position?: DropPosition;
    tabSize?: number;
    indentUnit?: number;
}): SelfDropResult {
    const {
        doc,
        source,
        targetLineNumber,
        parseLineWithQuote,
        getListContext,
        slotContext,
        lineMap,
        position,
        tabSize = 4,
        indentUnit = 2,
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

    const targetIndentWidth = position
        ? dropIndentWidth(position, { tabSize, indentUnit })
        : undefined;
    const hasListIntent = targetIndentWidth !== undefined && (
        position?.parent?.type === BlockType.ListItem
        || sourceBlock.type === BlockType.ListItem
    );
    if (!hasListIntent || targetIndentWidth === undefined) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    if (!sourceRangesAreListStructured({
        doc,
        source,
        parseLine: parseLineWithQuote,
        ranges: sourceRanges,
    })) {
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
    const sourceLineText = doc.line(sourceLineNumber).text;
    const sourceParsed = parseLineWithQuote(sourceLineText);
    if (!isListLine(sourceParsed)) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const listContextLineNumber = position
        ? dropContextLine(position)
        : targetLineNumber;

    const indentPlan = computeListIndentPlan({
        doc,
        sourceBase: {
            indentWidth: sourceParsed.indent.width,
            indentRaw: sourceParsed.indent.raw,
        },
        targetLineNumber,
        parseLineWithQuote,
        getListContext,
        targetIndentWidth,
        contextLineNumber: listContextLineNumber,
    });

    const isAfterSelf = targetLineNumber === effectiveSourceRange.endLine + 1;
    const isSameLine = targetLineNumber === effectiveSourceRange.startLine;
    const isSelfContext = indentPlan.listContextLineNumber === sourceLineNumber;
    const isContextInsideSource = indentPlan.listContextLineNumber >= sourceLineNumber
        && indentPlan.listContextLineNumber <= effectiveSourceRange.endLine;

    if (isAfterSelf && isContextInsideSource && indentPlan.targetIndentWidth > sourceParsed.indent.width) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_embedding',
            listContextLineNumber: indentPlan.listContextLineNumber,
            targetIndentWidth: indentPlan.targetIndentWidth,
        };
    }

    const allowInPlaceIndentChange = (
        (isAfterSelf && indentPlan.targetIndentWidth !== sourceParsed.indent.width)
        || (isSameLine && indentPlan.targetIndentWidth !== sourceParsed.indent.width && !isSelfContext)
        || (!isAfterSelf && indentPlan.targetIndentWidth < sourceParsed.indent.width)
    );

    if (!allowInPlaceIndentChange) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
            listContextLineNumber: indentPlan.listContextLineNumber,
            targetIndentWidth: indentPlan.targetIndentWidth,
        };
    }

    return {
        inSelfRange: true,
        allowInPlaceIndentChange: true,
        listContextLineNumber: indentPlan.listContextLineNumber,
        targetIndentWidth: indentPlan.targetIndentWidth,
    };
}
