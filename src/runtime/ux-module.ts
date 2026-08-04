import type { BlockSelection } from '../domain/selection/block-selection';
import type { DocEdit } from '../domain/transaction/block-transaction';
import type { Point, Pointer } from './dragger-runtime-types';

// Generic DefaultUx module contract only.
// Runtime never names concrete capabilities (scroll, fold, …). Hosts register
// whatever modules they build or import from md-dragger/runtime/modules.

export type DragUxContext = {
    selection: BlockSelection;
    point: Point;
    pointer: Pointer;
};

export type CommitResult = { kind: 'applied'; edits: DocEdit[] } | { kind: 'rejected' };

export type DefaultUxModule = {
    name: string;
    onDragStart?(ctx: DragUxContext): void;
    onDragMove?(ctx: DragUxContext): void;
    onDragEnd?(ctx: DragUxContext, result: CommitResult): void;
    onCancel?(ctx: DragUxContext): void;
    /** Tear down module-owned resources (timers) when the runtime is destroyed. */
    destroy?(): void;
};

export function notifyModules(
    modules: readonly DefaultUxModule[],
    hook: keyof Omit<DefaultUxModule, 'name'>,
    ctx: DragUxContext,
    result?: CommitResult,
): void {
    for (const module of modules) {
        if (hook === 'onDragEnd') {
            module.onDragEnd?.(ctx, result!);
            continue;
        }
        if (hook === 'onDragStart') module.onDragStart?.(ctx);
        else if (hook === 'onDragMove') module.onDragMove?.(ctx);
        else if (hook === 'onCancel') module.onCancel?.(ctx);
    }
}
