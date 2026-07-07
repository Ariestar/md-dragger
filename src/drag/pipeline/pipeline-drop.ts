import type { DropTarget } from '../../domain/command/drop-target';
import type { BlockCommand } from '../../domain/command/block-command';
import type { BlockSelection } from '../../domain/selection/block-selection';
import type { DragCancelReason } from './pipeline-event';
import {
    buildCancelledLifecycleEvent,
    buildDragStartedLifecycleEvent,
    buildDragTargetChangedLifecycleEvent,
    buildDropCommitLifecycleEvent,
    type PipelineOutput,
} from './pipeline-output';

export type DragDropSnapshot<TPreview = unknown> = {
    target: DropTarget | null;
    rejectReason?: DragCancelReason | null;
    previewData?: TPreview;
};

export type DropResolution<TPreview = unknown> =
    | { type: 'command'; command: BlockCommand; drop: DragDropSnapshot<TPreview> }
    | { type: 'platform_commit'; drop: DragDropSnapshot<TPreview> }
    | { type: 'cancel'; drop: DragDropSnapshot<TPreview>; reason?: DragCancelReason | null };

export function createRejectedDropSnapshot(rejectReason: DragCancelReason): DragDropSnapshot {
    return {
        target: null,
        rejectReason,
    };
}

export function startDragDrop<TPreview>(params: {
    selection: BlockSelection;
    drop: DragDropSnapshot<TPreview>;
    pointerType: string | null;
}): PipelineOutput<TPreview>[] {
    return [
        { type: 'lifecycle', event: buildDragStartedLifecycleEvent(params.selection, params.pointerType) },
        ...dragOver(params),
    ];
}

export function dragOver<TPreview>(params: {
    selection: BlockSelection;
    drop: DragDropSnapshot<TPreview>;
    pointerType: string | null;
}): PipelineOutput<TPreview>[] {
    return [
        {
            type: 'drag_over',
            selection: params.selection,
            drop: params.drop,
            pointerType: params.pointerType,
        },
        {
            type: 'lifecycle',
            event: buildDragTargetChangedLifecycleEvent({
                source: params.selection,
                targetLine: params.drop.target?.targetLineNumber ?? null,
                listIntent: params.drop.target?.listIntent ?? null,
                rejectReason: params.drop.rejectReason ?? null,
                pointerType: params.pointerType,
            }),
        },
    ];
}

export function drop<TPreview>(params: {
    selection: BlockSelection;
    resolution: DropResolution<TPreview>;
    pointerType: string | null;
}): PipelineOutput<TPreview>[] {
    if (params.resolution.type === 'cancel') {
        return cancelDrop({
            selection: params.selection,
            drop: params.resolution.drop,
            reason: params.resolution.reason ?? params.resolution.drop.rejectReason ?? 'no_target',
            pointerType: params.pointerType,
        });
    }

    const outputs: PipelineOutput<TPreview>[] = [];
    if (params.resolution.type === 'command') {
        outputs.push({ type: 'command_ready', command: params.resolution.command });
    }
    outputs.push(
        {
            type: 'dropped',
            selection: params.selection,
            drop: params.resolution.drop,
            pointerType: params.pointerType,
        },
        {
            type: 'lifecycle',
            event: buildDropCommitLifecycleEvent({
                source: params.selection,
                targetLine: params.resolution.drop.target?.targetLineNumber ?? null,
                listIntent: params.resolution.drop.target?.listIntent ?? null,
                pointerType: params.pointerType,
            }),
        },
    );
    return outputs;
}

export function cancelDrop<TPreview>(params: {
    selection: BlockSelection | null;
    drop?: DragDropSnapshot<TPreview> | null;
    reason: DragCancelReason;
    pointerType: string | null;
}): PipelineOutput<TPreview>[] {
    return [
        {
            type: 'cancelled',
            selection: params.selection,
            reason: params.reason,
            pointerType: params.pointerType,
        },
        {
            type: 'lifecycle',
            event: buildCancelledLifecycleEvent({
                source: params.selection,
                targetLine: params.drop?.target?.targetLineNumber ?? null,
                listIntent: params.drop?.target?.listIntent ?? null,
                rejectReason: params.reason,
                pointerType: params.pointerType,
            }),
        },
    ];
}
