import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { DropTarget } from '../../domain';
import type { Transition } from '../../runtime';
import { dragTransitionEffect } from './drag-events';

type IndicatorTarget = {
  target: DropTarget | null;
  targetLineNumber: number;
  allowed: boolean;
};

// Visual-only plugin: derives a drop indicator line from the pipeline's
// drag_over output (broadcast via dragTransitionEffect) and clears it on
// drop/cancel/terminal. Drop this from the extension array to render nothing.
export function dropIndicator(): Extension {
  return ViewPlugin.fromClass(class {
    private readonly indicator: HTMLDivElement;
    private current: IndicatorTarget | null = null;
    private refreshFrame: number | null = null;

    constructor(private readonly view: EditorView) {
      this.indicator = document.createElement('div');
      this.indicator.className = 'md-dragger-cm-drop-indicator';
      this.indicator.hidden = true;
      document.body.appendChild(this.indicator);
    }

    update(update: ViewUpdate): void {
      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) {
          if (effect.is(dragTransitionEffect)) {
            this.consume(effect.value.outputs);
          }
        }
      }
      if (update.docChanged || update.geometryChanged || update.viewportChanged) {
        this.scheduleRefresh();
      }
    }

    destroy(): void {
      if (this.refreshFrame !== null) {
        window.cancelAnimationFrame(this.refreshFrame);
        this.refreshFrame = null;
      }
      this.indicator.remove();
    }

    private consume(outputs: Transition['outputs']): void {
      for (const output of outputs) {
        if (output.type === 'drag_over') {
          this.render({
            target: output.drop.target,
            targetLineNumber: output.drop.target?.targetLineNumber ?? -1,
            allowed: output.drop.rejectReason == null,
          });
        } else if (output.type === 'dropped' || output.type === 'cancelled' || output.type === 'terminal') {
          this.render(null);
        }
      }
    }

    private render(next: IndicatorTarget | null): void {
      this.current = next;
      if (!next || !next.allowed || next.targetLineNumber < 1) {
        this.indicator.hidden = true;
        return;
      }

      const lineNumber = Math.min(next.targetLineNumber, this.view.state.doc.lines);
      const line = this.view.state.doc.line(lineNumber);
      const rect = this.view.coordsAtPos(line.from, -1);
      const contentRect = this.view.contentDOM.getBoundingClientRect();
      if (!rect) {
        this.indicator.hidden = true;
        return;
      }

      const indentOffset = (next.target?.listIntent?.targetIndentWidth ?? 0) * defaultCharacterWidth(this.view);
      this.indicator.hidden = false;
      this.indicator.style.left = `${contentRect.left + indentOffset}px`;
      this.indicator.style.top = `${next.targetLineNumber > this.view.state.doc.lines ? rect.bottom : rect.top}px`;
      this.indicator.style.width = `${Math.max(16, contentRect.width - indentOffset)}px`;
    }

    private scheduleRefresh(): void {
      if (this.refreshFrame !== null) return;
      this.refreshFrame = window.requestAnimationFrame(() => {
        this.refreshFrame = null;
        this.render(this.current);
      });
    }
  });
}

function defaultCharacterWidth(view: EditorView): number {
  const width = (view as unknown as { defaultCharacterWidth?: number }).defaultCharacterWidth;
  return typeof width === 'number' && width > 0 ? width : 8;
}
