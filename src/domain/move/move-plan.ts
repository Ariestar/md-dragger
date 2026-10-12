import { frontmatterEndLine, YAML_FENCE_RE } from '../block/block-detector';
import type { DropPosition } from '../command/drop-position';
import type { Doc } from '../markdown/document-types';
import { type Gap, gapAt } from '../markdown/gap';
import { getLineMap, type LineMap } from '../markdown/line-map';
import type { LineRange } from '../markdown/line-range-types';
import { parseLine } from '../parse/parse-line';
import type { RejectReason } from '../result';
import { canDropAt, isNestedBlock, listConversion } from '../rules/container-policy';
import { selfDrop } from '../rules/self-drop';
import type { BlockSelection } from '../selection/block-selection';
import { type CapturedMoveSource, captureMoveSource } from '../transaction/move-blocks';

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
 * Plan a move (the default) or copy before a target line, clamped to 1 through
 * targetDoc.lines + 1. Copy mode skips self-drop checks and in-place indentation
 * changes, but still obeys container rules. Returns a plan or a rejection without
 * modifying either document; captured, when supplied, provides the source snapshot.
 * Document access errors propagate.
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
    const position: DropPosition = { doc: targetDoc, line: gap.seam, parent: input.position.parent };

    const decision = canDropAt(captured, gap, { lineMap, tabSize, sourceDoc });
    if (!decision.allowDrop) return { type: 'reject', reason: decision.rejectReason };
    const asItems = listConversion(captured, gap, position.parent, { lineMap, tabSize });

    const mode = input.mode ?? 'move';
    let allowIndent = false;
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
        // A payload that turns into list items changes in its own gaps too.
        if (self.inSelfRange && !self.allowInPlaceIndentChange && asItems === null) {
            return { type: 'reject', reason: self.rejectReason ?? 'self_range_blocked' };
        }
        allowIndent = self.allowInPlaceIndentChange;
    }

    if (!allowIndent && createsFrontmatter({ sourceDoc, sourceLineMap, targetDoc, gap, captured, mode })) {
        return { type: 'reject', reason: 'frontmatter_fence' };
    }

    return {
        type: 'ok',
        value: { position, gap, captured, mode, asItems, allowIndent, tabSize, indentUnit: input.indentUnit },
    };
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
