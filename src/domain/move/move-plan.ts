import { frontmatterEndLine, YAML_FENCE_RE } from '../block/block-detector';
import type { Block } from '../block/block-types';
import type { DropPosition, DropZone } from '../command/drop-position';
import type { Doc } from '../markdown/document-types';
import { canonicalSeam, type Gap, gapAt } from '../markdown/gap';
import { getLineMap, type LineMap } from '../markdown/line-map';
import type { LineRange } from '../markdown/line-range-types';
import { isLinePayloadEnd, type PayloadEnd } from '../mutation';
import { parseLine } from '../parse/parse-line';
import { isReject, type RejectReason } from '../result';
import { calloutCovers, canDropAt, isNestedBlock, listConversion } from '../rules/container-policy';
import { selfDrop } from '../rules/self-drop';
import { runKind } from '../rules/separation';
import type { BlockSelection } from '../selection/block-selection';
import {
    applyChanges,
    type CapturedMoveSource,
    captureMoveSource,
    moveInsertion,
    moveTx,
} from '../transaction/move-blocks';

export type { RejectReason };

export type PlanMoveInput = {
    sourceDoc: Doc;
    selection: BlockSelection;
    position: DropPosition;
    tabSize: number;
    indentUnit: number;
    captured?: CapturedMoveSource;
    mode?: 'move' | 'copy';
};

/** Data-only plan. Only what moveTx needs. */
export type MovePlan = {
    position: DropPosition;
    gap: Gap;
    captured: CapturedMoveSource;
    mode: 'move' | 'copy';
    /** The line prefix the payload's lines take as list items (listConversion), or null when they move as they are. */
    asItems: string | null;
    allowIndent: boolean;
    tabSize: number;
    indentUnit: number;
};

export type MoveResult = { type: 'ok'; value: MovePlan } | { type: 'reject'; reason: RejectReason };

/**
 * Plan a move (the default) or copy into the gap at a target line, clamped to 1
 * through targetDoc.lines + 1. The plan's position.line is the boundary of that
 * gap the write uses: in an interior gap with blank lines, the line the
 * insertion lands before, given the boundary the position chose and the sides a
 * list sets; otherwise the gap's canonical seam. Copy mode skips self-drop
 * checks and in-place indentation changes, but still obeys container rules.
 * Returns a plan or a rejection without modifying either document; captured,
 * when supplied, provides the source snapshot. Document access errors propagate.
 */
