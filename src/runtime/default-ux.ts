import { detectBlock } from '../domain/block/block-detector';
import type { BlockInfo } from '../domain/block/block-types';
import { createSingleBlockSelection, type BlockSelection } from '../domain/selection/block-selection';
import type { SelectedBlockRange } from '../domain/selection/block-ranges';
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

export type Ux = {
    mount(): void;
    destroy(): void;
};

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

// multiSelect off:
//   press → hold → (dragArmMs) ready → move past threshold → drag
//   short release → press_cancelled
//
// multiSelect on:
//   press → hold
//   short release before multiSelectMs → press_cancelled (host menu)
//   hold to dragArmMs → ready (move past threshold → drag)
//   hold to multiSelectMs → selecting (persistent multi-select)
//   later sweeps toggle; long-press (dragArmMs) on selected block → group drag
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
        this.clearTimers();
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
        const existingSelectedBlocks = this.currentSelectedBlocks();
        const inSelecting = cfg.multiSelectEnabled && this.runtime().state.type === 'selecting';
        const selectedDragCandidate = inSelecting && isBlockSelected(block, existingSelectedBlocks);

        // Already selecting: arm group-drag on a selected block, or toggle-sweep.
        if (inSelecting) {
            const armMs = cfg.dragArmMs;
            const timer = selectedDragCandidate && armMs > 0
                ? this.deps.scheduler.setTimer(
                    () => this.markSelectedDragReady(sessionId, input.pointer),
                    armMs,
                )
                : null;
            this.pressSession = {
                sessionId,
                pointer: input.pointer,
                start: input.point,
                anchorBlock: block,
                selection,
                ready: false,
                rangeActive: false,
                selectedDragCandidate,
                selectedDragReady: selectedDragCandidate && armMs <= 0,
                selectedBlocksAtPress: existingSelectedBlocks,
                armTimer: timer,
                multiSelectTimer: null,
                releaseCapture: input.releaseCapture,
            };
            if (!selectedDragCandidate) this.startRangeSweep(this.pressSession);
            return;
        }

        // Fresh press: hold first so short release can cancel → host menu.
        this.runtime().beginHold(sessionId, selection, input.pointer.type);

        if (cfg.multiSelectEnabled) {
            const multiMs = Math.max(0, cfg.multiSelectMs);
            const armMs = Math.max(0, cfg.dragArmMs);
            const multiSelectTimer = multiMs > 0
                ? this.deps.scheduler.setTimer(
                    () => this.startRangeSweepIfCurrent(sessionId, input.pointer),
                    multiMs,
                )
                : null;
            const armTimer = armMs > 0
                ? this.deps.scheduler.setTimer(
                    () => this.markReady(sessionId, input.pointer),
                    armMs,
                )
                : null;
            this.pressSession = {
                sessionId,
                pointer: input.pointer,
                start: input.point,
                anchorBlock: block,
                selection,
                ready: armMs <= 0,
                rangeActive: false,
                selectedDragCandidate: false,
                selectedDragReady: false,
                selectedBlocksAtPress: [],
                armTimer,
                multiSelectTimer,
                releaseCapture: input.releaseCapture,
            };
            if (armMs <= 0) this.runtime().markHoldReady(sessionId, input.pointer.type);
            if (multiMs <= 0) this.startRangeSweep(this.pressSession);
            return;
        }

        // Single-block only.
        const armMs = Math.max(0, cfg.dragArmMs);
        const armTimer = armMs > 0
            ? this.deps.scheduler.setTimer(
                () => this.markReady(sessionId, input.pointer),
                armMs,
            )
            : null;
        this.pressSession = {
            sessionId,
            pointer: input.pointer,
            start: input.point,
            anchorBlock: block,
            selection,
            ready: armMs <= 0,
            rangeActive: false,
            selectedDragCandidate: false,
            selectedDragReady: false,
            selectedBlocksAtPress: [],
            armTimer,
            multiSelectTimer: null,
            releaseCapture: input.releaseCapture,
        };
        if (armMs <= 0) this.markReady(sessionId, input.pointer);
    }

    private handleMove(input: MoveInput): void {
        const session = this.pressSession;
        if (!session || !samePointer(session.pointer, input.pointer)) return;

        if (this.runtime().isGestureActive()) {
            this.runtime().moveDrag(session.sessionId, input.point, input.pointer, input.pointer.type);
            return;
        }

        const distance = distanceBetween(session.start, input.point);
        const cfg = this.cfg();

        if (session.selectedDragReady) {
            if (distance < cfg.dragStartMoveThresholdPx) return;
            const state = this.runtime().state;
            if (state.type !== 'selecting' || state.selection.selection.ranges.length === 0) return;
            input.claim?.();
            this.clearTimers();
            this.runtime().beginDrag(
                session.sessionId,
                state.selection.selection,
                input.point,
                input.pointer,
                input.pointer.type,
                session.releaseCapture,
            );
            return;
        }

        if (session.selectedDragCandidate && !session.rangeActive) {
            if (distance < cfg.dragStartMoveThresholdPx) return;
            this.startRangeSweep(session);
        }

        if (session.rangeActive && this.runtime().state.type === 'selecting') {
            const lineNumber = this.deps.lineFromPoint(input.point);
            if (lineNumber !== null) this.runtime().extendSelection(lineNumber);
            return;
        }

        // Armed for multi-select or single drag: moving past threshold starts a
        // drag once ready (dragArmMs elapsed, or dragArmMs=0).
        if (!session.rangeActive) {
            if (!session.ready) {
                // Not armed yet: cancel if the pointer drifts too far.
                if (distance > cfg.dragCancelMoveThresholdPx) {
                    this.cancelPress('press_cancelled', input.pointer.type);
                }
                return;
            }
            if (distance < cfg.dragStartMoveThresholdPx) return;
            input.claim?.();
            this.clearTimers();
            // Ensure pipeline is ready_to_drag before drag_start.
            if (this.runtime().state.type === 'holding') {
                this.runtime().markHoldReady(session.sessionId, input.pointer.type);
            }
            this.runtime().beginDrag(
                session.sessionId,
                session.selection,
                input.point,
                input.pointer,
                input.pointer.type,
                session.releaseCapture,
            );
            return;
        }
    }

    private handleRelease(input: ReleaseInput): void {
        const session = this.pressSession;
        if (this.runtime().isGestureActive() && session && samePointer(session.pointer, input.pointer)) {
            this.runtime().commitDrop(session.sessionId, input.point, input.pointer, input.pointer.type);
            this.pressSession = null;
            return;
        }
        if (!(session && samePointer(session.pointer, input.pointer))) return;

        if (session.rangeActive && this.runtime().state.type === 'selecting') {
            this.runtime().finishSelection();
            this.clearPress();
            return;
        }

        if (session.selectedDragCandidate) {
            if (!session.selectedDragReady) {
                this.startRangeSweep(session);
                this.runtime().finishSelection();
            }
            this.clearPress();
            return;
        }

        // Short press: cancel → host may open handle-tap menu.
        this.cancelPress('press_cancelled', input.pointer.type);
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

    private markReady(sessionId: string, pointer: Pointer): void {
        const session = this.pressSession;
        if (!session || session.sessionId !== sessionId || !samePointer(session.pointer, pointer)) return;
        session.ready = true;
        if (session.armTimer !== null) {
            this.deps.scheduler.clearTimer(session.armTimer);
            session.armTimer = null;
        }
        this.runtime().markHoldReady(sessionId, pointer.type);
    }

    private markSelectedDragReady(sessionId: string, pointer: Pointer): void {
        const session = this.pressSession;
        if (!session || session.sessionId !== sessionId || !samePointer(session.pointer, pointer)) return;
        if (!session.selectedDragCandidate) return;
        if (session.armTimer !== null) {
            this.deps.scheduler.clearTimer(session.armTimer);
            session.armTimer = null;
        }
        session.selectedDragReady = true;
    }

    private startRangeSweepIfCurrent(sessionId: string, pointer: Pointer): void {
        const session = this.pressSession;
        if (!session || session.sessionId !== sessionId || !samePointer(session.pointer, pointer)) return;
        this.startRangeSweep(session);
    }

    private startRangeSweep(session: PressSession): void {
        if (session.rangeActive) return;
        this.clearTimers();
        session.rangeActive = true;
        session.selectedDragReady = false;
        session.ready = false;
        this.runtime().startRangeSelection(session.anchorBlock, session.selectedBlocksAtPress);
    }

    private currentSelectedBlocks(): SelectedBlockRange[] {
        const state = this.runtime().state;
        if (state.type !== 'selecting') return [];
        return state.selection.selection.ranges.map((range) => ({
            startLineNumber: range.startLine + 1,
            endLineNumber: range.endLine + 1,
        }));
    }

    private cancelPress(reason: DragCancelReason, pointerType: string | null): void {
        this.clearPress();
        this.runtime().cancel(reason, pointerType);
    }

    private clearPress(): void {
        if (!this.pressSession) return;
        this.clearTimers();
        this.pressSession.releaseCapture?.();
        this.pressSession = null;
    }

    private clearTimers(): void {
        const session = this.pressSession;
        if (!session) return;
        if (session.armTimer !== null) {
            this.deps.scheduler.clearTimer(session.armTimer);
            session.armTimer = null;
        }
        if (session.multiSelectTimer !== null) {
            this.deps.scheduler.clearTimer(session.multiSelectTimer);
            session.multiSelectTimer = null;
        }
    }
}

type PressSession = {
    sessionId: string;
    pointer: Pointer;
    start: Point;
    anchorBlock: BlockInfo;
    selection: BlockSelection;
    ready: boolean;
    rangeActive: boolean;
    selectedDragCandidate: boolean;
    selectedDragReady: boolean;
    selectedBlocksAtPress: SelectedBlockRange[];
    armTimer: TimerToken | null;
    multiSelectTimer: TimerToken | null;
    releaseCapture?: () => void;
};

function samePointer(a: Pointer, b: Pointer): boolean {
    return a.id === b.id;
}

function distanceBetween(a: Point, b: Point): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function isBlockSelected(block: BlockInfo, selectedBlocks: SelectedBlockRange[]): boolean {
    return selectedBlocks.some((selected) => (
        selected.startLineNumber === block.startLine + 1
        && selected.endLineNumber === block.endLine + 1
    ));
}
