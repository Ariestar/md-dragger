import { detectBlock } from '../domain/block/block-detector';
import type { Block } from '../domain/block/block-types';
import type { Doc } from '../domain/markdown/document-types';
import {
    addBlocks,
    type BlockSelection,
    hasBlock,
    removeBlocks,
    selectBlocks,
    selectOne,
} from '../domain/selection/block-selection';
import type { DragCancelReason } from '../pipeline/pipeline-types';
import type { RuntimeController } from './dragger-runtime';
import {
    type Disposable,
    type GestureConfig,
    type InputSource,
    isPromiseLike,
    type MoveInput,
    type Point,
    type Pointer,
    type PressInput,
    type ReleaseInput,
    samePointer,
    type TimerToken,
    type Ux,
} from './dragger-runtime-types';
import { type DefaultUxModule, type DragUxContext, notifyModules } from './ux-module';

export type UxDeps = {
    input: InputSource;
    runtime: RuntimeController;
    getDoc: () => Doc;
    sourceLineFromInput: (input: PressInput) => number | null;
    lineFromPoint: (point: Point) => number | null;
    tabSize: number;
    gestureConfig: () => GestureConfig;
    selectionFromInput?: (input: PressInput, anchorBlock: Block) => BlockSelection | null;
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
//   hold to multiSelectMs → selecting; pointer move range-selects
//
// while selecting:
//   press unselected → toggle-sweep (XOR base∩range as pointer moves)
//   press selected → long-press (max(dragArmMs, multiSelectMs)) then move = group drag
//   press selected short release → toggle that block off
//   press selected + move before long-press → toggle-sweep instead
export class DefaultUx implements Ux {
    private readonly disposables: Disposable[] = [];
    private pressSession: PressSession | null = null;
    private destroyed = false;
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
            // Escape cancels with a distinct reason so hosts can tell a
            // keyboard cancel from a short-press release (which opens menus).
            // Returns whether a gesture was actually cancelled — the input
            // only claims the keydown when it consumed it.
            this.disposables.push(input.onEscape(() => this.runtime().clearSelectionOrCancel('keyboard_escape')));
        }
    }

    destroy(): void {
        this.destroyed = true;
        this.clearTimers();
        this.pressSession?.releaseCapture?.();
        this.pressSession = null;
        for (const module of this.modules) module.destroy?.();
        for (const dispose of this.disposables) dispose();
        this.disposables.length = 0;
    }

    private runtime(): RuntimeController {
        return this.deps.runtime;
    }

    private cfg(): GestureConfig {
        // gestureConfig() already merged DEFAULT_GESTURE_CONFIG.
        return this.deps.gestureConfig();
    }

    private handlePress(input: PressInput): void {
        if (input.button !== undefined && input.button !== 0) return;
        if (this.runtime().isCommitPending()) return;

        const lineNumber = this.deps.sourceLineFromInput(input);
        if (lineNumber === null) {
            // Press on non-block space ends any pending multi-select, or its
            // highlight would stay painted forever.
            this.runtime().clearSelectionOrCancel();
            return;
        }

        const block = detectBlock(this.deps.getDoc(), lineNumber, { tabSize: this.deps.tabSize });
        if (!block) return;

        // Do not claim (preventDefault) on press — that kills the browser click,
        // which hosts use for handle menus. Capture moves only; claim when drag starts.
        input.capture?.();
        // A new press must terminate an active drag first: the pipeline would
        // otherwise move dragging → holding without emitting a clear output,
        // leaving the published drag source stale forever. cancelPress also
        // notifies modules (auto-scroll) while the drag session is attached.
        if (this.runtime().isGestureActive()) {
            this.cancelPress('session_interrupted', input.pointer.type);
        } else {
            this.clearPress();
        }

        const cfg = this.cfg();
        const sessionId = this.runtime().createSessionId();
        const suppliedSelection = this.deps.selectionFromInput?.(input, block) ?? null;
        const usesSuppliedSelection = suppliedSelection !== null && suppliedSelection.blocks.length > 0;
        const selection = usesSuppliedSelection ? suppliedSelection : selectOne(block);
        const existing = this.currentSelection();
        const inSelecting =
            !usesSuppliedSelection && cfg.multiSelectEnabled && this.runtime().state.type === 'selecting';
        const selectedDragCandidate = inSelecting && existing !== null && hasBlock(existing, block);

        if (inSelecting) {
            // Group-drag arm is independent of desktop dragArmMs=0.
            const groupArmMs = Math.max(cfg.dragArmMs, cfg.multiSelectMs);
            if (selectedDragCandidate) {
                const timer =
                    groupArmMs > 0
                        ? this.deps.scheduler.setTimer(
                              () => this.markSelectedDragReady(sessionId, input.pointer),
                              groupArmMs,
                          )
                        : null;
                this.pressSession = this.makeSession({
                    sessionId,
                    pointer: input.pointer,
                    start: input.point,
                    anchorBlock: block,
                    selection: existing!,
                    baseSelection: existing!,
                    ready: false,
                    selectedDragCandidate: true,
                    selectedDragReady: groupArmMs <= 0,
                    armTimer: timer,
                    multiSelectTimer: null,
                    releaseCapture: input.releaseCapture,
                });
                return;
            }

            // Unselected block while selecting → toggle-sweep from here.
            this.pressSession = this.makeSession({
                sessionId,
                pointer: input.pointer,
                start: input.point,
                anchorBlock: block,
                selection: existing ?? selection,
                baseSelection: existing ?? { blocks: [] },
                ready: false,
                selectedDragCandidate: false,
                selectedDragReady: false,
                armTimer: null,
                multiSelectTimer: null,
                releaseCapture: input.releaseCapture,
            });
            this.startToggleSweep(this.pressSession);
            return;
        }

        this.runtime().beginHold(sessionId, selection, input.pointer.type);

        if (cfg.multiSelectEnabled && !usesSuppliedSelection) {
            const multiMs = Math.max(0, cfg.multiSelectMs);
            const armMs = Math.max(0, cfg.dragArmMs);
            const multiSelectTimer =
                multiMs > 0
                    ? this.deps.scheduler.setTimer(
                          () => this.startRangeSweepIfCurrent(sessionId, input.pointer),
                          multiMs,
                      )
                    : null;
            const armTimer =
                armMs > 0 ? this.deps.scheduler.setTimer(() => this.markReady(sessionId, input.pointer), armMs) : null;
            this.pressSession = this.makeSession({
                sessionId,
                pointer: input.pointer,
                start: input.point,
                anchorBlock: block,
                selection,
                baseSelection: { blocks: [] },
                ready: armMs <= 0,
                selectedDragCandidate: false,
                selectedDragReady: false,
                armTimer,
                multiSelectTimer,
                releaseCapture: input.releaseCapture,
            });
            if (armMs <= 0) this.runtime().markHoldReady(sessionId, input.pointer.type);
            if (multiMs <= 0) this.startRangeSweep(this.pressSession);
            return;
        }

        const armMs = Math.max(0, cfg.dragArmMs);
        const armTimer =
            armMs > 0 ? this.deps.scheduler.setTimer(() => this.markReady(sessionId, input.pointer), armMs) : null;
        this.pressSession = this.makeSession({
            sessionId,
            pointer: input.pointer,
            start: input.point,
            anchorBlock: block,
            selection,
            baseSelection: { blocks: [] },
            ready: armMs <= 0,
            selectedDragCandidate: false,
            selectedDragReady: false,
            armTimer,
            multiSelectTimer: null,
            releaseCapture: input.releaseCapture,
        });
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
            this.startDrag(session, state.selection.selection, input.point, input.pointer);
            return;
        }

        // Moved before group-drag long-press matured → toggle-sweep instead.
        if (session.selectedDragCandidate && !session.toggleSweep && !session.rangeActive) {
            if (distance < cfg.dragStartMoveThresholdPx) return;
            this.startToggleSweep(session);
        }

        if (session.toggleSweep) {
            this.updateToggleSelection(session, input.point);
            return;
        }

        if (session.rangeActive) {
            this.updateRangeSelection(session, input.point);
            return;
        }

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

    private handleRelease(input: ReleaseInput): void {
        const session = this.pressSession;
        if (this.runtime().isGestureActive() && session && samePointer(session.pointer, input.pointer)) {
            const result = this.runtime().commitDrop(session.sessionId, input.point, input.pointer, input.pointer.type);
            if (isPromiseLike(result)) {
                void result.then((resolved) => {
                    if (this.destroyed) return;
                    this.emitModule('onDragEnd', session, input.point, input.pointer, resolved);
                });
            } else {
                this.emitModule('onDragEnd', session, input.point, input.pointer, result ?? { kind: 'rejected' });
            }
            this.pressSession = null;
            return;
        }
        if (!(session && samePointer(session.pointer, input.pointer))) return;

        if (session.rangeActive || session.toggleSweep) {
            this.clearPress();
            return;
        }

        // Short press on an already-selected block → toggle it off.
        if (session.selectedDragCandidate && !session.selectedDragReady) {
            const next = removeBlocks(session.baseSelection, [session.anchorBlock]);
            if (next.blocks.length === 0) this.runtime().clearSelection();
            else this.runtime().setSelection(next);
            this.clearPress();
            return;
        }

        if (session.selectedDragCandidate) {
            // Long-pressed but never moved — keep selection.
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

    private startDrag(session: PressSession, selection: BlockSelection, point: Point, pointer: Pointer): void {
        session.selection = selection;
        session.dragActive = true;
        this.runtime().beginDrag(session.sessionId, selection, point, pointer, pointer.type, session.releaseCapture);
        // Pointer-capture ownership moves to the runtime's active drag session,
        // which releases it in endDragSession. Keep a single owner.
        session.releaseCapture = undefined;
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
        if (session.rangeActive || session.toggleSweep) return;
        this.clearTimers();
        session.rangeActive = true;
        session.selectedDragReady = false;
        session.ready = false;
        // Leave hold without a short-press cancel: host menus listen for press_cancelled only.
        if (this.runtime().state.type === 'holding' || this.runtime().state.type === 'ready_to_drag') {
            this.runtime().cancel('session_interrupted', session.pointer.type);
        }
        this.runtime().setSelection(selectOne(session.anchorBlock));
        session.selection = selectOne(session.anchorBlock);
        session.baseSelection = { blocks: [] };
    }

    private startToggleSweep(session: PressSession): void {
        if (session.toggleSweep || session.rangeActive) return;
        this.clearTimers();
        session.toggleSweep = true;
        session.selectedDragCandidate = false;
        session.selectedDragReady = false;
        session.ready = false;
        this.applyToggleRange(session, session.anchorBlock);
    }

    private updateToggleSelection(session: PressSession, point: Point): void {
        const lineNumber = this.deps.lineFromPoint(point);
        if (lineNumber === null) return;
        const focus = detectBlock(this.deps.getDoc(), lineNumber, { tabSize: this.deps.tabSize });
        if (!focus) return;
        this.applyToggleRange(session, focus);
    }

    private applyToggleRange(session: PressSession, focus: Block): void {
        const range = blocksBetween(this.deps.getDoc(), this.deps.tabSize, session.anchorBlock, focus);
        const next = xorSelection(session.baseSelection, range);
        session.selection = next;
        if (next.blocks.length === 0) this.runtime().clearSelection();
        else this.runtime().setSelection(next);
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

    /** One press-session shape for every branch — only the differing fields
     * are passed; the shared defaults (no range/toggle sweep yet, not an
     * active drag) live here. */
    private makeSession(params: {
        sessionId: string;
        pointer: Pointer;
        start: Point;
        anchorBlock: Block;
        selection: BlockSelection;
        baseSelection: BlockSelection;
        ready: boolean;
        selectedDragCandidate: boolean;
        selectedDragReady: boolean;
        armTimer: TimerToken | null;
        multiSelectTimer: TimerToken | null;
        releaseCapture?: () => void;
    }): PressSession {
        return {
            ...params,
            rangeActive: false,
            toggleSweep: false,
            dragActive: false,
        };
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
    /** Selection at press start; toggle-sweep XORs the pointer range against this. */
    baseSelection: BlockSelection;
    ready: boolean;
    rangeActive: boolean;
    toggleSweep: boolean;
    selectedDragCandidate: boolean;
    selectedDragReady: boolean;
    armTimer: TimerToken | null;
    multiSelectTimer: TimerToken | null;
    releaseCapture?: () => void;
    dragActive: boolean;
};

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

/** Symmetric difference by block line-span identity. */
function xorSelection(base: BlockSelection, range: Block[]): BlockSelection {
    let next = base;
    for (const block of range) {
        next = hasBlock(next, block) ? removeBlocks(next, [block]) : addBlocks(next, [block]);
    }
    return next;
}
