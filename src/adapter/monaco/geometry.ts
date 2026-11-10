import type { editor } from 'monaco-editor';
import { type DropPosition, listLevel, seamRow } from '../../domain';
import { type MdDraggerMonacoOptions, resolveConfig, resolveListIndentWidthPx } from './config';

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
 * Returns the absolute viewport bounding rect of a line's content band.
 * List items step horizontally by nesting level based on listIndentWidthPx.
 */
export function lineBand(
    codeEditor: editor.ICodeEditor,
    line: number,
    options: MdDraggerMonacoOptions,
): LineBand | null {
    const model = codeEditor.getModel();
    if (!model || line < 1 || line > model.getLineCount()) return null;

    const domNode = codeEditor.getDomNode();
    if (!domNode) return null;

    const domRect = domNode.getBoundingClientRect();
    const layout = codeEditor.getLayoutInfo();
    const scrollTop = codeEditor.getScrollTop();

    const lineTop = domRect.top + codeEditor.getTopForLineNumber(line) - scrollTop;
    const contentLeft = domRect.left + layout.contentLeft - codeEditor.getScrollLeft();
    const contentRight = domRect.left + layout.contentLeft + layout.contentWidth;

    const lineText = model.getLineContent(line);
    const resolvedConfig = resolveConfig(options.config);
    const level = listLevel(lineText, resolvedConfig.tabSize, resolvedConfig.listIndentUnit);
    const indentStepPx = resolveListIndentWidthPx(options, codeEditor);

    const left = contentLeft + level * indentStepPx;

    return {
        left,
        right: Math.max(left, contentRight),
        top: lineTop,
        bottom: domRect.top + codeEditor.getBottomForLineNumber(line) - scrollTop,
    };
}

/**
 * Computes the absolute screen geometry of the drop indicator seam.
 * Root drops align to the content edge; nested drops align to the parent item + one indent step.
 */
export function dropSeam(
    codeEditor: editor.ICodeEditor,
    position: DropPosition,
    options: MdDraggerMonacoOptions,
): DropSeam | null {
    const model = codeEditor.getModel();
    if (!model) return null;

    const domNode = codeEditor.getDomNode();
    if (!domNode) return null;

    const domRect = domNode.getBoundingClientRect();
    const layout = codeEditor.getLayoutInfo();
    const scrollTop = codeEditor.getScrollTop();
    const lineCount = model.getLineCount();

    const { row, edge } = seamRow(position);
    if (row < 1 || row > lineCount) return null;
    let left: number;

    if (position.parent) {
        const anchor = lineBand(codeEditor, position.parent.lines.startLine, options);
        if (!anchor) return null;
        left = anchor.left + resolveListIndentWidthPx(options, codeEditor);
    } else {
        left = domRect.left + layout.contentLeft - codeEditor.getScrollLeft();
    }

    const top = codeEditor.getTopForLineNumber(row);
    const bottom = codeEditor.getBottomForLineNumber(row);
    // Below a row is the top of the next one, past any view zone between them, where an insertion there shows.
    const below = row < lineCount ? codeEditor.getTopForLineNumber(row + 1) : bottom;
    const y = domRect.top + (edge === 'top' ? top : edge === 'below' ? below : (top + bottom) / 2) - scrollTop;

    const right = Math.max(left, domRect.left + layout.contentLeft + layout.contentWidth);

    return {
        left,
        right,
        y,
    };
}
