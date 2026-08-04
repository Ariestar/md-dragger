import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
    type BlockSelection,
    BlockType,
    type Doc,
    type DropPosition,
    detectBlock,
    locateDropPosition,
    parseLine,
    planMove,
    type RejectReason,
} from '../../domain';
import type { Point, PressInput } from '../../runtime';
import {
    HANDLE_CLASS,
    type MdDraggerCodeMirrorOptions,
    resolveListIndentUnit,
    resolveListIndentWidthPx,
} from './config';
import { lineBand } from './geometry';
import { nativePointerEvent } from './pointer-input';
import { viewAtPoint } from './views';

/**
 * Source line for a press on a drag handle.
 * Prefer data-block-start (handle identity) over Y geometry — tall widgets
 * (callout/table) place the handle on the block-start gutter row while the
 * pointer Y can sit over later visual rows.
 */
export function sourceLineFromInput(view: EditorView, input: PressInput): number | null {
    const event = nativePointerEvent(input.native);
    const target = event?.target instanceof Element ? event.target : null;
    const handle = target?.closest(`.${HANDLE_CLASS}`) ?? null;
    if (!handle || !view.dom.contains(handle)) return null;

    const fromAttr = Number(handle.getAttribute('data-block-start'));
    if (Number.isInteger(fromAttr) && fromAttr >= 1 && fromAttr <= view.state.doc.lines) {
        return fromAttr;
    }
    return lineAtPoint(view, input.point);
}

/** Document line under a screen point (1-based; past end → lines+1). */
export function lineAtPoint(view: EditorView, point: Point): number | null {
    const contentRect = view.contentDOM.getBoundingClientRect();
    if (point.y <= contentRect.top) return 1;
    if (point.y >= contentRect.bottom) return view.state.doc.lines + 1;

    const pos = view.posAtCoords({ x: Math.max(contentRect.left + 1, point.x), y: point.y }, false);
    if (typeof pos !== 'number') return null;
    return view.state.doc.lineAt(pos).number;
}

/**
 * Drop position on a specific view (one doc).
 * tabSize comes from the view's EditorState.tabSize.
 * Indent widths are text columns (domain units), already derived from pixels.
 */
export function resolveDropPosition(
    view: EditorView,
    point: Point,
    selection: BlockSelection,
    sourceIndentWidth: number,
    targetIndentWidth: number,
    options: MdDraggerCodeMirrorOptions,
): DropPosition | null {
    const hitLine = lineAtPoint(view, point);
    if (hitLine === null) return null;

    const doc = view.state.doc;
    const tabSize = view.state.facet(EditorState.tabSize);
    const indentUnit = resolveListIndentUnit(options);
    const inDoc = hitLine >= 1 && hitLine <= doc.lines;

    return locateDropPosition({
        doc,
        selection,
        hitLine,
        belowMid: inDoc ? belowMid(view, hitLine, point.y) : hitLine > doc.lines,
        sourceIndentWidth,
        targetIndentWidth,
        tabSize,
        indentUnit,
    });
}

/** Rejections that mean the pointer is over the source block itself. The
 * in-place seam stays grey (an explicit no-op) instead of snapping — snapping
 * would silently turn the no-op into a real move. Everything else is a
 * container/seam-location rejection that snapping can resolve. */
const NO_SNAP_REASONS: ReadonlySet<RejectReason> = new Set(['self_range_blocked', 'self_embedding']);

/** How far the linear walk searches for a valid seam beyond container edges. */
const SNAP_RADIUS = 4;

export type SnapDropPositionInput = {
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
export function snapDropPosition(input: SnapDropPositionInput): DropPosition {
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
            selection,
            hitLine: line,
            belowMid: false,
            sourceIndentWidth,
            targetIndentWidth,
            tabSize,
            indentUnit,
        });
        if (plan(position).type === 'ok') return position;
    }

    return raw;
}

/**
 * Default multi-doc drop locate — two independent axes:
 *   y → hit-test live views, seam on the target view
 *   x → horizontal drag distance from the source content band, in rendered
 *       list-indent steps → target indent width (domain clamps to structure)
 */
export function resolveDropPositionAtPoint(
    sourceView: EditorView,
    point: Point,
    selection: BlockSelection,
    options: MdDraggerCodeMirrorOptions,
): DropPosition | null {
    const source = selection.blocks[0];
    if (!source) return null;
    const sourceDoc = sourceView.state.doc;
    if (source.lines.startLine < 1 || source.lines.startLine > sourceDoc.lines) return null;

    const originBand = lineBand(sourceView, source.lines.startLine, options);
    if (!originBand) return null;

    const indentUnit = resolveListIndentUnit(options);
    const sourceIndentWidth =
        source.type === BlockType.ListItem
            ? parseLine(sourceDoc.line(source.lines.startLine).text, sourceView.state.facet(EditorState.tabSize)).indent
                  .width
            : 0;
    // Only list items nest on the x-axis; the rendered step is measured from
    // list lines, so it is resolved lazily and never for paragraph sources.
    let targetIndentWidth = sourceIndentWidth;
    if (source.type === BlockType.ListItem) {
        const horizontalSteps = Math.round((point.x - originBand.left) / resolveListIndentWidthPx(options, sourceView));
        targetIndentWidth += horizontalSteps * indentUnit;
    }

    const target = viewAtPoint(point.x, point.y);
    if (!target) return null;
    const position = resolveDropPosition(target, point, selection, sourceIndentWidth, targetIndentWidth, options);
    if (position === null) return null;
    return snapDropPosition({
        raw: position,
        sourceDoc,
        selection,
        sourceIndentWidth,
        targetIndentWidth,
        tabSize: target.state.facet(EditorState.tabSize),
        indentUnit,
    });
}

/** Line under point on whatever live view owns that screen position. */
export function lineAtScreenPoint(point: Point): number | null {
    const target = viewAtPoint(point.x, point.y);
    if (!target) return null;
    return lineAtPoint(target, point);
}

function belowMid(view: EditorView, line: number, y: number): boolean {
    const from = view.state.doc.line(line).from;
    try {
        const block = view.lineBlockAt(from);
        return y > view.documentTop + (block.top + block.bottom) / 2;
    } catch {
        const coords = view.coordsAtPos(from, 1);
        if (!coords) return false;
        return y > coords.top + view.defaultLineHeight / 2;
    }
}
