import { BlockInfo, BlockType } from '../block/block-types';
import { detectBlock } from '../block/block-detector';
import { getLineMap, getLineMetaAt, LineMap } from '../markdown/line-map';
import {
    InsertionRuleDecision,
    InsertionSlotContext,
    resolveInsertionRule,
} from './insertion-rules';
import { DocLike, StateWithDoc } from '../markdown/document-types';
import { isBlockquoteLine, isHorizontalRuleLine } from '../block/block-guards';

type ContainerType = BlockType.ListItem | BlockType.Blockquote | BlockType.Callout;
export type DetectBlockFn = (
    state: StateWithDoc,
    lineNumber: number,
    options: { tabSize: number }
) => BlockInfo | null;

const defaultDetectBlock: DetectBlockFn = (state, lineNumber, options) => detectBlock(state, lineNumber, options);

export interface DropRuleContext {
    slotContext: InsertionSlotContext;
    decision: InsertionRuleDecision;
}

export interface ContainerPolicyResolveOptions {
    lineMap?: LineMap;
    tabSize: number;
}

function clampInsertionLineNumber(doc: DocLike, lineNumber: number): number {
    if (lineNumber < 1) return 1;
    if (lineNumber > doc.lines + 1) return doc.lines + 1;
    return lineNumber;
}

function getImmediateLineText(doc: DocLike, lineNumber: number): string | null {
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    return doc.line(lineNumber).text;
}

function getActiveLineMap(
    state: StateWithDoc,
    options: ContainerPolicyResolveOptions
): LineMap {
    return options.lineMap ?? getLineMap(state, { tabSize: options.tabSize });
}

export function getPreviousNonEmptyLineNumber(
    doc: DocLike,
    lineNumber: number,
    lineMap?: LineMap
): number | null {
    if (lineMap && lineMap.doc === doc) {
        if (doc.lines <= 0) return null;
        const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
        const prev = lineMap.prevNonEmpty[clampedLine];
        return prev > 0 ? prev : null;
    }
    for (let i = lineNumber; i >= 1; i--) {
        const text = doc.line(i).text;
        if (text.trim().length === 0) continue;
        return i;
    }
    return null;
}

export function getNextNonEmptyLineNumber(
    doc: DocLike,
    lineNumber: number,
    lineMap?: LineMap
): number | null {
    if (lineMap && lineMap.doc === doc) {
        if (doc.lines <= 0) return null;
        const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
        const next = lineMap.nextNonEmpty[clampedLine];
        return next > 0 ? next : null;
    }
    for (let i = lineNumber; i <= doc.lines; i++) {
        const text = doc.line(i).text;
        if (text.trim().length === 0) continue;
        return i;
    }
    return null;
}

export function findEnclosingListBlock(
    state: StateWithDoc,
    lineNumber: number,
    detectBlockFn: DetectBlockFn | undefined,
    options: ContainerPolicyResolveOptions
): BlockInfo | null {
    const doc = state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const lineMap = getActiveLineMap(state, options);
    const activeDetectBlockFn = detectBlockFn ?? defaultDetectBlock;

    const radius = 8;
    const minLine = Math.max(1, lineNumber - radius);
    const maxLine = Math.min(doc.lines, lineNumber + radius);
    let best: BlockInfo | null = null;

    for (let ln = minLine; ln <= maxLine; ln++) {
        const meta = getLineMetaAt(lineMap, ln);
        if (meta && !meta.isList) continue;

        const block = activeDetectBlockFn(state, ln, { tabSize: options.lineMap?.tabSize ?? options.tabSize });
        if (!block || block.type !== BlockType.ListItem) continue;
        const blockStart = block.startLine + 1;
        const blockEnd = block.endLine + 1;
        if (lineNumber < blockStart || lineNumber > blockEnd) continue;

        if (!best || (block.endLine - block.startLine) > (best.endLine - best.startLine)) {
            best = block;
        }
    }

    return best;
}

function isTableBlockStartAtLine(
    state: StateWithDoc,
    lineNumber: number,
    detectBlockFn: DetectBlockFn,
    options: { tabSize: number }
): boolean {
    if (lineNumber < 1 || lineNumber > state.doc.lines) return false;
    const block = detectBlockFn(state, lineNumber, options);
    return !!block && block.type === BlockType.Table && block.startLine + 1 === lineNumber;
}

function isHorizontalRuleAtLine(
    state: StateWithDoc,
    lineNumber: number,
    detectBlockFn: DetectBlockFn,
    options: { tabSize: number }
): boolean {
    if (lineNumber < 1 || lineNumber > state.doc.lines) return false;
    const block = detectBlockFn(state, lineNumber, options);
    if (block) {
        return block.type === BlockType.HorizontalRule && block.startLine + 1 === lineNumber;
    }
    return isHorizontalRuleLine(state.doc.line(lineNumber).text);
}

