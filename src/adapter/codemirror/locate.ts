import { EditorView } from '@codemirror/view';
import type { Point, PressInput } from '../../runtime';
import {
  BlockType,
  clampTargetLineNumber,
  computeListIntent,
  getLineMap,
  getLineMetaAt,
  getNearestListLineAtOrBefore,
  resolveReferenceListLineNumber,
  type BlockSelection,
  type DropTarget,
  type ListDropTarget,
} from '../../domain';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';
import type { ParsedLine } from '../../domain/markdown/document-types';
import { HANDLE_CLASS, resolveTabSize, type MdDraggerCodeMirrorOptions } from './config';
import { nativePointerEvent } from './pointer-input';

export function sourceLineFromInput(view: EditorView, input: PressInput): number | null {
  const event = nativePointerEvent(input.native);
  const target = event?.target instanceof Element ? event.target : null;
  const handle = target?.closest(`.${HANDLE_CLASS}`);
  if (!handle) return null;
  return lineNumberFromPoint(view, input.point);
}

// Hit-test only: which document line the pointer is over.
// Drop insertion uses resolveDropTarget (half-line before/after).
export function lineNumberFromPoint(view: EditorView, point: Point): number | null {
  const contentRect = view.contentDOM.getBoundingClientRect();
  if (point.y <= contentRect.top) return 1;
  if (point.y >= contentRect.bottom) return view.state.doc.lines + 1;

  const pos = view.posAtCoords({ x: Math.max(contentRect.left + 1, point.x), y: point.y }, false);
  if (typeof pos !== 'number') return null;
  return view.state.doc.lineAt(pos).number;
}

export function resolveDropTarget(
  view: EditorView,
  point: Point,
  selection: BlockSelection,
  options: MdDraggerCodeMirrorOptions
): DropTarget | null {
  const hitLineNumber = lineNumberFromPoint(view, point);
  if (hitLineNumber === null) return null;

  const vertical = resolveVerticalTarget(view, hitLineNumber, point, selection, options);
  if (!vertical) return null;

  return {
    targetDoc: view.state.doc,
    targetLineNumber: vertical.targetLineNumber,
    placement: 'before',
    listIntent: resolveListIntent(
      view,
      point,
      selection,
      hitLineNumber,
      vertical,
      options,
    ),
  };
}

type VerticalTarget = {
  targetLineNumber: number;
  showAtBottom: boolean;
  childIntentOnLine: boolean;
};

// Production vertical rule (obsidian drop-target-resolver):
// - half-line split: upper → before line (target=line), lower → after (target=line+1)
// - list child intent (x past marker content on a list line, upper half):
//   force target = line+1 so nesting references the hovered row
function resolveVerticalTarget(
  view: EditorView,
  hitLineNumber: number,
  point: Point,
  selection: BlockSelection,
  options: MdDraggerCodeMirrorOptions,
): VerticalTarget | null {
  const doc = view.state.doc;
  if (hitLineNumber < 1) {
    return { targetLineNumber: 1, showAtBottom: false, childIntentOnLine: false };
  }
  if (hitLineNumber > doc.lines) {
    return {
      targetLineNumber: doc.lines + 1,
      showAtBottom: true,
      childIntentOnLine: false,
    };
  }

  const line = doc.line(hitLineNumber);
  const midY = lineMidY(view, line.from);
  const showAtBottom = midY !== null ? point.y > midY : true;

  let targetLineNumber = clampTargetLineNumber(
    doc.lines,
    showAtBottom ? hitLineNumber + 1 : hitLineNumber,
  );

  const parseLine = createLineParsingContext(resolveTabSize(options)).parseLine;
  const parsed = parseLine(line.text);
  const bounds = listMarkerBounds(view, hitLineNumber, parsed);
  const childIntentOnLine = selection.anchorBlock.type === BlockType.ListItem
    && !!bounds
    && parsed.isListItem
    && point.x >= bounds.contentStartX + 2;

  // Nest into the hovered list row: insertion after it, reference = this row.
  if (childIntentOnLine && !showAtBottom) {
    targetLineNumber = clampTargetLineNumber(doc.lines, hitLineNumber + 1);
  }

  return { targetLineNumber, showAtBottom, childIntentOnLine };
}

