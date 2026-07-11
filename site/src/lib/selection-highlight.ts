import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { BlockSelection } from 'md-dragger/domain';
import type { PipelineResult } from 'md-dragger/runtime';

// Demo-only selection paint.
// Driven by options.onChange (same sink as drop-indicator) — not by
// dragTransitionEffect, which can dual-instance under Vite source conditions.
const selectedLine = Decoration.line({ class: 'md-dragger-cm-selected-line' });

type SelectionHost = {
  consume(outputs: PipelineResult['outputs']): void;
};

let activeHost: SelectionHost | null = null;

export function selectionHighlightOnChange(result: PipelineResult): void {
  activeHost?.consume(result.outputs);
}

export function selectionHighlight(): Extension {
  return ViewPlugin.fromClass(class implements SelectionHost {
    decorations: DecorationSet = Decoration.none;
    private selection: BlockSelection | null = null;

    constructor(private readonly view: EditorView) {
      activeHost = this;
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
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
  if (!selection || selection.ranges.length === 0) return Decoration.none;
  const builder: ReturnType<typeof selectedLine.range>[] = [];
  for (const range of selection.ranges) {
    // BlockSelection lines are 0-based; CodeMirror doc lines are 1-based.
    const fromLine = Math.max(1, range.startLine + 1);
    const toLine = Math.min(view.state.doc.lines, range.endLine + 1);
    for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
      const line = view.state.doc.line(lineNumber);
      builder.push(selectedLine.range(line.from));
    }
  }
  return Decoration.set(builder, true);
}
