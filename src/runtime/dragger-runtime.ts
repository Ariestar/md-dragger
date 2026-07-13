import { detectBlock } from '../domain/block/block-detector';
import type { BlockInfo } from '../domain/block/block-types';
import type { DropTarget } from '../domain/command/drop-target';
import { createMoveCommand } from '../domain/command/move-command';
import { createSingleBlockSelection, type BlockSelection } from '../domain/selection/block-selection';
import type { SelectedBlockRange } from '../domain/selection/block-ranges';
import { buildSelectedBlockRangeFromBlockInfo, type RangeSelectionBoundary, type RangeSelectionBoundaryResolver } from '../domain/selection/range-selection';
import { createLineParsingContext } from '../domain/markdown/line-parsing-service';
import { getListContext } from '../domain/mutation/list-mutation';
import { buildInsertTextForDrop } from '../domain/mutation/text-mutation-policy';
import { resolveDropRuleAtInsertion } from '../domain/rules/container-policy-service';
import { planMove, type MoveDeps, type MoveResult } from '../domain/move/move-plan';
import { moveTx } from '../domain/transaction/move-blocks';
import { DragPipeline } from '../pipeline/drag-pipeline';
import type { DragDropSnapshot, DropResolution } from '../pipeline/pipeline-drop';
import type { DragCancelReason } from '../pipeline/pipeline-event';
import type { PipelineState } from '../pipeline/pipeline-state';
import type { DocEdit } from '../domain/transaction/block-transaction';
import {
    type Point,
    type Pointer,
    type ResolvedConfig,
    type DefaultUxConfig,
    type RuntimeOptions,
    type Ux,
    DEFAULT_GESTURE_CONFIG,
} from './dragger-runtime-types';
import { DefaultUx } from './default-ux';
import type { CommitResult } from './ux-module';

const DEFAULT_CONFIG: ResolvedConfig = {
    tabSize: 4,
};

type ActiveDragSession = {
    sessionId: string;
    pointer: Pointer;
    selection: BlockSelection;
    target: DropTarget | null;
    releaseCapture?: () => void;
};

// Semantic command surface a gesture stage drives. No raw pointers, timers, or
// pixel thresholds — those live in the Ux. Runtime owns pipeline ordering,
// drop planning, and commit routing.
export type RuntimeController = {
    readonly state: PipelineState;
    isGestureActive(): boolean;
    createSessionId(): string;
    beginHold(sessionId: string, selection: BlockSelection, pointerType: string | null): void;
    markHoldReady(sessionId: string, pointerType: string | null): void;
    beginDrag(sessionId: string, selection: BlockSelection, point: Point, pointer: Pointer, pointerType: string | null, releaseCapture?: () => void): void;
    moveDrag(sessionId: string, point: Point, pointer: Pointer, pointerType: string | null): void;
    // Returns how the drop finished so DefaultUx modules (e.g. fold-restore)
    // can run after apply without Runtime knowing about those modules.
    commitDrop(sessionId: string, point: Point, pointer: Pointer, pointerType: string | null): CommitResult | void;
    startRangeSelection(block: BlockInfo, selectedBlocks?: SelectedBlockRange[]): void;
    extendSelection(lineNumber: number): void;
    finishSelection(): void;
    enterRangeSelectionMode(anchorLine: number): void;
    cancel(reason: DragCancelReason, pointerType: string | null): void;
    clearSelectionOrCancel(): void;
    guardUnavailable(guardId: string): void;
    handleMobileDragAvailabilityChanged(mobileDragAvailable: boolean): void;
};

export class DraggerRuntime implements RuntimeController {
    private readonly pipeline: DragPipeline;
    private activeDragSession: ActiveDragSession | null = null;
    private mounted = false;
    private nextSessionNumber = 1;
    private ux: Ux | null = null;

