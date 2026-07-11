import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { DropTarget } from 'md-dragger/domain';
import type { PipelineResult } from 'md-dragger/runtime';

// Demo-only drop indicator.
//
// Driven by options.onChange from dragRuntime — NOT by dragTransitionEffect.
// Vite's `conditions: ['source']` can load the adapter twice (source + bundled),
// which creates two StateEffect identities so effect.is(dragTransitionEffect)
// never matches. The onChange callback is a plain function reference and
// cannot dual-instance.
type IndicatorTarget = {
  target: DropTarget | null;
  targetLineNumber: number;
  allowed: boolean;
};

type DropIndicatorHost = {
  consume(outputs: PipelineResult['outputs']): void;
  destroy(): void;
};

// Shared sink so mdDragger({ onChange }) can push into the ViewPlugin instance.
let activeHost: DropIndicatorHost | null = null;

export function dropIndicatorOnChange(result: PipelineResult): void {
  activeHost?.consume(result.outputs);
}

export function dropIndicator(): Extension {
  return ViewPlugin.fromClass(class implements DropIndicatorHost {
    private readonly indicator: HTMLDivElement;
    private current: IndicatorTarget | null = null;
    private refreshFrame: number | null = null;

    constructor(private readonly view: EditorView) {
      this.indicator = document.createElement('div');
      this.indicator.className = 'md-dragger-cm-drop-indicator';
      this.indicator.setAttribute('aria-hidden', 'true');
      this.indicator.hidden = true;
      // Inline critical styles so the line is visible even if CSS is purged
      // or not yet applied. Theme CSS can still override via class rules.
      this.indicator.style.position = 'fixed';
      this.indicator.style.zIndex = '1000';
      this.indicator.style.height = '2px';
      this.indicator.style.pointerEvents = 'none';
      this.indicator.style.background = 'var(--md-dragger-indicator, #60a5fa)';
      this.indicator.style.boxShadow = '0 0 0 1px var(--md-dragger-indicator-shadow, rgba(96,165,250,0.35))';
      document.body.appendChild(this.indicator);
      activeHost = this;
    }

    update(update: ViewUpdate): void {
      // Geometry-only refresh — pipeline pushes arrive via dropIndicatorOnChange.
      if (update.docChanged || update.geometryChanged || update.viewportChanged) {
        this.scheduleRefresh();
      }
    }

    destroy(): void {
      if (activeHost === this) activeHost = null;
      if (this.refreshFrame !== null) {
        window.cancelAnimationFrame(this.refreshFrame);
        this.refreshFrame = null;
      }
      this.indicator.remove();
    }

    consume(outputs: PipelineResult['outputs']): void {
      for (const output of outputs) {
        if (output.type === 'drag_over') {
          // Still show the line when the drop is rejected (e.g. self-drop) —
          // the host can style it differently later; hiding it entirely made
          // the demo look like the indicator was broken.
          this.render({
            target: output.drop.target,
            targetLineNumber: output.drop.target?.targetLineNumber ?? -1,
            allowed: true,
          });
        } else if (
          output.type === 'dropped'
          || output.type === 'cancelled'
          || output.type === 'terminal'
        ) {
          this.render(null);
        }
      }
    }

    private render(next: IndicatorTarget | null): void {
      this.current = next;
      if (!next || next.targetLineNumber < 1) {
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

      const indentOffset = (next.target?.listIntent?.targetIndentWidth ?? 0)
        * defaultCharacterWidth(this.view);
      this.indicator.hidden = false;
      this.indicator.style.left = `${contentRect.left + indentOffset}px`;
      this.indicator.style.top = `${
        next.targetLineNumber > this.view.state.doc.lines ? rect.bottom : rect.top
      }px`;
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
