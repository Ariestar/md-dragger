import { BlockType } from '../block/block-types';
import type { BlockSelection } from '../selection/block-selection';
import { selectionMergedLineRanges } from '../selection/block-selection';
import type { DropPosition } from '../command/drop-position';
import { InsertionRuleRejectReason, InsertionSlotContext, resolveInsertionRule } from './insertion-rules';
import { getLineMetaAt, LineMap } from '../markdown/line-map';
import { computeListIndentPlan } from '../mutation/list-mutation';
import { dropIndentWidth } from '../markdown/drop-locate';
import { Doc, ListContext, ParsedLine } from '../markdown/document-types';
import type { LineRange } from '../markdown/line-range-types';
import { isLineNumberInRanges } from '../markdown/line-range';

export type SelfDropRejectReason =
    | 'self_range_blocked'
    | 'self_embedding'
    | 'container_policy'
    | InsertionRuleRejectReason;

export type SelfDropResult = {
    inSelfRange: boolean;
    allowInPlaceIndentChange: boolean;
    rejectReason?: SelfDropRejectReason;
    listContextLineNumber?: number;
    targetIndentWidth?: number;
};

function sourceRangesAreListStructured(params: {
    doc: Doc;
    source: BlockSelection;
    parseLineWithQuote: (line: string) => ParsedLine;
    ranges: LineRange[];
}): boolean {
    const { doc, source, parseLineWithQuote, ranges } = params;
    if (source.blocks[0]?.type !== BlockType.ListItem) return false;

    for (const range of ranges) {
        let foundContent = false;
        for (let lineNumber = range.startLine; lineNumber <= range.endLine; lineNumber++) {
            const text = doc.line(lineNumber).text;
            if (text.trim().length === 0) continue;
            foundContent = true;
            if (!parseLineWithQuote(text).isListItem) return false;
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

    const sourceRanges = selectionMergedLineRanges(doc.lines, source);
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
        position?.kind === 'inside' || sourceBlock.type === BlockType.ListItem
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
        parseLineWithQuote,
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
    if (!sourceParsed.isListItem) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const listContextLineNumber = position?.kind === 'inside'
        ? position.parent.lines.startLine
        : targetLineNumber;

    const indentPlan = computeListIndentPlan({
        doc,
        sourceBase: {
            indentWidth: sourceParsed.indentWidth,
            indentRaw: sourceParsed.indentRaw,
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

    if (isAfterSelf && isContextInsideSource && indentPlan.targetIndentWidth > sourceParsed.indentWidth) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_embedding',
            listContextLineNumber: indentPlan.listContextLineNumber,
            targetIndentWidth: indentPlan.targetIndentWidth,
        };
    }

    const allowInPlaceIndentChange = (
        (isAfterSelf && indentPlan.targetIndentWidth !== sourceParsed.indentWidth)
        || (isSameLine && indentPlan.targetIndentWidth !== sourceParsed.indentWidth && !isSelfContext)
        || (!isAfterSelf && indentPlan.targetIndentWidth < sourceParsed.indentWidth)
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
