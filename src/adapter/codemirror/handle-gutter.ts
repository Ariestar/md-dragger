import type { Extension } from '@codemirror/state';
import { EditorView, GutterMarker, type BlockInfo as ViewBlockInfo, gutter } from '@codemirror/view';
import { detectBlock } from '../../domain';
import { HANDLE_CLASS, resolveTabSize, type MdDraggerCodeMirrorOptions, type RenderHandle } from './config';

function createDefaultHandle(): HTMLElement {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = HANDLE_CLASS;
  handle.setAttribute('aria-label', 'Drag markdown block');
  handle.textContent = '⋮⋮';
  return handle;
}

/** One marker per block-start line so handles keep line identity across updates. */
class BlockHandleMarker extends GutterMarker {
  constructor(
    readonly startLine: number,
    private readonly render?: RenderHandle,
  ) {
    super();
  }

  eq(other: GutterMarker): boolean {
    return other instanceof BlockHandleMarker
      && other.startLine === this.startLine
      && other.render === this.render;
  }

  toDOM(): HTMLElement {
    const handle = this.render?.() ?? createDefaultHandle();
    handle.setAttribute('data-block-start', String(this.startLine));
    return handle;
  }
}

export function dragHandleGutter(options: MdDraggerCodeMirrorOptions): Extension {
  return gutter({
    class: 'md-dragger-gutter',
    lineMarker: (view, line) => {
      const startLine = blockStartLine(view, line, options);
      if (startLine === null) return null;
      return new BlockHandleMarker(startLine, options.handle?.render);
    },
  });
}

function blockStartLine(
  view: EditorView,
  line: ViewBlockInfo,
  options: MdDraggerCodeMirrorOptions,
): number | null {
  const docLine = view.state.doc.lineAt(line.from);
  if (docLine.from !== line.from) return null;
  const block = detectBlock(view.state.doc, docLine.number, {
    tabSize: resolveTabSize(options),
  });
  if (!block || block.lines.startLine !== docLine.number) return null;
  return block.lines.startLine;
}
