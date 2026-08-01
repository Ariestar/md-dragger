import type { BlockCommand } from '../domain/command/block-command';
import type { BlockSelection } from '../domain/selection/block-selection';
import type { DragDropSnapshot } from './pipeline-drop';
import type { DragCancelReason } from './pipeline-event';
import type { PipelineState } from './pipeline-state';

// The pipeline's single output stream. Every state transition produces a list
// of these items; the runtime broadcasts them via `onChange`, and consumers
// (the platform adapter, the plugin) filter by `type` for what they need.
// There is no separate "lifecycle" projection — drag phase is read directly
// off these items (drag_source_changed = start, drag_over = move, dropped /
// cancelled / terminal = end).
export type PipelineOutput<TPreview = unknown> =
    | { type: 'state_changed'; state: PipelineState }
    | { type: 'selection_changed'; selection: BlockSelection | null }
    | { type: 'drag_source_changed'; selection: BlockSelection | null }
    | { type: 'drag_over'; selection: BlockSelection; drop: DragDropSnapshot<TPreview>; pointerType: string | null }
    | { type: 'dropped'; selection: BlockSelection; drop: DragDropSnapshot<TPreview>; pointerType: string | null }
    | { type: 'cancelled'; selection: BlockSelection | null; reason: DragCancelReason; pointerType: string | null }
    | { type: 'command_ready'; command: BlockCommand }
    | { type: 'terminal'; reason: 'drop' | 'cancel' | 'destroy' | 'guard_unavailable' };
