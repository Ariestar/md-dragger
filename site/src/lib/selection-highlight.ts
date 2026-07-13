import type { Extension } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { lineBand } from 'md-dragger/adapter/codemirror';
import type { BlockSelection } from 'md-dragger/domain';
import type { PipelineResult } from 'md-dragger/runtime';

// Demo selection paint. Geometry is adapter-owned (line box − own indent).

const TAB_SIZE = 4;

type SelectionHost = {
  consume(outputs: PipelineResult['outputs']): void;
};

let activeHost: SelectionHost | null = null;

export function selectionHighlightOnChange(result: PipelineResult): void {
  activeHost?.consume(result.outputs);
}

export function selectionHighlight(): Extension {
  return ViewPlugin.fromClass(class implements SelectionHost {
    decorations: DecrationsSet = Decrations.none;
    private selection: BlockSelection | null = null;

    constructor(private readonly view: EditorView) {
      activeHost = this;
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.geometryChanged) {
        this.decorations = buildDecorations(this.view, this.selection);
      }
    }

    destroy(): void {
      if (activeHost === this) activeHost = null;
    }

    consume(outputs: PipelineResult['outputs']): void {
      const next = selectionFromOutputs(outputs);
      if (next === undefined) return;
      this.selection = next;
      this.decorations = buildDecorations(this.view, this.selection);
    }
  }, {
    decorations: (value) => value.decorations,
  });
}

function selectionFromOutputs(outputs: PipelineResult['outputs']): BlockSelection | null | undefined {
  let found: BlockSelection | null | undefined;
  for (const output of outputs) {
    if (output.type === 'selection_changed' || output.type === 'drag_source_changed') {
      found = output.selection;
    } else if (output.type === 'cancelled' || output.type === 'terminal' || output.type === 'dropped') {
      found = null;
    }
  }
  return found;
}

function buildDecorations(view: EditorView, selection: BlockSelection | null): DecorationSet {
  if (!selection || selection.ranges.length === 0) return Decrations.none;

  const builder: ReturnType<ReturnType<typeof selectedLineAt>['range']>[] = [];
  for (const range of selection.ranges) {
    const fromLine = Math.max(1, range.startLine + 1);
    const toLine = Math.min(view.state.doc.lines, range.endLine + 1);
    for (let line = fromLine; line <= toLine; line += 1) {
      const docLine = view.state.doc.line(line);
      const inset = lineBand(view, line, TAB_SIZE)?.inset ?? 0;
      builder.push(selectedLineAt(inset).range(docLine.from));
    }
  }
  return Decrations.set(builder, true);
}

function selectedLineAt(insetPx: number) {
  return Decoration.line({
    class: 'md-dragger-selected-line',
    attributes: {
      style: `--md-dragger-content-inset: ${Math.max(0, Math.round(insetPx))}px`,
    },
  });
}
