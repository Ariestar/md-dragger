import type { EditorView } from '@codemirror/view';
import type { DropPosition } from '../../domain';

// Adapter paint: screen geometry from DropPosition structure + real line DOM.
// No indent-column math, no "first .ink-mde-indent in document" heuristics.

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

/** Selection highlight: line box. */
export function lineBand(view: EditorView, line: number): LineBand | null {
  const doc = view.state.doc;
  if (line < 1 || line > doc.lines) return null;
  const el = lineEl(view, doc.line(line).from);
  if (!el) return null;
  const box = el.getBoundingClientRect();
  const left = contentLeft(view, line) ?? box.left;
  return {
    left,
    right: Math.max(left + 24, box.right),
    top: box.top,
    bottom: box.bottom,
    inset: Math.max(0, left - box.left),
  };
}

/**
 * Drop indicator from structure only:
 * - y: seam from line above insert (or first line top)
 * - left: root → content left of band line;
 *         nested → content left of parent head + one nest widget on that line
 */
export function dropSeam(view: EditorView, position: DropPosition): DropSeam | null {
  const doc = position.doc;
  const targetLine = position.line;
  const bandLine = targetLine <= 1 ? 1 : Math.min(targetLine - 1, doc.lines);
  if (bandLine < 1 || bandLine > doc.lines) return null;

  const el = lineEl(view, doc.line(bandLine).from);
  if (!el) return null;
  const box = el.getBoundingClientRect();

  let left: number | null;
  if (position.parent) {
    const parentLine = position.parent.lines.startLine;
    left = nestContentLeft(view, parentLine);
  } else {
    left = contentLeft(view, bandLine);
  }
  if (left === null) return null;

  const atTop = targetLine <= 1;
  return {
    left,
    right: Math.max(left + 24, box.right),
    y: atTop ? box.top : box.bottom,
  };
}

/** Left edge of line content after ink-mde indent widgets (or line start). */
function contentLeft(view: EditorView, lineNumber: number): number | null {
  const doc = view.state.doc;
  if (lineNumber < 1 || lineNumber > doc.lines) return null;
  const from = doc.line(lineNumber).from;
  const el = lineEl(view, from);
  if (!el) return view.coordsAtPos(from, 1)?.left ?? null;

  const indents = el.querySelectorAll('.ink-mde-indent');
  if (indents.length > 0) {
    const last = indents[indents.length - 1] as HTMLElement;
    return last.getBoundingClientRect().right;
  }
  return view.coordsAtPos(from, 1)?.left ?? el.getBoundingClientRect().left;
}

/**
 * Where a child of this list item would start: after this line's indents + one nest step.
 * Nest step width taken from an indent widget on this line (structure DOM), not a global first match.
 */
function nestContentLeft(view: EditorView, parentLine: number): number | null {
  const base = contentLeft(view, parentLine);
  if (base === null) return null;

  const doc = view.state.doc;
  if (parentLine < 1 || parentLine > doc.lines) return base;
  const el = lineEl(view, doc.line(parentLine).from);
  if (!el) return base;

  const indent = el.querySelector('.ink-mde-indent') as HTMLElement | null;
  const step = indent?.getBoundingClientRect().width ?? 0;
  return base + Math.max(0, step);
}

function lineEl(view: EditorView, pos: number): HTMLElement | null {
  try {
    const block = view.lineBlockAt(pos);
    const dom = view.domAtPos(block.from);
    let node: Node | null = dom.node;
    if (node.nodeType === 3) node = node.parentElement;
    return node instanceof HTMLElement ? node.closest('.cm-line') : null;
  } catch {
    return null;
  }
}
