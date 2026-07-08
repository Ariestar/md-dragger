import { detectBlock } from '../domain/block/block-detector';
import type { BlockInfo } from '../domain/block/block-types';
import type { DropTarget } from '../domain/command/drop-target';
import { createSingleBlockSelection, type BlockSelection } from '../domain/selection/block-selection';
import type { SelectedBlockRange } from '../domain/selection/block-ranges';
import {
    buildSelectedBlockRangeFromBlockInfo,
    type RangeSelectionBoundary,
    type RangeSelectionBoundaryResolver,
} from '../domain/selection/range-selection';
import { createLineParsingContext } from '../domain/markdown/line-parsing-service';
import { getListContext } from '../domain/mutation/list-mutation';
import { buildInsertTextForDrop } from '../domain/mutation/text-mutation-policy';
import { resolveDropRuleAtInsertion } from '../domain/rules/container-policy-service';
import { planMove, type MoveDeps, type MoveResult } from '../domain/move/move-plan';
import { moveTx } from '../domain/transaction/move-blocks';
import { DragPipeline } from '../pipeline/drag-pipeline';
import type { DragDropSnapshot, DropResolution } from '../pipeline/pipeline-drop';
import type { DragCancelReason } from '../pipeline/pipeline-event';
import type { PipelineOutput } from '../pipeline/pipeline-output';
import type { PipelineState } from '../pipeline/pipeline-state';
import { defaultRuntimeUx } from './default-ux';
import {
    type Point,
    type Pointer,
    type TimerToken,
    type ResolvedConfig,
    type RuntimeController,
    type RuntimeOptions,
    type MoveInput,
    type PressInput,
    type ReleaseInput,
    type SelectionChangeInput,
    type RuntimeUx,
} from './dragger-runtime-types';

const DEFAULT_CONFIG: ResolvedConfig = {
    tabSize: 4,
    longPressMs: 250,
    dragStartMoveThresholdPx: 4,
    dragCancelMoveThresholdPx: 12,
};

type PressSession = {
    sessionId: string;
    pointer: Pointer;
    start: Point;
    selection: BlockSelection;
    ready: boolean;
    timer: TimerToken | null;
    releaseCapture?: () => void;
};

type ActiveDragSession = {
    sessionId: string;
    pointer: Pointer;
    selection: BlockSelection;
    target: DropTarget | null;
    releaseCapture?: () => void;
};

export class DraggerRuntime implements RuntimeController {
    private uxDisposable: (() => void) | null = null;
    private readonly pipeline: DragPipeline = new DragPipeline({
        onChange: (output) => this.handleChange(output),
    });
    private pressSession: PressSession | null = null;
    private activeDragSession: ActiveDragSession | null = null;
    private mounted = false;
    private nextSessionNumber = 1;

    constructor(private readonly options: RuntimeOptions) {}

    get state(): PipelineState {
        return this.pipeline.state;
    }

    get input() {
        return this.options.input;
    }

    mount(): void {
        if (this.mounted) return;
        this.mounted = true;
        const ux = this.resolveUx();
        this.uxDisposable = ux?.mount(this) ?? null;
    }

    destroy(): void {
        this.clearPressSession();
        this.activeDragSession?.releaseCapture?.();
        this.activeDragSession = null;
        this.pipeline.clear();
        this.uxDisposable?.();
        this.uxDisposable = null;
        this.mounted = false;
    }

    guardUnavailable(guardId: string): void {
        this.pipeline.enter({ type: 'guard_unavailable', guardId });
    }

    handleMobileDragAvailabilityChanged(mobileDragAvailable: boolean): void {
        if (!mobileDragAvailable) this.clearSelectionOrCancel();
    }

    isGestureActive(): boolean {
        return this.pressSession !== null || this.activeDragSession !== null;
    }

