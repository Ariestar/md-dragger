import { describe, expect, it } from 'vitest';
import { pointInViewport, type Viewport } from './viewport';

function viewport(id: string, left: number, top: number, width = 800, height = 600): Viewport<string> {
    return { id, left, top, width, height };
}

describe('pointInViewport', () => {
    const main = viewport('main', 0, 0);
    const popout = viewport('popout', 900, 50);

    it('keeps a point that is still inside the origin viewport', () => {
        expect(pointInViewport(main, 12, 8, 12, 8, [main, popout])).toEqual({ viewport: main, x: 12, y: 8 });
    });

    it('uses the other viewport when the origin no longer contains the point', () => {
        expect(pointInViewport(main, 1100, 90, 1100, 90, [main, popout])).toEqual({
            viewport: popout,
            x: 200,
            y: 40,
        });
    });

    it('keeps the origin point when the screen point misses every other viewport', () => {
        expect(pointInViewport(main, 1100, 90, 1100, 90, [main])).toEqual({ viewport: main, x: 1100, y: 90 });
    });

    it('returns null when there is no origin and the screen point misses every viewport', () => {
        expect(pointInViewport(null, 5, 6, 5000, 5000, [main])).toBeNull();
    });
});
