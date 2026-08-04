import { EditorState, type Extension, StateEffect } from '@codemirror/state';
import { type EditorView, ViewPlugin } from '@codemirror/view';
import type { Doc } from '../../domain';
import { type Change, DraggerRuntime, type PipelineOutput } from '../../runtime';
import { applyCommit } from './commit';
import { type MdDraggerCodeMirrorOptions, resolveConfig, resolveLocateOptions } from './config';
import { lineAtPoint, lineAtScreenPoint, resolveDropPositionAtPoint, sourceLineFromInput } from './locate';
import { pointerInput } from './pointer-input';
import { broadcastToLiveViews, registerView } from './views';

// Broadcast channel between the runtime plugin and any visual plugin
// (drop indicator, selection highlight, ...) that wants to derive from
// the pipeline output stream. dragRuntime dispatches one effect per
// change; visual plugins read them off update.transactions.
export const dragTransitionEffect = StateEffect.define<Change>();

// Constructs the headless runtime, wires it to CodeMirror's pointer input,
// multi-doc hit-test and commit, and rebroadcasts every pipeline transition
// as a dragTransitionEffect so visual plugins can derive from it.
//
// Every mounted instance registers its EditorView. Cross-pane drop/commit is
// the default path: locate uses viewAtPoint, commit routes by edit.doc.
// tabSize is always read live from EditorState.tabSize.
export function dragRuntime(options: MdDraggerCodeMirrorOptions): Extension {
    return ViewPlugin.fromClass(
        class {
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
                            locateOverride?.sourceLineFromInput?.(input) ?? sourceLineFromInput(view, input),
                        resolveDropPosition: (point, context) =>
                            locateOverride?.resolveDropPosition?.(point, context) ??
                            resolveDropPositionAtPoint(view, point, context.selection, options),
                        lineFromPoint: (point) =>
                            locateOverride?.lineFromPoint?.(point) ??
                            lineAtScreenPoint(point) ??
                            lineAtPoint(view, point),
                    },
                    commit: {
                        apply: (edits) => applyCommit(edits),
                    },
                    onChange: (output) => {
                        // Reach the view under the pointer: dispatch to the
                        // source view (its highlight) plus any view holding the
                        // drop target doc (its seam). Each painter filters by
                        // doc identity, so no cross-pane leakage.
                        const targetDoc = dropTargetDoc(output.outputs);
                        broadcastToLiveViews((v) => {
                            if (v === view || (targetDoc !== null && v.state.doc === targetDoc)) {
                                v.dispatch({ effects: dragTransitionEffect.of(output) });
                            }
                        });
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
        },
    );
}

/** The doc under the current drop target, if any output carries a position. */
function dropTargetDoc(outputs: readonly PipelineOutput[]): Doc | null {
    for (let i = outputs.length - 1; i >= 0; i--) {
        const output = outputs[i];
        if ((output.type === 'drag_over' || output.type === 'dropped') && output.drop.position) {
            return output.drop.position.doc;
        }
    }
    return null;
}
