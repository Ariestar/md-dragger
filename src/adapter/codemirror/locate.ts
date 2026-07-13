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

export function sourceLineFromInput(view: EditorView, input: PressInput): number | null {
  const event = nativePointerEvent(input.native);
  const target = event?.target instanceof Element ? event.target : null;
  const handle = target?.closest(`.${HANDLE_CLASS}`);
  if (!handle) return null;
  return lineNumberFromPoint(view, input.point);
}

// Hit-test only: which document line the pointer is over.
export function lineNumberFromPoint(view: EditorView, point: Point): number | null {
  const contentRect = view.contentDOM.getBoundingClientRect();
  if (point.y <= contentRect.top) return 1;
  if (point.y >= contentRect.bottom) return view.state.doc.lines + 1;

  const pos = view.posAtCoords({ x: Math.max(contentRect.left + 1, point.x), y: point.y }, false);
  if (typeof pos !== 'number') return null;
  return view.state.doc.lineAt(pos).number;
}

// Adapter = measure pixels. Domain owns half-line + list intent.
// listIndentUnit comes from host config — no silent default, no doc-sample guess.
export function resolveDropTarget(
  view: EditorView,
  point: Point,
  selection: BlockSelection,
  options: MdDraggerCodeMirrorOptions
): DropTarget | null {
  const hitLineNumber = lineNumberFromPoint(view, point);
  if (hitLineNumber === null) return null;

  const doc = view.state.doc;
  const tabSize = resolveTabSize(options);
  const listIndentUnit = resolveListIndentUnit(options);
  const lineParsing = createLineParsingContext(tabSize);

  const belowMidLine = hitLineNumber >= 1 && hitLineNumber <= doc.lines
    ? isBelowMidLine(view, hitLineNumber, point.y)
    : hitLineNumber > doc.lines;

  const pastListContentStart = hitLineNumber >= 1 && hitLineNumber <= doc.lines
    ? isPastListContentStart(view, hitLineNumber, point.x, lineParsing.parseLine)
    : false;

  const located = locateDropTarget({
    doc,
    selection,
    hitLineNumber,
    belowMidLine,
    pastListContentStart,
    cursorOffsetColumnsFromMarker: (listLineNumber) =>
      cursorOffsetColumnsFromMarker(view, listLineNumber, point.x, lineParsing.parseLine),
    tabSize,
    indentUnit: listIndentUnit,
  });
  if (!located) return null;

  return {
    targetDoc: doc,
    targetLineNumber: located.targetLineNumber,
    placement: located.placement,
    listIntent: located.listIntent,
  };
}

function isBelowMidLine(view: EditorView, lineNumber: number, clientY: number): boolean {
  const line = view.state.doc.line(lineNumber);
  const midY = lineMidY(view, line.from);
  if (midY === null) {
    throw new Error('isBelowMidLine: cannot measure line mid-Y');
  }
  return clientY > midY;
}

function isPastListContentStart(
  view: EditorView,
  lineNumber: number,
  clientX: number,
  parseLine: (line: string) => ParsedLine,
): boolean {
  const bounds = listMarkerBounds(view, lineNumber, parseLine);
  return !!bounds && clientX >= bounds.contentStartX + 2;
}

function cursorOffsetColumnsFromMarker(
  view: EditorView,
  listLineNumber: number,
  clientX: number,
  parseLine: (line: string) => ParsedLine,
): number | null {
  const markerX = markerStartX(view, listLineNumber, parseLine);
  if (markerX === null) return null;
  const charWidth = defaultCharacterWidth(view);
  return (clientX - markerX) / charWidth;
}

function lineMidY(view: EditorView, lineFromPos: number): number | null {
  try {
    const block = view.lineBlockAt(lineFromPos);
    return view.documentTop + (block.top + block.bottom) / 2;
  } catch {
    const coords = view.coordsAtPos(lineFromPos, 1);
    if (!coords) return null;
    return (coords.top + coords.bottom) / 2;
  }
}

function listMarkerBounds(
  view: EditorView,
  lineNumber: number,
  parseLine: (line: string) => ParsedLine,
): { markerStartX: number; contentStartX: number } | null {
  if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
  const line = view.state.doc.line(lineNumber);
  const parsed = parseLine(line.text);
  if (!parsed.isListItem) return null;
  const markerStartPos = line.from + parsed.quotePrefix.length + parsed.indentRaw.length;
  const contentStartPos = markerStartPos + parsed.marker.length;
  const markerStart = view.coordsAtPos(Math.min(line.to, markerStartPos), 1);
  const contentStart = view.coordsAtPos(Math.min(line.to, contentStartPos), 1);
  if (!markerStart || !contentStart) return null;
  return {
    markerStartX: markerStart.left,
    contentStartX: contentStart.left,
  };
}

function markerStartX(
  view: EditorView,
  lineNumber: number,
  parseLine: (line: string) => ParsedLine,
): number | null {
  return listMarkerBounds(view, lineNumber, parseLine)?.markerStartX ?? null;
}

function defaultCharacterWidth(view: EditorView): number {
  const width = (view as unknown as { defaultCharacterWidth?: number }).defaultCharacterWidth;
  if (!(typeof width === 'number' && width > 0)) {
    throw new Error('defaultCharacterWidth: EditorView has no character width');
  }
  return width;
}
