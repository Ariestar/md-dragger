import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Point, PressInput } from '../../runtime';
import {
  locateDropPosition,
  type BlockSelection,
  type DropPosition,
} from '../../domain';
import {
  HANDLE_CLASS,
  resolveListIndentUnit,
  type MdDraggerCodeMirrorOptions,
} from './config';
import { nativePointerEvent } from './pointer-input';
import { viewAtPoint } from './views';

/** Source line when press is on a drag handle; otherwise null. */
export function sourceLineFromInput(view: EditorView, input: PressInput): number | null {
  const event = nativePointerEvent(input.native);
  const target = event?.target instanceof Element ? event.target : null;
  if (!target?.closest(`.${HANDLE_CLASS}`)) return null;
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
 */
export function resolveDropPosition(
  view: EditorView,
  point: Point,
  selection: BlockSelection,
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
    tabSize,
    indentUnit,
  });
}

/**
 * Default multi-doc drop locate: hit-test live views, then resolve on the target.
 */
export function resolveDropPositionAtPoint(
  point: Point,
  selection: BlockSelection,
  options: MdDraggerCodeMirrorOptions,
): DropPosition | null {
  const target = viewAtPoint(point.x, point.y);
  if (!target) return null;
  return resolveDropPosition(target, point, selection, options);
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
