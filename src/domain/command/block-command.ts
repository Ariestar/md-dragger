import type { BlockType } from '../block/block-types';
import type { BlockSelection } from '../selection/block-selection';
import type { DropTarget } from './drop-target';

export type BlockCommand =
    | { type: 'move'; selection: BlockSelection; target: DropTarget }
    | { type: 'delete'; selection: BlockSelection }
    | { type: 'convert'; selection: BlockSelection; to: BlockType }
    | { type: 'indent'; selection: BlockSelection; direction: 'in' | 'out' };
