import { EditorView } from '@codemirror/view';
import type { DropCommit } from '../../runtime';

export function applyCommit(view: EditorView, commit: DropCommit): void {
  if (commit.changes.length === 0) return;
  view.dispatch({ changes: commit.changes });
}
