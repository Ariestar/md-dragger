import type { EditorView } from '@codemirror/view';
import type { DropTarget } from '../../domain';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';

// Adapter: pixels only. No drop rules, no width estimation.
//
// Host supplies columnWidthPx (platform/theme dependent).
// left = lineOrigin + targetIndentWidth * columnWidthPx

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

/** Line box minus own indent (selection). */
export function lineBand(view: EditorView, line: number, tabSize: number): LineBand | null {
  const doc = view.state.doc;
  if (line < 1 || line > doc.lines) return null;
  const docLine = doc.line(line);
  const el = lineEl(view, docLine.from);
  if (!el) return null;
  const box = el.getBoundingClientRect();

  const parsed = createLineParsingContext(tabSize).parseLine(docLine.text);
  const from = Math.min(
    docLine.to,
    docLine.from + parsed.quotePrefix.length + parsed.indentRaw.length,
  );
  const left = from > docLine.from
    ? (view.coordsAtPos(from, 1)?.left ?? box.left)
    : box.left;

  return {
    left,
    right: Math.max(left + 24, box.right),
    top: box.top,
    bottom: box.bottom,
    inset: Math.max(0, left - box.left),
  };
}

/**
 * Drop line for a domain DropTarget.
 * @param columnWidthPx host-supplied pixel width of one indent column
 */
export function dropSeam(
  view: EditorView,
  target: DropTarget,
  columnWidthPx: number,
): DropSeam | null {
  if (!(columnWidthPx > 0)) {
    throw new Error(`dropSeam: columnWidthPx must be positive, got ${String(columnWidthPx)}`);
  }

  const before = target.targetLineNumber;
  if (before < 1 || view.state.doc.lines < 1) return null;

  const atTop = before <= 1;
  const anchor = atTop ? 1 : Math.min(before - 1, view.state.doc.lines);
  const docLine = view.state.doc.line(anchor);
  const el = lineEl(view, docLine.from);
  if (!el) return null;
  const box = el.getBoundingClientRect();

  const cols = target.listIntent?.targetIndentWidth ?? 0;
  if (cols < 0) throw new Error(`dropSeam: invalid targetIndentWidth ${cols}`);

  const origin = view.coordsAtPos(docLine.from, 1)?.left;
  if (origin === undefined) return null;

  const left = origin + cols * columnWidthPx;

  return {
    left,
    right: Math.max(left + 24, box.right),
    y: atTop ? box.top : box.bottom,
  };
}

function lineEl(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.domAtPos(pos);
  let node: Node | null = dom.node;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  if (!(node instanceof Element)) return null;
  return node.closest('.cm-line');
}
