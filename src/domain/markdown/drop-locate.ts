import type { BlockSelection } from '../selection/block-selection';
import type { Doc } from './document-types';
import type { ListDropTarget } from '../command/drop-target';
import { BlockType } from '../block/block-types';
import { clampTargetLineNumber } from './line-target-number';
import { getLineMap, getLineMetaAt, getNearestListLineAtOrBefore, type LineMap } from './line-map';
import { computeListIntent, resolveReferenceListLineNumber } from './list-target';

// Pure drop-target resolution (vertical half-line + list intent).
//
// Adapter only measures the pointer and supplies:
//   - hitLineNumber / belowMidLine
//   - pastListContentStart (x past the hit list line's content start)
//   - cursorOffsetColumnsFromMarker(line) (pixels → columns from that line's marker)
// Domain owns all document rules.

export type DropLocateInput = {
    doc: Doc;
    selection: BlockSelection;
    /** 1-based line the pointer is over (or doc.lines+1 past end). */
    hitLineNumber: number;
    /** true when pointer is in the lower half of the hit line. */
    belowMidLine: boolean;
    /**
     * true when the hit line is a list item and the pointer is to the right of
     * its marker content — the "nest into this row" signal.
     */
    pastListContentStart: boolean;
    /**
     * Columns from a list line's marker start to the pointer.
     * Return null if the line is not a measurable list item.
     */
    cursorOffsetColumnsFromMarker: (listLineNumber: number) => number | null;
    tabSize: number;
    indentUnit: number;
};

export type DropLocateResult = {
    targetLineNumber: number;
    placement: 'before';
    listIntent?: ListDropTarget;
};

export function locateDropTarget(input: DropLocateInput): DropLocateResult | null {
    const {
        doc,
        selection,
        hitLineNumber,
        belowMidLine,
        pastListContentStart,
        cursorOffsetColumnsFromMarker,
        tabSize,
        indentUnit,
    } = input;

    if (hitLineNumber < 1) {
        return { targetLineNumber: 1, placement: 'before' };
    }
    if (hitLineNumber > doc.lines) {
        return { targetLineNumber: doc.lines + 1, placement: 'before' };
    }

    const lineMap = getLineMap(doc, { tabSize });
    const hitMeta = getLineMetaAt(lineMap, hitLineNumber);
    const childIntentOnLine = selection.anchorBlock.type === BlockType.ListItem
        && !!hitMeta?.isList
        && pastListContentStart;

    // Half-line: upper → before hit, lower → after hit (target = hit + 1).
    let targetLineNumber = clampTargetLineNumber(
        doc.lines,
        belowMidLine ? hitLineNumber + 1 : hitLineNumber,
    );

    // Nest into hovered list row: force insertion after it so the reference is this row.
    if (childIntentOnLine && !belowMidLine) {
        targetLineNumber = clampTargetLineNumber(doc.lines, hitLineNumber + 1);
    }

    const listIntent = resolveListIntent({
        doc,
        lineMap,
        selection,
        hitLineNumber,
        targetLineNumber,
        childIntentOnLine,
        cursorOffsetColumnsFromMarker,
        indentUnit,
    });

    return {
        targetLineNumber,
        placement: 'before',
        listIntent,
    };
}

function resolveListIntent(params: {
    doc: Doc;
    lineMap: LineMap;
    selection: BlockSelection;
    hitLineNumber: number;
    targetLineNumber: number;
    childIntentOnLine: boolean;
    cursorOffsetColumnsFromMarker: (listLineNumber: number) => number | null;
    indentUnit: number;
}): ListDropTarget | undefined {
    const {
        doc,
        lineMap,
        selection,
        hitLineNumber,
        targetLineNumber,
        childIntentOnLine,
        cursorOffsetColumnsFromMarker,
        indentUnit,
    } = params;

    if (selection.anchorBlock.type !== BlockType.ListItem) return undefined;

    // Reference list line:
    //   child-intent → hovered row
    //   else → nearest non-empty at or before the insertion line's previous line
    let referenceLineNumber: number | null = null;
    if (childIntentOnLine) {
        referenceLineNumber = hitLineNumber;
    } else {
        referenceLineNumber = nonEmptyAtOrBefore(lineMap, targetLineNumber - 1)
            ?? getNearestListLineAtOrBefore(lineMap, Math.max(1, targetLineNumber - 1));
    }
    if (referenceLineNumber === null || referenceLineNumber < 1) {
        return { mode: 'sibling', contextLineNumber: targetLineNumber, targetIndentWidth: 0 };
    }

    const baseLineNumber = resolveReferenceListLineNumber(referenceLineNumber, lineMap)
        ?? referenceLineNumber;

    const cursorOffsetColumns = cursorOffsetColumnsFromMarker(baseLineNumber);
    if (cursorOffsetColumns === null) {
        return { mode: 'sibling', contextLineNumber: baseLineNumber, targetIndentWidth: 0 };
    }

    const isSelfTarget = baseLineNumber === selection.anchorBlock.startLine + 1;
    const intent = computeListIntent({
        doc,
        lineMap,
        referenceLineNumber: baseLineNumber,
        cursorOffsetColumns,
        indentUnit,
        allowChild: !isSelfTarget,
    });
    if (!intent) return undefined;

    // Cap indent between previous list indent and next list indent.
    let targetIndentWidth = intent.targetIndentWidth;
    const baseIndent = getLineMetaAt(lineMap, baseLineNumber)?.indentWidth;
    if (typeof baseIndent === 'number') {
        targetIndentWidth = Math.min(targetIndentWidth, baseIndent + indentUnit);
    }
    if (targetLineNumber <= doc.lines) {
        const nextMeta = getLineMetaAt(lineMap, targetLineNumber);
        if (nextMeta?.isList) {
            targetIndentWidth = Math.max(
                targetIndentWidth,
                Math.max(0, nextMeta.indentWidth - indentUnit),
            );
        }
    }

    return {
        mode: intent.mode,
        contextLineNumber: intent.contextLineNumber,
        targetIndentWidth,
    };
}

// prevNonEmpty[i] = nearest non-empty line at or before i (includes i if non-empty).
function nonEmptyAtOrBefore(lineMap: LineMap, fromLine: number): number | null {
    if (fromLine < 1) return null;
    const clamped = Math.min(fromLine, lineMap.doc.lines);
    const prev = lineMap.prevNonEmpty[clamped];
    return typeof prev === 'number' && prev > 0 ? prev : null;
}
