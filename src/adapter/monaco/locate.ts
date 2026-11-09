import type { editor } from 'monaco-editor';
import {
    ADAPTABLE_BLOCKS,
    type BlockSelection,
    BlockType,
    type DropPosition,
    locateDropPosition,
    parseLine,
    snapDrop,
} from '../../domain';
import type { Point, PressInput } from '../../runtime';
import { HANDLE_CLASS, type MdDraggerMonacoOptions, resolveConfig, resolveListIndentWidthPx } from './config';
import { monacoDoc } from './doc';

/**
 * Resolves the 1-based source line for a press on a drag handle.
 * Reads data-block-start attribute if available, otherwise hit-tests coordinates.
 */
export function sourceLineFromInput(editor: editor.ICodeEditor, input: PressInput): number | null {
    const native = input.native;
    if (native && typeof native === 'object' && 'target' in native) {
        const target = native.target;
        if (!target || typeof (target as Element).closest !== 'function') return null;
        const handle = (target as Element).closest(`.${HANDLE_CLASS}`);
        if (handle && editor.getDomNode()?.contains(handle)) {
            const fromAttr = Number(handle.getAttribute('data-block-start'));
            const model = editor.getModel();
            if (model && Number.isInteger(fromAttr) && fromAttr >= 1 && fromAttr <= model.getLineCount()) {
                return fromAttr;
            }
            return lineAtPoint(editor, input.point);
        }
    }
    return null;
}

/**
 * Returns the document line number under screen coordinates.
 */
export function lineAtPoint(editor: editor.ICodeEditor, point: Point): number | null {
    const model = editor.getModel();
    if (!model) return null;

    const target = editor.getTargetAtClientPoint(point.x, point.y);
    if (target?.position) {
        return target.position.lineNumber;
    }

    return null;
}

/**
 * Resolve a drop seam from client coordinates and snap it against container rules.
 * For paragraphs, headings, list items, and blockquotes, horizontal distance from
 * the content's left edge sets list indentation in rendered indent steps.
 * Returns null without a model, DOM node, selection, or line hit.
 * Invalid configuration throws; document access errors propagate.
 */
export function resolveDropPosition(
    editor: editor.ICodeEditor,
    point: Point,
    selection: BlockSelection,
    options: MdDraggerMonacoOptions,
): DropPosition | null {
    const model = editor.getModel();
    if (!model) return null;
    const domNode = editor.getDomNode();
    if (!domNode) return null;
    const rect = domNode.getBoundingClientRect();

    const source = selection.blocks[0];
    if (!source) return null;

    const hitLine = lineAtPoint(editor, point);
    if (hitLine === null) return null;

    const doc = monacoDoc(model);
    const resolvedConfig = resolveConfig(options.config);
    const tabSize = resolvedConfig.tabSize;
    const indentUnit = resolvedConfig.listIndentUnit;
    const inDoc = hitLine >= 1 && hitLine <= doc.lines;

    const sourceIndentWidth =
        source.type === BlockType.ListItem ? parseLine(doc.line(source.lines.startLine).text, tabSize).indent.width : 0;

    let targetIndentWidth = sourceIndentWidth;
    if (source.type === BlockType.ListItem || ADAPTABLE_BLOCKS.has(source.type)) {
        const stepPx = resolveListIndentWidthPx(options, editor);
        const contentLeft = rect.left + editor.getLayoutInfo().contentLeft - editor.getScrollLeft();
        const horizontalSteps = Math.max(0, Math.round((point.x - contentLeft) / stepPx));
        targetIndentWidth = horizontalSteps * indentUnit;
    }

    const belowMid = inDoc
        ? point.y >
          rect.top +
              (editor.getTopForLineNumber(hitLine) + editor.getBottomForLineNumber(hitLine)) / 2 -
              editor.getScrollTop()
        : hitLine > doc.lines;

    const raw = locateDropPosition({
        doc,
        selection,
        hitLine,
        belowMid,
        sourceIndentWidth,
        targetIndentWidth,
        tabSize,
        indentUnit,
    });

    return snapDrop({
        raw,
        sourceDoc: doc,
        selection,
        sourceIndentWidth,
        targetIndentWidth,
        tabSize,
        indentUnit,
    });
}
