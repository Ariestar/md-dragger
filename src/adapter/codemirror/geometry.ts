import type { EditorView } from '@codemirror/view';
import type { DropPosition } from '../../domain';
import { dropIndentWidth } from '../../domain';
import {
  resolveListIndentUnit,
  resolveTabSize,
  type MdDraggerCodeMirrorOptions,
} from './config';

// Adapter: pixels only.
//
// ink-mde list indent is laid out as nest-level widgets, not plain spaces.
// left = origin + (indentWidth / listIndentUnit) * nestStepPx

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

export type DropSeamOptions = {
  listIndentUnit: number;
  tabSize: number;
};

/** Selection: line box; left = marker start (after own indent only). */
export function lineBand(view: EditorView, line: number, tabSize: number): LineBand | null {
  const doc = view.state.doc;
  if (line < 1 || line > doc.lines) return null;
  const docLine = doc.line(line);
  const el = lineEl(view, docLine.from);
  if (!el) return null;
  const box = el.getBoundingClientRect();

  const left = markerStartX(view, line, tabSize) ?? box.left;
  return {
    left,
    right: Math.max(left + 24, box.right),
    top: box.top,
    bottom: box.bottom,
    inset: Math.max(0, left - box.left),
  };
}

/** Drop seam from DropPosition (no guide field). */
export function dropSeam(
  view: EditorView,
  position: DropPosition,
  options: DropSeamOptions,
): DropSeam | null {
  if (!(options.listIndentUnit > 0)) {
    throw new Error(`dropSeam: listIndentUnit must be positive, got ${String(options.listIndentUnit)}`);
  }

  const doc = position.doc;
  const targetLine = position.line;
  const bandLine = targetLine <= 1 ? 1 : Math.min(targetLine - 1, doc.lines);
  if (bandLine < 1 || bandLine > doc.lines) return null;

  const band = doc.line(bandLine);
  const el = lineEl(view, band.from);
  if (!el) return null;
  const box = el.getBoundingClientRect();

  const origin = view.coordsAtPos(band.from, 1)?.left;
  if (origin === undefined) return null;

  const tabSize = options.tabSize;
  if (!(tabSize > 0)) {
    throw new Error(`dropSeam: tabSize must be positive, got ${String(tabSize)}`);
  }
  const indentCols = Math.max(0, dropIndentWidth(position, {
    tabSize,
    indentUnit: options.listIndentUnit,
  }));
  const levels = indentCols / options.listIndentUnit;
  const left = origin + levels * nestStepPx(view, options.listIndentUnit);

  const atTop = targetLine <= 1;
  return {
    left,
    right: Math.max(left + 24, box.right),
    y: atTop ? box.top : box.bottom,
  };
}

export function dropSeamFromOptions(
  view: EditorView,
  position: DropPosition,
  options: MdDraggerCodeMirrorOptions,
): DropSeam | null {
  return dropSeam(view, position, {
    listIndentUnit: resolveListIndentUnit(options),
    tabSize: resolveTabSize(options),
  });
}

function nestStepPx(view: EditorView, listIndentUnit: number): number {
  const indentEl = view.contentDOM.querySelector('.ink-mde-indent') as HTMLElement | null;
  if (indentEl) {
    const w = indentEl.getBoundingClientRect().width;
    if (w > 0) return w;
  }
  const rem = parseFloat(getComputedStyle(view.contentDOM).fontSize || '16') || 16;
  return 2 * rem;
}

function markerStartX(view: EditorView, line: number, _tabSize: number): number | null {
  const docLine = view.state.doc.line(line);
  return view.coordsAtPos(docLine.from, 1)?.left ?? null;
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
