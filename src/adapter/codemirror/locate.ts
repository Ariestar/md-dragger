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

/**
 * Columns (indent-width units) from the start of `text` up to `end` code units.
 * Same rules as parseLine indent.width (tabs expand to tabSize).
 */
function columnsOf(text: string, end: number, tabSize: number): number {
  const slice = text.slice(0, Math.max(0, Math.min(text.length, end)));
  let width = 0;
  for (const ch of slice) {
    width += ch === '\t' ? tabSize : 1;
  }
  return width;
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

  return locateDropPosition({
    doc,
    selection,
    hitLine,
    belowMid: inDoc ? belowMid(view, hitLine, point.y) : hitLine > doc.lines,
    pastMarker: inDoc ? pastMarker(view, hitLine, point, tabSize) : false,
    pointerColumn: (listLine) => pointerColumn(view, listLine, point, tabSize),
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
  point: Point,
  tabSize: number,
): boolean {
  const docLine = view.state.doc.line(line);
  const parsed = parseLine(docLine.text, tabSize);
  if (!isListLine(parsed)) return false;

  const markerEnd =
    docLine.from
    + parsed.quote.prefix.length
    + parsed.indent.raw.length
    + listMarkerText(parsed).length;
  const coords = view.coordsAtPos(markerEnd, 1);
  if (!coords) return false;
  return point.x > coords.left;
}

/**
 * Absolute indent-width column of the pointer on a list line.
 * Uses document position (posAtCoords) + text column count — no pixel/char-width heuristics.
 */
function pointerColumn(
  view: EditorView,
  listLine: number,
  point: Point,
  tabSize: number,
): number | null {
  const docLine = view.state.doc.line(listLine);
  const parsed = parseLine(docLine.text, tabSize);
  if (!isListLine(parsed)) return null;

  const pos = view.posAtCoords({ x: point.x, y: point.y }, false);
  if (typeof pos !== 'number') return null;

  const clamped = Math.max(docLine.from, Math.min(docLine.to, pos));
  return columnsOf(docLine.text, clamped - docLine.from, tabSize);
}
