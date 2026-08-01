import { describe, expect, it, vi } from 'vitest';
import { DefaultUx } from './default-ux';
import type { RuntimeController } from './dragger-runtime';
import type { ReleaseInput, TimerToken } from './dragger-runtime-types';

type CapturingInput = ReturnType<typeof makeInputSource>;

function makeRuntime(overrides: Partial<RuntimeController> = {}): RuntimeController {
    return {
        isGestureActive: () => false,
        createSessionId: () => 'test-session',
        beginHold: vi.fn(),
        markHoldReady: vi.fn(),
        beginDrag: vi.fn(),
        moveDrag: vi.fn(),
        commitDrop: vi.fn(),
        setSelection: vi.fn(),
        clearSelection: vi.fn(),
        cancel: vi.fn(),
        clearSelectionOrCancel: vi.fn(),
        guardUnavailable: vi.fn(),
        handleMobileDragAvailabilityChanged: vi.fn(),
        ...overrides,
    } as unknown as RuntimeController;
}

function makeInputSource() {
    let releaseHandler: ((input: ReleaseInput) => void) | null = null;
    const input = {
        onPress: () => () => {},
        onMove: () => () => {},
        onRelease: (handler: (input: ReleaseInput) => void) => {
            releaseHandler = handler;
            return () => {};
        },
    };
    const source = {
        ...input,
        release: (extra: Partial<ReleaseInput> = {}) =>
            releaseHandler?.({ point: { x: 0, y: 0 }, pointer: { id: 1, type: 'mouse' }, ...extra }),
    };
    return source as unknown as CapturingInput;
}

function makeUx(runtime: RuntimeController, input: CapturingInput): void {
    const ux = new DefaultUx({
        input,
        runtime,
        getDoc: () => ({ lines: 0 }) as never,
        sourceLineFromInput: () => null,
        lineFromPoint: () => null,
        tabSize: 4,
        gestureConfig: () => ({}),
        scheduler: {
            setTimer: (callback: () => void) => 0 as TimerToken,
            clearTimer: () => {},
        },
    });
    ux.mount();
}

describe('DefaultUx handleRelease', () => {
    it('force-cancels a still-active gesture when pressSession was lost', () => {
        const cancel = vi.fn();
        const runtime = makeRuntime({ isGestureActive: () => true, cancel });
        const input = makeInputSource();
        makeUx(runtime, input);

        input.release();

        expect(cancel).toHaveBeenCalledWith('pointer_cancelled', 'mouse');
    });

    it('force-cancels when the releasing pointer does not match the gesture', () => {
        const cancel = vi.fn();
        const runtime = makeRuntime({ isGestureActive: () => true, cancel });
        const input = makeInputSource();
        makeUx(runtime, input);

        input.release({ pointer: { id: 999, type: 'touch' } });

        expect(cancel).toHaveBeenCalled();
    });

    it('does not cancel when no gesture is active and there is no press session', () => {
        const cancel = vi.fn();
        const runtime = makeRuntime({ isGestureActive: () => false, cancel });
        const input = makeInputSource();
        makeUx(runtime, input);

        input.release();

        expect(cancel).not.toHaveBeenCalled();
    });
});
