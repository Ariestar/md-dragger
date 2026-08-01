import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { DraggerRuntime } from '../../runtime';
import {
  resolveConfig,
  resolveLocateOptions,
  type MdDraggerCodeMirrorOptions,
} from './config';
import { pointerInput } from './pointer-input';
import {
  sourceLineFromInput,
  resolveDropPositionAtPoint,
  lineAtPoint,
  lineAtScreenPoint,
} from './locate';
import { applyCommit } from './commit';
import { dragTransitionEffect } from './drag-events';
import { registerView } from './views';

// Constructs the headless runtime, wires it to CodeMirror's pointer input,
// multi-doc hit-test and commit, and rebroadcasts every pipeline transition
// as a dragTransitionEffect so visual plugins can derive from it.
//
// Every mounted instance registers its EditorView. Cross-pane drop/commit is
// the default path: locate uses viewAtPoint, commit routes by edit.doc.
// tabSize is always read live from EditorState.tabSize.
export function dragRuntime(options: MdDraggerCodeMirrorOptions): Extension {
  return ViewPlugin.fromClass(class {
    private readonly runtime: DraggerRuntime;
    private readonly unregisterView: () => void;

    constructor(private readonly view: EditorView) {
      this.unregisterView = registerView(view);
      const locateOverride = resolveLocateOptions(options.locate, view);
      this.runtime = new DraggerRuntime({
        input: pointerInput(view),
        document: {
          getDoc: () => view.state.doc,
        },
        locate: {
          sourceLineFromInput: (input) =>
            locateOverride?.sourceLineFromInput?.(input)
            ?? sourceLineFromInput(view, input),
          resolveDropPosition: (point, context) =>
            locateOverride?.resolveDropPosition?.(point, context)
            ?? resolveDropPositionAtPoint(view, point, context.selection, options),
          lineFromPoint: (point) =>
            locateOverride?.lineFromPoint?.(point)
            ?? lineAtScreenPoint(point)
            ?? lineAtPoint(view, point),
        },
        commit: {
          apply: (edits) => applyCommit(edits),
        },
        onChange: (output) => {
          view.dispatch({ effects: dragTransitionEffect.of(output) });
          options.onChange?.(output);
        },
        config: () => {
          const raw = typeof options.config === 'function' ? options.config() : options.config;
          return resolveConfig({
            tabSize: view.state.facet(EditorState.tabSize),
            listIndentUnit: raw.listIndentUnit,
          });
        },
        ux: options.ux,
      });
      this.runtime.mount();
    }

    destroy(): void {
      this.runtime.destroy();
      this.unregisterView();
    }
  });
}
