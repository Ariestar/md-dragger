import type { DropPosition } from '../command/drop-position';
import type { Doc } from '../markdown/document-types';
import { getLineMap } from '../markdown/line-map';
import { clampInsertLine } from '../markdown/line-number';
import { createLineParsingContext } from '../markdown/line-parsing-service';
import { resolveDropRuleAtInsertion } from '../rules/container-policy-service';
import { selfDrop } from '../rules/self-drop';
import type { BlockSelection } from '../selection/block-selection';
import { selectOne } from '../selection/block-selection';
import { getListContextNearLine } from '../mutation/list-mutation';
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

export type MoveRejectReason = DropRejectReason;

export type PlanMoveInput = {
    sourceDoc: Doc;
    selection: BlockSelection;
    position: DropPosition;
    tabSize: number;
    indentUnit: number;
    captured?: CapturedMoveSource;
};

/** Data-only plan. Only what moveTx needs. */
export type MovePlan = {
    position: DropPosition;
    captured: CapturedMoveSource;
    allowIndent: boolean;
    tabSize: number;
    indentUnit: number;
};

export type MoveResult =
    | { type: 'ok'; value: MovePlan }
    | { type: 'reject'; reason: MoveRejectReason };

export type DropCheck =
    | { type: 'ok'; value: MovePlan }
    | { type: 'reject'; reason: DropRejectReason };

export function checkDrop(input: PlanMoveInput): DropCheck {
    const targetDoc = input.position.doc;
    const captured = input.captured ?? captureMoveSource(input.sourceDoc, input.selection);
    if (!captured) return { type: 'reject', reason: 'empty_selection' };

    const line = clampInsertLine(targetDoc.lines, input.position.line);
    const position: DropPosition = input.position.kind === 'seam'
        ? { kind: 'seam', doc: targetDoc, line }
        : { kind: 'inside', doc: targetDoc, parent: input.position.parent, line };

    const lineMap = getLineMap(targetDoc, { tabSize: input.tabSize });
    const slot = resolveDropRuleAtInsertion(targetDoc, captured.block, line, {
        lineMap,
        tabSize: input.tabSize,
    });
    if (!slot.decision.allowDrop) {
        return {
            type: 'reject',
            reason: slot.decision.rejectReason ?? 'container_policy',
        };
    }

    let allowIndent = false;
    if (input.sourceDoc === targetDoc) {
        const lineParsing = createLineParsingContext(input.tabSize);
        const self = selfDrop({
            doc: targetDoc,
            source: selectOne(captured.block),
            targetLineNumber: line,
            parseLineWithQuote: lineParsing.parseLine,
            getListContext: (doc, lineNumber) => getListContextNearLine(doc, lineNumber, lineParsing.parseLine),
            slotContext: slot.slotContext,
            lineMap,
            position,
            tabSize: input.tabSize,
            indentUnit: input.indentUnit,
        });
        if (self.inSelfRange && !self.allowInPlaceIndentChange) {
            return {
                type: 'reject',
                reason: self.rejectReason ?? 'self_range_blocked',
            };
        }
        allowIndent = self.allowInPlaceIndentChange;
    }

    return {
        type: 'ok',
        value: {
            position,
            captured,
            allowIndent,
            tabSize: input.tabSize,
            indentUnit: input.indentUnit,
        },
    };
}

export function planMove(input: PlanMoveInput): MoveResult {
    return checkDrop(input);
}
