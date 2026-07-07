import { describe, expect, it } from 'vitest';
import { BlockInfo, BlockType } from '../block/block-types';
import {
    resolveDropRuleContextAtInsertion,
    resolveSlotContextAtInsertion,
    type DetectBlockFn,
} from './container-policy';
import { getLineMap } from '../markdown/line-map';
import { DocLike, StateWithDoc } from '../markdown/document-types';

function createDoc(lines: string[]): DocLike {
    const fromOffsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
        fromOffsets.push(offset);
        offset += line.length + 1;
    }

    return {
        lines: lines.length,
        line: (n: number) => {
            const idx = n - 1;
            const text = lines[idx] ?? '';
            const from = fromOffsets[idx] ?? 0;
            return { text, from, to: from + text.length };
        },
    };
}

function createState(lines: string[]): StateWithDoc {
    return { doc: createDoc(lines) };
}

function createBlock(type: BlockType, startLine: number, endLine: number, content: string): BlockInfo {
    return {
        type,
        startLine,
        endLine,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

function mapDetectBlock(map: Record<number, BlockInfo>): DetectBlockFn {
    return (_state, lineNumber) => map[lineNumber] ?? null;
}

const TAB_SIZE = 4;

describe('container-policies', () => {
    it('resolves inside_list for nested list insertion points', () => {
        const state = createState(['- parent', '  - child', 'after']);
        const root = createBlock(BlockType.ListItem, 0, 1, '- parent\n  - child');
        const child = createBlock(BlockType.ListItem, 1, 1, '  - child');
        const detect = mapDetectBlock({ 1: root, 2: child });

        const slot = resolveSlotContextAtInsertion(state, 2, detect, { tabSize: TAB_SIZE });

        expect(slot).toBe('inside_list');
    });

    it('keeps boundary between top-level list roots as outside', () => {
        const state = createState(['- first', '- second']);
        const first = createBlock(BlockType.ListItem, 0, 0, '- first');
        const second = createBlock(BlockType.ListItem, 1, 1, '- second');
        const detect = mapDetectBlock({ 1: first, 2: second });

        const slot = resolveSlotContextAtInsertion(state, 2, detect, { tabSize: TAB_SIZE });

        expect(slot).toBe('outside');
    });

    it('keeps boundary between list subtree and next root as outside', () => {
        const state = createState(['- root', '  - child', '- sibling']);
        const root = createBlock(BlockType.ListItem, 0, 1, '- root\n  - child');
        const child = createBlock(BlockType.ListItem, 1, 1, '  - child');
        const sibling = createBlock(BlockType.ListItem, 2, 2, '- sibling');
        const detect = mapDetectBlock({ 1: root, 2: child, 3: sibling });

        const slot = resolveSlotContextAtInsertion(state, 3, detect, { tabSize: TAB_SIZE });

        expect(slot).toBe('outside');
    });

    it('resolves quote run slot contexts', () => {
        const state = createState(['> line 1', '> line 2']);
        const detect = mapDetectBlock({});

        expect(resolveSlotContextAtInsertion(state, 1, detect, { tabSize: TAB_SIZE })).toBe('quote_before');
        expect(resolveSlotContextAtInsertion(state, 2, detect, { tabSize: TAB_SIZE })).toBe('inside_quote_run');
        expect(resolveSlotContextAtInsertion(state, 3, detect, { tabSize: TAB_SIZE })).toBe('quote_after');
    });

    it('resolves callout/table/hr hard forbidden slots', () => {
        const calloutState = createState(['> [!note] title', '> detail', 'outside']);
        const tableState = createState(['| h |', '| - |', '| v |']);
        const hrState = createState(['---', 'after']);

        const calloutBlock = createBlock(BlockType.Callout, 0, 1, '> [!note] title\n> detail');
        const tableBlock = createBlock(BlockType.Table, 0, 2, '| h |\n| - |\n| v |');
        const hrBlock = createBlock(BlockType.HorizontalRule, 0, 0, '---');
        const calloutDetect = mapDetectBlock({ 1: calloutBlock, 2: calloutBlock });
        const tableDetect = mapDetectBlock({ 1: tableBlock, 2: tableBlock, 3: tableBlock });
        const hrDetect = mapDetectBlock({ 1: hrBlock });

        expect(resolveSlotContextAtInsertion(calloutState, 3, calloutDetect, { tabSize: TAB_SIZE })).toBe('callout_after');
        expect(resolveSlotContextAtInsertion(tableState, 1, tableDetect, { tabSize: TAB_SIZE })).toBe('table_before');
        expect(resolveSlotContextAtInsertion(hrState, 1, hrDetect, { tabSize: TAB_SIZE })).toBe('hr_before');
    });

    it('prevents non-quote source in quote run and tail boundary, but allows first-line boundary', () => {
        const state = createState(['> line 1', '> line 2']);
        const detect = mapDetectBlock({});
        const source = createBlock(BlockType.Paragraph, 0, 0, 'outside');

        const insideRule = resolveDropRuleContextAtInsertion(state, source, 2, detect, { tabSize: TAB_SIZE });
        const beforeRule = resolveDropRuleContextAtInsertion(state, source, 1, detect, { tabSize: TAB_SIZE });
        const afterRule = resolveDropRuleContextAtInsertion(state, source, 3, detect, { tabSize: TAB_SIZE });

        expect(insideRule.decision.allowDrop).toBe(false);
        expect(insideRule.decision.rejectReason).toBe('inside_quote_run');
        expect(beforeRule.decision.allowDrop).toBe(true);
        expect(beforeRule.decision.rejectReason).toBeNull();
        expect(afterRule.decision.allowDrop).toBe(false);
        expect(afterRule.decision.rejectReason).toBe('quote_boundary');
    });

    it('allows quote source and prevents callout source at quote boundaries', () => {
        const state = createState(['> line 1', '> line 2']);
        const detect = mapDetectBlock({});
        const quoteSource = createBlock(BlockType.Blockquote, 0, 0, '> moved');
        const calloutSource = createBlock(BlockType.Callout, 0, 1, '> [!note] title\n> body');

        expect(resolveDropRuleContextAtInsertion(state, quoteSource, 1, detect, { tabSize: TAB_SIZE }).decision.allowDrop).toBe(true);
        expect(resolveDropRuleContextAtInsertion(state, quoteSource, 3, detect, { tabSize: TAB_SIZE }).decision.allowDrop).toBe(true);
        expect(resolveDropRuleContextAtInsertion(state, calloutSource, 1, detect, { tabSize: TAB_SIZE }).decision.allowDrop).toBe(false);
        expect(resolveDropRuleContextAtInsertion(state, calloutSource, 3, detect, { tabSize: TAB_SIZE }).decision.allowDrop).toBe(false);
    });

    it('prevents callout source from entering quote run internals', () => {
        const state = createState(['> line 1', '> line 2']);
        const detect = mapDetectBlock({});
        const calloutSource = createBlock(BlockType.Callout, 0, 1, '> [!note] title\n> body');

        const insideRule = resolveDropRuleContextAtInsertion(state, calloutSource, 2, detect, { tabSize: TAB_SIZE });

        expect(insideRule.decision.allowDrop).toBe(false);
        expect(insideRule.decision.rejectReason).toBe('inside_quote_run');
    });

    it('prevents non-list source inside list slots while allowing list source', () => {
        const state = createState(['- parent', '  - child', 'after']);
        const root = createBlock(BlockType.ListItem, 0, 1, '- parent\n  - child');
        const child = createBlock(BlockType.ListItem, 1, 1, '  - child');
        const detect = mapDetectBlock({ 1: root, 2: child });
        const paragraph = createBlock(BlockType.Paragraph, 0, 0, 'outside');
        const listItem = createBlock(BlockType.ListItem, 0, 0, '- moved');

        expect(resolveDropRuleContextAtInsertion(state, paragraph, 2, detect, { tabSize: TAB_SIZE }).decision.allowDrop).toBe(false);
        expect(resolveDropRuleContextAtInsertion(state, listItem, 2, detect, { tabSize: TAB_SIZE }).decision.allowDrop).toBe(true);
    });

    it('keeps slot context output stable when passing explicit lineMap', () => {
        const state = createState(['> quote', '', '- item', 'tail']);
        const listBlock = createBlock(BlockType.ListItem, 2, 2, '- item');
        const detect = mapDetectBlock({ 3: listBlock });
        const lineMap = getLineMap(state, { tabSize: TAB_SIZE });

        const withoutMap = resolveSlotContextAtInsertion(state, 3, detect, { tabSize: TAB_SIZE });
        const withMap = resolveSlotContextAtInsertion(state, 3, detect, { lineMap, tabSize: TAB_SIZE });

        expect(withMap).toBe(withoutMap);
    });
});