export function planMove(input: PlanMoveInput): MoveResult {
    const { sourceDoc, tabSize } = input;
    const targetDoc = input.position.doc;
    const sourceLineMap = getLineMap(sourceDoc, { tabSize });
    const captured =
        input.captured ?? captureMoveSource(sourceDoc, input.selection, { lineMap: sourceLineMap, tabSize });
    if (!captured) return { type: 'reject', reason: 'empty_selection' };

    // A nested block moves only with its container, wherever it is dropped.
    if (captured.blocks.some((block) => isNestedBlock(sourceDoc, block, { lineMap: sourceLineMap, tabSize }))) {
        return { type: 'reject', reason: 'nested_block' };
    }

    // Gap interiors and container rules are structural: they come before the
    // self check. Self-drop only applies to gaps the structure allows (a
    // no-op or an in-place list indent change).
    const lineMap = getLineMap(targetDoc, { tabSize });
    const at = gapAt(targetDoc, input.position.line, { lineMap, tabSize });
    if (at.type === 'interior') return { type: 'reject', reason: at.reason };
    const { gap } = at;
    const mode = input.mode ?? 'move';
    const moving = (line: number) =>
        mode === 'move' &&
        sourceDoc === targetDoc &&
        captured.segments.some((s) => line >= s.startLine && line <= s.endLine);
    const zone = effectiveZone(targetDoc, gap, input.position, captured, { lineMap, tabSize, moving });
    // The boundary in an interior gap with blank lines, which the write turns into blank lines on each side.
    const interior = gap.above !== null && gap.below !== null && gap.blankLines > 0;
    const line = interior ? input.position.line : gap.seam;
    const position: DropPosition = { doc: targetDoc, line, parent: input.position.parent, zone };

    const decision = canDropAt(captured, gap, { lineMap, tabSize, sourceDoc });
    if (!decision.allowDrop) return { type: 'reject', reason: decision.rejectReason };
    const asItems = listConversion(captured, gap, position.parent, { lineMap, tabSize });

    const plan: MovePlan = {
        position,
        gap,
        captured,
        mode,
        asItems,
        allowIndent: false,
        tabSize,
        indentUnit: input.indentUnit,
    };
    // A copy keeps its source, so it can land anywhere next to it and never changes a level in place.
    if (mode === 'move' && sourceDoc === targetDoc) {
        const self = selfDrop({
            doc: targetDoc,
            blocks: captured.blocks,
            segments: captured.segments,
            targetLineNumber: gap.seam,
            parseLineWithQuote: (text: string) => parseLine(text, tabSize),
            lineMap,
            position,
            tabSize,
            indentUnit: input.indentUnit,
        });
        plan.allowIndent = self.allowInPlaceIndentChange;
        // A payload that turns into list items changes in its own gaps too.
        if (self.inSelfRange && !self.allowInPlaceIndentChange && asItems === null) {
            const reason = self.rejectReason ?? 'self_range_blocked';
            // A line payload in one of the source's own two gaps is a real move unless it reproduces the source:
            // it can join the line on the far side, or stand apart as its own paragraph.
            const ownGap =
                gap.seam === captured.segments[0].startLine ||
                gap.seam ===
                    canonicalSeam(targetDoc, captured.segments[captured.segments.length - 1].endLine + 1, { lineMap });
            if (zone === undefined || reason !== 'self_range_blocked' || !ownGap) return { type: 'reject', reason };
            const edits = moveTx({ sourceDoc: targetDoc, plan });
            if (!Array.isArray(edits)) return edits;
            if (applyChanges(targetDoc, edits[0].changes) === targetDoc.sliceString(0, targetDoc.length)) {
                return { type: 'reject', reason };
            }
        }
    }

    if (!plan.allowIndent && createsFrontmatter({ sourceDoc, sourceLineMap, targetDoc, gap, captured, mode })) {
        return { type: 'reject', reason: 'frontmatter_fence' };
    }

    // An in-place indent change writes nothing into the gap: it keeps the gap's canonical seam. At the note's end the
    // write puts the payload under the last block and keeps the padding below it: the line after that block, the
    // gap's first boundary.
    if (plan.allowIndent) plan.position = { ...position, line: gap.seam };
    else if (gap.above && !gap.below) plan.position = { ...position, line: lineMap.prevNonEmpty[gap.seam - 1] + 1 };
    if (!interior || plan.allowIndent) return { type: 'ok', value: plan };
    // The line the write puts the payload before, in the original document, kept inside the pointer's gap: where
    // the move's removal deletes the pointer's blank lines, the insertion lands at an edge of the deleted range.
    const step = moveInsertion(sourceDoc, plan);
    if (isReject(step)) return { type: 'reject', reason: step.reason };
    const written = targetDoc.lineAt(step.insertion.from).number;
    plan.position = { ...position, line: Math.max(gap.seam - gap.blankLines, Math.min(gap.seam, written)) };
    return { type: 'ok', value: plan };
}

/**
 * The zone a drop takes. A join applies only for a line payload — an
 * end that is a line cut from a larger paragraph or quote — whose run kind
 * matches the neighbour it joins, outside any callout, when the line written
 * under the other is no setext heading underline, and never under a list
 * parent, whose item takes the payload as its content; otherwise a line
 * payload lands apart. Absent when nothing chose a zone, when neither payload
 * end is a line payload, when the payload turns into list items, or when the
 * pointer is over a line that moves itself: that is the source, so its own
 * gaps stay a no-op.
 */
export function effectiveZone(
    doc: Doc,
    gap: Gap | null,
    { zone, parent }: { zone?: DropZone; parent: Block | null },
    captured: CapturedMoveSource,
    options: { lineMap: LineMap; tabSize: number; moving: (line: number) => boolean },
): DropZone | undefined {
    // `lower` is the line the join writes under the other one: a line of `=` or `-` only would underline a heading.
    const joins = (end: PayloadEnd, line: number, lower: string) =>
        isLinePayloadEnd(end) &&
        runKind(doc, line, options) === end.run &&
        !calloutCovers(doc, line, line, options) &&
        !/^(=+|-+)\s*$/.test(parseLine(lower, options.tabSize).body);
    if (zone === undefined || (!isLinePayloadEnd(captured.first) && !isLinePayloadEnd(captured.last))) return undefined;
    if (gap !== null && listConversion(captured, gap, parent, options) !== null) return undefined;
    const above = gap?.above ? options.lineMap.prevNonEmpty[gap.seam - 1] : 0;
    const below = gap?.below ? gap.seam : 0;
    const target = zone === 'joinAbove' ? above : zone === 'joinBelow' ? below : 0;
    if (target > 0 && options.moving(target)) return undefined;
    if (parent !== null) return 'apart';
    const firstLine = captured.content.split('\n', 1)[0];
    if (zone === 'joinAbove' && above > 0 && joins(captured.first, above, firstLine)) return 'joinAbove';
    if (zone === 'joinBelow' && below > 0 && joins(captured.last, below, doc.line(below).text)) return 'joinBelow';
    return 'apart';
}

