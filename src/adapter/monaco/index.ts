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
    type LocateOptions,
    type MdDraggerMonacoOptions,
    resolveConfig,
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
    if (!domNode) throw new Error('mdDraggerMonaco: editor has no DOM node');
    resolveConfig(options.config);
    const input = pointerInput(editor);
    const seamWidget = new DropSeamWidget(domNode.ownerDocument);
    editor.addOverlayWidget(seamWidget);

    const highlightManager = new DragHighlightManager(editor);

    let applying = false;
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
            sourceLineFromInput: (press) =>
                options.locate?.sourceLineFromInput
                    ? options.locate.sourceLineFromInput(press)
                    : sourceLineFromInput(editor, press),
            resolveDropPosition: (point, context) =>
                options.locate?.resolveDropPosition
                    ? options.locate.resolveDropPosition(point, context)
                    : resolveDropPosition(editor, point, context.selection, options),
            lineFromPoint: (point) =>
                options.locate?.lineFromPoint ? options.locate.lineFromPoint(point) : lineAtPoint(editor, point),
        },
        commit: {
            apply: (edits) => {
                applying = true;
                try {
                    applyCommit(editor, edits);
                } finally {
                    applying = false;
                }
            },
        },
        config: () => resolveConfig(options.config),
        ux: typeof options.ux === 'function' ? options.ux(editor) : options.ux,
        onChange: (result) => {
            const model = editor.getModel();
            if (!model) {
                seamWidget.update(editor, null, false, options);
                highlightManager.clear();
                return;
            }

            const doc = monacoDoc(model);
            const { position, invalid } = dropSeamState(result.outputs, doc);
            seamWidget.update(editor, position, invalid, options);

            const selection = selectionFromOutputs(result.outputs);
            if (selection) {
                const ranges = selectionLineRanges(model.getLineCount(), selection);
                highlightManager.update(ranges);
            } else {
                highlightManager.clear();
            }
        },
    });

    runtime.mount();

    const cancel = () => {
        input.cancel();
        runtime.clearSelectionOrCancel();
    };
    const subscriptions = [
        editor.onDidChangeModel(cancel),
        editor.onDidChangeModelContent(() => {
            if (!applying) cancel();
        }),
    ];
    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const subscription of subscriptions) subscription.dispose();
        runtime.destroy();
        editor.removeOverlayWidget(seamWidget);
        highlightManager.clear();
    };
    subscriptions.push(editor.onDidDispose(dispose));
    return dispose;
}
