import type { editor } from 'monaco-editor';
import type { DocEdit } from '../../domain';

/**
 * Apply DocEdit[] transactions to a Monaco editor instance.
 * Converts character range offsets to Monaco line/column positions.
 */
export function applyCommit(editor: editor.ICodeEditor, edits: DocEdit[]): void {
    const model = editor.getModel();
    if (!model) return;

    for (const edit of edits) {
        if (edit.changes.length === 0) continue;
        const operations: editor.IIdentifiedSingleEditOperation[] = edit.changes.map((change) => {
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
        });
        editor.executeEdits('md-dragger', operations);
    }
}
