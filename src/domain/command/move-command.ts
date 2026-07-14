import type { BlockCommand } from './block-command';
import type { BlockSelection } from '../selection/block-selection';
import type { DropPosition } from './drop-position';

export type MoveBlockCommand = Extract<BlockCommand, { type: 'move' }>;

export function createMoveCommand(selection: BlockSelection, position: DropPosition): MoveBlockCommand {
    return { type: 'move', selection, position };
}
