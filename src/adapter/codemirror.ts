import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  type BlockInfo as ViewBlockInfo,
  ViewPlugin,
  type ViewUpdate,
  gutter,
} from '@codemirror/view';
import {
  DraggerRuntime,
  type DragPoint,
  type DragPreview,
  type DraggerInputSource,
  type DraggerPressInput,
  type DraggerRuntimeConfigInput,
} from '../drag/runtime';
import { detectBlock, type BlockSelection, type TextChange } from '../domain';

const HANDLE_CLASS = 'md-dragger-cm-handle';
const EDITOR_CLASS = 'md-dragger-cm-editor';

export type MdDraggerCodeMirrorOptions = {
  config?: DraggerRuntimeConfigInput;
};

export function mdDraggerCodeMirrorExtension(options: MdDraggerCodeMirrorOptions = {}): Extension {
  return [
    EditorView.editorAttributes.of({ class: EDITOR_CLASS }),
    blockSelectionField,
    dragHandleGutter(options),
    ViewPlugin.fromClass(class {
      private readonly runtime: DraggerRuntime;
      private readonly preview: DropPreviewRenderer;

      constructor(private readonly view: EditorView) {
        this.preview = new DropPreviewRenderer(view);
        this.runtime = new DraggerRuntime({
          input: createPointerInputSource(view),
          document: {
            getDoc: () => view.state.doc,
            applyChanges: (changes) => applyTextChanges(view, changes),
          },
          locate: {
            sourceLineFromInput: (input) => sourceLineFromInput(view, input),
            targetLineFromPoint: (point) => targetLineFromPoint(view, point),
          },
          preview: (value) => this.preview.render(value),
          selection: (selection) => {
            view.dispatch({ effects: setBlockSelectionEffect.of(selection) });
          },
          config: () => ({
            longPressMs: 0,
            ...resolveConfig(options.config),
          }),
        });
        this.runtime.mount();
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.geometryChanged || update.viewportChanged) {
          this.preview.scheduleRefresh();
        }
      }

      destroy(): void {
        this.runtime.destroy();
        this.preview.destroy();
      }
    }),
  ];
}

const setBlockSelectionEffect = StateEffect.define<BlockSelection | null>();

const selectedLineDecoration = Decoration.line({
  attributes: { class: 'md-dragger-cm-selected-line' },
});

const blockSelectionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (selectionDecorations, transaction) => {
    let next = selectionDecorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setBlockSelectionEffect)) {
        next = buildSelectionDecorations(transaction.state.doc, effect.value);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildSelectionDecorations(doc: { lines: number; line(n: number): { from: number } }, selection: BlockSelection | null): DecorationSet {
  if (!selection || selection.ranges.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of selection.ranges) {
    const startLine = Math.max(1, Math.min(doc.lines, range.startLine + 1));
    const endLine = Math.max(startLine, Math.min(doc.lines, range.endLine + 1));
    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
      const line = doc.line(lineNumber);
      builder.add(line.from, line.from, selectedLineDecoration);
    }
  }
  return builder.finish();
}

class DragHandleMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = HANDLE_CLASS;
    handle.setAttribute('aria-label', 'Drag markdown block');
    handle.textContent = '⋮⋮';
    return handle;
  }
}

const dragHandleMarker = new DragHandleMarker();

function dragHandleGutter(options: MdDraggerCodeMirrorOptions): Extension {
  return gutter({
    class: 'md-dragger-cm-gutter',
    lineMarker: (view, line) => {
      if (!isDraggableBlockStart(view, line, options)) return null;
      return dragHandleMarker;
    },
  });
}

function isDraggableBlockStart(view: EditorView, line: ViewBlockInfo, options: MdDraggerCodeMirrorOptions): boolean {
  const docLine = view.state.doc.lineAt(line.from);
  if (docLine.from !== line.from) return false;
  const block = detectBlock({ doc: view.state.doc }, docLine.number, {
    tabSize: resolveConfig(options.config)?.tabSize ?? 4,
  });
  return block?.startLine === docLine.number - 1;
}

function sourceLineFromInput(view: EditorView, input: DraggerPressInput): number | null {
  const event = nativePointerEvent(input.native);
  const target = event?.target instanceof Element ? event.target : null;
  const handle = target?.closest(`.${HANDLE_CLASS}`);
  if (!handle) return null;
  return targetLineFromPoint(view, input.point);
}

function targetLineFromPoint(view: EditorView, point: DragPoint): number | null {
  const contentRect = view.contentDOM.getBoundingClientRect();
  if (point.y <= contentRect.top) return 1;
  if (point.y >= contentRect.bottom) return view.state.doc.lines;

  const pos = view.posAtCoords({ x: Math.max(contentRect.left + 1, point.x), y: point.y }, false);
  if (typeof pos !== 'number') return null;
  return view.state.doc.lineAt(pos).number;
}