function resolveListIntent(
  view: EditorView,
  point: Point,
  selection: BlockSelection,
  hitLineNumber: number,
  vertical: VerticalTarget,
  options: MdDraggerCodeMirrorOptions
): ListDropTarget | undefined {
  if (selection.anchorBlock.type !== BlockType.ListItem) return undefined;

  const tabSize = resolveTabSize(options);
  const lineParsing = createLineParsingContext(tabSize);
  const doc = view.state.doc;
  const lineMap = getLineMap(doc, { tabSize });
  const { targetLineNumber, childIntentOnLine } = vertical;

  // Production reference:
  //   prevNonEmpty(target - 1), or the hit line when childIntentOnLine.
  let referenceLineNumber: number | null = null;
  if (childIntentOnLine) {
    referenceLineNumber = hitLineNumber;
  } else {
    referenceLineNumber = nonEmptyAtOrBefore(lineMap, targetLineNumber - 1)
      ?? getNearestListLineAtOrBefore(lineMap, Math.max(1, targetLineNumber - 1));
  }
  if (referenceLineNumber === null || referenceLineNumber < 1) {
    return { mode: 'sibling', contextLineNumber: targetLineNumber, targetIndentWidth: 0 };
  }

  const baseLineNumber = resolveReferenceListLineNumber(referenceLineNumber, lineMap)
    ?? referenceLineNumber;

  const markerX = markerStartX(view, baseLineNumber, lineParsing.parseLine);
  if (markerX === null) {
    return { mode: 'sibling', contextLineNumber: baseLineNumber, targetIndentWidth: 0 };
  }

  const columnPixelWidth = defaultCharacterWidth(view);
  const cursorOffsetColumns = (point.x - markerX) / columnPixelWidth;
  const indentUnit = lineParsing.getIndentUnitWidthForDoc(doc);
  const isSelfTarget = baseLineNumber === selection.anchorBlock.startLine + 1;

  const intent = computeListIntent({
    doc,
    lineMap,
    referenceLineNumber: baseLineNumber,
    cursorOffsetColumns,
    indentUnit,
    allowChild: !isSelfTarget,
  });
  if (!intent) return undefined;

  // Cap indent between prev list indent and next list indent.
  let targetIndentWidth = intent.targetIndentWidth;
  const baseIndent = getLineMetaAt(lineMap, baseLineNumber)?.indentWidth;
  if (typeof baseIndent === 'number') {
    targetIndentWidth = Math.min(targetIndentWidth, baseIndent + indentUnit);
  }
  if (targetLineNumber <= doc.lines) {
    const nextMeta = getLineMetaAt(lineMap, targetLineNumber);
    if (nextMeta?.isList) {
      targetIndentWidth = Math.max(
        targetIndentWidth,
        Math.max(0, nextMeta.indentWidth - indentUnit),
      );
    }
  }

  return {
    mode: intent.mode,
    contextLineNumber: intent.contextLineNumber,
    targetIndentWidth,
  };
}

// prevNonEmpty[i] = nearest non-empty line at or before i (includes i if non-empty).
function nonEmptyAtOrBefore(
  lineMap: ReturnType<typeof getLineMap>,
  fromLine: number,
): number | null {
  if (fromLine < 1) return null;
  const clamped = Math.min(fromLine, lineMap.doc.lines);
  const prev = lineMap.prevNonEmpty[clamped];
  return typeof prev === 'number' && prev > 0 ? prev : null;
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
  parsed: ParsedLine,
): { markerStartX: number; contentStartX: number } | null {
  if (!parsed.isListItem) return null;
  const line = view.state.doc.line(lineNumber);
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
  if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
  const line = view.state.doc.line(lineNumber);
  const parsed = parseLine(line.text);
  if (!parsed.isListItem) return null;
  const offset = parsed.quotePrefix.length + parsed.indentRaw.length;
  const rect = view.coordsAtPos(Math.min(line.to, line.from + offset), 1);
  return rect?.left ?? null;
}

function defaultCharacterWidth(view: EditorView): number {
  const width = (view as unknown as { defaultCharacterWidth?: number }).defaultCharacterWidth;
  return typeof width === 'number' && width > 0 ? width : 8;
}
