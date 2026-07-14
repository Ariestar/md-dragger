import type { BlockSelection } from '../domain/selection/block-selection';
import type { DragDropSnapshot } from './pipeline-drop';
import type { GuardId } from './pipeline-event';

export type PipelineState =
    | { type: 'idle' }
    | { type: 'holding'; hold: HoldContext }
    | { type: 'ready_to_drag'; hold: HoldContext }
    | { type: 'selecting'; selection: SelectionContext }
    | { type: 'dragging'; drag: DragContext };

export type HoldContext = {
    sessionId: string;
    selection: BlockSelection;
    guardDeps: GuardId[];
};

export type SelectionContext = {
    selection: BlockSelection;
    guardDeps: GuardId[];
};

export type DragContext<TPreview = unknown> = {
    sessionId: string;
    selection: BlockSelection;
    drop: DragDropSnapshot<TPreview> | null;
    guardDeps: GuardId[];
};

export const IDLE_PIPELINE_STATE: PipelineState = { type: 'idle' };
