import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { dropSeam } from 'md-dragger/adapter/codemirror';
import type { DropPosition } from 'md-dragger/domain';
import type { PipelineResult } from 'md-dragger/runtime';

// Demo drop line: paint only from DropPosition + real line DOM (dropSeam).

let active:
  | { consume(outputs: PipelineResult['outputs']): void }
  | null = null;

export function dropIndicatorOnChange(result: PipelineResult): void {
  active?.consume(result.outputs);
}

export function dropIndicator(): Extension {
  return ViewPlugin.fromClass(class {
    private readonly el: HTMLDivElement;
    private position: DropPosition | null = null;
    private raf: number | null = null;

    constructor(private readonly view: EditorView) {
      this.el = document.createElement('div');
      this.el.className = 'md-dragger-drop-indicator';
      this.el.setAttribute('aria-hidden', 'true');
      this.el.hidden = true;
      const cap = document.createElement('span');
      cap.className = 'md-dragger-drop-indicator-cap';
      this.el.appendChild(cap);
      document.body.appendChild(this.el);
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
      this.el.remove();
    }

    consume(outputs: PipelineResult['outputs']): void {
      for (const output of outputs) {
        if (output.type === 'drag_over') {
          this.position = output.drop.position;
          this.paint();
        } else if (
          output.type === 'dropped'
          || output.type === 'cancelled'
          || output.type === 'terminal'
        ) {
          this.position = null;
          this.paint();
        }
      }
    }

    private queue(): void {
      if (this.raf !== null) return;
      this.raf = window.requestAnimationFrame(() => {
        this.raf = null;
        this.paint();
      });
    }

    private paint(): void {
      const position = this.position;
      if (!position) {
        this.el.hidden = true;
        return;
      }

      const seam = dropSeam(this.view, position);
      if (!seam) {
        this.el.hidden = true;
        return;
      }

      this.el.hidden = false;
      this.el.style.transform = `translate3d(${seam.left}px, ${seam.y}px, 0)`;
      this.el.style.width = `${Math.max(24, seam.right - seam.left)}px`;
    }
  });
}
