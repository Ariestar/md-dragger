import type { Extension } from '@codemirror/state';
import { type EditorView, GutterMarker, gutter, type BlockInfo as ViewBlockInfo } from '@codemirror/view';
import { detectBlock, parseLine } from '../../domain';
import {
    type GutterBlock,
    HANDLE_CLASS,
    isDraggerEnabled,
    type MdDraggerCodeMirrorOptions,
    type RenderHandle,
    resolveTabSize,
} from './config';

function createDefaultHandle(doc: Document): HTMLElement {
    const handle = doc.createElement('button');
    handle.type = 'button';
    handle.className = HANDLE_CLASS;
    handle.setAttribute('aria-label', 'Drag markdown block');
    handle.textContent = '⋮⋮';
    return handle;
}

/** One marker per block-start line so handles keep line identity across updates. */
class BlockHandleMarker extends GutterMarker {
    constructor(
        readonly block: GutterBlock,
        private readonly render?: RenderHandle,
    ) {
        super();
    }

    eq(other: GutterMarker): boolean {
        return (
            other instanceof BlockHandleMarker &&
            other.block.lines.startLine === this.block.lines.startLine &&
            other.block.lines.endLine === this.block.lines.endLine &&
            other.block.type === this.block.type &&
            other.block.marker?.text === this.block.marker?.text &&
            other.render === this.render
        );
    }

    toDOM(view: EditorView): HTMLElement {
        const doc = view.dom.ownerDocument;
        const handle = this.render?.(doc, this.block) ?? createDefaultHandle(doc);
        handle.setAttribute('data-block-start', String(this.block.lines.startLine));
        return handle;
    }
}

export function dragHandleGutter(options: MdDraggerCodeMirrorOptions): Extension {
    return gutter({
        class: 'md-dragger-gutter',
        side: options.handle?.side,
        lineMarker: (view, line) => {
            if (!isDraggerEnabled(options, view)) return null;
            const block = blockAtLine(view, line, options);
            if (block === null) return null;
            return new BlockHandleMarker(block, options.handle?.render);
        },
    });
}

function blockAtLine(view: EditorView, line: ViewBlockInfo, options: MdDraggerCodeMirrorOptions): GutterBlock | null {
    const docLine = view.state.doc.lineAt(line.from);
    if (docLine.from !== line.from) return null;
    const tabSize = resolveTabSize(options);
    const block = detectBlock(view.state.doc, docLine.number, { tabSize });
    if (!block || block.lines.startLine !== docLine.number) return null;
    const { marker } = parseLine(docLine.text, tabSize);
    return { ...block, marker };
}
