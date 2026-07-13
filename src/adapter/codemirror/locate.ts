import { EditorView } from '@codemirror/view';
import type { Point, PressInput } from '../../runtime';
import {
  locateDropTarget,
  type BlockSelection,
  type DropTarget,
} from '../../domain';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';
import type { ParsedLine } from '../../domain/markdown/document-types';
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

// Adapter measures pointer → domain facts; domain returns DropTarget + guide.
export function resolveDropTarget(
  view: EditorView,
  point: Point,
  selection: BlockSelection,
  options: MdDraggerCodeMirrorOptions,
): DropTarget | null {
  const hitLine = lineAtPoint(view, point);
  if (hitLine === null) return null;

  const doc = view.state.doc;
  const tabSize = resolveTabSize(options);
  const indentUnit = resolveListIndentUnit(options);
  const parseLine = createLineParsingContext(tabSize).parseLine;
  const inDoc = hitLine >= 1 && hitLine <= doc.lines;

  const located = locateDropTarget({
    doc,
    selection,
    hitLine,
    belowMid: inDoc ? belowMid(view, hitLine, point.y) : hitLine > doc.lines,
    pastMarker: inDoc ? pastMarker(view, hitLine, point.x, parseLine) : false,
    markerOffset: (listLine) => markerOffset(view, listLine, point.x, parseLine),
    tabSize,
    indentUnit,
  });
  if (!located) return null;

  return {
    targetDoc: doc,
    targetLineNumber: located.targetLineNumber,
    placement: located.placement,
    listIntent: located.listIntent,
    guide: located.guide,
  };
}

function belowMid(view: EditorView, line: number, y: number): boolean {
  const from = view.state.doc.line(line).from;
  try {
    const block = view.lineBlockAt(from);
    return y > view.documentTop + (block.top + block.bottom) / 2;
  } catch {
    const coords = view.coordsAtPos(from, 1);
    if (!coords) throw new Error('belowMid: cannot measure line mid-Y');
    return y > (coords.top + coords.bottom) / 2;
  }
}

function pastMarker(
  view: EditorView,
  line: number,
  x: number,
  parseLine: (text: string) => ParsedLine,
): boolean {
  const bounds = listBounds(view, line, parseLine);
  return !!bounds && x >= bounds.textX + 2;
}

function markerOffset(
  view: EditorView,
  line: number,
  x: number,
  parseLine: (text: string) => ParsedLine,
): number | null {
  const bounds = listBounds(view, line, parseLine);
  if (!bounds) return null;
  // Input only: columns from marker. Use the span of one space on this line if present,
  // else the marker→text gap (host-measured, not estimated in domain).
  const unit = spaceOnLine(view, line) ?? Math.max(1, bounds.textX - bounds.markerX);
  return (x - bounds.markerX) / unit;
}

function spaceOnLine(view: EditorView, line: number): number | null {
  const docLine = view.state.doc.line(line);
  const i = docLine.text.indexOf(' ');
  if (i < 0) return null;
  const a = view.coordsAtPos(docLine.from + i, 1);
  const b = view.coordsAtPos(docLine.from + i + 1, 1);
  if (!a || !b || b.left <= a.left) return null;
  return b.left - a.left;
}

function listBounds(
  view: EditorView,
  line: number,
  parseLine: (text: string) => ParsedLine,
): { markerX: number; textX: number } | null {
  if (line < 1 || line > view.state.doc.lines) return null;
  const docLine = view.state.doc.line(line);
  const parsed = parseLine(docLine.text);
  if (!parsed.isListItem) return null;

  const markerPos = docLine.from + parsed.quotePrefix.length + parsed.indentRaw.length;
  const textPos = markerPos + parsed.marker.length;
  const marker = view.coordsAtPos(Math.min(docLine.to, markerPos), 1);
  const text = view.coordsAtPos(Math.min(docLine.to, textPos), 1);
  if (!marker || !text) return null;
  return { markerX: marker.left, textX: text.left };
}
