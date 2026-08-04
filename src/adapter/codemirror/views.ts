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

/** Prefer the view that owns the topmost DOM node under the point. */
export function viewAtPoint(x: number, y: number): EditorView | null {
    if (liveViews.size === 0) return null;

    const hit = typeof document !== 'undefined' ? document.elementFromPoint(x, y) : null;
    if (hit) {
        for (const view of liveViews) {
            if (view.dom.contains(hit)) return view;
        }
    }

    for (const view of liveViews) {
        const rect = view.dom.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return view;
        }
    }
    return null;
}
