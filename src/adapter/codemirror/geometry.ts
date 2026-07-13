import type { EditorView } from '@codemirror/view';
import type { DropTarget } from '../../domain';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';

// Adapter-only: pixels for a domain DropTarget.
// Domain stays host-agnostic (line + indent only). No UX here — just measure.

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

/** Line box minus this line's own indent (marker stays in). */
export function lineBand(
  view: EditorView,
  line: number,
  tabSize: number,
): LineBand | null {
  return measureBand(view, line, tabSize);
}

/**
 * Paint geometry for a domain drop target:
 *   anchor = previous line (line 1 at top)
 *   left   = after list indent when present, else anchor's own indent
 *   right  = anchor line box (block width, not text end)
 *   y      = top of first line, else bottom of previous
 */
export function dropSeam(
  view: EditorView,
  target: DropTarget,
  tabSize: number,
): DropSeam | null {
  const beforeLine = target.targetLineNumber;
  if (beforeLine < 1 || view.state.doc.lines < 1) return null;

  const atTop = beforeLine <= 1;
  const anchor = atTop ? 1 : Math.min(beforeLine - 1, view.state.doc.lines);
  const band = measureBand(
    view,
    anchor,
    tabSize,
    target.listIntent?.targetIndentWidth,
  );
  if (!band) return null;

  return {
    left: band.left,
    right: band.right,
    y: atTop ? band.top : band.bottom,
  };
}

function measureBand(
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
  return node.closest('.cm-line');
}

function charWidth(view: EditorView): number {
  const width = (view as unknown as { defaultCharacterWidth?: number }).defaultCharacterWidth;
  return typeof width === 'number' && width > 0 ? width : 8;
}
