import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { EDITOR_CLASS, type MdDraggerCodeMirrorOptions, resolveListIndentUnit } from './config';
import {
    DRAG_SOURCE_LINE_CLASS,
    DROP_SEAM_BELOW_CLASS,
    DROP_SEAM_CLASS,
    DROP_SEAM_TOP_CLASS,
    dropSeamDecoration,
    INVALID_CLASS,
    listIndentUnitFacet,
    SOURCE_LEVEL_STYLE_VAR,
    seamOffset,
    sourceHighlightDecoration,
    sourceListLevel,
} from './decoration';
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
// Adapter parts wire CodeMirror into the headless runtime's five IO axes and
// build the paint decorations (source highlight, drop seam); the host only
// renders: it styles the protocol classes and fills view-level geometry CSS
// variables (seam offset from seamOffset, rendered indent step).
//
// Multi-doc is default: every dragRuntime mount registers its view; commit
// routes by DocEdit.doc; drop locate hit-tests live views.
export { pointerInput } from './pointer-input';
export { dragRuntime, dragTransitionEffect } from './runtime-plugin';
// Render protocol + decoration builders shared by hosts: the class names and
// the --d-source-level CSS variable are adapter-owned contracts — hosts style
// them in their stylesheet, the adapter never re-derives them per host.
// The decorations are built from the engine's per-view output stream
// (dragTransitionEffect), so hosts don't re-derive selection rows, seam rows,
// or nesting levels.
export {
    DRAG_SOURCE_LINE_CLASS,
    DROP_SEAM_BELOW_CLASS,
    DROP_SEAM_CLASS,
    DROP_SEAM_TOP_CLASS,
    dropSeamDecoration,
    INVALID_CLASS,
    listIndentUnitFacet,
    SOURCE_LEVEL_STYLE_VAR,
    seamOffset,
    sourceHighlightDecoration,
    sourceListLevel,
};

const editorAttributes = EditorView.editorAttributes.of({ class: EDITOR_CLASS });

// Thin composition. Host must pass config.tabSize + config.listIndentUnit.
// Mount on each editor; cross-pane works when multiple instances are live.
// listIndentUnitFacet carries config.listIndentUnit to the decoration
// builders, so hosts never pass it around.
export function mdDragger(options: MdDraggerCodeMirrorOptions): Extension[] {
    return [
        editorAttributes,
        listIndentUnitFacet.of(resolveListIndentUnit(options)),
        dragHandleGutter(options),
        dragRuntime(options),
    ];
}
