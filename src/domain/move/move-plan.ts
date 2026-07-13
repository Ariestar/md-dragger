import type { BlockInfo } from '../block/block-types';
import { createMoveCommand, type MoveBlockCommand } from '../command/move-command';
import type { DropTarget, ListDropTarget } from '../command/drop-target';
import type { Doc, ListContext, ParsedLine } from '../markdown/document-types';
import { getLineMap, type LineMap } from '../markdown/line-map';
import type { InsertionSlotContext } from '../rules/insertion-rules';
import { selfDrop } from '../rules/self-drop';
import type { BlockSelection } from '../selection/block-selection';
import { createBlockSelection } from '../selection/block-selection';
import type { InsertionRuleRejectReason } from '../rules/insertion-rules';
import { captureMoveSource, type CapturedMoveSource } from '../transaction/move-blocks';

export type DropRejectReason =
    | 'table_cell'
    | 'no_target'
    | 'no_anchor'
    | 'self_range_blocked'
    | 'self_embedding'
    | 'inside_list'
    | 'inside_quote_run'
    | 'quote_boundary'
    | 'callout_after'
    | 'table_before'
    | 'hr_before'
    | 'container_policy'
    | 'empty_selection';

// Cross-document is a native property of the inputs, not a mode to opt into:
// distinct source and target documents (by identity) are a cross-document move.
export type MoveRejectReason = DropRejectReason;

export type MoveDeps = {
    tabSize: number;
    slotAt: (
        doc: Doc,
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        options: { lineMap?: LineMap; tabSize: number }
    ) => {
        slotContext: InsertionSlotContext;
        decision: { allowDrop: boolean; rejectReason?: InsertionRuleRejectReason | 'container_policy' | null };
    };
    parseLine: (line: string) => ParsedLine;
    listCtx: (doc: Doc, lineNumber: number) => ListContext;
    insertText: (
        doc: Doc,
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        sourceContent: string,
        listIntent?: ListDropTarget
    ) => string;
};

export type DropInput = {
    sourceDoc: Doc;
    selection: BlockSelection;
    target: DropTarget;
    deps: MoveDeps;
    captured?: CapturedMoveSource;
};

export type DropOk = {
    target: DropTarget;
    targetLineNumber: number;
    slot: InsertionSlotContext;
    captured: CapturedMoveSource;
    allowIndent: boolean;
    lineMap: LineMap;
};

export type DropCheck =
    | { type: 'ok'; value: DropOk }
    | { type: 'reject'; reason: DropRejectReason };

export type MovePlan = {
    command: MoveBlockCommand;
    target: DropTarget;
    targetLineNumber: number;
    slot: InsertionSlotContext;
    captured: CapturedMoveSource;
    allowIndent: boolean;
    deps: MoveDeps;
};

export type MoveResult =
    | { type: 'ok'; value: MovePlan }
    | { type: 'reject'; reason: MoveRejectReason };

export function checkDrop(input: DropInput): DropCheck {
    const targetDoc = input.target.targetDoc;
    const captured = input.captured ?? captureMoveSource(input.sourceDoc, input.selection);
    if (!captured) return { type: 'reject', reason: 'empty_selection' };

    const targetLineNumber = clampTarget(targetDoc.lines, input.target.targetLineNumber);
    const lineMap = getLineMap(targetDoc, { tabSize: input.deps.tabSize });
    const slot = input.deps.slotAt(targetDoc, captured.block, targetLineNumber, {
        lineMap,
        tabSize: input.deps.tabSize,
    });
    if (!slot.decision.allowDrop) {
        return {
            type: 'reject',
            reason: slot.decision.rejectReason ?? 'container_policy',
        };
    }

    // Self-drop can only happen within one document — a different target doc
    // can never be the source block itself.
    if (input.sourceDoc === targetDoc) {
        const self = selfDrop({
            doc: targetDoc,
            source: createBlockSelection(captured.block, captured.payload.ranges),
            targetLineNumber,
            parseLineWithQuote: input.deps.parseLine,
            getListContext: input.deps.listCtx,
            slotContext: slot.slotContext,
            lineMap,
            listIntent: input.target.listIntent,
        });
        if (self.inSelfRange && !self.allowInPlaceIndentChange) {
            return {
                type: 'reject',
                reason: self.rejectReason ?? 'self_range_blocked',
            };
        }
        return {
            type: 'ok',
            value: {
                target: {
                    ...input.target,
                    targetLineNumber,
                },
                targetLineNumber,
                slot: slot.slotContext,
                captured,
                allowIndent: self.allowInPlaceIndentChange,
                lineMap,
            },
        };
    }

    return {
        type: 'ok',
        value: {
            target: {
                ...input.target,
                targetLineNumber,
            },
            targetLineNumber,
            slot: slot.slotContext,
            captured,
            allowIndent: false,
            lineMap,
        },
    };
}

export function planMove(input: DropInput): MoveResult {
    const drop = checkDrop(input);
    if (drop.type === 'reject') return drop;

    return {
        type: 'ok',
        value: {
            command: createMoveCommand(input.selection, drop.value.target),
            target: drop.value.target,
            targetLineNumber: drop.value.targetLineNumber,
            slot: drop.value.slot,
            captured: drop.value.captured,
            allowIndent: drop.value.allowIndent,
            deps: input.deps,
        },
    };
}

function clampTarget(docLines: number, lineNumber: number): number {
    if (lineNumber < 1) return 1;
    if (lineNumber > docLines + 1) return docLines + 1;
    return lineNumber;
}
