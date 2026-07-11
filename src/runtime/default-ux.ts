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

// Gesture model (multi-select on): long-press a handle → persistent
// range-select submode; keep holding + drag to toggle blocks. Release keeps the
// selection so later handle sweeps can toggle more blocks. To drag the group,
// long-press an already selected block, then move.
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
        const existingSelectedBlocks = this.currentSelectedBlocks();
        const inSelecting = cfg.multiSelectEnabled && this.runtime().state.type === 'selecting';
        const selectedDragCandidate = inSelecting && isBlockSelected(block, existingSelectedBlocks);

        // Already in persistent multi-select: either arm a second long-press to
        // drag the group, or start another toggle sweep immediately.
        if (inSelecting) {
            const timer = selectedDragCandidate && cfg.longPressMs > 0
                ? this.deps.scheduler.setTimer(
                    () => this.markSelectedDragReady(sessionId, input.pointer),
                    cfg.longPressMs,
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
                selectedDragReady: selectedDragCandidate && cfg.longPressMs <= 0,
                selectedBlocksAtPress: existingSelectedBlocks,
                timer,
                releaseCapture: input.releaseCapture,
            };
            if (!selectedDragCandidate) this.startRangeSweep(this.pressSession);
            return;
        }

        const rangeMode = cfg.multiSelectEnabled;
        const timer = cfg.longPressMs > 0
            ? this.deps.scheduler.setTimer(
                () => rangeMode
                    ? this.startRangeSweepIfCurrent(sessionId, input.pointer)
                    : this.markReady(sessionId, input.pointer),
                cfg.longPressMs,
            )
            : null;
        this.pressSession = {
            sessionId,
            pointer: input.pointer,
            start: input.point,
            anchorBlock: block,
            selection,
            ready: cfg.longPressMs <= 0 && !rangeMode,
            rangeActive: false,
            selectedDragCandidate: false,
            selectedDragReady: false,
            selectedBlocksAtPress: [],
            timer,
            releaseCapture: input.releaseCapture,
        };
        this.runtime().beginHold(sessionId, selection, input.pointer.type);
        if (cfg.longPressMs <= 0 && !rangeMode) this.markReady(sessionId, input.pointer);
        if (cfg.longPressMs <= 0 && rangeMode) this.startRangeSweep(this.pressSession);
    }

    private handleMove(input: MoveInput): void {
        const session = this.pressSession;
        if (!session || !samePointer(session.pointer, input.pointer)) return;

        // Drag in progress: forward every move so drag_over / drop indicator track.
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

        // Pressed a selected block but moved before long-press matured → toggle sweep instead.
        if (session.selectedDragCandidate && !session.rangeActive) {
            if (distance < cfg.dragStartMoveThresholdPx) return;
            this.startRangeSweep(session);
        }

        if (session.rangeActive && this.runtime().state.type === 'selecting') {
            const lineNumber = this.deps.lineFromPoint(input.point);
            if (lineNumber !== null) this.runtime().extendSelection(lineNumber);
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
    }

    private handleRelease(input: ReleaseInput): void {
        const session = this.pressSession;
        if (this.runtime().isGestureActive() && session && samePointer(session.pointer, input.pointer)) {
            this.runtime().commitDrop(session.sessionId, input.point, input.pointer, input.pointer.type);
            this.pressSession = null;
            return;
        }
        if (!(session && samePointer(session.pointer, input.pointer))) return;

        // Persistent multi-select: keep ranges across presses.
        if (session.rangeActive && this.runtime().state.type === 'selecting') {
            this.runtime().finishSelection();
            this.clearPress();
            return;
        }
        if (session.selectedDragCandidate) {
            // Short press on a selected block without long-press maturity: treat as toggle.
            if (!session.selectedDragReady) {
                this.startRangeSweep(session);
                this.runtime().finishSelection();
            }
            this.clearPress();
            return;
        }
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
        this.clearPressTimer();
        this.runtime().markHoldReady(sessionId, pointer.type);
    }

    private markSelectedDragReady(sessionId: string, pointer: Pointer): void {
        const session = this.pressSession;
        if (!session || session.sessionId !== sessionId || !samePointer(session.pointer, pointer)) return;
        if (!session.selectedDragCandidate) return;
        this.clearPressTimer();
        session.selectedDragReady = true;
    }

    private startRangeSweepIfCurrent(sessionId: string, pointer: Pointer): void {
        const session = this.pressSession;
        if (!session || session.sessionId !== sessionId || !samePointer(session.pointer, pointer)) return;
        this.startRangeSweep(session);
    }

    private startRangeSweep(session: PressSession): void {
        if (session.rangeActive) return;
        this.clearPressTimer();
        session.rangeActive = true;
        session.selectedDragReady = false;
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
    anchorBlock: BlockInfo;
    selection: BlockSelection;
    ready: boolean;
    // True while this press is actively drawing/toggling a range.
    rangeActive: boolean;
    selectedDragCandidate: boolean;
    selectedDragReady: boolean;
    selectedBlocksAtPress: SelectedBlockRange[];
    timer: TimerToken | null;
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
