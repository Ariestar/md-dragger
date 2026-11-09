import { detectBlock } from '../block/block-detector';
import { type Block, BlockType } from '../block/block-types';
import type { DropPosition, DropZone } from '../command/drop-position';
import { effectiveZone, planMove } from '../move/move-plan';
import { parseLine } from '../parse/parse-line';
import type { RejectReason } from '../result';
import { canDropAt, convertsToItems } from '../rules/container-policy';
import type { BlockSelection } from '../selection/block-selection';
import { selectionLineRanges } from '../selection/block-selection';
import { type CapturedMoveSource, captureMoveSource } from '../transaction/move-blocks';
import type { Doc } from './document-types';
import { canonicalSeam, gapAt } from './gap';
import { getLineMap, getLineMetaAt, type LineMap, listLineAtOrAbove, quoteRunAt } from './line-map';
import { isLineNumberInRanges } from './line-range';
import type { LineRange } from './line-range-types';

/**
 * Drop locate — two independent axes, no cross-null:
 *   y → the gap under the pointer, by its canonical seam (always); the line is
 *       that seam, or in an interior gap of two or more blank lines the
 *       boundary under the pointer: the seam before the blank line or block
 *       the pointer is over (DropPosition.line); and the zone of the gap the
 *       pointer is over (DropZone)
 *   x → target indent → parent at the canonical seam (clamp to structure, never kills y)
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
    const { doc, hitLine, belowMid, tabSize } = input;
    const lineMap = getLineMap(doc, { tabSize });
    return locateAt(input, belowMid ? hitLine + 1 : hitLine, pointerZone(lineMap, hitLine, belowMid));
}

/**
 * The part of the gap the pointer is over: the lower half of the line above
 * the gap, the upper half of the line below it, or anywhere between (its
 * blank lines, or padding at an edge).
 */
function pointerZone(lineMap: LineMap, hitLine: number, belowMid: boolean): DropZone {
    if (hitLine < 1 || hitLine > lineMap.doc.lines || lineMap.lineMeta[hitLine].isEmpty) return 'apart';
    return belowMid ? 'joinAbove' : 'joinBelow';
}

/**
 * The drop position at a raw seam: the boundary it picks in its gap, the parent from the x axis at the gap's
 * canonical seam, and the zone the gap takes for this payload.
 */
function locateAt(input: DropLocateInput, raw: number, zone: DropZone | undefined): DropPosition {
    const { doc, selection, tabSize } = input;
    const lineMap = getLineMap(doc, { tabSize });
    const sourceDoc = input.sourceDoc ?? doc;
    const captured = captureMoveSource(sourceDoc, selection, { lineMap: getLineMap(sourceDoc, { tabSize }), tabSize });
    const seam = canonicalSeam(doc, raw, { lineMap });
    // Legality, the parent and the zone are the gap's; only which of its blank lines the payload lands among is the
    // pointer's.
    const at = gapAt(doc, seam, { lineMap, tabSize });
    const k = at.type === 'gap' && at.gap.above && at.gap.below ? at.gap.blankLines : 0;
    const line = k >= 2 ? Math.max(seam - k, Math.min(seam, raw)) : seam;
    const moving = (other: number) =>
        sourceDoc === doc &&
        captured !== null &&
        captured.segments.some((s) => other >= s.startLine && other <= s.endLine);
    const parent = dropParent(input, seam, lineMap, captured);
    const zoneFor = (payload: CapturedMoveSource) =>
        effectiveZone(doc, at.type === 'gap' ? at.gap : null, { zone, parent }, payload, { lineMap, tabSize, moving });
    return { doc, line, parent, zone: captured ? zoneFor(captured) : undefined };
}

