import type { ScrollPort } from '../../runtime/modules';

// Edge auto-scroll port for a CodeMirror view: scrolls the .cm-scroller
// under the pointer (CM6's native scroll container). The platform DOM lives
// here in the adapter; the engine's autoScroll module only drives the loop.
// getDoc defaults to the main document; hosts with pop-out windows pass the
// active document getter so cross-window drags still hit the right scroller.

export function scrollPort(getDoc: () => Document = () => document): ScrollPort {
    return {
        nudge(point, cfg) {
            const scroller = getDoc().elementFromPoint(point.x, point.y)?.closest('.cm-scroller') as HTMLElement | null;
            if (!scroller) return;
            const rect = scroller.getBoundingClientRect();
            let dy = 0;
            const top = point.y - rect.top;
            const bottom = rect.bottom - point.y;
            if (top >= 0 && top < cfg.edgeZonePx) {
                dy = -cfg.maxSpeedPx * (1 - top / cfg.edgeZonePx);
            } else if (bottom >= 0 && bottom < cfg.edgeZonePx) {
                dy = cfg.maxSpeedPx * (1 - bottom / cfg.edgeZonePx);
            }
            if (dy !== 0) scroller.scrollTop += dy;
        },
    };
}
