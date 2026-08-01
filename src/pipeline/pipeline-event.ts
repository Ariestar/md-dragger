import type { BlockSelection } from '../domain/selection/block-selection';
import type { DragDropSnapshot, DropResolution } from './pipeline-drop';

export type GuardId = string;

export type DragCancelReason =
    | 'press_cancelled'
    | 'pointer_cancelled'
    | 'session_interrupted'
    | 'selection_invalid'
    | 'guard_unavailable'
    | 'no_target'
    | 'table_cell'
    | 'self_range_blocked'
    | 'self_embedding'
    | 'container_policy'
    | 'inside_list'
    | 'inside_quote_run'
    | 'quote_boundary'
    | 'callout_after'
    | 'table_before'
    | 'hr_before';

/**
 * Pipeline stores selection results only.
 * Multi-select construction (range drag, modifiers, …) lives in UX.
 */
export type PipelineEvent<TPreview = unknown> =
    | {
          type: 'hold_start';
          sessionId: string;
          selection: BlockSelection;
          guardDeps?: GuardId[];
          pointerType?: string | null;
      }
    | { type: 'hold_ready'; sessionId: string; pointerType?: string | null }
    | { type: 'selection_set'; selection: BlockSelection; guardDeps?: GuardId[] }
    | { type: 'selection_clear' }
    | { type: 'drag_start'; sessionId: string; drop: DragDropSnapshot<TPreview>; pointerType?: string | null }
    | { type: 'drag_over'; sessionId: string; drop: DragDropSnapshot<TPreview>; pointerType?: string | null }
    | { type: 'drop'; sessionId: string; resolution: DropResolution<TPreview>; pointerType?: string | null }
    | { type: 'cancel'; sessionId?: string; reason: DragCancelReason; pointerType?: string | null }
    | { type: 'guard_unavailable'; guardId: GuardId }
    | { type: 'destroy' };
