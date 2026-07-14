import type { BlockType } from '../block/block-types';
import type { BlockSelection } from '../selection/block-selection';
import type { DropPosition } from './drop-position';

export type BlockCommand =
    | { type: 'move'; selection: BlockSelection; position: DropPosition }
    | { type: 'delete'; selection: BlockSelection }
    | { type: 'convert'; selection: BlockSelection; to: BlockType }
    | { type: 'indent'; selection: BlockSelection; direction: 'in' | 'out' };
