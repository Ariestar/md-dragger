import type { EditorView } from '@codemirror/view';
import type { DropTarget } from '../../domain';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';

// Adapter: pixels only. No drop/list logic.
//
// Root bug: defaultCharacterWidth is average glyph width, not a space.
// In proportional fonts (e.g. Geist) that is ~half a space → indent looks half.
//
// Formula only:
//   left = textOrigin + targetIndentWidth * spaceWidth

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

/** Line box minus own indent (for selection paint). */
export function lineBand(view: EditorView, line: number, tabSize: number): LineBand | null {
  const doc = view.state.doc;
  if (line < 1 || line > doc.lines) return null;
  const docLine = doc.line(line);
  const el = lineEl(view, docLine.from);
  if (!el) return null;
  const box = el.getBoundingClientRect();

  const parsed = createLineParsingContext(tabSize).parseLine(docLine.text);
  const from = Math.min(docLine.to, docLine.from + parsed.quotePrefix.length + parsed.indentRaw.length);
  const left = from > docLine.from ? (view.coordsAtPos(from, 1)?.left ?? box.left) : box.left;

  return {
    left,
    right: Math.max(left + 24, box.right),
    top: box.top,
    bottom: box.bottom,
    inset: Math.max(0, left - box.left),
  };
}

/** Drop line: previous line box; left = origin + indent columns × space width. */
export function dropSeam(view: EditorView, target: DropTarget, _tabSize: number): DropSeam | null {
  const before = target.targetLineNumber;
  if (before < 1 || view.state.doc.lines < 1) return null;

  const atTop = before <= 1;
  const anchor = atTop ? 1 : Math.min(before - 1, view.state.doc.lines);
  const docLine = view.state.doc.line(anchor);
  const el = lineEl(view, docLine.from);
  if (!el) return null;
  const box = el.getBoundingClientRect();

  const cols = target.listIntent?.targetIndentWidth ?? 0;
  const origin = view.coordsAtPos(docLine.from, 1)?.left;
  if (origin === undefined) return null;

  const left = origin + cols * spaceWidth(view);

  return {
    left,
    right: Math.max(left + 24, box.right),
    y: atTop ? box.top : box.bottom,
  };
}

/** Width of one space column (not average glyph width). */
export function spaceWidth(view: EditorView): number {
  const doc = view.state.doc;
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    const i = line.text.indexOf(' ');
    if (i < 0) continue;
    const a = view.coordsAtPos(line.from + i, 1);
    const b = view.coordsAtPos(line.from + i + 1, 1);
    if (a && b && b.left > a.left) return b.left - a.left;
  }
  throw new Error('spaceWidth: document has no measurable space');
}

function lineEl(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.domAtPos(pos);
  let node: Node | null = dom.node;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  if (!(node instanceof Element)) return null;
  return node.closest('.cm-line');
}