    constructor(private readonly options: RuntimeOptions) {
        // Wire pipeline output straight to the host — no second event system.
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

    guardUnavailable(guardId: string): void {
        this.pipeline.enter({ type: 'guard_unavailable', guardId });
    }

    handleMobileDragAvailabilityChanged(mobileDragAvailable: boolean): void {
        if (!mobileDragAvailable) this.clearSelectionOrCancel();
    }

    isGestureActive(): boolean {
        return this.activeDragSession !== null;
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
        const target = this.resolveTarget(point, selection);
        this.activeDragSession = { sessionId, pointer, selection, target, releaseCapture };
        this.pipeline.enter({
            type: 'drag_start',
            sessionId,
            drop: this.buildDropSnapshot(selection, target),
            pointerType,
        });
    }

    moveDrag(sessionId: string, point: Point, pointer: Pointer, pointerType: string | null): void {
        const drag = this.activeDragSession;
        if (!drag || drag.sessionId !== sessionId || !samePointer(drag.pointer, pointer)) return;
        drag.target = this.resolveTarget(point, drag.selection);
        this.pipeline.enter({
            type: 'drag_over',
            sessionId: drag.sessionId,
            drop: this.buildDropSnapshot(drag.selection, drag.target),
            pointerType,
        });
    }

    commitDrop(sessionId: string, point: Point, pointer: Pointer, pointerType: string | null): CommitResult | void {
        const drag = this.activeDragSession;
        if (!drag || drag.sessionId !== sessionId || !samePointer(drag.pointer, pointer)) return;

        drag.target = this.resolveTarget(point, drag.selection);
        const dropSnapshot = this.buildDropSnapshot(drag.selection, drag.target);
        const planned = this.plan(drag.selection, drag.target);

        if (planned.type !== 'ok' || !drag.target) {
            this.pipeline.enter({
                type: 'drop',
                sessionId: drag.sessionId,
                resolution: this.cancelDrop(dropSnapshot, planned.type === 'ok' ? 'no_target' : planned.reason),
                pointerType,
            });
            this.endDragSession();
            return { kind: 'rejected' };
        }

        if (this.commitMode() === 'command') {
            this.pipeline.enter({
                type: 'drop',
                sessionId: drag.sessionId,
                resolution: {
                    type: 'command',
                    command: createMoveCommand(drag.selection, drag.target),
                    drop: dropSnapshot,
                },
                pointerType,
            });
            this.endDragSession();
            return { kind: 'command' };
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

    startRangeSelection(block: BlockInfo, selectedBlocks: SelectedBlockRange[] = []): void {
        const doc = this.options.document.getDoc();
        const anchorBoundary = boundaryFromBlock(block);
        this.pipeline.enter({
            type: 'selection_start',
            seed: {
                selection: createSingleBlockSelection(block),
                range: {
                    type: 'range',
                    doc,
                    anchorBoundary,
                    initialBoundary: anchorBoundary,
                    selectedBlocks,
                    resolveBoundary: this.createBoundaryResolver(),
                },
            },
        });
    }

    extendSelection(lineNumber: number): void {
        if (this.pipeline.state.type !== 'selecting') return;
        const doc = this.options.document.getDoc();
        this.pipeline.enter({
            type: 'selection_change',
            boundary: this.boundaryAtLine(lineNumber),
            docLines: doc.lines,
            resolveBoundary: this.createBoundaryResolver(),
        });
    }

    enterRangeSelectionMode(anchorLine: number): void {
        if (this.isGestureActive()) return;
        const doc = this.options.document.getDoc();
        const block = detectBlock(doc, anchorLine, { tabSize: this.config().tabSize });
        if (!block) return;
        this.startRangeSelection(block);
    }

    finishSelection(): void {
        if (this.pipeline.state.type !== 'selecting') return;
        if (this.currentSelection()?.ranges.length === 0) {
            this.pipeline.enter({ type: 'selection_clear' });
        }
    }

    cancel(reason: DragCancelReason = 'press_cancelled', pointerType: string | null = null): void {
        const sessionId = this.activeDragSession?.sessionId;
        this.endDragSession();
        this.pipeline.enter({ type: 'cancel', sessionId, reason, pointerType });
    }

    clearSelectionOrCancel(): void {
        if (!this.isGestureActive() && this.pipeline.state.type === 'selecting') {
            this.pipeline.enter({ type: 'selection_clear' });
            return;
        }
        this.cancel();
    }

    // --- internals ---

    private buildUx(): Ux {
        // Function = full Ux replacement. Object / omit = DefaultUx + its config.
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
        const raw = typeof uxConfig.gesture === 'function'
            ? uxConfig.gesture()
            : uxConfig.gesture;
        return { ...DEFAULT_GESTURE_CONFIG, ...raw };
    }

    private commitMode(): 'apply' | 'command' {
        return this.options.commit.mode === 'command' ? 'command' : 'apply';
    }

    // Every terminal drag path (success, reject, cancel, destroy, re-begin) must
    // release pointer capture. Capture is stored on the session at beginDrag.
    private endDragSession(): void {
        this.activeDragSession?.releaseCapture?.();
        this.activeDragSession = null;
    }

    private resolveTarget(point: Point, selection: BlockSelection): DropTarget | null {
        const target = this.options.locate.resolveDropTarget(point, { selection });
        if (!target) return null;
        return {
            ...target,
            targetLineNumber: Math.max(1, Math.min(target.targetDoc.lines + 1, target.targetLineNumber)),
        };
    }

    private plan(selection: BlockSelection, target: DropTarget | null): MoveResult {
        if (target === null) return { type: 'reject', reason: 'no_target' };
        const tabSize = this.config().tabSize;
        const lineParsing = createLineParsingContext(tabSize);
        return planMove({
            sourceDoc: this.options.document.getDoc(),
            selection,
            target,
            deps: this.moveDeps(target.targetDoc, lineParsing),
        });
    }

    private moveDeps(
        doc: ReturnType<RuntimeOptions['document']['getDoc']>,
        lineParsing: ReturnType<typeof createLineParsingContext>,
    ): MoveDeps {
        return {
            tabSize: this.config().tabSize,
            slotAt: (targetDoc, sourceBlock, lineNumber, options) =>
                resolveDropRuleAtInsertion(targetDoc, sourceBlock, lineNumber, options),
            parseLine: lineParsing.parseLine,
            listCtx: (activeDoc, lineNumber) => getListContext(activeDoc, lineNumber, lineParsing.parseLine),
            indentUnit: (sample) => lineParsing.getIndentUnitWidth(sample),
            insertText: (activeDoc, sourceBlock, lineNumber, sourceContent, listIntent) =>
                buildInsertTextForDrop({
                    lineParsing,
                    doc: activeDoc,
                    sourceBlock,
                    targetLineNumber: lineNumber,
                    sourceContent,
                    listIntent,
                }),
        };
    }

    private buildDropSnapshot(selection: BlockSelection, target: DropTarget | null): DragDropSnapshot {
        return {
            target,
            rejectReason: target === null ? 'no_target' : this.dropRejectReason(selection, target),
        };
    }

    private dropRejectReason(selection: BlockSelection, target: DropTarget): DragCancelReason | null {
        const planned = this.plan(selection, target);
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

    private currentSelection(): BlockSelection | null {
        const state = this.pipeline.state;
        if (state.type !== 'selecting') return null;
        return state.selection.selection;
    }

    private boundaryAtLine(lineNumber: number): RangeSelectionBoundary {
        const doc = this.options.document.getDoc();
        const block = detectBlock(doc, lineNumber, { tabSize: this.config().tabSize });
        if (block) return boundaryFromBlock(block);
        return {
            startLineNumber: lineNumber,
            endLineNumber: lineNumber,
            representativeLineNumber: lineNumber,
        };
    }

    private createBoundaryResolver(): RangeSelectionBoundaryResolver {
        return (lineNumber) => {
            const doc = this.options.document.getDoc();
            const block = detectBlock(doc, lineNumber, { tabSize: this.config().tabSize });
            return block ? boundaryFromBlock(block) : {
                startLineNumber: lineNumber,
                endLineNumber: lineNumber,
            };
        };
    }

    private config(): ResolvedConfig {
        const config = typeof this.options.config === 'function'
            ? this.options.config()
            : this.options.config;
        return { ...DEFAULT_CONFIG, ...config };
    }
}

function samePointer(a: Pointer, b: Pointer): boolean {
    return a.id === b.id;
}

function boundaryFromBlock(block: BlockInfo): ReturnType<typeof buildSelectedBlockRangeFromBlockInfo> & {
    representativeLineNumber: number;
} {
    const range = buildSelectedBlockRangeFromBlockInfo(block);
    return { ...range, representativeLineNumber: range.startLineNumber };
}

function isDragCancelReason(reason: string): reason is DragCancelReason {
    return reason !== 'empty_selection';
}
