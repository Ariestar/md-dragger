import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { EDITOR_CLASS, type MdDraggerCodeMirrorOptions } from './config';
import { dragHandleGutter } from './handle-gutter';
import { dragRuntime } from './runtime-plugin';

// Named building blocks — compose them yourself, or use mdDragger() below.
// Adapter parts only: they wire CodeMirror into the headless runtime's five
// IO axes. Rendering (drop indicator, selection highlight, …) is the
// consumer's job — derive it from dragTransitionEffect, not shipped here.
export { pointerInput } from './pointer-input';
export { sourceLineFromInput, resolveDropTarget, lineNumberFromPoint } from './locate';
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
  type MdDraggerCodeMirrorOptions,
  type HandleOptions,
  type LocateOptions,
  type LocateOptionInput,
  type RenderHandle,
} from './config';

const editorAttributes = EditorView.editorAttributes.of({ class: EDITOR_CLASS });

// Thin, transparent composition of the adapter blocks above. Spread it into
// your extensions array (`[...mdDragger()]`); it carries no visuals — add
// your own drop indicator / selection highlight by listening to
// dragTransitionEffect.
export function mdDragger(options: MdDraggerCodeMirrorOptions = {}): Extension[] {
  return [
    editorAttributes,
    dragHandleGutter(options),
    dragRuntime(options),
  ];
}