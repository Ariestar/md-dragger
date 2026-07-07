import type { DocLikeWithRange } from '../../domain/markdown/document-types';
import type { BlockSelection } from '../../domain/selection/block-selection';
import type { RangeSelectionOperation } from '../../domain/selection/block-selection';
import type { SelectedBlockRange } from '../../domain/selection/block-ranges';
import type { BlockCommand } from '../../domain/command/block-command';
import type { RangeSelectionBoundary, RangeSelectionBoundaryResolver } from '../../domain/selection/range-selection';
import type { DragDropSnapshot, DropResolution } from './pipeline-drop';
import type { HoldTarget } from './pipeline-state';

export type GuardId = string;

export type DragCancelReason =
    | 'press_cancelled'
    | 'pointer_cancelled'
    | 'session_interrupted'
    | 'selection_invalid'
    | 'guard_unavailable'
    | 'no_target'
    | 'no_anchor'
    | 'table_cell'
    | 'self_range_blocked'
    | 'self_embedding'
    | 'container_policy'
    | 'inside_list'
    | 'inside_quote_run'
    | 'quote_boundary'
    | 'callout_after'
    | 'table_before'
    | 'hr_before'
    | 'cross_document_disabled';

export type SelectionSeed = {
    selection: BlockSelection;
    range?: SelectionRangeSeed;
};

export type SelectionRangeSeed = {
    type: 'range';
    doc: DocLikeWithRange;
    anchorBoundary: RangeSelectionBoundary;
    initialBoundary?: RangeSelectionBoundary;
    selectedBlocks: SelectedBlockRange[];
    operation?: RangeSelectionOperation;
    resolveBoundary?: RangeSelectionBoundaryResolver;
};

export type PipelineEvent<TPreview = unknown> =
    | { type: 'hold_start'; sessionId: string; target: HoldTarget; guardDeps?: GuardId[]; pointerType?: string | null }
    | { type: 'hold_ready'; sessionId: string; pointerType?: string | null }
    | { type: 'selection_start'; seed: SelectionSeed; guardDeps?: GuardId[] }
    | {
        type: 'selection_change';
        boundary: RangeSelectionBoundary;
        docLines?: number;
        resolveBoundary?: RangeSelectionBoundaryResolver;
    }
    | { type: 'selection_finish' }
    | { type: 'selection_clear' }
    | { type: 'drag_start'; sessionId: string; drop: DragDropSnapshot<TPreview>; pointerType?: string | null }
    | { type: 'drag_over'; sessionId: string; drop: DragDropSnapshot<TPreview>; pointerType?: string | null }
    | { type: 'drop'; sessionId: string; resolution: DropResolution<TPreview>; pointerType?: string | null }
    | { type: 'cancel'; sessionId?: string; reason: DragCancelReason; pointerType?: string | null }
    | { type: 'guard_unavailable'; guardId: GuardId }
    | { type: 'destroy' };

export type CommandDropResolution<TPreview = unknown> = {
    type: 'command';
    command: BlockCommand;
    drop: DragDropSnapshot<TPreview>;
};
