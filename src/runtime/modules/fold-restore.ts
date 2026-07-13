import type { BlockSelection } from '../../domain/selection/block-selection';
import type { DefaultUxModule } from '../ux-module';

// Optional module shipped for hosts that can restore editor fold UI after a move.
// Not imported by Runtime; host registers it via ux: { modules: [foldRestore(...)] }.

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
            const selectionAfter = result.edits.find((edit) => edit.selectionAfter)?.selectionAfter ?? null;
            port.restore(snapshot, selectionAfter);
            snapshot = null;
        },
        onCancel() {
            snapshot = null;
        },
    };
}
