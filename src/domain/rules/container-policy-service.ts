import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';
import { getLineMap, LineMap } from '../markdown/line-map';

import { resolveDropRuleContextAtInsertion, type DropRuleContext } from './container-policy';

export function resolveDropRuleAtInsertion(
    doc: Doc,
    sourceBlock: Block,
    targetLineNumber: number,
    options: { lineMap?: LineMap; tabSize: number }
): DropRuleContext {
    const lineMap = options.lineMap ?? getLineMap(doc, { tabSize: options.tabSize });
    return resolveDropRuleContextAtInsertion(
        doc,
        sourceBlock,
        targetLineNumber,
        undefined,
        { lineMap, tabSize: options.tabSize }
    );
}
