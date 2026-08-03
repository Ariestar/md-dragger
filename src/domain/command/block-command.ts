import type { BlockSelection } from '../selection/block-selection';
import type { DropPosition } from './drop-position';

export type BlockCommand = { type: 'move'; selection: BlockSelection; position: DropPosition };
