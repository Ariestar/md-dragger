import type { DropPosition } from '../domain/command/drop-position';
import { type MoveResult, planMove } from '../domain/move/move-plan';
import type { BlockSelection } from '../domain/selection/block-selection';
import type { DocEdit } from '../domain/transaction/block-transaction';
import { moveTx } from '../domain/transaction/move-blocks';
import { DragPipeline } from '../pipeline/pipeline-reducer';
import type { DragCancelReason, DragDropSnapshot, DropResolution, PipelineState } from '../pipeline/pipeline-types';
import { DefaultUx } from './default-ux';
import {
    DEFAULT_GESTURE_CONFIG,
    type DefaultUxConfig,
    type Point,
    type Pointer,
    type ResolvedConfig,
    type RuntimeOptions,
    samePointer,
    type Ux,
} from './dragger-runtime-types';
import type { CommitResult } from './ux-module';

type ActiveDragSession = {
    sessionId: string;
    pointer: Pointer;
    selection: BlockSelection;
    position: DropPosition | null;
    releaseCapture?: () => void;
};

/**
 * Protocol for UX layers. Selection is a finished BlockSelection —
 * multi-select construction stays in DefaultUx / host.
 */
export type RuntimeController = {
    readonly state: PipelineState;
    isGestureActive(): boolean;
    createSessionId(): string;
    beginHold(sessionId: string, selection: BlockSelection, pointerType: string | null): void;
    markHoldReady(sessionId: string, pointerType: string | null): void;
    beginDrag(
        sessionId: string,
        selection: BlockSelection,
        point: Point,
        pointer: Pointer,
        pointerType: string | null,
        releaseCapture?: () => void,
    ): void;
    moveDrag(sessionId: string, point: Point, pointer: Pointer, pointerType: string | null): void;
    commitDrop(sessionId: string, point: Point, pointer: Pointer, pointerType: string | null): CommitResult | undefined;
    /** Replace the persistent multi-select result. */
    setSelection(selection: BlockSelection): void;
    clearSelection(): void;
    cancel(reason: DragCancelReason, pointerType: string | null): void;
    /** Cancel/clear the active gesture; returns true when it consumed the
     * trigger (e.g. Escape), false when the pipeline was idle. */
    clearSelectionOrCancel(reason?: DragCancelReason): boolean;
};

export class DraggerRuntime implements RuntimeController {
    private readonly pipeline: DragPipeline;
    private activeDragSession: ActiveDragSession | null = null;
    private mounted = false;
    private nextSessionNumber = 1;
    private ux: Ux | null = null;

    constructor(private readonly options: RuntimeOptions) {
        this.pipeline = new DragPipeline({
            onChange: (result) => this.options.onChange?.(result),
        });
    }

    get state(): PipelineState {
        return this.pipeline.state;
    }

    mount(): void {
        if (this.mounted) return;
        this.mounted = true;
        this.ux = this.buildUx();
        this.ux.mount();
    }

    destroy(): void {
        this.ux?.destroy();
        this.ux = null;
        this.endDragSession();
        this.pipeline.clear();
        this.mounted = false;
    }

    isGestureActive(): boolean {
        // The pipeline state is the single source of truth for "a drag is in
        // progress" — it stays in sync with activeDragSession (both are set and
        // cleared synchronously by beginDrag/endDragSession).
        return this.pipeline.state.type === 'dragging';
    }

    createSessionId(): string {
        const sessionId = `runtime-${this.nextSessionNumber}`;
        this.nextSessionNumber += 1;
        return sessionId;
    }

    beginHold(sessionId: string, selection: BlockSelection, pointerType: string | null): void {
        this.pipeline.enter({ type: 'hold_start', sessionId, selection, pointerType });
    }

    markHoldReady(sessionId: string, pointerType: string | null): void {
        if (this.pipeline.state.type !== 'holding') return;
        if (this.pipeline.state.hold.sessionId !== sessionId) return;
        this.pipeline.enter({ type: 'hold_ready', sessionId, pointerType });
    }

    beginDrag(
        sessionId: string,
        selection: BlockSelection,
        point: Point,
        pointer: Pointer,
        pointerType: string | null,
        releaseCapture?: () => void,
    ): void {
        this.endDragSession();
        const position = this.resolvePosition(point, selection);
        this.activeDragSession = { sessionId, pointer, selection, position, releaseCapture };
        this.pipeline.enter({
            type: 'drag_start',
            sessionId,
            drop: this.buildDropSnapshot(selection, position),
            sourceDoc: this.options.document.getDoc(),
            pointerType,
        });
    }

    moveDrag(sessionId: string, point: Point, pointer: Pointer, pointerType: string | null): void {
        const drag = this.activeDragSession;
        if (!drag || drag.sessionId !== sessionId || !samePointer(drag.pointer, pointer)) return;
        drag.position = this.resolvePosition(point, drag.selection);
        this.pipeline.enter({
            type: 'drag_over',
            sessionId: drag.sessionId,
            drop: this.buildDropSnapshot(drag.selection, drag.position),
            pointerType,
        });
    }

