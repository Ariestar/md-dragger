import type { GuardId } from './pipeline-event';
import type { PipelineState } from './pipeline-state';

export function dependsOnGuard(state: PipelineState, guardId: GuardId): boolean {
    switch (state.type) {
        case 'holding':
        case 'ready_to_drag':
            return state.hold.guardDeps.includes(guardId);
        case 'selecting':
            return state.selection.guardDeps.includes(guardId);
        case 'dragging':
            return state.drag.guardDeps.includes(guardId);
        default:
            return false;
    }
}

export function withGuardDeps(guardDeps?: GuardId[]): GuardId[] {
    return [...new Set(guardDeps ?? [])];
}
