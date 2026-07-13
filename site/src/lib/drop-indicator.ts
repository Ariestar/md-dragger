import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { DropTarget } from 'md-dragger/domain';
import type { PipelineResult } from 'md-dragger/runtime';

// Demo drop line. Fed by mdDragger({ onChange }) — not dragTransitionEffect
// (Vite source dual-instance can break StateEffect identity).
// Y = insertion seam before targetLineNumber (bottom of previous line).
// X/width = the line box that defines that seam + list indent.

let active:
  | { consume(outputs: PipelineResult['outputs']): void }
  | null = null;

export function dropIndicatorOnChange(result: PipelineResult): void {
  active?.consume(result.outputs);
}

export function dropIndicator(): Extension {
  return ViewPlugin.fromClass(class {
    private readonly el: HTMLDivElement;
    private target: DropTarget | null = null;
    private raf: number | null = null;

    constructor(private readonly view: EditorView) {
      this.el = document.createElement('div');
      this.el.className = 'md-dragger-cm-drop-indicator';
      this.el.setAttribute('aria-hidden', 'true');
      this.el.hidden = true;
      const cap = document.createElement('span');
      cap.className = 'md-dragger-cm-drop-indicator-cap';
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
          this.target = output.drop.target;
          this.paint();
        } else if (
          output.type === 'dropped'
          || output.type === 'cancelled'
          || output.type === 'terminal'
        ) {
          this.target = null;
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
      const target = this.target;
      if (!target || target.targetLineNumber < 1) {
        this.el.hidden = true;
        return;
      }

      const seam = insertionSeam(this.view, target.targetLineNumber);
      if (!seam) {
        this.el.hidden = true;
        return;
      }

      const indent = (target.listIntent?.targetIndentWidth ?? 0)
        * defaultCharacterWidth(this.view);
      const left = seam.left + indent;
      const width = Math.max(24, seam.right - left);

      this.el.hidden = false;
      this.el.style.transform = `translate3d(${left}px, ${seam.y}px, 0)`;
      this.el.style.width = `${width}px`;
    }
  });
}

// placement 'before' targetLineNumber → seam is top of that line / bottom of previous.
function insertionSeam(
  view: EditorView,
  targetLineNumber: number,
): { left: number; right: number; y: number } | null {
  const doc = view.state.doc;
  if (targetLineNumber <= 1) {
    const lineEl = lineElementAt(view, doc.line(1).from);
    if (!lineEl) return null;
    const rect = lineEl.getBoundingClientRect();
    return { left: rect.left, right: rect.right, y: rect.top };
  }

  const anchorLineNumber = Math.min(targetLineNumber - 1, doc.lines);
  const lineEl = lineElementAt(view, doc.line(anchorLineNumber).from);
  if (!lineEl) return null;
  const rect = lineEl.getBoundingClientRect();
  // After last line: still use last line's bottom as the seam.
  return { left: rect.left, right: rect.right, y: rect.bottom };
}

function lineElementAt(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.domAtPos(pos);
  let node: Node | null = dom.node;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  if (!(node instanceof Element)) return null;
  return node.closest('.cm-line');
}

function defaultCharacterWidth(view: EditorView): number {
  const width = (view as unknown as { defaultCharacterWidth?: number }).defaultCharacterWidth;
  return typeof width === 'number' && width > 0 ? width : 8;
}
