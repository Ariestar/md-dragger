import { EditorView } from '@codemirror/view';
import type { DocEdit, TextChange } from '../../domain';

// Reference adapter: applies every edit to the single view. A real
// cross-editor host dispatches each edit to the view that owns its doc.
export function applyCommit(view: EditorView, edits: DocEdit[]): void {
  for (const edit of edits) {
    dispatchChanges(view, edit.changes);
  }
}

function dispatchChanges(view: EditorView, changes: TextChange[]): void {
  if (changes.length === 0) return;
  view.dispatch({ changes });
}
