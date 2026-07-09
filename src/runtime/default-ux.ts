import { detectBlock } from '../domain/block/block-detector';
import type { BlockInfo } from '../domain/block/block-types';
import { createSingleBlockSelection, type BlockSelection } from '../domain/selection/block-selection';
import type { Doc } from '../domain/markdown/document-types';
import type { DragCancelReason } from '../pipeline/pipeline-event';
import type { RuntimeController } from './dragger-runtime';
import {
    type Disposable,
    type GestureConfig,
    type InputSource,
    type MoveInput,
    type Point,
    type Pointer,
    type PressInput,
    type ReleaseInput,
    type TimerToken,
    DEFAULT_GESTURE_CONFIG,
} from './dragger-runtime-types';

// A ux stage turns raw pointer events into semantic commands on the runtime.
// It owns everything platform-ux-specific — long-press timing, pixel
// thresholds, the long-press → range-select gesture — so the runtime core
// stays platform-agnostic. The runtime ships a default (DefaultUx); a host
// that wants different ux (HTML5 DnD, a totally different gesture) supplies
// its own Ux and drives the same RuntimeController.
export type Ux = {
    mount(): void;
    destroy(): void;
};

// The dependencies a Ux needs from its host. Kept abstract (no CodeMirror
// types) so a Ux is portable across editors — the adapter supplies input,
// getDoc, sourceLineFromInput and lineFromPoint; the runtime supplies itself
// (as a RuntimeController) and the gesture config.
export type UxDeps = {
    input: InputSource;
    runtime: RuntimeController;
    getDoc: () => Doc;
    sourceLineFromInput: (input: PressInput) => number | null;
    lineFromPoint: (point: Point) => number | null;
    tabSize: number;
    gestureConfig: () => GestureConfig;
    scheduler: {
        setTimer(callback: () => void, delayMs: number): TimerToken;
        clearTimer(token: TimerToken): void;
    };
};

// The default, batteries-included gesture recognizer. Not bound to any editor
// — only to the UxDeps abstractions above.
//
// Gesture model (multi-select on): long-press a handle → range-select submode;
// keep holding + drag to draw a multi-block range; drag past the start
// threshold → drag the whole drawn range. Single-block drag (multi-select off):
// long-press → ready; drag past threshold → drag the one block.
//
// External range-select entry (no long-press): enterRangeSelectionMode(line),
// used e.g. by a mobile toolbar command.
export class DefaultUx implements Ux {
    private readonly disposables: Disposable[] = [];
    private pressSession: PressSession | null = null;

    constructor(private readonly deps: UxDeps) {}

    mount(): void {
        const input = this.deps.input;
        this.disposables.push(input.onPress((e) => this.handlePress(e)));
        this.disposables.push(input.onMove((e) => this.handleMove(e)));
        this.disposables.push(input.onRelease((e) => this.handleRelease(e)));
        if (input.onCancel) {
            this.disposables.push(input.onCancel((e) => this.handleCancel(e.pointer, e.releaseCapture)));
        }
        if (input.onEscape) {
            this.disposables.push(input.onEscape(() => this.runtime().clearSelectionOrCancel()));
        }
    }

    destroy(): void {
        this.clearPressTimer();
        this.pressSession?.releaseCapture?.();
        this.pressSession = null;
        for (const dispose of this.disposables) dispose();
        this.disposables.length = 0;
    }

    private runtime(): RuntimeController {
        return this.deps.runtime;
    }

    private cfg(): GestureConfig {
        return { ...DEFAULT_GESTURE_CONFIG, ...this.deps.gestureConfig() };
    }

    private handlePress(input: PressInput): void {
        if (input.button !== undefined && input.button !== 0) return;

        const lineNumber = this.deps.sourceLineFromInput(input);
        if (lineNumber === null) return;

        const block = detectBlock(this.deps.getDoc(), lineNumber, { tabSize: this.deps.tabSize });
        if (!block) return;

        input.claim?.();
        input.capture?.();
        this.clearPress();
        const cfg = this.cfg();
        const sessionId = this.runtime().createSessionId();
        const selection = createSingleBlockSelection(block);
        const rangeMode = cfg.multiSelectEnabled;
        const timer = cfg.longPressMs > 0
            ? this.deps.scheduler.setTimer(
                () => rangeMode
                    ? this.enterRangeSelect(sessionId, input.pointer, block)
                    : this.markReady(sessionId, input.pointer),
                cfg.longPressMs,
            )
            : null;
        this.pressSession = {
            sessionId,
            pointer: input.pointer,
            start: input.point,
            selection,
            ready: cfg.longPressMs <= 0 && !rangeMode,
            rangeActive: false,
            timer,
            releaseCapture: input.releaseCapture,
        };
        this.runtime().beginHold(sessionId, selection, input.pointer.type);
        if (cfg.longPressMs <= 0 && !rangeMode) this.markReady(sessionId, input.pointer);
        if (cfg.longPressMs <= 0 && rangeMode) this.enterRangeSelect(sessionId, input.pointer, block);
    }

