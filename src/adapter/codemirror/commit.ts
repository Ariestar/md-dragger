import { EditorView } from '@codemirror/view';
import type { CrossDocDropCommit, DropCommit } from '../../runtime';

export function applyCommit(view: EditorView, commit: DropCommit | CrossDocDropCommit): void {
  if ('source' in commit && 'target' in commit) {
    // Cross-document: both sides land on this single view in the reference
    // adapter. A real cross-editor host dispatches each side to its own view.
    dispatchChanges(view, commit.source.changes);
    dispatchChanges(view, commit.target.changes);
    return;
  }
  dispatchChanges(view, commit.changes);
}

function dispatchChanges(view: EditorView, changes: DropCommit['changes']): void {
  if (changes.length === 0) return;
  view.dispatch({ changes });
}
