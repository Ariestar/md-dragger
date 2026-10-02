import type { editor } from 'monaco-editor';
import { type DropPosition, listLevel } from '../../domain';
import { type MdDraggerMonacoOptions, resolveConfig, resolveListIndentUnit, resolveListIndentWidthPx } from './config';

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

// Monaco's editor.EditorOption.lineHeight numeric enum value
const LINE_HEIGHT_OPTION = 75;

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
    const lineHeight = codeEditor.getOption(LINE_HEIGHT_OPTION);
    const scrollTop = codeEditor.getScrollTop();

    const lineTop = domRect.top + codeEditor.getTopForLineNumber(line) - scrollTop;
    const contentLeft = domRect.left + layout.contentLeft;
    const contentRight = contentLeft + layout.contentWidth;

    const lineText = model.getLineContent(line);
    const resolvedConfig = resolveConfig(options.config);
    const indentUnit = resolveListIndentUnit(options);
    const level = listLevel(lineText, resolvedConfig.tabSize, indentUnit);
    const indentStepPx = resolveListIndentWidthPx(options, codeEditor);

    const left = contentLeft + level * indentStepPx;

    return {
        left,
        right: Math.max(left, contentRight),
        top: lineTop,
        bottom: lineTop + lineHeight,
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
    const lineHeight = codeEditor.getOption(LINE_HEIGHT_OPTION);
    const scrollTop = codeEditor.getScrollTop();
    const lineCount = model.getLineCount();

    const targetLine = position.line;
    let left: number;

    if (position.parent) {
        const anchor = lineBand(codeEditor, position.parent.lines.startLine, options);
        if (!anchor) return null;
        left = anchor.left + resolveListIndentWidthPx(options, codeEditor);
    } else {
        left = domRect.left + layout.contentLeft;
    }

    let y: number;
    if (targetLine <= 1) {
        y = domRect.top + codeEditor.getTopForLineNumber(1) - scrollTop;
    } else if (targetLine > lineCount) {
        y = domRect.top + codeEditor.getTopForLineNumber(lineCount) - scrollTop + lineHeight;
    } else {
        y = domRect.top + codeEditor.getTopForLineNumber(targetLine) - scrollTop;
    }

    const right = Math.max(left, domRect.left + layout.contentLeft + layout.contentWidth);

    return {
        left,
        right,
        y,
    };
}
