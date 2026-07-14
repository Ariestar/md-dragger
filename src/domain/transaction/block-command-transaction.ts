import type { Doc } from '../markdown/document-types';
import type { BlockSelection } from '../selection/block-selection';
import type { DocEdit } from './block-transaction';
import type { CommandReject } from './command-reject';
import { planDeleteBlocksTransaction } from './delete-blocks';

export function planDelete(params: {
    doc: Doc;
    selection: BlockSelection;
}): DocEdit | CommandReject {
    return planDeleteBlocksTransaction(params);
}
