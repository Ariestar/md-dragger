import type { editor } from 'monaco-editor';
import {
    type BlockSelection,
    BlockType,
    type DropPosition,
    locateDropPosition,
    parseLine,
    snapDrop,
} from '../../domain';
import type { Point, PressInput } from '../../runtime';
import {
    HANDLE_CLASS,
    type MdDraggerMonacoOptions,
    resolveConfig,
    resolveListIndentUnit,
    resolveListIndentWidthPx,
} from './config';
import { monacoDoc } from './doc';
import { lineBand } from './geometry';

// Monaco's editor.EditorOption.lineHeight numeric enum value
const LINE_HEIGHT_OPTION = 75;

/**
 * Resolves the 1-based source line for a press on a drag handle.
 * Reads data-block-start attribute if available, otherwise hit-tests coordinates.
 */
export function sourceLineFromInput(editor: editor.ICodeEditor, input: PressInput): number | null {
    const native = input.native;
    if (native && typeof native === 'object' && 'target' in native) {
        const target = native.target as Element | null;
        const handle = target?.closest(`.${HANDLE_CLASS}`) ?? null;
        if (handle) {
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

    const domNode = editor.getDomNode();
    if (!domNode) return null;

    const rect = domNode.getBoundingClientRect();
    if (point.y <= rect.top) return 1;
    if (point.y >= rect.bottom) return model.getLineCount() + 1;

    return null;
}

/**
 * Resolves the DropPosition for a pointer point, taking horizontal dragging
 * (list nesting / outdenting) into account and snapping against invalid containers.
 */
export function resolveDropPosition(
    editor: editor.ICodeEditor,
    point: Point,
    selection: BlockSelection,
    options: MdDraggerMonacoOptions,
): DropPosition | null {
    const model = editor.getModel();
    if (!model) return null;

    const source = selection.blocks[0];
    if (!source) return null;

    const hitLine = lineAtPoint(editor, point);
    if (hitLine === null) return null;

    const doc = monacoDoc(model);
    const resolvedConfig = resolveConfig(options.config);
    const tabSize = resolvedConfig.tabSize;
    const indentUnit = resolveListIndentUnit(options);
    const inDoc = hitLine >= 1 && hitLine <= doc.lines;

    const sourceIndentWidth =
        source.type === BlockType.ListItem ? parseLine(doc.line(source.lines.startLine).text, tabSize).indent.width : 0;

    let targetIndentWidth = sourceIndentWidth;
    if (source.type === BlockType.ListItem) {
        const originBand = lineBand(editor, source.lines.startLine, options);
        if (originBand) {
            const stepPx = resolveListIndentWidthPx(options, editor);
            const horizontalSteps = Math.round((point.x - originBand.left) / stepPx);
            targetIndentWidth += horizontalSteps * indentUnit;
        }
    }

    const belowMid = inDoc ? isBelowMid(editor, hitLine, point.y) : hitLine > doc.lines;

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

function isBelowMid(codeEditor: editor.ICodeEditor, line: number, y: number): boolean {
    const domNode = codeEditor.getDomNode();
    if (!domNode) return false;

    const domRect = domNode.getBoundingClientRect();
    const scrollTop = codeEditor.getScrollTop();
    const lineTop = domRect.top + codeEditor.getTopForLineNumber(line) - scrollTop;
    const lineHeight = codeEditor.getOption(LINE_HEIGHT_OPTION);

    return y > lineTop + lineHeight / 2;
}