function dropParent(
    input: DropLocateInput,
    seam: number,
    lineMap: LineMap,
    captured: CapturedMoveSource | null,
): Block | null {
    const { doc, selection, sourceIndentWidth, targetIndentWidth, tabSize, indentUnit } = input;

    // x cannot veto y: root seam is always valid.
    if (indentUnit <= 0 || seam <= 1) return null;

    // One drop may nest freely, but can outdent by at most one level.
    const want = Math.max(
        quantizeIndent(targetIndentWidth, indentUnit),
        quantizeIndent(sourceIndentWidth, indentUnit) - indentUnit,
    );
    if (want <= 0) return null;

    // The last non-blank line above the seam: nesting works across a loose list's blank line.
    const above = lineMap.prevNonEmpty[seam - 1];
    let parentLine = above > 0 ? listLineAtOrAbove(lineMap, above) : null;
    if (parentLine === null || lineMap.listSubtreeEndLine[parentLine] < above) return null;

    // Child indent `want` needs parent indent `want - unit`.
    // Walk up until indent ≤ desired; skip self-selection in the same document.
    const desiredParentIndent = want - indentUnit;
    const sameDoc = input.sourceDoc === undefined || input.sourceDoc === doc;
    const sourceLines = sameDoc ? selectionLineRanges(doc.lines, selection) : [];
    // The engine writes no `>` prefix: a parent is an item of the payload's own quote depth, and a quoted parent
    // only for list items in the quote they move within, directly above the seam: any other quote stays apart from
    // it. A payload a list turns into items (a plain quote too) is unquoted where the seam is not between two quoted
    // lines.
    const sourceDoc = input.sourceDoc ?? doc;
    const first = selection.blocks[0].lines.startLine;
    const { lineMeta } = lineMap;
    const inQuote =
        above === seam - 1 && lineMeta[above].quoteDepth > 0 && seam <= doc.lines && lineMeta[seam].quoteDepth > 0;
    const converts = !inQuote && captured !== null && convertsToItems(captured, tabSize);
    const depth = converts ? 0 : parseLine(sourceDoc.line(first).text, tabSize).quote.depth;
    if (depth > 0) {
        const run = quoteRunAt(lineMap, above);
        const items = captured?.blocks.every((block) => block.type === BlockType.ListItem);
        if (!items || !sameDoc || above !== seam - 1 || first < run.startLine || first > run.endLine) return null;
    }

    while (parentLine > 0) {
        const meta = getLineMetaAt(lineMap, parentLine);
        if (!meta?.isList) {
            parentLine = 0;
            break;
        }
        if (meta.quoteDepth !== depth || (sameDoc && isLineNumberInRanges(parentLine, sourceLines))) {
            parentLine = lineMap.listParentLine[parentLine] ?? 0;
            continue;
        }
        if (meta.indentWidth > desiredParentIndent) {
            parentLine = lineMap.listParentLine[parentLine] ?? 0;
            continue;
        }
        break;
    }

    return parentLine > 0 ? listItemAt(doc, parentLine, tabSize) : null;
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
 * The row the drop indicator sits on, and which edge of it, for the line a
 * position gives: the bottom of the line above for `joinAbove`, the top of the
 * line below for `joinBelow`, the middle of a gap's one blank line for a line
 * payload `apart`; otherwise above the first line, at the top of the first
 * blank line of a gap, where the row above is the block above (a callout's
 * rows are hidden in its widget), or below the previous line.
 */
export function seamRow(position: DropPosition): { row: number; edge: 'top' | 'below' | 'center' } {
    const { doc, line, zone } = position;
    const blank = (n: number) => doc.line(n).text.trim().length === 0;
    let above = line - 1;
    while (above >= 1 && blank(above)) above--;
    if (zone === 'joinAbove') return { row: above, edge: 'below' };
    if (zone === 'joinBelow') return { row: line, edge: 'top' };
    let below = line;
    while (below <= doc.lines && blank(below)) below++;
    if (zone === 'apart' && above >= 1 && below <= doc.lines && below - above === 2) {
        return { row: above + 1, edge: 'center' };
    }
    if (line <= 1) return { row: 1, edge: 'top' };
    if (line <= doc.lines && blank(line) && !blank(line - 1)) return { row: line, edge: 'top' };
    return { row: Math.min(line - 1, doc.lines), edge: 'below' };
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
 * Snap a rejected drop seam to an edge of the region it lies inside.
 *
 * Only interior rejections snap: a seam inside frontmatter, a fenced code or
 * math block, a table, a tight quote run or a list item's subtree. The region
 * comes from gapAt or from the container rule that rejected the seam, and its
 * two edges — its first line and the line after its last — are tried nearest
 * first (ties go below, so the indicator keeps up with a downward drag). Each
 * re-derives its parent from the seam so the indent intent stays consistent
 * with the paint geometry. The first edge whose plan is ok or a self no-op
 * wins; otherwise, and for rejections without a region (self, nested block,
 * frontmatter fence), the raw grey seam stays.
 */
export function snapDrop(input: SnapDropInput): DropPosition {
    const { raw, sourceDoc, selection, sourceIndentWidth, targetIndentWidth, tabSize, indentUnit } = input;
    const doc = raw.doc;
    const captured = captureMoveSource(sourceDoc, selection, { lineMap: getLineMap(sourceDoc, { tabSize }), tabSize });
    if (!captured) return raw;

    const plan = (position: DropPosition) =>
        planMove({ sourceDoc, selection, position, tabSize, indentUnit, captured });
    const rawPlan = plan(raw);
    if (rawPlan.type === 'ok' || NO_SNAP_REASONS.has(rawPlan.reason)) return raw;

    const region = rejectedRegion(raw, captured, sourceDoc, tabSize);
    if (!region) return raw;

    // Nearest to the gap the pointer is in, not to the boundary it picks there.
    const seam = canonicalSeam(doc, raw.line, { lineMap: getLineMap(doc, { tabSize }) });
    const edges = [region.startLine, region.endLine + 1].sort(
        (a, b) => Math.abs(a - seam) - Math.abs(b - seam) || b - a,
    );
    for (const line of edges) {
        // A snapped seam is not where the pointer is: it lands apart. A position without a zone keeps none.
        const position = locateAt(
            {
                doc,
                sourceDoc,
                selection,
                hitLine: line,
                belowMid: false,
                sourceIndentWidth,
                targetIndentWidth,
                tabSize,
                indentUnit,
            },
            line,
            raw.zone && 'apart',
        );
        const planned = plan(position);
        if (planned.type === 'ok' || NO_SNAP_REASONS.has(planned.reason)) return position;
    }

    return raw;
}

/**
 * The protected region a rejected seam lies inside, or null when the rejection is not about the seam's place. A
 * block whose interior is protected, inside a container that rejects the payload, lies inside the container's region.
 */
function rejectedRegion(
    raw: DropPosition,
    payload: CapturedMoveSource,
    sourceDoc: Doc,
    tabSize: number,
): LineRange | null {
    const lineMap = getLineMap(raw.doc, { tabSize });
    const decide = (line: number): LineRange | null => {
        const at = gapAt(raw.doc, line, { lineMap, tabSize });
        if (at.type === 'interior') {
            return (at.reason !== 'inside_frontmatter' && decide(at.region.startLine)) || at.region;
        }
        const decision = canDropAt(payload, at.gap, { lineMap, tabSize, sourceDoc });
        return decision.allowDrop ? null : decision.region;
    };
    return decide(raw.line);
}
