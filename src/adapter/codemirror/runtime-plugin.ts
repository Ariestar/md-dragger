import { EditorState, type Extension, StateEffect } from '@codemirror/state';
import { type EditorView, ViewPlugin } from '@codemirror/view';
import { type Change, DraggerRuntime } from '../../runtime';
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
                        // Drag-lifecycle batches reach every live view; each
                        // painter filters by doc identity (dropSeamState /
                        // dragSelectionDoc), so the pane under the pointer
                        // shows the seam and a pane that stops being the
                        // target clears itself on the next batch. Selection-
                        // only batches stay on the source view — multi-select
                        // is single-view by nature and its outputs carry no doc.
                        const hasDragOutput = output.outputs.some(
                            (o) =>
                                o.type === 'drag_source_changed' ||
                                o.type === 'drag_over' ||
                                o.type === 'dropped' ||
                                o.type === 'cancelled' ||
                                o.type === 'terminal',
                        );
                        if (hasDragOutput) {
                            broadcastToLiveViews((v) => v.dispatch({ effects: dragTransitionEffect.of(output) }));
                        } else {
                            view.dispatch({ effects: dragTransitionEffect.of(output) });
                        }
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
