import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockType } from '../../domain/block/block-types';
import type { DragUxContext } from '../ux-module';
import { autoScroll, type ScrollPort } from './auto-scroll';

const cfg = { edgeZonePx: 40, maxSpeedPx: 12 };

function ctx(x: number, y: number): DragUxContext {
    return {
        selection: { blocks: [{ type: BlockType.ListItem, lines: { startLine: 1, endLine: 1 } }] },
        point: { x, y },
        pointer: { id: 1, type: 'mouse' },
    };
}

describe('autoScroll module', () => {
    afterEach(() => vi.useRealTimers());

    it('keeps nudging on a timer while the pointer is stationary', () => {
        vi.useFakeTimers();
        const nudged: number[] = [];
        const port: ScrollPort = { nudge: () => nudged.push(1) };
        const module = autoScroll(port, cfg);

        module.onDragStart?.(ctx(10, 590));
        // A tick fires without any pointer move — this is the regression:
        // edge auto-scroll must keep running while the pointer is held still.
        vi.advanceTimersByTime(16);
        vi.advanceTimersByTime(16);
        expect(nudged.length).toBeGreaterThanOrEqual(2);
    });

    it('nudges with the latest point after a move', () => {
        vi.useFakeTimers();
        const nudged: Array<{ x: number; y: number }> = [];
        const port: ScrollPort = { nudge: (point) => nudged.push(point) };
        const module = autoScroll(port, cfg);

        module.onDragStart?.(ctx(10, 590));
        module.onDragMove?.(ctx(20, 591));
        vi.advanceTimersByTime(16);
        expect(nudged[nudged.length - 1]).toEqual({ x: 20, y: 591 });
    });

    it('stops nudging after the drag ends', () => {
        vi.useFakeTimers();
        const nudged: number[] = [];
        const port: ScrollPort = { nudge: () => nudged.push(1) };
        const module = autoScroll(port, cfg);

        module.onDragStart?.(ctx(10, 590));
        module.onDragEnd?.(ctx(10, 590), { kind: 'applied', edits: [] });
        const before = nudged.length;
        vi.advanceTimersByTime(64);
        expect(nudged.length).toBe(before);
    });

    it('stops nudging after a cancel', () => {
        vi.useFakeTimers();
        const nudged: number[] = [];
        const port: ScrollPort = { nudge: () => nudged.push(1) };
        const module = autoScroll(port, cfg);

        module.onDragStart?.(ctx(10, 590));
        module.onCancel?.(ctx(10, 590));
        const before = nudged.length;
        vi.advanceTimersByTime(64);
        expect(nudged.length).toBe(before);
    });

    it('does nothing when the edge zone or max speed is zero', () => {
        const nudged: number[] = [];
        const port: ScrollPort = { nudge: () => nudged.push(1) };
        const module = autoScroll(port, { edgeZonePx: 0, maxSpeedPx: 12 });

        module.onDragStart?.(ctx(10, 590));
        expect(nudged).toHaveLength(0);
    });
});
