import type { DropPosition } from '../command/drop-position';
import type { Doc } from '../markdown/document-types';
import { getLineMap } from '../markdown/line-map';
import { parseLine } from '../parse/parse-line';
import { canDropAt } from '../rules/container-policy';
import { selfDrop } from '../rules/self-drop';
import type { BlockSelection } from '../selection/block-selection';
import { selectOne } from '../selection/block-selection';
import { getListContextNearLine } from '../mutation/list-mutation';
import { captureMoveSource, type CapturedMoveSource } from '../transaction/move-blocks';
import type { RejectReason } from '../result';

export type { RejectReason };

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
    | { type: 'reject'; reason: RejectReason };

export function planMove(input: PlanMoveInput): MoveResult {
    const targetDoc = input.position.doc;
    const captured = input.captured ?? captureMoveSource(input.sourceDoc, input.selection);
    if (!captured) return { type: 'reject', reason: 'empty_selection' };

    const line = Math.max(1, Math.min(targetDoc.lines + 1, input.position.line));
    const position: DropPosition = {
        doc: targetDoc,
        line,
        parent: input.position.parent,
    };

    const lineMap = getLineMap(targetDoc, { tabSize: input.tabSize });
    const slot = canDropAt(targetDoc, captured.block, line, {
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
        const parse = (text: string) => parseLine(text, input.tabSize);
        const self = selfDrop({
            doc: targetDoc,
            source: selectOne(captured.block),
            targetLineNumber: line,
            parse: parse,
            getListContext: (doc, lineNumber) => getListContextNearLine(doc, lineNumber, parse),
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
