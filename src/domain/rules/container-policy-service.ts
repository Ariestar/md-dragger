import { BlockInfo } from '../block/block-types';
import type { StateWithDoc } from '../markdown/document-types';
import { getLineMap, LineMap } from '../markdown/line-map';

import {
    resolveDropRuleContextAtInsertion,
    type DropRuleContext,
} from './container-policy';

export function resolveDropRuleAtInsertion(
    state: StateWithDoc,
    sourceBlock: BlockInfo,
    targetLineNumber: number,
    options: { lineMap?: LineMap; tabSize: number }
): DropRuleContext {
    const lineMap = options.lineMap ?? getLineMap(state, { tabSize: options.tabSize });
    return resolveDropRuleContextAtInsertion(
        state,
        sourceBlock,
        targetLineNumber,
        undefined,
        { lineMap, tabSize: options.tabSize }
    );
}
