import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { EDITOR_CLASS, type MdDraggerCodeMirrorOptions } from './config';
import { dragHandleGutter } from './handle-gutter';
import { dragRuntime } from './runtime-plugin';

// Named building blocks — compose them yourself, or use mdDragger() below.
// Adapter parts only: they wire CodeMirror into the headless runtime's five
// IO axes. Rendering (drop indicator, selection highlight, …) is the
// consumer's job — derive it from dragTransitionEffect / onChange.
//
// Multi-doc is default: every dragRuntime mount registers its view; commit
// routes by DocEdit.doc; drop locate hit-tests live views.
export { pointerInput } from './pointer-input';
export {
  sourceLineFromInput,
  resolveDropPosition,
  resolveDropPositionAtPoint,
  lineAtPoint,
  lineAtScreenPoint,
} from './locate';
export { lineBand, dropSeam } from './geometry';
export type { LineBand, DropSeam } from './geometry';
export { dragHandleGutter } from './handle-gutter';
export { applyCommit } from './commit';
export { dragRuntime } from './runtime-plugin';
export { dragTransitionEffect } from './drag-events';
export {
  HANDLE_CLASS,
  EDITOR_CLASS,
  resolveConfig,
  resolveLocateOptions,
  resolveTabSize,
  resolveListIndentUnit,
  resolveListIndentWidthPx,
  type MdDraggerCodeMirrorOptions,
  type CodeMirrorGeometryOptions,
  type HandleOptions,
  type LocateOptions,
  type LocateOptionInput,
  type ListIndentWidthPx,
  type RenderHandle,
} from './config';

const editorAttributes = EditorView.editorAttributes.of({ class: EDITOR_CLASS });

// Thin composition. Host must pass config.tabSize + config.listIndentUnit.
// Mount on each editor; cross-pane works when multiple instances are live.
export function mdDragger(options: MdDraggerCodeMirrorOptions): Extension[] {
  return [
    editorAttributes,
    dragHandleGutter(options),
    dragRuntime(options),
  ];
}
