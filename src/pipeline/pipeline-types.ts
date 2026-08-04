import type { DropPosition } from '../domain/command/drop-position';
import type { Doc } from '../domain/markdown/document-types';
import type { BlockSelection } from '../domain/selection/block-selection';

export type DragCancelReason =
    | 'press_cancelled'
    | 'pointer_cancelled'
    | 'session_interrupted'
    | 'selection_invalid'
    | 'keyboard_escape'
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

export type DragDropSnapshot = {
    position: DropPosition | null;
    rejectReason?: DragCancelReason | null;
};

export type DropResolution =
    | { type: 'platform_commit'; drop: DragDropSnapshot }
    | { type: 'cancel'; drop: DragDropSnapshot; reason?: DragCancelReason | null };

export type PipelineEvent =
    | { type: 'hold_start'; sessionId: string; selection: BlockSelection; pointerType?: string | null }
    | { type: 'hold_ready'; sessionId: string; pointerType?: string | null }
    | { type: 'selection_set'; selection: BlockSelection }
    | { type: 'selection_clear' }
    | { type: 'drag_start'; sessionId: string; drop: DragDropSnapshot; sourceDoc: Doc; pointerType?: string | null }
    | { type: 'drag_over'; sessionId: string; drop: DragDropSnapshot; pointerType?: string | null }
    | { type: 'drop'; sessionId: string; resolution: DropResolution; pointerType?: string | null }
    | { type: 'cancel'; sessionId?: string; reason: DragCancelReason; pointerType?: string | null }
    | { type: 'destroy' };

export type HoldContext = {
    sessionId: string;
    selection: BlockSelection;
};

export type SelectionContext = {
    selection: BlockSelection;
};

export type DragContext = {
    sessionId: string;
    selection: BlockSelection;
    drop: DragDropSnapshot | null;
    /** Doc that owns the drag — painters filter by this identity so a
     * cross-pane broadcast never paints the source highlight elsewhere. */
    sourceDoc: Doc;
};

export type PipelineState =
    | { type: 'idle' }
    | { type: 'holding'; hold: HoldContext }
    | { type: 'ready_to_drag'; hold: HoldContext }
    | { type: 'selecting'; selection: SelectionContext }
    | { type: 'dragging'; drag: DragContext };

export const IDLE_PIPELINE_STATE: PipelineState = { type: 'idle' };

// The pipeline's single output stream. Every state transition produces a list
// of these items; the runtime broadcasts them via `onChange`, and consumers
// (the platform adapter, the plugin) filter by `type` for what they need.
// There is no separate "lifecycle" projection — drag phase is read directly
// off these items (drag_source_changed = start, drag_over = move, dropped /
// cancelled / terminal = end).
export type PipelineOutput =
    | { type: 'state_changed'; state: PipelineState }
    | { type: 'selection_changed'; selection: BlockSelection | null }
    | { type: 'drag_source_changed'; selection: BlockSelection | null; sourceDoc: Doc | null }
    | {
          type: 'drag_over';
          selection: BlockSelection;
          drop: DragDropSnapshot;
          sourceDoc: Doc;
          pointerType: string | null;
      }
    | { type: 'dropped'; selection: BlockSelection; drop: DragDropSnapshot; pointerType: string | null }
    | { type: 'cancelled'; selection: BlockSelection | null; reason: DragCancelReason; pointerType: string | null }
    | { type: 'terminal'; reason: 'drop' | 'cancel' | 'destroy' };
