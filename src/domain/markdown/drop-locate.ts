import { detectBlock } from '../block/block-detector';
import { type Block, BlockType } from '../block/block-types';
import type { DropPosition } from '../command/drop-position';
import { planMove } from '../move/move-plan';
import { parseLine } from '../parse/parse-line';
import type { RejectReason } from '../result';
import type { BlockSelection } from '../selection/block-selection';
import { selectionLineRanges } from '../selection/block-selection';
import type { Doc } from './document-types';
import { getLineMap, getLineMetaAt, listLineAtOrAbove } from './line-map';
import { isLineNumberInRanges } from './line-range';

/**
 * Drop locate — two independent axes, no cross-null:
 *   y → insert-before seam line (always)
 *   x → target indent → parent at that seam (clamp to structure, never kills y)
 */
export type DropLocateInput = {
    doc: Doc;
    sourceDoc?: Doc;
    selection: BlockSelection;
    hitLine: number;
    belowMid: boolean;
    sourceIndentWidth: number;
    targetIndentWidth: number;
    tabSize: number;
    indentUnit: number;
};

export function locateDropPosition(input: DropLocateInput): DropPosition {
    const { doc, selection, hitLine, belowMid, sourceIndentWidth, targetIndentWidth, tabSize, indentUnit } = input;

    const line = Math.max(1, Math.min(doc.lines + 1, belowMid ? hitLine + 1 : hitLine));

    // x cannot veto y: root seam is always valid.
    if (indentUnit <= 0 || line <= 1) {
        return { doc, line, parent: null };
    }

    // One drop may nest freely, but can outdent by at most one level.
    const want = Math.max(
        quantizeIndent(targetIndentWidth, indentUnit),
        quantizeIndent(sourceIndentWidth, indentUnit) - indentUnit,
    );
    if (want <= 0) {
        return { doc, line, parent: null };
    }

    const lineMap = getLineMap(doc, { tabSize });
    const above = line - 1;
    let parentLine = listLineAtOrAbove(lineMap, above);
    if (parentLine === null || lineMap.listSubtreeEndLine[parentLine] < above) {
        return { doc, line, parent: null };
    }

    // Child indent `want` needs parent indent `want - unit`.
    // Walk up until indent ≤ desired; skip self-selection in the same document.
    const desiredParentIndent = want - indentUnit;
    const sameDoc = input.sourceDoc === undefined || input.sourceDoc === doc;
    const sourceLines = sameDoc ? selectionLineRanges(doc.lines, selection) : [];

    while (parentLine > 0) {
        const meta = getLineMetaAt(lineMap, parentLine);
        if (!meta?.isList) {
            parentLine = 0;
            break;
        }
        if (sameDoc && isLineNumberInRanges(parentLine, sourceLines)) {
            parentLine = lineMap.listParentLine[parentLine] ?? 0;
            continue;
        }
        if (meta.indentWidth > desiredParentIndent) {
            parentLine = lineMap.listParentLine[parentLine] ?? 0;
            continue;
        }
        break;
    }

    if (parentLine <= 0) {
        return { doc, line, parent: null };
    }

    const parent = listItemAt(doc, parentLine, tabSize);
    return { doc, line, parent };
}

function quantizeIndent(width: number, indentUnit: number): number {
    if (!(width > 0) || !(indentUnit > 0)) return 0;
    return Math.max(0, Math.round(width / indentUnit) * indentUnit);
}

function listItemAt(doc: Doc, listHeadLine: number, tabSize: number): Block | null {
    const block = detectBlock(doc, listHeadLine, { tabSize });
    if (!block || block.type !== BlockType.ListItem) return null;
    return block;
}

/**
 * Indent for paint/compile from parent only.
 * root → 0; under list item → parentIndent + unit.
 */
export function dropIndentWidth(position: DropPosition, options: { tabSize: number; indentUnit: number }): number {
    if (position.parent?.type === BlockType.ListItem) {
        const lineMap = getLineMap(position.doc, { tabSize: options.tabSize });
        const meta = getLineMetaAt(lineMap, position.parent.lines.startLine);
        const base = meta?.indentWidth ?? 0;
        return base + options.indentUnit;
    }
    return 0;
}

