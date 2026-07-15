import { EditorView } from '@codemirror/view';
import type { Point, PressInput } from '../../runtime';
import {
  locateDropPosition,
  type BlockSelection,
  type DropPosition,
} from '../../domain';
import { parseLine, isListLine, listMarkerText } from '../../domain/parse';
import {
  HANDLE_CLASS,
  resolveListIndentUnit,
  resolveTabSize,
  type MdDraggerCodeMirrorOptions,
} from './config';
import { nativePointerEvent } from './pointer-input';

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

/** Adapter measures pointer → domain DropPosition. */
export function resolveDropPosition(
  view: EditorView,
  point: Point,
  selection: BlockSelection,
  options: MdDraggerCodeMirrorOptions,
): DropPosition | null {
  const hitLine = lineAtPoint(view, point);
  if (hitLine === null) return null;

  const doc = view.state.doc;
  const tabSize = resolveTabSize(options);
  const indentUnit = resolveListIndentUnit(options);
  const inDoc = hitLine >= 1 && hitLine <= doc.lines;
  const nestPx = nestStepPx(view, indentUnit);

  return locateDropPosition({
    doc,
    selection,
    hitLine,
    belowMid: inDoc ? belowMid(view, hitLine, point.y) : hitLine > doc.lines,
    pastMarker: inDoc ? pastMarker(view, hitLine, point.x, tabSize) : false,
    markerOffset: (listLine) => markerOffset(view, listLine, point.x, tabSize, indentUnit, nestPx),
    tabSize,
    indentUnit,
  });
}

function belowMid(view: EditorView, line: number, y: number): boolean {
  const from = view.state.doc.line(line).from;
  try {
    const block = view.lineBlockAt(from);
    return y > view.documentTop + (block.top + block.bottom) / 2;
  } catch {
    const coords = view.coordsAtPos(from, 1);
    if (!coords) return false;
    const height = view.defaultLineHeight;
    return y > coords.top + height / 2;
  }
}

function pastMarker(
  view: EditorView,
  line: number,
  x: number,
  tabSize: number,
): boolean {
  const docLine = view.state.doc.line(line);
  const parsed = parseLine(docLine.text, tabSize);
  if (!isListLine(parsed)) return false;
  // Use real screen coords of marker end — not char-count guesses.
  // Ordered markers ("10. ") are wider than "- "; document offsets alone mis-fire nestZone.
  const markerEnd =
    docLine.from
    + parsed.quote.prefix.length
    + parsed.indent.raw.length
    + listMarkerText(parsed).length;
  const coords = view.coordsAtPos(markerEnd, 1);
  if (!coords) return false;
  return x > coords.left;
}

/**
 * Columns relative to the list marker start, in the same units as indentWidth.
 * ink-mde draws nest levels as widgets (~nestStepPx per listIndentUnit columns),
 * not as plain spaces — defaultCharacterWidth systematically skews ordered lists
 * (longer markers) toward negative offsets → outdent → parent null (root).
 */
function markerOffset(
  view: EditorView,
  listLine: number,
  x: number,
  tabSize: number,
  indentUnit: number,
  nestPx: number,
): number | null {
  const docLine = view.state.doc.line(listLine);
  const parsed = parseLine(docLine.text, tabSize);
  if (!isListLine(parsed)) return null;

  const markerStart =
    docLine.from + parsed.quote.prefix.length + parsed.indent.raw.length;
  const origin = view.coordsAtPos(markerStart, 1)?.left;
  if (origin === undefined) return null;
  if (!(nestPx > 0) || !(indentUnit > 0)) return null;

  // One nest widget ≈ indentUnit columns (see dropSeam geometry).
  return ((x - origin) / nestPx) * indentUnit;
}

/** Pixels for one list nest step (matches dropSeam / ink-mde-indent). */
function nestStepPx(view: EditorView, listIndentUnit: number): number {
  const indentEl = view.contentDOM.querySelector('.ink-mde-indent') as HTMLElement | null;
  if (indentEl) {
    const w = indentEl.getBoundingClientRect().width;
    if (w > 0) return w;
  }
  // Fallback only for geometry without widgets: approximate from font size, not char width of "1."
  const rem = parseFloat(getComputedStyle(view.contentDOM).fontSize || '16') || 16;
  return 2 * rem * (listIndentUnit > 0 ? 1 : 1);
}
