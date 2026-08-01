import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { type DropPosition, parseLine } from '../../domain';
import { type CodeMirrorGeometryOptions, resolveListIndentUnit, resolveListIndentWidthPx } from './config';

// Content band = the block's rendered row, as an absolute viewport rect.
// Single geometry source for highlight, indicator, and x-axis locate — one
// coordinate system, no relative offsets.

export type LineBand = {
    left: number;
    right: number;
    top: number;
    bottom: number;
};

export type DropSeam = {
    left: number;
    right: number;
    y: number;
};

/**
 * Notion-like row block: absolute rect of one line's content band.
 *
 * Plain list lines anchor at the content edge and step one rendered
 * list-indent per nesting level, so the level-0 bullet (== paragraph column)
 * and every nested bullet sit inside the box. coordsAtPos(lineStart) alone
 * would land on the marker glyph (host CSS hanging indent) and leave the
 * bullet outside. All other lines (paragraph, quote, indented) keep their own
 * rendered text column.
 */
export function lineBand(view: EditorView, line: number, options: CodeMirrorGeometryOptions): LineBand | null {
    const doc = view.state.doc;
    if (line < 1 || line > doc.lines) return null;

    const docLine = doc.line(line);
    const parsed = parseLine(docLine.text, view.state.facet(EditorState.tabSize));
    const bandFrom = docLine.from + parsed.quote.prefix.length + parsed.indent.raw.length;

    let left: number;
    if (parsed.marker?.kind === 'list' && parsed.quote.prefix.length === 0) {
        const level = parsed.indent.width / resolveListIndentUnit(options);
        left = view.contentDOM.getBoundingClientRect().left + level * resolveListIndentWidthPx(options, view);
    } else {
        const content = view.coordsAtPos(bandFrom, 1);
        if (!content) return null;
        left = content.left;
    }

    const block = view.lineBlockAt(docLine.from);
    return {
        left,
        right: Math.max(left, view.contentDOM.getBoundingClientRect().right),
        top: view.documentTop + block.top,
        bottom: view.documentTop + block.bottom,
    };
}

/**
 * Drop indicator aligned to the content band, same geometry source as lineBand:
 * nested → parent content band + one rendered indent step;
 * root → the content edge (x said root, even over nested lines).
 */
export function dropSeam(
    view: EditorView,
    position: DropPosition,
    options: CodeMirrorGeometryOptions,
): DropSeam | null {
    const doc = position.doc;
    const targetLine = position.line;
    const bandLine = targetLine <= 1 ? 1 : Math.min(targetLine - 1, doc.lines);
    if (bandLine < 1 || bandLine > doc.lines) return null;

    let left: number;
    if (position.parent) {
        const anchor = lineBand(view, position.parent.lines.startLine, options);
        if (!anchor) return null;
        left = anchor.left + resolveListIndentWidthPx(options, view);
    } else {
        // Root intent: column 0 of the content area, same lattice as a level-0
        // band. Not the seam line's own coordsAtPos — that carries the host's
        // list hanging indent and would misalign over nested lines.
        left = view.contentDOM.getBoundingClientRect().left;
    }

    const block = view.lineBlockAt(doc.line(bandLine).from);
    return {
        left,
        right: Math.max(left, view.contentDOM.getBoundingClientRect().right),
        y: view.documentTop + (targetLine <= 1 ? block.top : block.bottom),
    };
}
