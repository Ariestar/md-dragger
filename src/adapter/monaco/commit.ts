import type { editor } from 'monaco-editor';
import type { DocEdit } from '../../domain';
import { monacoDoc } from './doc';

/**
 * Apply DocEdit[] transactions to a Monaco editor instance.
 * Converts character range offsets to Monaco line/column positions.
 */
export function applyCommit(editor: editor.ICodeEditor, edits: DocEdit[]): void {
    const model = editor.getModel();
    if (!model) throw new Error('mdDraggerMonaco: editor has no model');
    const doc = monacoDoc(model);
    if (edits.some((edit) => edit.doc !== doc)) {
        throw new Error('mdDraggerMonaco: cannot apply edits to a stale or different model');
    }

    const operations: editor.IIdentifiedSingleEditOperation[] = edits.flatMap((edit) =>
        edit.changes.map((change) => {
            const start = model.getPositionAt(change.from);
            const end = model.getPositionAt(change.to);
            return {
                range: {
                    startLineNumber: start.lineNumber,
                    startColumn: start.column,
                    endLineNumber: end.lineNumber,
                    endColumn: end.column,
                },
                text: change.insert,
                forceMoveMarkers: true,
            };
        }),
    );
    if (operations.length === 0) return;
    editor.pushUndoStop();
    if (!editor.executeEdits('md-dragger', operations)) throw new Error('mdDraggerMonaco: editor rejected the edits');
    editor.pushUndoStop();
}
