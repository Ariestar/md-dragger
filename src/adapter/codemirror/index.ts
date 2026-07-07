import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { EDITOR_CLASS, type MdDraggerCodeMirrorOptions } from './config';
import { dragHandleGutter } from './handle-gutter';
import { dragRuntime } from './runtime-plugin';
import { dropIndicator } from './drop-indicator';

// Named building blocks — compose them yourself, or use mdDragger() below.
export { pointerInput } from './pointer-input';
export { sourceLineFromInput, resolveDropTarget, lineNumberFromPoint } from './locate';
export { dragHandleGutter } from './handle-gutter';
export { applyCommit } from './commit';
export { dragRuntime } from './runtime-plugin';
export { dropIndicator } from './drop-indicator';
export { dragTransitionEffect } from './drag-events';
export {
  HANDLE_CLASS,
  EDITOR_CLASS,
  resolveConfig,
  resolveTabSize,
  type MdDraggerCodeMirrorOptions,
} from './config';

const editorAttributes = EditorView.editorAttributes.of({ class: EDITOR_CLASS });

// Thin, transparent composition of the building blocks above. Spread it into
// your extensions array (`[...mdDragger()]`); to drop a piece — e.g. the drop
// indicator — list the blocks yourself instead of calling this.
export function mdDragger(options: MdDraggerCodeMirrorOptions = {}): Extension[] {
  return [
    editorAttributes,
    dragHandleGutter(options),
    dragRuntime(options),
    dropIndicator(),
  ];
}
