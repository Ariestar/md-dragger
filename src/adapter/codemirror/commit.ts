import type { DocEdit, TextChange } from '../../domain';
import { viewForDoc } from './views';

/**
 * Apply DocEdit[] by document identity.
 * Each edit goes to the live EditorView whose state.doc === edit.doc.
 * Unregistered / destroyed docs are skipped.
 */
export function applyCommit(edits: DocEdit[]): void {
  for (const edit of edits) {
    const view = viewForDoc(edit.doc);
    if (!view) continue;
    dispatchChanges(view, edit.changes);
  }
}

function dispatchChanges(
  view: { dispatch: (tr: { changes: TextChange[] }) => void },
  changes: TextChange[],
): void {
  if (changes.length === 0) return;
  view.dispatch({ changes });
}
