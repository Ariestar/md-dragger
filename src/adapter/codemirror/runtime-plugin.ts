import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { DraggerRuntime } from '../../runtime';
import {
  resolveConfig,
  resolveLocateOptions,
  type MdDraggerCodeMirrorOptions,
} from './config';
import { pointerInput } from './pointer-input';
import { sourceLineFromInput, resolveDropTarget, lineAtPoint } from './locate';
import { applyCommit } from './commit';
import { dragTransitionEffect } from './drag-events';

// Constructs the headless runtime, wires it to CodeMirror's pointer input,
// document, hit-test and commit, and rebroadcasts every pipeline transition
// as a dragTransitionEffect so visual plugins can derive from it.
export function dragRuntime(options: MdDraggerCodeMirrorOptions): Extension {
  return ViewPlugin.fromClass(class {
    private readonly runtime: DraggerRuntime;

    constructor(private readonly view: EditorView) {
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
          resolveDropTarget: (point, context) =>
            locateOverride?.resolveDropTarget?.(point, context)
            ?? resolveDropTarget(view, point, context.selection, options),
          lineFromPoint: (point) =>
            locateOverride?.lineFromPoint?.(point)
            ?? lineAtPoint(view, point),
        },
        commit: {
          apply: (commit) => applyCommit(view, commit),
        },
        onChange: (output) => {
          view.dispatch({ effects: dragTransitionEffect.of(output) });
          options.onChange?.(output);
        },
        config: resolveConfig(options.config),
        ux: options.ux,
      });
      this.runtime.mount();
    }

    destroy(): void {
      this.runtime.destroy();
    }
  });
}