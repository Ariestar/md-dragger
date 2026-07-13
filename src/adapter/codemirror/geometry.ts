import type { EditorView } from '@codemirror/view';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';

// Host geometry for the CodeMirror adapter only.
// Domain/runtime never import this file.
//
// Line band = rendered line box with that line's own indent cut off
// (list marker stays in). Right edge is the line box, not text end.

export type LineBand = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** left − line-box left (selection CSS inset). */
  inset: number;
};

export type DropSeam = {
  left: number;
  right: number;
  y: number;
};

/** Line box minus this line's own indent. */
export function lineBand(
  view: EditorView,
  line: number,
  tabSize: number,
): LineBand | null {
  const doc = view.state.doc;
  if (line < 1 || line > doc.lines) return null;

  const docLine = doc.line(line);
  const el = lineEl(view, docLine.from);
  if (!el) return null;

  const box = el.getBoundingClientRect();
  const parsed = createLineParsingContext(tabSize).parseLine(docLine.text);
  const contentFrom = Math.min(
    docLine.to,
    docLine.from + parsed.quotePrefix.length + parsed.indentRaw.length,
  );

  let left = box.left;
  if (contentFrom > docLine.from) {
    const at = view.coordsAtPos(contentFrom, 1);
    if (at) left = at.left;
  }

  return {
    left,
    right: Math.max(left + 24, box.right),
    top: box.top,
    bottom: box.bottom,
    inset: Math.max(0, left - box.left),
  };
}

/**
 * Drop line before `beforeLine`:
 *   anchor = previous line (line 1 at top)
 *   y      = top of first line, else bottom of previous
 */
export function dropSeam(
  view: EditorView,
  beforeLine: number,
  tabSize: number,
): DropSeam | null {
  const doc = view.state.doc;
  if (doc.lines < 1 || beforeLine < 1) return null;

  const atTop = beforeLine <= 1;
  const anchor = atTop ? 1 : Math.min(beforeLine - 1, doc.lines);
  const band = lineBand(view, anchor, tabSize);
  if (!band) return null;

  return {
    left: band.left,
    right: band.right,
    y: atTop ? band.top : band.bottom,
  };
}

function lineEl(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.domAtPos(pos);
  let node: Node | null = dom.node;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  if (!(node instanceof Element)) return null;
  // Host line node class from the editor implementation.
  return node.closest('.cm-line');
}
