import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';
import type { DropPosition } from '../command/drop-position';
import { resolveDeleteRange, resolveInsertionChange } from '../mutation/document-change';
import { selectionLineRanges, type BlockSelection } from '../selection/block-selection';
import type { LineRange } from '../markdown/line-range-types';
import { lineCount } from '../markdown/line-range';
import { parseLine } from '../parse/parse-line';
import { buildInsertTextForDrop } from '../mutation/text-mutation-policy';
import type { MovePlan } from '../move/move-plan';
import type { DocEdit, TextChange } from './block-transaction';
import { reject, type Reject } from '../result';
import { planOrderedListRenumberChanges } from './list-renumber';

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

function captureMoveSourcePayload(doc: Doc, selection: BlockSelection): MoveSourcePayload | null {
    const ranges = selectionLineRanges(doc.lines, selection);
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
}): DocEdit[] | Reject {
    const { sourceDoc, plan } = params;
    const targetDoc = plan.position.doc;
    const targetLine = plan.position.line;
    const tabSize = plan.tabSize;
    const parse = (text: string) => parseLine(text, tabSize);

    const insertText = buildInsertTextForDrop({
        doc: targetDoc,
        sourceBlock: plan.captured.block,
        targetLineNumber: targetLine,
        sourceContent: plan.captured.payload.content,
        position: plan.position,
        tabSize,
        indentUnit: plan.indentUnit,
    });
    if (!insertText.length) return reject('no_insert_text');

    if (sourceDoc !== targetDoc) {
        const target = planInsertOnlyTransaction({
            doc: targetDoc,
            payload: plan.captured.payload,
            targetLineNumber: targetLine,
            insertText,
        });
        if ('type' in target) return target;
        // Renumber ordered lists near insert and near deleted source (best-effort on pre-edit docs)
        const targetRenumber = planOrderedListRenumberChanges(targetDoc, parse, targetLine);
        const sourceRenumber = planOrderedListRenumberChanges(
            sourceDoc,
            parse,
            plan.captured.payload.ranges[0]?.startLine ?? 1
        );
        return [
            {
                doc: targetDoc,
                changes: mergeChanges(target.changes, targetRenumber),
            },
            {
                doc: sourceDoc,
                changes: mergeChanges(planSourceDeletion(plan.captured.payload), sourceRenumber),
            },
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

    // Same-doc: renumber near original source and near target (pre-edit coordinates;
    // renumber only touches marker digits so order of application is: main edits then renumber by from desc).
    const nearSource = plan.captured.payload.ranges[0]?.startLine ?? targetLine;
    const renumber = [
        ...planOrderedListRenumberChanges(targetDoc, parse, nearSource),
        ...planOrderedListRenumberChanges(targetDoc, parse, targetLine),
    ];
    return [{
        doc: targetDoc,
        changes: mergeChanges(tx.changes, renumber),
    }];
}

export function planSourceDeletion(payload: MoveSourcePayload): TextChange[] {
    return payload.segments
        .map((segment) => ({ from: segment.deleteFrom, to: segment.deleteTo, insert: '' }))
        .sort((a, b) => b.from - a.from);
}

function mergeChanges(primary: TextChange[], extra: TextChange[]): TextChange[] {
    if (extra.length === 0) return primary;
    // Dedupe identical spans; apply later changes with higher from first
    const all = [...primary, ...extra];
    const key = (c: TextChange) => `${c.from}:${c.to}:${c.insert}`;
    const seen = new Set<string>();
    const out: TextChange[] = [];
    for (const c of all.sort((a, b) => b.from - a.from)) {
        const k = key(c);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(c);
    }
    return out;
}

function planInsertionAndDeletionTransaction(params: {
    doc: Doc;
    payload: MoveSourcePayload;
    targetLineNumber: number;
    insertText: string;
    allowInPlaceIndentChange: boolean;
}): DocEdit | Reject {
    const { doc, payload, targetLineNumber, insertText, allowInPlaceIndentChange } = params;

    const totalDeletedLength = payload.segments.reduce(
        (sum, segment) => sum + (segment.deleteTo - segment.deleteFrom),
        0
    );
    const insertion = resolveInsertionChange(doc, targetLineNumber, insertText, {
        remainingLengthAfterDelete: doc.length - totalDeletedLength,
    });
    if (payload.segments.some((segment) => insertion.pos > segment.deleteFrom && insertion.pos < segment.deleteTo)) {
        return reject('insertion_inside_deleted_range');
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
}): DocEdit | Reject {
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
