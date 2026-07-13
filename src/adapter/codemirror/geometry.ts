import type { EditorView } from '@codemirror/view';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';

// Host geometry for the CodeMirror adapter only.
// Domain/runtime never import this file.
//
// Line band = rendered line box with leading indent cut off (marker in).
// Right edge is always the line box, not text end.

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

export type DropSeamOptions = {
  tabSize: number;
  /**
   * Absolute indent columns for the drop (listIntent.targetIndentWidth).
   * Omit to use the anchor line's own indent.
   */
  indent?: number;
};

/** Line box minus this line's own indent. */
export function lineBand(
  view: EditorView,
  line: number,
  tabSize: number,
): LineBand | null {
  return bandAt(view, line, tabSize);
}

/**
 * Drop line before `beforeLine`:
 *   anchor = previous line (line 1 at top)
 *   right  = anchor line box right (block width)
 *   left   = anchor line box after `indent` columns (nest level preview)
 *   y      = top of first line, else bottom of previous
 */
export function dropSeam(
  view: EditorView,
  beforeLine: number,
  options: DropSeamOptions,
): DropSeam | null {
  const doc = view.state.doc;
  if (doc.lines < 1 || beforeLine < 1) return null;

  const atTop = beforeLine <= 1;
  const anchor = atTop ? 1 : Math.min(beforeLine - 1, doc.lines);
  const band = bandAt(view, anchor, options.tabSize, options.indent);
  if (!band) return null;

  return {
    left: band.left,
    right: band.right,
    y: atTop ? band.top : band.bottom,
  };
}

function bandAt(
  view: EditorView,
  line: number,
  tabSize: number,
  indent?: number,
): LineBand | null {
  const doc = view.state.doc;
  if (line < 1 || line > doc.lines) return null;

  const docLine = doc.line(line);
  const el = lineEl(view, docLine.from);
  if (!el) return null;

  const box = el.getBoundingClientRect();
  const parsed = createLineParsingContext(tabSize).parseLine(docLine.text);
  const targetIndent = Math.max(0, indent ?? parsed.indentWidth);

  // Walk leading columns on this line; project any remaining with char width.
  const walked = walkIndent(docLine.text, parsed.quotePrefix.length, targetIndent, tabSize);
  let left = box.left;
  if (walked.chars > 0) {
    const at = view.coordsAtPos(Math.min(docLine.to, docLine.from + walked.chars), 1);
    if (at) left = at.left;
  }
  if (walked.width < targetIndent) {
    left += (targetIndent - walked.width) * charWidth(view);
  }

  return {
    left,
    right: Math.max(left + 24, box.right),
    top: box.top,
    bottom: box.bottom,
    inset: Math.max(0, left - box.left),
  };
}

function walkIndent(
  text: string,
  quoteLen: number,
  target: number,
  tabSize: number,
): { chars: number; width: number } {
  let width = 0;
  let chars = 0;
  const body = text.slice(quoteLen);
  for (const ch of body) {
    if (width >= target) break;
    if (ch === ' ') {
      width += 1;
      chars += 1;
      continue;
    }
    if (ch === '\t') {
      width += tabSize;
      chars += 1;
      continue;
    }
    break;
  }
  return { chars: quoteLen + chars, width };
}

function lineEl(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.domAtPos(pos);
  let node: Node | null = dom.node;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  if (!(node instanceof Element)) return null;
  // Host line node class from the editor implementation.
  return node.closest('.cm-line');
}

function charWidth(view: EditorView): number {
  const width = (view as unknown as { defaultCharacterWidth?: number }).defaultCharacterWidth;
  return typeof width === 'number' && width > 0 ? width : 8;
}
