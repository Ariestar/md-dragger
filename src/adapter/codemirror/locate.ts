import { EditorView } from '@codemirror/view';
import type { Point, PressInput } from '../../runtime';
import { BlockType, computeListIntent, getLineMap, type BlockSelection, type DropTarget, type ListDropTarget } from '../../domain';
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
  const targetLineNumber = lineNumberFromPoint(view, point);
  if (targetLineNumber === null) return null;

  return {
    targetDoc: view.state.doc,
    targetLineNumber,
    placement: 'before',
    listIntent: resolveListIntent(view, point, selection, targetLineNumber, options),
  };
}

// Thin coordinate adapter: translate pointer pixels into the column-space
// inputs the domain computeListIntent expects, then map its result back to a
// ListDropTarget.
function resolveListIntent(
  view: EditorView,
  point: Point,
  selection: BlockSelection,
  targetLineNumber: number,
  options: MdDraggerCodeMirrorOptions
): ListDropTarget | undefined {
  if (selection.anchorBlock.type !== BlockType.ListItem) return undefined;

  const tabSize = resolveTabSize(options);
  const lineParsing = createLineParsingContext(tabSize);
  const doc = view.state.doc;
  const lineMap = getLineMap(doc, { tabSize });

  const referenceLineNumber = nearestListLineAtOrBefore(view, targetLineNumber, lineMap);
  if (referenceLineNumber === null) {
    return { mode: 'sibling', contextLineNumber: targetLineNumber, targetIndentWidth: 0 };
  }

  const markerX = markerStartX(view, referenceLineNumber, lineParsing.parseLine);
  if (markerX === null) {
    return { mode: 'sibling', contextLineNumber: referenceLineNumber, targetIndentWidth: 0 };
  }

  const columnPixelWidth = defaultCharacterWidth(view);
  const cursorOffsetColumns = (point.x - markerX) / columnPixelWidth;
  const indentUnit = lineParsing.getIndentUnitWidthForDoc(doc);

  // Self-target guard: dropping onto the source block's own root list line
  // forbids child (would make it its own child).
  const isSelfTarget = referenceLineNumber === selection.anchorBlock.startLine + 1;

  const intent = computeListIntent({
    doc,
    lineMap,
    referenceLineNumber,
    cursorOffsetColumns,
    indentUnit,
    allowChild: !isSelfTarget,
  });
  if (!intent) return undefined;
  return {
    mode: intent.mode,
    contextLineNumber: intent.contextLineNumber,
    targetIndentWidth: intent.targetIndentWidth,
  };
}

function nearestListLineAtOrBefore(
  view: EditorView,
  targetLineNumber: number,
  lineMap: ReturnType<typeof getLineMap>
): number | null {
  const doc = view.state.doc;
  const clamped = Math.max(1, Math.min(targetLineNumber, doc.lines));
  // Walk up from the target to find the nearest list line; fall back to a
  // small downward probe if the target itself isn't in a list.
  const meta = (() => { try { return lineMap.lineMeta[clamped] ?? null; } catch { return null; } })();
  if (meta?.isList) return clamped;
  for (let delta = 1; delta <= 2; delta++) {
    const up = clamped - delta;
    if (up >= 1) {
      const m = (() => { try { return lineMap.lineMeta[up] ?? null; } catch { return null; } })();
      if (m?.isList) return up;
    }
    const down = clamped + delta;
    if (down <= doc.lines) {
      const m = (() => { try { return lineMap.lineMeta[down] ?? null; } catch { return null; } })();
      if (m?.isList) return down;
    }
  }
  return null;
}

function markerStartX(view: EditorView, lineNumber: number, parseLine: (line: string) => ParsedLine): number | null {
  const line = view.state.doc.line(lineNumber);
  const parsed = parseLine(line.text);
  const offset = parsed.quotePrefix.length + parsed.indentRaw.length;
  const rect = view.coordsAtPos(Math.min(line.to, line.from + offset), 1);
  return rect?.left ?? null;
}

function defaultCharacterWidth(view: EditorView): number {
  const width = (view as unknown as { defaultCharacterWidth?: number }).defaultCharacterWidth;
  return typeof width === 'number' && width > 0 ? width : 8;
}