    handlePress(input: PressInput): void {
        if (input.button !== undefined && input.button !== 0) return;

        const doc = this.options.document.getDoc();
        const lineNumber = this.options.locate.sourceLineFromInput(input);
        if (lineNumber === null) return;

        const block = detectBlock({ doc }, lineNumber, { tabSize: this.config().tabSize });
        if (!block) return;

        input.claim?.();
        if (isSelectionGesture(input)) {
            this.selectBlock(block, input);
            return;
        }

        input.capture?.();
        this.clearPressSession();
        const sessionId = this.createSessionId();
        const selection = this.resolveDragSelection(block);
        const timer = this.config().longPressMs > 0
            ? this.setTimer(() => this.markPressReady(sessionId, input.pointer), this.config().longPressMs)
            : null;
        this.pressSession = {
            sessionId,
            pointer: input.pointer,
            start: input.point,
            selection,
            ready: this.config().longPressMs <= 0,
            timer,
            releaseCapture: input.releaseCapture,
        };
        this.pipeline.enter({
            type: 'hold_start',
            sessionId,
            target: { selection },
            pointerType: input.pointer.type,
        });
        if (this.config().longPressMs <= 0) this.markPressReady(sessionId, input.pointer);
    }

    handleMove(input: MoveInput): void {
        if (this.activeDragSession) {
            this.handleDragMove(input);
            return;
        }

        const session = this.pressSession;
        if (!session || !samePointer(session.pointer, input.pointer)) return;

        const distance = distanceBetween(session.start, input.point);
        if (!session.ready) {
            if (distance > this.config().dragCancelMoveThresholdPx) this.cancel();
            return;
        }
        if (distance < this.config().dragStartMoveThresholdPx) return;

        input.claim?.();
        this.activeDragSession = {
            sessionId: session.sessionId,
            pointer: input.pointer,
            selection: session.selection,
            target: this.resolveTarget(input.point, session.selection),
            releaseCapture: session.releaseCapture,
        };
        this.clearPressTimer(session);
        this.pressSession = null;
        this.pipeline.enter({
            type: 'drag_start',
            sessionId: session.sessionId,
            drop: this.buildDropSnapshot(session.selection, this.activeDragSession.target),
            pointerType: input.pointer.type,
        });
    }

    handleDragMove(input: MoveInput): void {
        const drag = this.activeDragSession;
        if (!drag || !samePointer(drag.pointer, input.pointer)) return;
        input.claim?.();
        drag.target = this.resolveTarget(input.point, drag.selection);
        this.pipeline.enter({
            type: 'drag_over',
            sessionId: drag.sessionId,
            drop: this.buildDropSnapshot(drag.selection, drag.target),
            pointerType: input.pointer.type,
        });
    }

    handleRelease(input: ReleaseInput): void {
        if (this.activeDragSession && samePointer(this.activeDragSession.pointer, input.pointer)) {
            input.claim?.();
            this.drop(input);
            input.releaseCapture?.();
            return;
        }
        if (this.pressSession && samePointer(this.pressSession.pointer, input.pointer)) {
            this.cancel('press_cancelled', input.pointer.type);
        }
    }

    handleCancel(pointer: Pointer, releaseCapture?: () => void): void {
        if (this.activeDragSession && samePointer(this.activeDragSession.pointer, pointer)) {
            releaseCapture?.();
            this.cancel('pointer_cancelled', pointer.type);
            return;
        }
        if (this.pressSession && samePointer(this.pressSession.pointer, pointer)) {
            releaseCapture?.();
            this.cancel('pointer_cancelled', pointer.type);
        }
    }

    handleSelectionChange(input: SelectionChangeInput): void {
        if (this.pipeline.state.type !== 'selecting') return;
        const lineNumber = this.selectionLineFromInput(input);
        if (lineNumber === null) return;
        input.claim?.();
        const doc = this.options.document.getDoc();
        const resolveBoundary = this.createBoundaryResolver();
        this.pipeline.enter({
            type: 'selection_change',
            boundary: this.boundaryAtLine(lineNumber),
            docLines: doc.lines,
            resolveBoundary,
        });
    }

    finishSelection(): void {
        if (this.pipeline.state.type !== 'selecting') return;
        this.pipeline.enter({ type: 'selection_finish' });
        if (this.currentPassiveSelection()?.ranges.length === 0) {
            this.pipeline.enter({ type: 'selection_clear' });
        }
    }