function isCalloutAfterBoundary(
    state: StateWithDoc,
    prevImmediateLine: number,
    nextIsQuoteLike: boolean,
    detectBlockFn: DetectBlockFn,
    options: { tabSize: number }
): boolean {
    if (prevImmediateLine < 1 || prevImmediateLine > state.doc.lines) return false;
    if (nextIsQuoteLike) return false;
    const prevBlock = detectBlockFn(state, prevImmediateLine, options);
    return !!prevBlock
        && prevBlock.type === BlockType.Callout
        && prevBlock.endLine + 1 === prevImmediateLine;
}

function resolveListContextAtInsertion(
    state: StateWithDoc,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn | undefined,
    options: ContainerPolicyResolveOptions
): { type: ContainerType; block: BlockInfo } | null {
    const doc = state.doc;
    if (doc.lines <= 0) return null;
    const lineMap = getActiveLineMap(state, options);

    const candidates = [
        targetLineNumber - 1,
        targetLineNumber,
        targetLineNumber + 1,
        getPreviousNonEmptyLineNumber(doc, targetLineNumber - 1, lineMap),
        getNextNonEmptyLineNumber(doc, targetLineNumber, lineMap),
    ].filter((v): v is number => typeof v === 'number' && v >= 1 && v <= doc.lines);
    const seen = new Set<number>();
    let best: BlockInfo | null = null;

    for (const line of candidates) {
        if (seen.has(line)) continue;
        seen.add(line);
        const lineMeta = getLineMetaAt(lineMap, line);
        if (lineMeta && !lineMeta.isList) continue;

        const block = findEnclosingListBlock(state, line, detectBlockFn, {
            lineMap,
            tabSize: options.tabSize,
        });
        if (!block) continue;

        const blockTopBoundary = block.startLine + 1;
        const blockBottomBoundary = block.endLine + 2;
        const isInsideContainer = targetLineNumber > blockTopBoundary
            && targetLineNumber < blockBottomBoundary;
        if (!isInsideContainer) continue;

        if (!best || (block.endLine - block.startLine) > (best.endLine - best.startLine)) {
            best = block;
        }
    }

    if (!best) return null;
    return { type: BlockType.ListItem, block: best };
}

export function resolveSlotContextAtInsertion(
    state: StateWithDoc,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn | undefined,
    options: ContainerPolicyResolveOptions
): InsertionSlotContext {
    const doc = state.doc;
    const lineMap = getActiveLineMap(state, options);
    const clampedTarget = clampInsertionLineNumber(doc, targetLineNumber);
    const prevImmediateLine = clampedTarget - 1;
    const nextImmediateLine = clampedTarget <= doc.lines ? clampedTarget : null;
    const prevMeta = getLineMetaAt(lineMap, prevImmediateLine);
    const nextMeta = nextImmediateLine === null ? null : getLineMetaAt(lineMap, nextImmediateLine);

    const prevImmediateText = prevMeta ? null : getImmediateLineText(doc, prevImmediateLine);
    const nextImmediateText = nextMeta || nextImmediateLine === null
        ? null
        : getImmediateLineText(doc, nextImmediateLine);
    const prevIsQuoteLike = prevMeta ? prevMeta.isQuote : isBlockquoteLine(prevImmediateText);
    const nextIsQuoteLike = nextMeta ? nextMeta.isQuote : isBlockquoteLine(nextImmediateText);

    const detectOptions = { tabSize: options.tabSize };

    const activeDetectBlockFn = detectBlockFn ?? defaultDetectBlock;

    if (isCalloutAfterBoundary(state, prevImmediateLine, nextIsQuoteLike, activeDetectBlockFn, detectOptions)) {
        return 'callout_after';
    }

    if (
        nextImmediateLine !== null
        && isTableBlockStartAtLine(state, nextImmediateLine, activeDetectBlockFn, detectOptions)
    ) {
        return 'table_before';
    }

    if (
        nextImmediateLine !== null
        && isHorizontalRuleAtLine(state, nextImmediateLine, activeDetectBlockFn, detectOptions)
    ) {
        return 'hr_before';
    }

    if (prevIsQuoteLike && nextIsQuoteLike) {
        return 'inside_quote_run';
    }
    if (!prevIsQuoteLike && nextIsQuoteLike) {
        return 'quote_before';
    }
    if (prevIsQuoteLike && !nextIsQuoteLike) {
        return 'quote_after';
    }

    const listContext = resolveListContextAtInsertion(
        state,
        clampedTarget,
        activeDetectBlockFn,
        { lineMap, tabSize: options.tabSize }
    );
    if (listContext) {
        return 'inside_list';
    }

    return 'outside';
}

export function resolveDropRuleContextAtInsertion(
    state: StateWithDoc,
    sourceBlock: BlockInfo,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn | undefined,
    options: ContainerPolicyResolveOptions
): DropRuleContext {
    const slotContext = resolveSlotContextAtInsertion(state, targetLineNumber, detectBlockFn, options);
    const decision = resolveInsertionRule({
        sourceType: sourceBlock.type,
        slotContext,
    });
    return {
        slotContext,
        decision,
    };
}


