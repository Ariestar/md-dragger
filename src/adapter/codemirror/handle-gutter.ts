import type { Extension } from '@codemirror/state';
import {
  EditorView,
  GutterMarker,
  type BlockInfo as ViewBlockInfo,
  gutter,
} from '@codemirror/view';
import { detectBlock } from '../../domain';
import { HANDLE_CLASS, resolveTabSize, type MdDraggerCodeMirrorOptions } from './config';

class DragHandleMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = HANDLE_CLASS;
    handle.setAttribute('aria-label', 'Drag markdown block');
    handle.textContent = '⋮⋮';
    return handle;
  }
}

const dragHandleMarker = new DragHandleMarker();

export function dragHandleGutter(options: MdDraggerCodeMirrorOptions): Extension {
  return gutter({
    class: 'md-dragger-cm-gutter',
    lineMarker: (view, line) => {
      if (!isDraggableBlockStart(view, line, options)) return null;
      return dragHandleMarker;
    },
  });
}

function isDraggableBlockStart(view: EditorView, line: ViewBlockInfo, options: MdDraggerCodeMirrorOptions): boolean {
  const docLine = view.state.doc.lineAt(line.from);
  if (docLine.from !== line.from) return false;
  const block = detectBlock({ doc: view.state.doc }, docLine.number, {
    tabSize: resolveTabSize(options),
  });
  return block?.startLine === docLine.number - 1;
}