function createPointerInputSource(view: EditorView): DraggerInputSource {
  return {
    onPress: (handler) => {
      const listener = (event: PointerEvent) => {
        handler({
          point: { x: event.clientX, y: event.clientY },
          pointer: { id: event.pointerId, type: event.pointerType },
          button: event.button,
          modifiers: {
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          },
          native: event,
          claim: () => claimPointerEvent(event),
          capture: () => capturePointer(view.dom, event.pointerId),
          releaseCapture: () => releasePointerCapture(view.dom, event.pointerId),
        });
      };
      view.dom.addEventListener('pointerdown', listener, true);
      return () => view.dom.removeEventListener('pointerdown', listener, true);
    },
    onMove: (handler) => {
      const listener = (event: PointerEvent) => {
        handler({
          point: { x: event.clientX, y: event.clientY },
          pointer: { id: event.pointerId, type: event.pointerType },
          native: event,
          claim: () => claimPointerEvent(event),
        });
      };
      window.addEventListener('pointermove', listener, { capture: true, passive: false });
      return () => window.removeEventListener('pointermove', listener, true);
    },
    onRelease: (handler) => {
      const listener = (event: PointerEvent) => {
        handler({
          point: { x: event.clientX, y: event.clientY },
          pointer: { id: event.pointerId, type: event.pointerType },
          native: event,
          claim: () => claimPointerEvent(event),
          releaseCapture: () => releasePointerCapture(view.dom, event.pointerId),
        });
      };
      window.addEventListener('pointerup', listener, { capture: true, passive: false });
      return () => window.removeEventListener('pointerup', listener, true);
    },
    onCancel: (handler) => {
      const listener = (event: PointerEvent) => {
        handler({
          pointer: { id: event.pointerId, type: event.pointerType },
          reason: 'pointer_cancelled',
          native: event,
          releaseCapture: () => releasePointerCapture(view.dom, event.pointerId),
        });
      };
      window.addEventListener('pointercancel', listener, { capture: true, passive: false });
      return () => window.removeEventListener('pointercancel', listener, true);
    },
    onEscape: (handler) => {
      const listener = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        handler();
        event.preventDefault();
        event.stopPropagation();
      };
      window.addEventListener('keydown', listener, true);
      return () => window.removeEventListener('keydown', listener, true);
    },
  };
}

class DropPreviewRenderer {
  private readonly indicator: HTMLDivElement;
  private current: DragPreview | null = null;
  private refreshFrame: number | null = null;

  constructor(private readonly view: EditorView) {
    this.indicator = document.createElement('div');
    this.indicator.className = 'md-dragger-cm-drop-indicator';
    this.indicator.hidden = true;
    document.body.appendChild(this.indicator);
  }

  render(preview: DragPreview | null): void {
    this.current = preview;
    if (!preview || !preview.allowed || preview.targetLineNumber === null) {
      this.indicator.hidden = true;
      return;
    }

    const line = this.view.state.doc.line(preview.targetLineNumber);
    const rect = this.view.coordsAtPos(line.from, -1);
    const contentRect = this.view.contentDOM.getBoundingClientRect();
    if (!rect) {
      this.indicator.hidden = true;
      return;
    }

    this.indicator.hidden = false;
    this.indicator.style.left = `${contentRect.left}px`;
    this.indicator.style.top = `${rect.top}px`;
    this.indicator.style.width = `${contentRect.width}px`;
  }

  scheduleRefresh(): void {
    if (this.refreshFrame !== null) return;
    this.refreshFrame = window.requestAnimationFrame(() => {
      this.refreshFrame = null;
      this.render(this.current);
    });
  }

  destroy(): void {
    if (this.refreshFrame !== null) {
      window.cancelAnimationFrame(this.refreshFrame);
      this.refreshFrame = null;
    }
    this.indicator.remove();
  }
}

function applyTextChanges(view: EditorView, changes: TextChange[]): void {
  if (changes.length === 0) return;
  view.dispatch({ changes });
}

function resolveConfig(config: DraggerRuntimeConfigInput | undefined) {
  return typeof config === 'function' ? config() : config;
}

function nativePointerEvent(value: unknown): PointerEvent | null {
  return value instanceof PointerEvent ? value : null;
}

function claimPointerEvent(event: PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function capturePointer(target: HTMLElement, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Pointer capture can fail when the pointer is no longer active.
  }
}

function releasePointerCapture(target: HTMLElement, pointerId: number): void {
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // Pointer capture can fail when the pointer is already released.
  }
}
