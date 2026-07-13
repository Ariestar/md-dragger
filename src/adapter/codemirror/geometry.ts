import type { EditorView } from '@codemirror/view';
import type { DropTarget } from '../../domain';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';

// Adapter UX mapping only — no indent math, no column estimation.
// Domain DropTarget.guide already chose bandLine / leftLine / leftChars.

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

/** Map domain DropTarget.guide → screen seam. No calculations beyond coords. */
export function dropSeam(view: EditorView, target: DropTarget): DropSeam | null {
  const guide = target.guide;
  if (!guide) return null;
  const { bandLine, leftLine, leftChars } = guide;
  const doc = view.state.doc;
  if (bandLine < 1 || bandLine > doc.lines) return null;
  if (leftLine < 1 || leftLine > doc.lines) return null;

  const band = doc.line(bandLine);
  const bandEl = lineEl(view, band.from);
  if (!bandEl) return null;
  const box = bandEl.getBoundingClientRect();

  const leftDoc = doc.line(leftLine);
  const leftPos = Math.min(leftDoc.to, leftDoc.from + Math.max(0, leftChars));
  const left = view.coordsAtPos(leftPos, 1)?.left;
  if (left === undefined) return null;

  const atTop = target.targetLineNumber <= 1;
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
