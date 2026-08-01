import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Point, PressInput } from '../../runtime';
import {
  BlockType,
  locateDropPosition,
  parseLine,
  type BlockSelection,
  type DropPosition,
} from '../../domain';
import {
  HANDLE_CLASS,
  resolveListIndentUnit,
  resolveListIndentWidthPx,
  type MdDraggerCodeMirrorOptions,
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
  const sourceIndentWidth = source.type === BlockType.ListItem
    ? parseLine(
      sourceDoc.line(source.lines.startLine).text,
      sourceView.state.facet(EditorState.tabSize),
    ).indent.width
    : 0;
  // Only list items nest on the x-axis; the rendered step is measured from
  // list lines, so it is resolved lazily and never for paragraph sources.
  let targetIndentWidth = sourceIndentWidth;
  if (source.type === BlockType.ListItem) {
    const horizontalSteps = Math.round(
      (point.x - originBand.left) / resolveListIndentWidthPx(options, sourceView),
    );
    targetIndentWidth += horizontalSteps * indentUnit;
  }

  const target = viewAtPoint(point.x, point.y);
  if (!target) return null;
  return resolveDropPosition(target, point, selection, sourceIndentWidth, targetIndentWidth, options);
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
