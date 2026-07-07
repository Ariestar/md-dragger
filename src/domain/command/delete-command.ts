import type { BlockCommand } from './block-command';
import type { BlockSelection } from '../selection/block-selection';

export type DeleteBlockCommand = Extract<BlockCommand, { type: 'delete' }>;

export function createDeleteCommand(selection: BlockSelection): DeleteBlockCommand {
    return { type: 'delete', selection };
}