    private handleMove(input: MoveInput): void {
        const session = this.pressSession;
        if (!session || !samePointer(session.pointer, input.pointer)) return;

        const distance = distanceBetween(session.start, input.point);
        const cfg = this.cfg();

        // Range-select submode: the long-press has fired and the runtime is
        // selecting. Draw the range on every move; past the start threshold,
        // upgrade the drawn range into a drag of the whole selection.
        if (session.rangeActive && this.runtime().state.type === 'selecting') {
            const lineNumber = this.deps.lineFromPoint(input.point);
            if (lineNumber !== null) this.runtime().extendSelection(lineNumber);
            if (distance >= cfg.dragStartMoveThresholdPx) {
                this.upgradeRangeToDrag(session, input);
            }
            return;
        }

        if (!session.ready) {
            if (distance > cfg.dragCancelMoveThresholdPx) this.cancelPress('press_cancelled', input.pointer.type);
            return;
        }
        if (distance < cfg.dragStartMoveThresholdPx) return;

        input.claim?.();
        this.runtime().beginDrag(
            session.sessionId,
            session.selection,
            input.point,
            input.pointer,
            input.pointer.type,
            session.releaseCapture,
        );
        this.clearPressTimer();
        this.pressSession = null;
    }

    private handleRelease(input: ReleaseInput): void {
        const session = this.pressSession;
        if (this.runtime().isGestureActive() && session && samePointer(session.pointer, input.pointer)) {
            // An active drag session originated from this press: commit the drop.
            this.runtime().commitDrop(session.sessionId, input.point, input.pointer, input.pointer.type);
            this.pressSession = null;
            return;
        }
        if (session && samePointer(session.pointer, input.pointer)) {
            // Press released without becoming a drag. A drawn range that never
            // upgraded is discarded (the pipeline holds no cross-press
            // selection); a bare hold just cancels.
            if (session.rangeActive && this.runtime().state.type === 'selecting') {
                this.runtime().clearSelectionOrCancel();
            } else {
                this.cancelPress('press_cancelled', input.pointer.type);
            }
            this.pressSession = null;
        }
    }

    private handleCancel(pointer: Pointer, releaseCapture?: () => void): void {
        const session = this.pressSession;
        releaseCapture?.();
        if (this.runtime().isGestureActive()) {
            this.runtime().cancel('pointer_cancelled', pointer.type);
        } else if (session && samePointer(session.pointer, pointer)) {
            this.cancelPress('pointer_cancelled', pointer.type);
        }
    }

    // --- sub-gestures ---

    private markReady(sessionId: string, pointer: Pointer): void {
        const session = this.pressSession;
        if (!session || session.sessionId !== sessionId || !samePointer(session.pointer, pointer)) return;
        session.ready = true;
        this.clearPressTimer();
        this.runtime().markHoldReady(sessionId, pointer.type);
    }

    private enterRangeSelect(sessionId: string, pointer: Pointer, anchorBlock: BlockInfo): void {
        const session = this.pressSession;
        if (!session || session.sessionId !== sessionId || !samePointer(session.pointer, pointer)) return;
        this.clearPressTimer();
        session.rangeActive = true;
        this.runtime().startRangeSelection(anchorBlock);
    }

    private upgradeRangeToDrag(session: PressSession, input: MoveInput): void {
        const state = this.runtime().state;
        if (state.type !== 'selecting') return;
        const selection = state.selection.selection;
        if (selection.ranges.length === 0) return;
        this.runtime().beginDrag(
            session.sessionId,
            selection,
            input.point,
            input.pointer,
            input.pointer.type,
            session.releaseCapture,
        );
        this.pressSession = null;
    }

    private cancelPress(reason: DragCancelReason, pointerType: string | null): void {
        this.clearPress();
        this.runtime().cancel(reason, pointerType);
    }

    private clearPress(): void {
        if (!this.pressSession) return;
        this.clearPressTimer();
        this.pressSession.releaseCapture?.();
        this.pressSession = null;
    }

    private clearPressTimer(): void {
        const session = this.pressSession;
        if (!session || session.timer === null) return;
        this.deps.scheduler.clearTimer(session.timer);
        session.timer = null;
    }
}

type PressSession = {
    sessionId: string;
    pointer: Pointer;
    start: Point;
    selection: BlockSelection;
    ready: boolean;
    // True once the long-press fired into range-select submode; subsequent
    // moves draw the range and a past-threshold move upgrades to a drag.
    rangeActive: boolean;
    timer: TimerToken | null;
    releaseCapture?: () => void;
};

function samePointer(a: Pointer, b: Pointer): boolean {
    return a.id === b.id;
}

function distanceBetween(a: Point, b: Point): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}
