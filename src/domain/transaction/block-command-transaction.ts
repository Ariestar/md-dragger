import type { Doc } from '../markdown/document-types';
import type { BlockSelection } from '../selection/block-selection';
import type { BlockCommand } from '../command/block-command';
import type { DeleteBlockCommand } from '../command/delete-command';
import type { DocEdit } from './block-transaction';
import { rejectCommand, type CommandReject } from './command-reject';
import { planDeleteBlocksTransaction } from './delete-blocks';

export function planDelete(params: {
    doc: Doc;
    selection: BlockSelection;
}): DocEdit | CommandReject {
    return planDeleteBlocksTransaction(params);
}

/** Routes delete commands; other command types reject. */
export function planBlockCommandTransaction(params: {
    doc: Doc;
    command: BlockCommand;
}): DocEdit | CommandReject {
    if (params.command.type !== 'delete') return rejectCommand('unsupported_command');
    return planDelete({ doc: params.doc, selection: params.command.selection });
}
