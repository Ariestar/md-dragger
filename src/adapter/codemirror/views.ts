import type { EditorView } from '@codemirror/view';
import type { Doc } from '../../domain';

/**
 * Every dragRuntime mount registers its EditorView here.
 * Multi-pane is the same path as single-pane: one or many live views.
 * Doc identity is always read from view.state.doc (CM replaces the Text object on edit).
 */
const liveViews = new Set<EditorView>();

export function registerView(view: EditorView): () => void {
    liveViews.add(view);
    return () => {
        liveViews.delete(view);
    };
}

/** Apply an effect to every live view — the source view plus any other
 * open panes, so cross-pane drop feedback (seam, highlight) reaches the
 * view under the pointer. Consumers still filter by doc identity. */
export function broadcastToLiveViews(dispatch: (view: EditorView) => void): void {
    for (const view of liveViews) dispatch(view);
}

export function viewForDoc(doc: Doc): EditorView | null {
    for (const view of liveViews) {
        if (view.state.doc === doc) return view;
    }
    return null;
}

/** Windows that currently host a live editor. A pop-out is its own window. */
export function liveViewWindows(): Window[] {
    const wins = new Set<Window>();
    for (const view of liveViews) {
        const win = view.dom.ownerDocument.defaultView;
        if (win) wins.add(win);
    }
    return [...wins];
}

// Set for the duration of a pointer handler. clientX/clientY belong to the
// window that received the event, which is not always the drag source.
let pointerDoc: Document | null = null;

export function withPointerDocument<T>(doc: Document | null, run: () => T): T {
    const prev = pointerDoc;
    pointerDoc = doc;
    try {
        return run();
    } finally {
        pointerDoc = prev;
    }
}

export function pointerDocument(): Document | null {
    return pointerDoc;
}

export type ViewHit = { view: EditorView; x: number; y: number };

/** On-screen rect of a frame, and the scale from its layout pixels to that rect. */
function frameScale(frame: HTMLElement): { rect: DOMRect; sx: number; sy: number } {
    const rect = frame.getBoundingClientRect();
    return {
        rect,
        sx: frame.offsetWidth > 0 && rect.width > 0 ? rect.width / frame.offsetWidth : 1,
        sy: frame.offsetHeight > 0 && rect.height > 0 ? rect.height / frame.offsetHeight : 1,
    };
}

/** A point in `frame`'s parent document, translated into the frame's document. */
export function pointInChildFrame(
    frame: HTMLIFrameElement,
    x: number,
    y: number,
): { doc: Document; x: number; y: number } | null {
    const doc = frame.contentDocument;
    if (!doc) return null;
    const { rect, sx, sy } = frameScale(frame);
    return {
        doc,
        x: (x - rect.left) / sx - frame.clientLeft,
        y: (y - rect.top) / sy - frame.clientTop,
    };
}

/** A point in `frame`'s document, translated into the parent document. */
export function pointInParentFrame(frame: HTMLElement, x: number, y: number): { doc: Document; x: number; y: number } {
    const { rect, sx, sy } = frameScale(frame);
    return {
        doc: frame.ownerDocument,
        x: rect.left + (frame.clientLeft + x) * sx,
        y: rect.top + (frame.clientTop + y) * sy,
    };
}

/**
 * A point in a document, translated to the top-level document of its window
 * (through each enclosing frame). A pop-out window is its own top level.
 */
export function pointInTopDocument(doc: Document, x: number, y: number): { doc: Document; x: number; y: number } {
    let frame = doc.defaultView?.frameElement as HTMLElement | null;
    while (frame) {
        const next = pointInParentFrame(frame, x, y);
        doc = next.doc;
        x = next.x;
        y = next.y;
        frame = doc.defaultView?.frameElement as HTMLElement | null;
    }
    return { doc, x, y };
}

/**
 * Editor under a point whose coordinates are in `doc`, descending into iframes
 * (a canvas card) and climbing back out. The returned x/y are in that editor's
 * own viewport.
 */
export function locateEditor(x: number, y: number, doc: Document, depth = 0): ViewHit | null {
    if (liveViews.size === 0 || depth > 4) return null;

    const hit = doc.elementFromPoint(x, y);
    if (hit) {
        for (const view of liveViews) {
            if (view.dom.contains(hit)) return { view, x, y };
        }
        const frame = hit.tagName === 'IFRAME' ? (hit as HTMLIFrameElement) : null;
        const inner = frame ? pointInChildFrame(frame, x, y) : null;
        if (inner) {
            const found = locateEditor(inner.x, inner.y, inner.doc, depth + 1);
            if (found) return found;
        }
    }

    for (const view of liveViews) {
        if (view.dom.ownerDocument !== doc) continue;
        const rect = view.dom.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return { view, x, y };
        }
    }

    // Nothing in this document is under the point. A canvas card's iframe reports
    // that for a pointer that has left the card.
    if (hit) return null;
    const frame = doc.defaultView?.frameElement as HTMLElement | null;
    if (!frame) return null;
    const parent = pointInParentFrame(frame, x, y);
    return locateEditor(parent.x, parent.y, parent.doc, depth + 1);
}

/**
 * Prefer the view that owns the topmost DOM node under the point. Point
 * coordinates are only meaningful within one document (a canvas card's iframe
 * has its own), so the hit test runs in `doc` and only editors in it count.
 */
export function viewAtPoint(x: number, y: number, doc: Document): EditorView | null {
    return locateEditor(x, y, doc)?.view ?? null;
}
