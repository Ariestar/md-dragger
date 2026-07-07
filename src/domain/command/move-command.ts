import type { BlockSelection } from '../selection/block-selection';
import type { BlockCommand } from './block-command';
import type { DropTarget } from './drop-target';

export type MoveBlockCommand = Extract<BlockCommand, { type: 'move' }>;

export function createMoveCommand(selection: BlockSelection, target: DropTarget): MoveBlockCommand {
    return { type: 'move', selection, target };
}