/**
 * 0-based nesting level of a list line (0 for root or non-list).
 * Throws for a non-finite/non-positive indent unit or a non-finite result.
 */
export function listLevel(lineText: string, tabSize: number, indentUnit: number): number {
    if (!Number.isFinite(indentUnit) || indentUnit <= 0) {
        throw new RangeError('md-dragger: indentUnit must be finite and greater than zero');
    }
    const parsed = parseLine(lineText, tabSize);
    if (parsed.marker?.kind !== 'list' || parsed.quote.prefix.length > 0) return 0;
    const level = Math.round(parsed.indent.width / indentUnit);
    if (!Number.isFinite(level)) throw new RangeError('md-dragger: list level must be finite');
    return level;
}

/** Rejections that mean the pointer is over the source block itself. The
 * in-place seam stays grey (an explicit no-op) instead of snapping — snapping
 * would silently turn the no-op into a real move. Everything else is a
 * container/seam-location rejection that snapping can resolve. */
const NO_SNAP_REASONS: ReadonlySet<RejectReason> = new Set(['self_range_blocked', 'self_embedding']);

/** How far the linear walk searches for a valid seam beyond container edges. */
const SNAP_RADIUS = 4;

export type SnapDropInput = {
    /** The rejected seam from locateDropPosition (parent already derived). */
    raw: DropPosition;
    sourceDoc: Doc;
    selection: BlockSelection;
    sourceIndentWidth: number;
    targetIndentWidth: number;
    tabSize: number;
    indentUnit: number;
};

/**
 * Snap a rejected drop seam to the nearest insertable seam.
 *
 * Invalid seams are container/seam-location rejections (inside a fenced code
 * or math block, inside a list for non-list sources, table/hr adjacency, …).
 * Instead of painting a dead grey indicator, search outward:
 *   1. container edges — the block under the seam and the block ending right
 *      above it each contribute their boundaries (fence lines, list bounds);
 *   2. a short linear walk (±SNAP_RADIUS) for forbidden spans the edges do
 *      not cover (short quote runs, single-line callout-after seams).
 * Candidates are tried nearest-first; each re-derives its parent from the
 * seam line so the indent intent stays consistent with the paint geometry.
 * Self-range rejections and an exhausted search keep the original grey seam.
 */
export function snapDrop(input: SnapDropInput): DropPosition {
    const { raw, sourceDoc, selection, sourceIndentWidth, targetIndentWidth, tabSize, indentUnit } = input;
    const doc = raw.doc;
    const seam = raw.line;
    const maxLine = doc.lines + 1;

    const plan = (position: DropPosition) => planMove({ sourceDoc, selection, position, tabSize, indentUnit });
    const rawPlan = plan(raw);
    if (rawPlan.type === 'ok' || NO_SNAP_REASONS.has(rawPlan.reason)) return raw;

    const candidates: number[] = [];
    const push = (line: number): void => {
        if (line < 1 || line > maxLine || candidates.includes(line)) return;
        candidates.push(line);
    };

    for (const probe of [seam, seam - 1]) {
        const block = detectBlock(doc, probe, { tabSize });
        if (!block) continue;
        push(block.lines.startLine);
        push(block.lines.endLine + 1);
    }

    for (let d = 1; d <= SNAP_RADIUS; d++) {
        push(seam - d);
        push(seam + d);
    }

    // Nearest first; equidistant candidates prefer the seam below (larger
    // line) so the indicator keeps up with a downward drag.
    const byDistance = [...candidates].sort((a, b) => Math.abs(a - seam) - Math.abs(b - seam) || b - a);
    for (const line of byDistance) {
        const position = locateDropPosition({
            doc,
            sourceDoc,
            selection,
            hitLine: line,
            belowMid: false,
            sourceIndentWidth,
            targetIndentWidth,
            tabSize,
            indentUnit,
        });
        const planned = plan(position);
        if (planned.type === 'ok' || NO_SNAP_REASONS.has(planned.reason)) return position;
    }

    return raw;
}
