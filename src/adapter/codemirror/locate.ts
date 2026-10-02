import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
    type BlockSelection,
    BlockType,
    type Doc,
    type DropPosition,
    locateDropPosition,
    parseLine,
    snapDrop,
} from '../../domain';
import type { Point, PressInput } from '../../runtime';
import {
    HANDLE_CLASS,
    type MdDraggerCodeMirrorOptions,
    resolveListIndentUnit,
    resolveListIndentWidthPx,
} from './config';
import { elementTarget, nativePointerEvent } from './pointer-input';
import { locateEditor, pointerDocument } from './views';

/**
 * Source line for a press on a drag handle.
 * Prefer data-block-start (handle identity) over Y geometry — tall widgets
 * (callout/table) place the handle on the block-start gutter row while the
 * pointer Y can sit over later visual rows.
 */
export function sourceLineFromInput(view: EditorView, input: PressInput): number | null {
    const target = elementTarget(nativePointerEvent(input.native));
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
    sourceDoc?: Doc,
): DropPosition | null {
    const hitLine = lineAtPoint(view, point);
    if (hitLine === null) return null;

    const doc = view.state.doc;
    const tabSize = view.state.facet(EditorState.tabSize);
    const indentUnit = resolveListIndentUnit(options);
    const inDoc = hitLine >= 1 && hitLine <= doc.lines;

    return locateDropPosition({
        doc,
        sourceDoc,
        selection,
        hitLine,
        belowMid: inDoc ? belowMid(view, hitLine, point.y) : hitLine > doc.lines,
        sourceIndentWidth,
        targetIndentWidth,
        tabSize,
        indentUnit,
    });
}

export { type SnapDropInput, snapDrop } from '../../domain';

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

    const indentUnit = resolveListIndentUnit(options);
    const sourceIndentWidth =
        source.type === BlockType.ListItem
            ? parseLine(sourceDoc.line(source.lines.startLine).text, sourceView.state.facet(EditorState.tabSize)).indent
                  .width
            : 0;

    const space = pointerDocument() ?? sourceView.dom.ownerDocument;
    const targetHit = locateEditor(point.x, point.y, space);
    if (!targetHit) return null;
    const targetPoint = { x: targetHit.x, y: targetHit.y };

    let targetIndentWidth = sourceIndentWidth;
    if (source.type === BlockType.ListItem) {
        const stepPx = resolveListIndentWidthPx(options, targetHit.view);
        if (stepPx > 0) {
            const contentLeft = targetHit.view.contentDOM.getBoundingClientRect().left;
            const horizontalSteps = Math.max(0, Math.round((targetPoint.x - contentLeft) / stepPx));
            targetIndentWidth = horizontalSteps * indentUnit;
        }
    }
    const position = resolveDropPosition(
        targetHit.view,
        targetPoint,
        selection,
        sourceIndentWidth,
        targetIndentWidth,
        options,
        sourceDoc,
    );
    if (position === null) return null;
    return snapDrop({
        raw: position,
        sourceDoc,
        selection,
        sourceIndentWidth,
        targetIndentWidth,
        tabSize: targetHit.view.state.facet(EditorState.tabSize),
        indentUnit,
    });
}

/** Line under point on whichever live editor the pointer is over, including one in another window or a card iframe. */
export function lineAtScreenPoint(point: Point, doc: Document): number | null {
    const hit = locateEditor(point.x, point.y, pointerDocument() ?? doc);
    if (!hit) return null;
    return lineAtPoint(hit.view, { x: hit.x, y: hit.y });
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
