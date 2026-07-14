import { detectBlock } from '../domain/block/block-detector';
import type { Block } from '../domain/block/block-types';
import {
    hasBlock,
    selectBlocks,
    selectOne,
    type BlockSelection,
} from '../domain/selection/block-selection';
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
import {
    notifyModules,
    type DefaultUxModule,
    type DragUxContext,
} from './ux-module';

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
    modules?: readonly DefaultUxModule[];
};

// multiSelect off:
//   press → hold → (dragArmMs) ready → move past threshold → drag
//   short release → press_cancelled
//
// multiSelect on:
//   press → hold
//   short release before multiSelectMs → press_cancelled (host menu)
//   hold to dragArmMs → ready (move past threshold → drag)
//   hold to multiSelectMs → selecting; pointer move range-selects in UX
//   long-press on already-selected block → group drag
//
// Range multi-select (anchor → current block span) lives here, not in domain.
export class DefaultUx implements Ux {
    private readonly disposables: Disposable[] = [];
    private pressSession: PressSession | null = null;
    private readonly modules: readonly DefaultUxModule[];

    constructor(private readonly deps: UxDeps) {
        this.modules = deps.modules ?? [];
    }

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
        const selection = selectOne(block);
        const existing = this.currentSelection();
        const inSelecting = cfg.multiSelectEnabled && this.runtime().state.type === 'selecting';
        const selectedDragCandidate = inSelecting && existing !== null && hasBlock(existing, block);

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
                selection: existing ?? selection,
                ready: false,
                rangeActive: false,
                selectedDragCandidate,
                selectedDragReady: selectedDragCandidate && armMs <= 0,
                armTimer: timer,
                multiSelectTimer: null,
                releaseCapture: input.releaseCapture,
                dragActive: false,
            };
            if (!selectedDragCandidate) this.startRangeSweep(this.pressSession);
            return;
        }

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
                armTimer,
                multiSelectTimer,
                releaseCapture: input.releaseCapture,
                dragActive: false,
            };
            if (armMs <= 0) this.runtime().markHoldReady(sessionId, input.pointer.type);
            if (multiMs <= 0) this.startRangeSweep(this.pressSession);
            return;
        }

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
            armTimer,
            multiSelectTimer: null,
            releaseCapture: input.releaseCapture,
            dragActive: false,
        };
        if (armMs <= 0) this.markReady(sessionId, input.pointer);
    }

    private handleMove(input: MoveInput): void {
        const session = this.pressSession;
        if (!session || !samePointer(session.pointer, input.pointer)) return;

        if (this.runtime().isGestureActive()) {
            this.runtime().moveDrag(session.sessionId, input.point, input.pointer, input.pointer.type);
            this.emitModule('onDragMove', session, input.point, input.pointer);
            return;
        }

        const distance = distanceBetween(session.start, input.point);
        const cfg = this.cfg();

        if (session.selectedDragReady) {
            if (distance < cfg.dragStartMoveThresholdPx) return;
            const state = this.runtime().state;
            if (state.type !== 'selecting' || state.selection.selection.blocks.length === 0) return;
            input.claim?.();
            this.clearTimers();
            this.startDrag(
                session,
                state.selection.selection,
                input.point,
                input.pointer,
            );
            return;
        }

        if (session.selectedDragCandidate && !session.rangeActive) {
            if (distance < cfg.dragStartMoveThresholdPx) return;
            this.startRangeSweep(session);
        }

        if (session.rangeActive) {
            this.updateRangeSelection(session, input.point);
            return;
        }

        if (!session.rangeActive) {
            if (!session.ready) {
                if (distance > cfg.dragCancelMoveThresholdPx) {
                    this.cancelPress('press_cancelled', input.pointer.type);
                }
                return;
            }
            if (distance < cfg.dragStartMoveThresholdPx) return;
            input.claim?.();
            this.clearTimers();
            if (this.runtime().state.type === 'holding') {
                this.runtime().markHoldReady(session.sessionId, input.pointer.type);
            }
            this.startDrag(session, session.selection, input.point, input.pointer);
        }
    }

    private handleRelease(input: ReleaseInput): void {
        const session = this.pressSession;
        if (this.runtime().isGestureActive() && session && samePointer(session.pointer, input.pointer)) {
            const result = this.runtime().commitDrop(
                session.sessionId,
                input.point,
                input.pointer,
                input.pointer.type,
            );
            this.emitModule('onDragEnd', session, input.point, input.pointer, result ?? { kind: 'rejected' });
            this.pressSession = null;
            return;
        }
        if (!(session && samePointer(session.pointer, input.pointer))) return;

        if (session.rangeActive) {
            // Leave selecting state with last setSelection result.
            this.clearPress();
            return;
        }

        if (session.selectedDragCandidate) {
            if (!session.selectedDragReady) {
                this.startRangeSweep(session);
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
            if (session) {
                this.emitModule('onCancel', session, session.start, pointer);
            }
            this.runtime().cancel('pointer_cancelled', pointer.type);
            this.pressSession = null;
        } else if (session && samePointer(session.pointer, pointer)) {
            this.cancelPress('pointer_cancelled', pointer.type);
        }
    }

    private startDrag(
        session: PressSession,
        selection: BlockSelection,
        point: Point,
        pointer: Pointer,
    ): void {
        session.selection = selection;
        session.dragActive = true;
        this.runtime().beginDrag(
            session.sessionId,
            selection,
            point,
            pointer,
            pointer.type,
            session.releaseCapture,
        );
        this.emitModule('onDragStart', session, point, pointer);
    }

    private emitModule(
        hook: 'onDragStart' | 'onDragMove' | 'onDragEnd' | 'onCancel',
        session: PressSession,
        point: Point,
        pointer: Pointer,
        result?: Parameters<typeof notifyModules>[3],
    ): void {
        if (this.modules.length === 0) return;
        const ctx: DragUxContext = {
            selection: session.selection,
            point,
            pointer,
        };
        notifyModules(this.modules, hook, ctx, result);
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
        // Cancel hold if still holding — multi-select is persistent selection, not a hold.
        if (this.runtime().state.type === 'holding' || this.runtime().state.type === 'ready_to_drag') {
            this.runtime().cancel('press_cancelled', session.pointer.type);
        }
        this.runtime().setSelection(selectOne(session.anchorBlock));
        session.selection = selectOne(session.anchorBlock);
    }

    private updateRangeSelection(session: PressSession, point: Point): void {
        const lineNumber = this.deps.lineFromPoint(point);
        if (lineNumber === null) return;
        const doc = this.deps.getDoc();
        const focus = detectBlock(doc, lineNumber, { tabSize: this.deps.tabSize });
        if (!focus) return;
        const blocks = blocksBetween(doc, this.deps.tabSize, session.anchorBlock, focus);
        const selection = selectBlocks(blocks);
        session.selection = selection;
        this.runtime().setSelection(selection);
    }

    private currentSelection(): BlockSelection | null {
        const state = this.runtime().state;
        if (state.type !== 'selecting') return null;
        return state.selection.selection;
    }

    private cancelPress(reason: DragCancelReason, pointerType: string | null): void {
        const session = this.pressSession;
        if (session?.dragActive) {
            this.emitModule('onCancel', session, session.start, session.pointer);
        }
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
    anchorBlock: Block;
    selection: BlockSelection;
    ready: boolean;
    rangeActive: boolean;
    selectedDragCandidate: boolean;
    selectedDragReady: boolean;
    armTimer: TimerToken | null;
    multiSelectTimer: TimerToken | null;
    releaseCapture?: () => void;
    dragActive: boolean;
};

function samePointer(a: Pointer, b: Pointer): boolean {
    return a.id === b.id;
}

function distanceBetween(a: Point, b: Point): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Whole blocks covering [anchor, focus] by document order. */
function blocksBetween(doc: Doc, tabSize: number, anchor: Block, focus: Block): Block[] {
    const start = Math.min(anchor.lines.startLine, focus.lines.startLine);
    const end = Math.max(anchor.lines.endLine, focus.lines.endLine);
    const blocks: Block[] = [];
    let cursor = start;
    while (cursor <= end) {
        const block = detectBlock(doc, cursor, { tabSize });
        if (!block) {
            cursor += 1;
            continue;
        }
        blocks.push(block);
        cursor = block.lines.endLine + 1;
    }
    return blocks;
}
