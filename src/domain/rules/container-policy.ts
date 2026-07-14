import { Block, BlockType } from '../block/block-types';
import { detectBlock } from '../block/block-detector';
import { getLineMap, getLineMetaAt, LineMap } from '../markdown/line-map';
import { InsertionRuleDecision, InsertionSlotContext, resolveInsertionRule } from './insertion-rules';
import { Doc } from '../markdown/document-types';
import { isBlockquoteLine, isHorizontalRuleLine } from '../block/block-guards';

type ContainerType = BlockType.ListItem | BlockType.Blockquote | BlockType.Callout;
export type DetectBlockFn = (
    doc: Doc,
    lineNumber: number,
    options: { tabSize: number }
) => Block | null;

const defaultDetectBlock: DetectBlockFn = (doc, lineNumber, options) => detectBlock(doc, lineNumber, options);

export interface DropRuleContext {
    slotContext: InsertionSlotContext;
    decision: InsertionRuleDecision;
}

export interface ContainerPolicyResolveOptions {
    lineMap?: LineMap;
    tabSize: number;
}

function getImmediateLineText(doc: Doc, lineNumber: number): string | null {
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    return doc.line(lineNumber).text;
}

function getActiveLineMap(
    doc: Doc,
    options: ContainerPolicyResolveOptions
): LineMap {
    return options.lineMap ?? getLineMap(doc, { tabSize: options.tabSize });
}

export function getPreviousNonEmptyLineNumber(
    doc: Doc,
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
    doc: Doc,
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
    doc: Doc,
    lineNumber: number,
    detectBlockFn: DetectBlockFn | undefined,
    options: ContainerPolicyResolveOptions
): Block | null {
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const lineMap = getActiveLineMap(doc, options);
    const activeDetectBlockFn = detectBlockFn ?? defaultDetectBlock;

    const radius = 8;
    const minLine = Math.max(1, lineNumber - radius);
    const maxLine = Math.min(doc.lines, lineNumber + radius);
    let best: Block | null = null;

    for (let ln = minLine; ln <= maxLine; ln++) {
        const meta = getLineMetaAt(lineMap, ln);
        if (meta && !meta.isList) continue;

        const block = activeDetectBlockFn(doc, ln, { tabSize: options.lineMap?.tabSize ?? options.tabSize });
        if (!block || block.type !== BlockType.ListItem) continue;
        const blockStart = block.lines.startLine;
        const blockEnd = block.lines.endLine;
        if (lineNumber < blockStart || lineNumber > blockEnd) continue;

        if (!best || ((block.lines.endLine - block.lines.startLine)) > ((best.lines.endLine - best.lines.startLine))) {
            best = block;
        }
    }

    return best;
}

function isTableBlockStartAtLine(
    doc: Doc,
    lineNumber: number,
    detectBlockFn: DetectBlockFn,
    options: { tabSize: number }
): boolean {
    if (lineNumber < 1 || lineNumber > doc.lines) return false;
    const block = detectBlockFn(doc, lineNumber, options);
    return !!block && block.type === BlockType.Table && block.lines.startLine === lineNumber;
}

function isHorizontalRuleAtLine(
    doc: Doc,
    lineNumber: number,
    detectBlockFn: DetectBlockFn,
    options: { tabSize: number }
): boolean {
    if (lineNumber < 1 || lineNumber > doc.lines) return false;
    const block = detectBlockFn(doc, lineNumber, options);
    if (block) {
        return block.type === BlockType.HorizontalRule && block.lines.startLine === lineNumber;
    }
    return isHorizontalRuleLine(doc.line(lineNumber).text);
}

function isCalloutAfterBoundary(
    doc: Doc,
    prevImmediateLine: number,
    nextIsQuoteLike: boolean,
    detectBlockFn: DetectBlockFn,
    options: { tabSize: number }
): boolean {
    if (prevImmediateLine < 1 || prevImmediateLine > doc.lines) return false;
    if (nextIsQuoteLike) return false;
    const prevBlock = detectBlockFn(doc, prevImmediateLine, options);
    return !!prevBlock
        && prevBlock.type === BlockType.Callout
        && prevBlock.lines.endLine === prevImmediateLine;
}

function resolveListContextAtInsertion(
    doc: Doc,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn | undefined,
    options: ContainerPolicyResolveOptions
): { type: ContainerType; block: Block } | null {
    if (doc.lines <= 0) return null;
    const lineMap = getActiveLineMap(doc, options);

    const candidates = [
        targetLineNumber - 1,
        targetLineNumber,
        targetLineNumber + 1,
        getPreviousNonEmptyLineNumber(doc, targetLineNumber - 1, lineMap),
        getNextNonEmptyLineNumber(doc, targetLineNumber, lineMap),
    ].filter((v): v is number => typeof v === 'number' && v >= 1 && v <= doc.lines);
    const seen = new Set<number>();
    let best: Block | null = null;

    for (const line of candidates) {
        if (seen.has(line)) continue;
        seen.add(line);
        const lineMeta = getLineMetaAt(lineMap, line);
        if (lineMeta && !lineMeta.isList) continue;

        const block = findEnclosingListBlock(doc, line, detectBlockFn, {
            lineMap,
            tabSize: options.tabSize,
        });
        if (!block) continue;

        const blockTopBoundary = block.lines.startLine;
        const blockBottomBoundary = block.lines.endLine + 1;
        const isInsideContainer = targetLineNumber > blockTopBoundary
            && targetLineNumber < blockBottomBoundary;
        if (!isInsideContainer) continue;

        if (!best || ((block.lines.endLine - block.lines.startLine)) > ((best.lines.endLine - best.lines.startLine))) {
            best = block;
        }
    }

    if (!best) return null;
    return { type: BlockType.ListItem, block: best };
}

export function resolveSlotContextAtInsertion(
    doc: Doc,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn | undefined,
    options: ContainerPolicyResolveOptions
): InsertionSlotContext {
    const lineMap = getActiveLineMap(doc, options);
    const clampedTarget = Math.max(1, Math.min(doc.lines + 1, targetLineNumber));
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

    if (isCalloutAfterBoundary(doc, prevImmediateLine, nextIsQuoteLike, activeDetectBlockFn, detectOptions)) {
        return 'callout_after';
    }

    if (
        nextImmediateLine !== null
        && isTableBlockStartAtLine(doc, nextImmediateLine, activeDetectBlockFn, detectOptions)
    ) {
        return 'table_before';
    }

    if (
        nextImmediateLine !== null
        && isHorizontalRuleAtLine(doc, nextImmediateLine, activeDetectBlockFn, detectOptions)
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
        doc,
        clampedTarget,
        activeDetectBlockFn,
        { lineMap, tabSize: options.tabSize }
    );
    if (listContext) {
        return 'inside_list';
    }

    return 'outside';
}

/**
 * Can this source block be dropped at the insert seam?
 * Uses default detectBlock; lineMap optional for reuse.
 */
export function resolveDropRuleAtInsertion(
    doc: Doc,
    sourceBlock: Block,
    targetLineNumber: number,
    options: { lineMap?: LineMap; tabSize: number }
): DropRuleContext {
    const lineMap = options.lineMap ?? getLineMap(doc, { tabSize: options.tabSize });
    const slotContext = resolveSlotContextAtInsertion(
        doc,
        targetLineNumber,
        undefined,
        { lineMap, tabSize: options.tabSize }
    );
    const decision = resolveInsertionRule({
        sourceType: sourceBlock.type,
        slotContext,
    });
    return { slotContext, decision };
}


