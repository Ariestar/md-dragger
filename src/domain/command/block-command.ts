import type { BlockType } from '../block/block-types';
import type { BlockSelection } from '../selection/block-selection';
import type { DropPosition } from './drop-position';

export type BlockCommand =
    | { type: 'move'; selection: BlockSelection; position: DropPosition }
    | { type: 'delete'; selection: BlockSelection }
    | { type: 'convert'; selection: BlockSelection; to: BlockType }
    | { type: 'indent'; selection: BlockSelection; direction: 'in' | 'out' };

export type MoveBlockCommand = Extract<BlockCommand, { type: 'move' }>;
export type DeleteBlockCommand = Extract<BlockCommand, { type: 'delete' }>;

export function createMoveCommand(selection: BlockSelection, position: DropPosition): MoveBlockCommand {
    return { type: 'move', selection, position };
}

export function createDeleteCommand(selection: BlockSelection): DeleteBlockCommand {
    return { type: 'delete', selection };
}
