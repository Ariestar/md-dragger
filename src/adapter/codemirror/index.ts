import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { EDITOR_CLASS, type MdDraggerCodeMirrorOptions } from './config';
import { dragHandleGutter } from './handle-gutter';
import { dragRuntime } from './runtime-plugin';

export { applyCommit } from './commit';
export {
    type CodeMirrorGeometryOptions,
    EDITOR_CLASS,
    HANDLE_CLASS,
    type HandleOptions,
    type ListIndentWidthPx,
    type LocateOptionInput,
    type LocateOptions,
    type MdDraggerCodeMirrorOptions,
    type RenderHandle,
    resolveConfig,
    resolveListIndentUnit,
    resolveListIndentWidthPx,
    resolveLocateOptions,
    resolveTabSize,
} from './config';
export type { DropSeam, LineBand } from './geometry';
export { dropSeam, lineBand } from './geometry';
export { dragHandleGutter } from './handle-gutter';
export {
    lineAtPoint,
    lineAtScreenPoint,
    resolveDropPosition,
    resolveDropPositionAtPoint,
    sourceLineFromInput,
} from './locate';
// Named building blocks — compose them yourself, or use mdDragger() below.
// Adapter parts only: they wire CodeMirror into the headless runtime's five
// IO axes. Rendering (drop indicator, selection highlight, …) is the
// consumer's job — derive it from dragTransitionEffect / onChange.
//
// Multi-doc is default: every dragRuntime mount registers its view; commit
// routes by DocEdit.doc; drop locate hit-tests live views.
export { pointerInput } from './pointer-input';
export { dragRuntime, dragTransitionEffect } from './runtime-plugin';

const editorAttributes = EditorView.editorAttributes.of({ class: EDITOR_CLASS });

// Thin composition. Host must pass config.tabSize + config.listIndentUnit.
// Mount on each editor; cross-pane works when multiple instances are live.
export function mdDragger(options: MdDraggerCodeMirrorOptions): Extension[] {
    return [editorAttributes, dragHandleGutter(options), dragRuntime(options)];
}