    commitDrop(
        sessionId: string,
        point: Point,
        pointer: Pointer,
        pointerType: string | null,
    ): CommitResult | undefined {
        const drag = this.activeDragSession;
        if (!drag || drag.sessionId !== sessionId || !samePointer(drag.pointer, pointer)) return;

        drag.position = this.resolvePosition(point, drag.selection);
        const dropSnapshot = this.buildDropSnapshot(drag.selection, drag.position);
        const planned = this.plan(drag.selection, drag.position);

        if (planned.type !== 'ok' || !drag.position) {
            this.pipeline.enter({
                type: 'drop',
                sessionId: drag.sessionId,
                resolution: this.cancelDrop(dropSnapshot, planned.type === 'ok' ? 'no_target' : planned.reason),
                pointerType,
            });
            this.endDragSession();
            return { kind: 'rejected' };
        }

        const edits = moveTx({ sourceDoc: this.options.document.getDoc(), plan: planned.value });
        if (!Array.isArray(edits)) {
            this.pipeline.enter({
                type: 'drop',
                sessionId: drag.sessionId,
                resolution: this.cancelDrop(dropSnapshot, edits.reason),
                pointerType,
            });
            this.endDragSession();
            return { kind: 'rejected' };
        }

        this.pipeline.enter({
            type: 'drop',
            sessionId: drag.sessionId,
            resolution: { type: 'platform_commit', drop: dropSnapshot },
            pointerType,
        });
        this.endDragSession();
        this.options.commit.apply?.(edits as DocEdit[]);
        return { kind: 'applied', edits: edits as DocEdit[] };
    }

    setSelection(selection: BlockSelection): void {
        this.pipeline.enter({ type: 'selection_set', selection });
    }

    clearSelection(): void {
        this.pipeline.enter({ type: 'selection_clear' });
    }

    cancel(reason: DragCancelReason = 'press_cancelled', pointerType: string | null = null): void {
        this.endDragSession();
        this.pipeline.enter({ type: 'cancel', reason, pointerType });
    }

    clearSelectionOrCancel(reason: DragCancelReason = 'press_cancelled'): boolean {
        if (!this.isGestureActive() && this.pipeline.state.type === 'selecting') {
            this.clearSelection();
            return true;
        }
        if (this.pipeline.state.type === 'idle') return false;
        this.cancel(reason);
        return true;
    }

    private buildUx(): Ux {
        if (typeof this.options.ux === 'function') return this.options.ux(this);
        const uxConfig = this.options.ux ?? {};
        const scheduler = this.options.scheduler ?? {
            setTimer: (cb, ms) => setTimeout(cb, ms),
            clearTimer: (token) => clearTimeout(token),
        };
        return new DefaultUx({
            input: this.options.input,
            runtime: this,
            getDoc: () => this.options.document.getDoc(),
            sourceLineFromInput: (input) => this.options.locate.sourceLineFromInput(input),
            lineFromPoint: (point) => this.options.locate.lineFromPoint?.(point) ?? null,
            tabSize: this.config().tabSize,
            gestureConfig: () => this.resolveGestureConfig(uxConfig),
            scheduler,
            modules: uxConfig.modules ?? [],
        });
    }

    private resolveGestureConfig(uxConfig: DefaultUxConfig) {
        const raw = typeof uxConfig.gesture === 'function' ? uxConfig.gesture() : uxConfig.gesture;
        return { ...DEFAULT_GESTURE_CONFIG, ...raw };
    }

    private endDragSession(): void {
        this.activeDragSession?.releaseCapture?.();
        this.activeDragSession = null;
    }

    private resolvePosition(point: Point, selection: BlockSelection): DropPosition | null {
        const position = this.options.locate.resolveDropPosition(point, { selection });
        if (!position) return null;
        const doc = position.doc;
        const line = Math.max(1, Math.min(doc.lines + 1, position.line));
        return {
            doc,
            line,
            parent: position.parent,
        };
    }

    private plan(selection: BlockSelection, position: DropPosition | null): MoveResult {
        if (position === null) return { type: 'reject', reason: 'no_target' };
        const { tabSize, listIndentUnit } = this.config();
        return planMove({
            sourceDoc: this.options.document.getDoc(),
            selection,
            position,
            tabSize,
            indentUnit: listIndentUnit,
        });
    }

    private buildDropSnapshot(selection: BlockSelection, position: DropPosition | null): DragDropSnapshot {
        return {
            position,
            rejectReason: position === null ? 'no_target' : this.dropRejectReason(selection, position),
        };
    }

    private dropRejectReason(selection: BlockSelection, position: DropPosition): DragCancelReason | null {
        const planned = this.plan(selection, position);
        if (planned.type === 'ok') return null;
        return isDragCancelReason(planned.reason) ? planned.reason : 'selection_invalid';
    }

    private cancelDrop(drop: DragDropSnapshot, reason: string): DropResolution {
        return {
            type: 'cancel',
            drop,
            reason: isDragCancelReason(reason) ? reason : 'selection_invalid',
        };
    }

    private config(): ResolvedConfig {
        const raw = typeof this.options.config === 'function' ? this.options.config() : this.options.config;
        if (!raw) {
            throw new Error('DraggerRuntime: config is required (tabSize, listIndentUnit)');
        }
        if (!(raw.tabSize > 0)) {
            throw new Error(`DraggerRuntime: config.tabSize must be positive, got ${String(raw.tabSize)}`);
        }
        if (!(raw.listIndentUnit > 0)) {
            throw new Error(
                `DraggerRuntime: config.listIndentUnit must be positive, got ${String(raw.listIndentUnit)}`,
            );
        }
        return raw;
    }
}

function isDragCancelReason(reason: string): reason is DragCancelReason {
    return reason !== 'empty_selection';
}
