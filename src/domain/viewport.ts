export type Viewport<Id = number> = {
    id: Id;
    left: number;
    top: number;
    width: number;
    height: number;
};

function contains(x: number, y: number, width: number, height: number): boolean {
    return x >= 0 && y >= 0 && x <= width && y <= height;
}

/**
 * Local point of a pointer inside the viewport that contains it.
 * A point still inside the origin viewport stays there. Otherwise the
 * viewport whose screen rect contains the screen point wins, and the result
 * is that viewport's local coordinates. No containing viewport keeps the
 * origin point; with no origin either, there is no point.
 */
export function pointInViewport<Id>(
    origin: Viewport<Id> | null,
    clientX: number,
    clientY: number,
    screenX: number,
    screenY: number,
    viewports: readonly Viewport<Id>[],
): { viewport: Viewport<Id>; x: number; y: number } | null {
    if (origin && contains(clientX, clientY, origin.width, origin.height)) {
        return { viewport: origin, x: clientX, y: clientY };
    }
    for (const viewport of viewports) {
        if (origin && viewport.id === origin.id) continue;
        const x = screenX - viewport.left;
        const y = screenY - viewport.top;
        if (!contains(x, y, viewport.width, viewport.height)) continue;
        return { viewport, x, y };
    }
    if (!origin) return null;
    return { viewport: origin, x: clientX, y: clientY };
}
