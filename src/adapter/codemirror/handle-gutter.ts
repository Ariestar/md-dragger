import type { Extension } from '@codemirror/state';
import { EditorView, GutterMarker, type BlockInfo as ViewBlockInfo, gutter } from '@codemirror/view';
import { detectBlock } from '../../domain';
import { HANDLE_CLASS, resolveTabSize, type MdDraggerCodeMirrorOptions, type RenderHandle } from './config';

// Default handle: a plain ⋮⋮ button.
function createDefaultHandle(): HTMLElement {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = HANDLE_CLASS;
  handle.setAttribute('aria-label', 'Drag markdown block');
  handle.textContent = '⋮⋮';
  return handle;
}

// A GutterMarker whose toDOM delegates to a consumer-provided factory (or the
// default). One marker instance is reused for every draggable line.
function createHandleMarker(render: RenderHandle | undefined): GutterMarker {
  return new (class extends GutterMarker {
    toDOM(): HTMLElement {
      return render?.() ?? createDefaultHandle();
    }
  })();
}

export function dragHandleGutter(options: MdDraggerCodeMirrorOptions): Extension {
  const marker = createHandleMarker(options.handle?.render);
  return gutter({
    class: 'md-dragger-gutter',
    lineMarker: (view, line) => {
      if (!isDraggableBlockStart(view, line, options)) return null;
      return marker;
    },
  });
}

function isDraggableBlockStart(view: EditorView, line: ViewBlockInfo, options: MdDraggerCodeMirrorOptions): boolean {
  const docLine = view.state.doc.lineAt(line.from);
  if (docLine.from !== line.from) return false;
  const block = detectBlock(view.state.doc, docLine.number, {
    tabSize: resolveTabSize(options),
  });
  return block?.startLine === docLine.number - 1;
}

