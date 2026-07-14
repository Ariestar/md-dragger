import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';
import type { DropPosition } from '../command/drop-position';
import { resolveDeleteRange, resolveInsertionChange } from '../mutation/document-change';
import { selectionMergedLineRanges, type BlockSelection } from '../selection/block-selection';
import type { LineRange } from '../markdown/line-range-types';
import { lineCount } from '../markdown/line-range';
import { createLineParsingContext } from '../markdown/line-parsing-service';
import { buildInsertTextForDrop } from '../mutation/text-mutation-policy';
import type { MovePlan } from '../move/move-plan';
import type { DocEdit, TextChange } from './block-transaction';
import { rejectCommand, type CommandReject } from './command-reject';

export type MoveSourceSegment = {
    lines: LineRange;
    from: number;
    to: number;
    deleteFrom: number;
    deleteTo: number;
};

export type MoveSourcePayload = {
    content: string;
    ranges: LineRange[];
    segments: MoveSourceSegment[];
};

export type CapturedMoveSource = {
    /** Representative block for type/rules (first in selection). */
    block: Block;
    payload: MoveSourcePayload;
};

export function captureMoveSource(doc: Doc, selection: BlockSelection): CapturedMoveSource | null {
    const payload = captureMoveSourcePayload(doc, selection);
    if (!payload) return null;
    const first = payload.ranges[0];
    const last = payload.ranges[payload.ranges.length - 1];
    return {
        block: {
            type: selection.blocks[0].type,
            lines: { startLine: first.startLine, endLine: last.endLine },
        },
        payload,
    };
}

export function captureMoveSourcePayload(doc: Doc, selection: BlockSelection): MoveSourcePayload | null {
    const ranges = selectionMergedLineRanges(doc.lines, selection);
    if (ranges.length === 0) return null;

    const segments = ranges.map((range) => {
        const start = doc.line(range.startLine);
        const end = doc.line(range.endLine);
        const deleteRange = resolveDeleteRange(doc, start.from, end.to);
        return {
            lines: range,
            from: start.from,
            to: end.to,
            deleteFrom: deleteRange.from,
            deleteTo: deleteRange.to,
        };
    });
    const content = segments.map((segment) => doc.sliceString(segment.from, segment.to)).join('\n');
    return { content, ranges, segments };
}

export function moveTx(params: {
    sourceDoc: Doc;
    plan: MovePlan;
}): DocEdit[] | CommandReject {
    const { sourceDoc, plan } = params;
    const targetDoc = plan.position.doc;
    const targetLine = plan.position.line;
    const lineParsing = createLineParsingContext(plan.tabSize);

    const insertText = buildInsertTextForDrop({
        lineParsing,
        doc: targetDoc,
        sourceBlock: plan.captured.block,
        targetLineNumber: targetLine,
        sourceContent: plan.captured.payload.content,
        position: plan.position,
        indentUnit: plan.indentUnit,
    });
    if (!insertText.length) return rejectCommand('no_insert_text');

    if (sourceDoc !== targetDoc) {
        const target = planInsertOnlyTransaction({
            doc: targetDoc,
            payload: plan.captured.payload,
            targetLineNumber: targetLine,
            insertText,
        });
        if ('type' in target) return target;
        return [
            target,
            { doc: sourceDoc, changes: planSourceDeletion(plan.captured.payload) },
        ];
    }

    const tx = planInsertionAndDeletionTransaction({
        doc: targetDoc,
        payload: plan.captured.payload,
        targetLineNumber: targetLine,
        insertText,
        allowInPlaceIndentChange: plan.allowIndent,
    });
    if ('type' in tx) return tx;
    return [tx];
}

export function planSourceDeletion(payload: MoveSourcePayload): TextChange[] {
    return payload.segments
        .map((segment) => ({ from: segment.deleteFrom, to: segment.deleteTo, insert: '' }))
        .sort((a, b) => b.from - a.from);
}

function planInsertionAndDeletionTransaction(params: {
    doc: Doc;
    payload: MoveSourcePayload;
    targetLineNumber: number;
    insertText: string;
    allowInPlaceIndentChange: boolean;
}): DocEdit | CommandReject {
    const { doc, payload, targetLineNumber, insertText, allowInPlaceIndentChange } = params;

    const totalDeletedLength = payload.segments.reduce(
        (sum, segment) => sum + (segment.deleteTo - segment.deleteFrom),
        0
    );
    const insertion = resolveInsertionChange(doc, targetLineNumber, insertText, {
        remainingLengthAfterDelete: doc.length - totalDeletedLength,
    });
    if (payload.segments.some((segment) => insertion.pos > segment.deleteFrom && insertion.pos < segment.deleteTo)) {
        return rejectCommand('insertion_inside_deleted_range');
    }

    const firstSegment = payload.segments[0];
    const changes = allowInPlaceIndentChange && insertion.pos === firstSegment.deleteFrom
        ? [{ from: firstSegment.deleteFrom, to: firstSegment.deleteTo, insert: insertion.text }]
        : [
            { from: insertion.pos, to: insertion.pos, insert: insertion.text },
            ...payload.segments.map((segment) => ({ from: segment.deleteFrom, to: segment.deleteTo, insert: '' })),
        ].sort((a, b) => b.from - a.from);

    return { doc, changes };
}

function planInsertOnlyTransaction(params: {
    doc: Doc;
    payload: MoveSourcePayload;
    targetLineNumber: number;
    insertText: string;
}): DocEdit | CommandReject {
    const { doc, targetLineNumber, insertText } = params;
    const insertion = resolveInsertionChange(doc, targetLineNumber, insertText, {
        remainingLengthAfterDelete: doc.length,
    });
    return {
        doc,
        changes: [{ from: insertion.pos, to: insertion.pos, insert: insertion.text }],
    };
}

export function resolveFinalInsertedStartLineNumber(targetLineNumber: number, payload: MoveSourcePayload): number {
    let removedLineCountBeforeTarget = 0;
    for (const segment of payload.segments) {
        if (segment.lines.endLine < targetLineNumber) {
            removedLineCountBeforeTarget += lineCount(segment.lines);
        }
    }
    return Math.max(1, targetLineNumber - removedLineCountBeforeTarget);
}
