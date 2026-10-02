import type { editor } from 'monaco-editor';
import { selectionLineRanges } from '../../domain';
import { DraggerRuntime, dropSeamState, selectionFromOutputs } from '../../runtime';
import { applyCommit } from './commit';
import { type MdDraggerMonacoOptions, resolveConfig } from './config';
import { monacoDoc } from './doc';
import { lineAtPoint, resolveDropPosition, sourceLineFromInput } from './locate';
import { pointerInput } from './pointer-input';
import { DragHighlightManager, DropSeamWidget } from './widget';

export { applyCommit } from './commit';
export {
    DRAG_SOURCE_LINE_CLASS,
    DROP_SEAM_CLASS,
    HANDLE_CLASS,
    INVALID_CLASS,
    type ListIndentWidthPx,
    type MdDraggerMonacoOptions,
    resolveConfig,
    resolveListIndentUnit,
    resolveListIndentWidthPx,
} from './config';
export { monacoDoc } from './doc';
export type { DropSeam, LineBand } from './geometry';
export { dropSeam, lineBand } from './geometry';
export { lineAtPoint, resolveDropPosition, sourceLineFromInput } from './locate';
export { pointerInput } from './pointer-input';
export { DragHighlightManager, DropSeamWidget } from './widget';

/**
 * Attaches the md-dragger block drag-and-drop runtime to a Monaco Editor instance.
 * Returns a disposable function to detach listeners and widgets.
 */
export function mdDraggerMonaco(editor: editor.ICodeEditor, options: MdDraggerMonacoOptions): () => void {
    if (options.enabled && !options.enabled(editor)) {
        return () => {};
    }

    const domNode = editor.getDomNode();
    const ownerDoc = domNode?.ownerDocument ?? (typeof document !== 'undefined' ? document : ({} as Document));
    const seamWidget = new DropSeamWidget(ownerDoc);
    editor.addOverlayWidget(seamWidget);

    const highlightManager = new DragHighlightManager();

    const input = pointerInput(editor);

    const runtime = new DraggerRuntime({
        input,
        document: {
            getDoc: () => {
                const model = editor.getModel();
                if (!model) throw new Error('mdDraggerMonaco: editor has no model');
                return monacoDoc(model);
            },
        },
        locate: {
            sourceLineFromInput: (press) => sourceLineFromInput(editor, press),
            resolveDropPosition: (point, context) => resolveDropPosition(editor, point, context.selection, options),
            lineFromPoint: (point) => lineAtPoint(editor, point),
        },
        commit: {
            apply: (edits) => applyCommit(editor, edits),
        },
        config: resolveConfig(options.config),
        ux: typeof options.ux === 'function' ? options.ux(editor) : options.ux,
        onChange: (result) => {
            const model = editor.getModel();
            if (!model) return;

            const doc = monacoDoc(model);
            const { position, invalid } = dropSeamState(result.outputs, doc);
            seamWidget.update(editor, position, invalid, options);

            const selection = selectionFromOutputs(result.outputs);
            if (selection) {
                const ranges = selectionLineRanges(model.getLineCount(), selection);
                if (ranges.length > 0) {
                    highlightManager.update(editor, ranges[0].startLine, ranges[ranges.length - 1].endLine);
                } else {
                    highlightManager.clear(editor);
                }
            } else {
                highlightManager.clear(editor);
            }
        },
    });

    runtime.mount();

    return () => {
        runtime.destroy();
        editor.removeOverlayWidget(seamWidget);
        seamWidget.destroy();
        highlightManager.clear(editor);
    };
}
