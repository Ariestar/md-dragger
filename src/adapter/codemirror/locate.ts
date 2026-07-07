import { EditorView } from '@codemirror/view';
import type { Point, PressInput } from '../../runtime';
import {
  BlockType,
  type BlockSelection,
  type DropTarget,
  type ListDropTarget,
} from '../../domain';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';
import type { ParsedLine } from '../../domain/markdown/document-types';
import {
  HANDLE_CLASS,
  LIST_INTENT_THRESHOLD_PX,
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
    targetLineNumber,
    placement: 'before',
    listIntent: resolveListIntent(view, point, selection, targetLineNumber, options),
  };
}

function resolveListIntent(
  view: EditorView,
  point: Point,
  selection: BlockSelection,
  targetLineNumber: number,
  options: MdDraggerCodeMirrorOptions
): ListDropTarget | undefined {
  if (selection.anchorBlock.type !== BlockType.ListItem) return undefined;

  const lineParsing = createLineParsingContext(resolveTabSize(options));
  const sourceBase = firstListLine(selection.anchorBlock.content, lineParsing.parseLine);
  if (!sourceBase) return undefined;

  const context = findListContext(view, targetLineNumber, lineParsing.parseLine);
  if (!context) {
    return {
      mode: 'sibling',
      contextLineNumber: targetLineNumber,
      targetIndentWidth: 0,
    };
  }

  const indentUnitWidth = lineParsing.getIndentUnitWidth(context.parsed.indentRaw || sourceBase.indentRaw);
  const markerX = markerStartX(view, context.lineNumber, context.parsed);
  const horizontalDelta = markerX === null ? 0 : point.x - markerX;
  const mode = horizontalDelta >= LIST_INTENT_THRESHOLD_PX
    ? 'child'
    : horizontalDelta <= -LIST_INTENT_THRESHOLD_PX
      ? 'outdent'
      : 'sibling';
  const targetIndentWidth = Math.max(0, context.parsed.indentWidth + (
    mode === 'child' ? indentUnitWidth : mode === 'outdent' ? -indentUnitWidth : 0
  ));

  return {
    mode,
    contextLineNumber: context.lineNumber,
    targetIndentWidth,
  };
}

function firstListLine(text: string, parseLine: (line: string) => ParsedLine): { indentRaw: string } | null {
  for (const line of text.split('\n')) {
    const parsed = parseLine(line);
    if (parsed.isListItem) {
      return { indentRaw: parsed.indentRaw };
    }
  }
  return null;
}

function findListContext(
  view: EditorView,
  targetLineNumber: number,
  parseLine: (line: string) => ParsedLine
): { lineNumber: number; parsed: ParsedLine } | null {
  const doc = view.state.doc;
  const candidates = [
    Math.min(targetLineNumber, doc.lines),
    targetLineNumber - 1,
    targetLineNumber + 1,
  ];
  const seen = new Set<number>();
  for (const lineNumber of candidates) {
    if (lineNumber < 1 || lineNumber > doc.lines || seen.has(lineNumber)) continue;
    seen.add(lineNumber);
    const parsed = parseLine(doc.line(lineNumber).text);
    if (parsed.isListItem) return { lineNumber, parsed };
  }
  return null;
}

function markerStartX(view: EditorView, lineNumber: number, parsed: ParsedLine): number | null {
  const line = view.state.doc.line(lineNumber);
  const offset = parsed.quotePrefix.length + parsed.indentRaw.length;
  const rect = view.coordsAtPos(Math.min(line.to, line.from + offset), 1);
  return rect?.left ?? null;
}
