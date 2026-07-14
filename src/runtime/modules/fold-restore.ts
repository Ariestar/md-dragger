import type { BlockSelection } from '../../domain/selection/block-selection';
import type { DefaultUxModule } from '../ux-module';

// Optional module for hosts that restore fold UI after a move.
// Post-apply selection mapping is deferred; restore receives null selectionAfter.

export type FoldPort = {
    capture(selection: BlockSelection): unknown | null;
    restore(snapshot: unknown, selectionAfter: BlockSelection | null): void;
};

export function foldRestore(port: FoldPort): DefaultUxModule {
    let snapshot: unknown | null = null;
    return {
        name: 'fold-restore',
        onDragStart(ctx) {
            snapshot = port.capture(ctx.selection);
        },
        onDragEnd(_ctx, result) {
            if (result.kind !== 'applied' || snapshot == null) {
                snapshot = null;
                return;
            }
            port.restore(snapshot, null);
            snapshot = null;
        },
        onCancel() {
            snapshot = null;
        },
    };
}