    private drop(input: ReleaseInput): void {
        const drag = this.activeDragSession;
        if (!drag) return;
        drag.target = this.resolveTarget(input.point, drag.selection);
        const dropSnapshot = this.buildDropSnapshot(drag.selection, drag.target);
        const planned = this.plan(drag.selection, drag.target);
        if (planned.type === 'ok' && drag.target) {
            const transaction = moveTx(this.options.document.getDoc(), planned.value);
            if ('changes' in transaction) {
                this.pipeline.enter({
                    type: 'drop',
                    sessionId: drag.sessionId,
                    resolution: { type: 'platform_commit', drop: dropSnapshot },
                    pointerType: input.pointer.type,
                });
                const target = drag.target;
                const selection = drag.selection;
                this.activeDragSession = null;
                this.options.commit.apply(
                    {
                        changes: transaction.changes,
                        effects: transaction.effects,
                        selectionAfter: transaction.selectionAfter,
                    },
                    { selection, target }
                );
                return;
            }
            this.pipeline.enter({
                type: 'drop',
                sessionId: drag.sessionId,
                resolution: this.cancelDrop(dropSnapshot, transaction.reason),
                pointerType: input.pointer.type,
            });
            this.activeDragSession = null;
            return;
        }
        this.pipeline.enter({
            type: 'drop',
            sessionId: drag.sessionId,
            resolution: this.cancelDrop(dropSnapshot, planned.type === 'ok' ? 'no_target' : planned.reason),
            pointerType: input.pointer.type,
        });
        this.activeDragSession = null;
    }

    cancel(reason: DragCancelReason = 'press_cancelled', pointerType: string | null = null): void {
        const sessionId = this.activeDragSession?.sessionId ?? this.pressSession?.sessionId;
        this.clearPressSession();
        this.activeDragSession?.releaseCapture?.();
        this.activeDragSession = null;
        this.pipeline.enter({ type: 'cancel', sessionId, reason, pointerType });
    }

    clearSelectionOrCancel(): void {
        if (!this.isGestureActive() && this.pipeline.state.type === 'selecting') {
            this.pipeline.enter({ type: 'selection_clear' });
            return;
        }
        this.cancel();
    }

    private resolveUx(): RuntimeUx | null {
        const ux = this.options.ux ?? 'default';
        if (ux === 'none') return null;
        if (ux === 'default') return defaultRuntimeUx();
        return typeof ux === 'function' ? ux() : ux;
    }

    private resolveTarget(point: Point, selection: BlockSelection): DropTarget | null {
        const target = this.options.locate.resolveDropTarget(point, { selection });
        if (target) return this.clampTarget(target);
        return null;
    }

    private clampTarget(target: DropTarget): DropTarget {
        const doc = this.options.document.getDoc();
        return {
            ...target,
            targetLineNumber: Math.max(1, Math.min(doc.lines + 1, target.targetLineNumber)),
        };
    }

    private plan(selection: BlockSelection, target: DropTarget | null): MoveResult {
        if (target === null) return { type: 'reject', reason: 'no_target' };
        const doc = this.options.document.getDoc();
        const tabSize = this.config().tabSize;
        const lineParsing = createLineParsingContext(tabSize);
        return planMove({
            doc,
            selection,
            target,
            deps: this.moveDeps(doc, lineParsing),
        });
    }

