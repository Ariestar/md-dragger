import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { dropIndentWidth, parseLine, type DropPosition } from '../../domain';
import {
  resolveListIndentUnit,
  resolveListIndentWidthPx,
  type CodeMirrorGeometryOptions,
} from './config';

// Adapter geometry uses only Markdown structure, CodeMirror coordinates, and
// the host-owned pixel width of one list nesting level.

export type LineBand = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  inset: number;
};

export type DropSeam = {
  left: number;
  right: number;
  y: number;
};

/** Notion-like row block: after the list mark through the editor column edge. */
export function lineBand(
  view: EditorView,
  line: number,
  options: CodeMirrorGeometryOptions,
): LineBand | null {
  const doc = view.state.doc;
  if (line < 1 || line > doc.lines) return null;

  const docLine = doc.line(line);
  const tabSize = view.state.facet(EditorState.tabSize);
  const listIndentUnit = resolveListIndentUnit(options);
  const listIndentWidthPx = resolveListIndentWidthPx(options, view);
  const parsed = parseLine(docLine.text, tabSize);
  const origin = view.coordsAtPos(docLine.from, 1);
  if (!origin) return null;

  const listContentFrom = parsed.marker?.kind === 'list'
    ? docLine.from
      + parsed.quote.prefix.length
      + parsed.indent.raw.length
      + parsed.marker.text.length
    : null;
  const listContent = listContentFrom === null
    ? null
    : view.coordsAtPos(listContentFrom, 1);
  if (listContentFrom !== null && !listContent) return null;

  const left = listContent?.left
    ?? origin.left + parsed.indent.width / listIndentUnit * listIndentWidthPx;
  const right = view.contentDOM.getBoundingClientRect().right;
  const block = view.lineBlockAt(docLine.from);
  return {
    left,
    right: Math.max(left, right),
    top: view.documentTop + block.top,
    bottom: view.documentTop + block.bottom,
    inset: Math.max(0, left - origin.left),
  };
}

/** Drop indicator range from target list structure through the editor column edge. */
export function dropSeam(
  view: EditorView,
  position: DropPosition,
  options: CodeMirrorGeometryOptions,
): DropSeam | null {
  const doc = position.doc;
  const targetLine = position.line;
  const bandLine = targetLine <= 1 ? 1 : Math.min(targetLine - 1, doc.lines);
  if (bandLine < 1 || bandLine > doc.lines) return null;

  const band = doc.line(bandLine);
  const origin = view.coordsAtPos(band.from, 1);
  if (!origin) return null;

  const tabSize = view.state.facet(EditorState.tabSize);
  const listIndentUnit = resolveListIndentUnit(options);
  const listIndentWidthPx = resolveListIndentWidthPx(options, view);
  const indentWidth = dropIndentWidth(position, {
    tabSize,
    indentUnit: listIndentUnit,
  });
  const left = origin.left + indentWidth / listIndentUnit * listIndentWidthPx;
  const block = view.lineBlockAt(band.from);
  return {
    left,
    right: Math.max(left, view.contentDOM.getBoundingClientRect().right),
    y: view.documentTop + (targetLine <= 1 ? block.top : block.bottom),
  };
}