/**
 * Whether the move or copy would make a document without frontmatter start with
 * a `---` line and contain another `---` line later, turning content into YAML.
 * Separators never go above a document's first line, so its new first line is
 * the payload's (inserted at a top edge without padding) or the first line
 * that survives the removal.
 */
function createsFrontmatter(params: {
    sourceDoc: Doc;
    sourceLineMap: LineMap;
    targetDoc: Doc;
    gap: Gap;
    captured: CapturedMoveSource;
    mode: 'move' | 'copy';
}): boolean {
    const { sourceDoc, sourceLineMap, targetDoc, gap, captured, mode } = params;
    const { segments } = captured;
    const payloadFirst = sourceDoc.line(segments[0].startLine).text;

    // A copy, or a move to another document, keeps the target's lines and adds the payload's.
    if (sourceDoc !== targetDoc || mode === 'copy') {
        // A document with no block takes the payload on its first line, above any padding.
        const startsTarget =
            gap.above === null && gap.below === null
                ? frontmatterEndLine(targetDoc) === 0 && YAML_FENCE_RE.test(payloadFirst)
                : startsWithFence(targetDoc, gap.above === null ? payloadFirst : targetDoc.line(1).text);
        if (startsTarget && countFences(targetDoc) + countFences(sourceDoc, segments) >= 2) {
            return true;
        }
        return mode === 'move' && removalCreatesFrontmatter(sourceDoc, sourceLineMap, segments);
    }

    // Same document: the lines are the same; only the first one can change.
    // The insertion lands at the top edge when every block above the gap moves.
    const aboveLine = gap.above ? sourceLineMap.prevNonEmpty[gap.seam - 1] : 0;
    const topEdge = gap.above === null || (segments[0].startLine === 1 && aboveLine <= segments[0].endLine);
    const first = topEdge ? payloadFirst : firstLineAfterRemoval(sourceDoc, sourceLineMap, segments[0]);
    return startsWithFence(sourceDoc, first) && countFences(sourceDoc) >= 2;
}

/** Whether removing `segments` exposes a `---` line as line 1 of a document without frontmatter, with another below it. */
export function removalCreatesFrontmatter(doc: Doc, lineMap: LineMap, segments: LineRange[]): boolean {
    if (!startsWithFence(doc, firstLineAfterRemoval(doc, lineMap, segments[0]))) return false;
    return countFences(doc) - countFences(doc, segments) >= 2;
}

/** A document without frontmatter or leading padding whose new first line is a `---` fence. */
function startsWithFence(doc: Doc, firstLine: string | null): boolean {
    if (frontmatterEndLine(doc) > 0 || doc.line(1).text.trim().length === 0) return false;
    return firstLine !== null && YAML_FENCE_RE.test(firstLine);
}

/** Text of line 1 once `segment` is removed: line 1 itself, or the first block after a removed first segment. */
function firstLineAfterRemoval(doc: Doc, lineMap: LineMap, segment: LineRange): string | null {
    if (segment.startLine !== 1) return doc.line(1).text;
    const next = segment.endLine < doc.lines ? lineMap.nextNonEmpty[segment.endLine + 1] : 0;
    return next > 0 ? doc.line(next).text : null;
}

/** `---` lines of `doc`, or of `ranges` of it. */
function countFences(doc: Doc, ranges: LineRange[] = [{ startLine: 1, endLine: doc.lines }]): number {
    let count = 0;
    for (const { startLine, endLine } of ranges) {
        for (let line = startLine; line <= endLine; line++) if (YAML_FENCE_RE.test(doc.line(line).text)) count++;
    }
    return count;
}