    private moveDeps(
        doc: ReturnType<RuntimeOptions['document']['getDoc']>,
        lineParsing: ReturnType<typeof createLineParsingContext>
    ): MoveDeps {
        return {
            tabSize: this.config().tabSize,
            slotAt: (sourceBlock, lineNumber, options) =>
                resolveDropRuleAtInsertion({ doc }, sourceBlock, lineNumber, options),
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
            rejectReason: target === null
                ? 'no_target'
                : this.dropRejectReason(selection, target),
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

    private createSessionId(): string {
        const sessionId = `runtime-${this.nextSessionNumber}`;
        this.nextSessionNumber += 1;
        return sessionId;
    }

    private markPressReady(sessionId: string, pointer: Pointer): void {
        const session = this.pressSession;
        if (!session || session.sessionId !== sessionId || !samePointer(session.pointer, pointer)) return;
        session.ready = true;
        this.clearPressTimer(session);
        this.pipeline.enter({
            type: 'hold_ready',
            sessionId,
            pointerType: pointer.type,
        });
    }

    private selectBlock(block: BlockInfo, input: PressInput): void {
        const doc = this.options.document.getDoc();
        const current = this.currentPassiveSelection();
        const selectedBlocks = selectionToSelectedBlocks(current);
        const clickedBoundary = boundaryFromBlock(block);
        const range = {
            type: 'range' as const,
            doc,
            anchorBoundary: input.modifiers?.shiftKey && current
                ? boundaryFromBlock(current.anchorBlock)
                : clickedBoundary,
            initialBoundary: clickedBoundary,
            selectedBlocks,
            operation: input.modifiers?.shiftKey && current ? 'add' as const : undefined,
            resolveBoundary: this.createBoundaryResolver(),
        };

        this.pipeline.enter({
            type: 'selection_start',
            seed: {
                selection: current ?? createSingleBlockSelection(block),
                range,
            },
        });
        this.pipeline.enter({ type: 'selection_finish' });
        if (this.currentPassiveSelection()?.ranges.length === 0) {
            this.pipeline.enter({ type: 'selection_clear' });
        }
    }

    private resolveDragSelection(block: BlockInfo): BlockSelection {
        const current = this.currentPassiveSelection();
        if (isBlockCoveredBySelection(current, block)) {
            return current;
        }
        return createSingleBlockSelection(block);
    }

    private currentPassiveSelection(): BlockSelection | null {
        const state = this.pipeline.state;
        if (state.type !== 'selecting' || state.selection.phase !== 'passive') return null;
        return state.selection.selection;
    }

    private selectionLineFromInput(input: SelectionChangeInput): number | null {
        if (typeof input.lineNumber === 'number') return input.lineNumber;
        return null;
    }

    private boundaryAtLine(lineNumber: number): RangeSelectionBoundary {
        const doc = this.options.document.getDoc();
        const block = detectBlock({ doc }, lineNumber, { tabSize: this.config().tabSize });
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
            const block = detectBlock({ doc }, lineNumber, { tabSize: this.config().tabSize });
            return block ? boundaryFromBlock(block) : {
                startLineNumber: lineNumber,
                endLineNumber: lineNumber,
            };
        };
    }

    private handleChange(output: ReturnType<DragPipeline['enter']>): void {
        this.options.onChange?.(output);
    }

    private clearPressSession(): void {
        if (!this.pressSession) return;
        this.clearPressTimer(this.pressSession);
        this.pressSession.releaseCapture?.();
        this.pressSession = null;
    }

    private clearPressTimer(session: PressSession): void {
        if (session.timer === null) return;
        this.clearTimer(session.timer);
        session.timer = null;
    }

    private setTimer(callback: () => void, delayMs: number): TimerToken {
        if (this.options.scheduler) return this.options.scheduler.setTimer(callback, delayMs);
        // eslint-disable-next-line obsidianmd/prefer-window-timers
        return setTimeout(callback, delayMs);
    }

    private clearTimer(token: TimerToken): void {
        if (this.options.scheduler) {
            this.options.scheduler.clearTimer(token);
            return;
        }
        // eslint-disable-next-line obsidianmd/prefer-window-timers
        clearTimeout(token);
    }

    private config(): ResolvedConfig {
        const config = typeof this.options.config === 'function'
            ? this.options.config()
            : this.options.config;
        return {
            ...DEFAULT_CONFIG,
            ...config,
        };
    }
}

function samePointer(a: Pointer, b: Pointer): boolean {
    return a.id === b.id;
}

function distanceBetween(a: Point, b: Point): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function isSelectionGesture(input: PressInput): boolean {
    return input.modifiers?.shiftKey === true
        || input.modifiers?.ctrlKey === true
        || input.modifiers?.metaKey === true;
}

function selectionToSelectedBlocks(selection: BlockSelection | null): SelectedBlockRange[] {
    if (!selection) return [];
    return selection.ranges.map((range) => ({
        startLineNumber: range.startLine + 1,
        endLineNumber: range.endLine + 1,
    }));
}

function boundaryFromBlock(block: BlockInfo): ReturnType<typeof buildSelectedBlockRangeFromBlockInfo> & {
    representativeLineNumber: number;
} {
    const range = buildSelectedBlockRangeFromBlockInfo(block);
    return {
        ...range,
        representativeLineNumber: range.startLineNumber,
    };
}

function isBlockCoveredBySelection(selection: BlockSelection | null, block: BlockInfo): selection is BlockSelection {
    if (!selection) return false;
    return selection.ranges.some((range) => (
        range.startLine === block.startLine
        && range.endLine === block.endLine
    ));
}

function isDragCancelReason(reason: string): reason is DragCancelReason {
    return reason !== 'empty_selection';
}
