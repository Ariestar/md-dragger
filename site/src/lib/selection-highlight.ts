import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  lineBand,
  type CodeMirrorGeometryOptions,
} from 'md-dragger/adapter/codemirror';
import type { BlockSelection } from 'md-dragger/domain';
import type { PipelineResult } from 'md-dragger/runtime';

// Demo selection paint: fixed overlay boxes from the absolute lineBand rect —
// same coordinate system as the drop indicator. No per-line CSS inset.

let active:
  | { consume(outputs: PipelineResult['outputs']): void }
  | null = null;

export function selectionHighlightOnChange(result: PipelineResult): void {
  active?.consume(result.outputs);
}

export function selectionHighlight(options: CodeMirrorGeometryOptions): Extension {
  return ViewPlugin.fromClass(class {
    private readonly layer: HTMLDivElement;
    private boxes: HTMLDivElement[] = [];
    private selection: BlockSelection | null = null;
    private raf: number | null = null;

    constructor(private readonly view: EditorView) {
      this.layer = document.createElement('div');
      this.layer.className = 'md-dragger-selection-layer';
      this.layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(this.layer);
      active = this;
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.geometryChanged || update.viewportChanged) {
        this.queue();
      }
    }

    destroy(): void {
      if (active === this) active = null;
      if (this.raf !== null) window.cancelAnimationFrame(this.raf);
      this.layer.remove();
    }

    consume(outputs: PipelineResult['outputs']): void {
      const next = selectionFromOutputs(outputs);
      if (next === undefined) return;
      this.selection = next;
      this.paint();
    }

    private queue(): void {
      if (this.raf !== null) return;
      this.raf = window.requestAnimationFrame(() => {
        this.raf = null;
        this.paint();
      });
    }

    private paint(): void {
      const rects = this.selectedRects();
      while (this.boxes.length < rects.length) {
        const box = document.createElement('div');
        box.className = 'md-dragger-selected-box';
        this.layer.appendChild(box);
        this.boxes.push(box);
      }
      for (let i = 0; i < this.boxes.length; i += 1) {
        const box = this.boxes[i];
        const rect = rects[i];
        if (!rect) {
          box.hidden = true;
          continue;
        }
        box.hidden = false;
        box.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
        box.style.width = `${Math.max(0, rect.right - rect.left)}px`;
        box.style.height = `${Math.max(0, rect.bottom - rect.top)}px`;
      }
    }

    private selectedRects(): Array<{ left: number; right: number; top: number; bottom: number }> {
      const selection = this.selection;
      if (!selection || selection.blocks.length === 0) return [];
      const rects = [];
      for (const block of selection.blocks) {
        const fromLine = Math.max(1, block.lines.startLine);
        const toLine = Math.min(this.view.state.doc.lines, block.lines.endLine);
        for (let line = fromLine; line <= toLine; line += 1) {
          const band = lineBand(this.view, line, options);
          if (band) rects.push(band);
        }
      }
      return rects;
    }
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
