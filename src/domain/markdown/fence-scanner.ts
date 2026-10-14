import { isCodeFenceLine, isCommentFenceLine, isMathFenceLine, isSingleLineFence } from '../block/block-guards';
import { BlockType } from '../block/block-types';
import type { Doc } from './document-types';

export type FenceRange = { startLine: number; endLine: number };

export type FencedBlock = {
    type: BlockType.CodeBlock | BlockType.MathBlock | BlockType.Comment;
    range: FenceRange;
};

type FenceDef = {
    type: FencedBlock['type'];
    isMatch: (text: string | null) => boolean;
    allowSingleLineMarker?: string;
    keepUnclosed?: boolean;
};

const FENCE_DEFS: readonly FenceDef[] = [
    { type: BlockType.CodeBlock, isMatch: isCodeFenceLine, keepUnclosed: true },
    { type: BlockType.MathBlock, isMatch: isMathFenceLine, allowSingleLineMarker: '$$' },
    { type: BlockType.Comment, isMatch: isCommentFenceLine, allowSingleLineMarker: '%%' },
];

type FenceLazyScanState = {
    scannedUntilLine: number;
    openFence: {
        type: FencedBlock['type'];
        startLine: number;
        isMatch: (text: string | null) => boolean;
        keepUnclosed?: boolean;
    } | null;
    fullyScanned: boolean;
    fenceByLine: Map<number, FencedBlock>;
};

const fenceLazyScanCache = new WeakMap<Doc, FenceLazyScanState>();

function assignFenceRangeByLine(
    fenceByLine: Map<number, FencedBlock>,
    type: FencedBlock['type'],
    startLine: number,
    endLine: number,
): void {
    const entry: FencedBlock = { type, range: { startLine, endLine } };
    for (let i = startLine; i <= endLine; i++) {
        fenceByLine.set(i, entry);
    }
}

function createFenceLazyScanState(): FenceLazyScanState {
    return {
        scannedUntilLine: 0,
        openFence: null,
        fullyScanned: false,
        fenceByLine: new Map<number, FencedBlock>(),
    };
}

function getFenceLazyScanState(doc: Doc): FenceLazyScanState {
    const cached = fenceLazyScanCache.get(doc);
    if (cached) return cached;
    const created = createFenceLazyScanState();
    fenceLazyScanCache.set(doc, created);
    return created;
}

function scanFenceLine(state: FenceLazyScanState, lineNumber: number, text: string): void {
    if (state.openFence) {
        if (state.openFence.isMatch(text)) {
            assignFenceRangeByLine(state.fenceByLine, state.openFence.type, state.openFence.startLine, lineNumber);
            state.openFence = null;
        }
        return;
    }

    for (const def of FENCE_DEFS) {
        if (!def.isMatch(text)) continue;
        if (def.allowSingleLineMarker && isSingleLineFence(text, def.allowSingleLineMarker)) {
            assignFenceRangeByLine(state.fenceByLine, def.type, lineNumber, lineNumber);
        } else {
            state.openFence = {
                type: def.type,
                startLine: lineNumber,
                isMatch: def.isMatch,
                keepUnclosed: def.keepUnclosed,
            };
        }
        return;
    }
}

function finalizeFenceStateAtDocEnd(state: FenceLazyScanState): void {
    if (state.openFence?.keepUnclosed) {
        assignFenceRangeByLine(
            state.fenceByLine,
            state.openFence.type,
            state.openFence.startLine,
            state.openFence.startLine,
        );
    }
    state.openFence = null;
    state.fullyScanned = true;
}

function ensureFenceScanComplete(doc: Doc): FenceLazyScanState {
    const state = getFenceLazyScanState(doc);
    if (state.fullyScanned) return state;

    let cursor = state.scannedUntilLine + 1;
    while (cursor <= doc.lines) {
        scanFenceLine(state, cursor, doc.line(cursor).text);
        cursor++;
    }
    state.scannedUntilLine = Math.max(state.scannedUntilLine, cursor - 1);
    finalizeFenceStateAtDocEnd(state);
    return state;
}

export function findFencedBlock(doc: Doc, lineNumber: number): FencedBlock | null {
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const state = ensureFenceScanComplete(doc);
    return state.fenceByLine.get(lineNumber) ?? null;
}

export function findCommentBlockRange(doc: Doc, lineNumber: number): FenceRange | null {
    const b = findFencedBlock(doc, lineNumber);
    return b?.type === BlockType.Comment ? b.range : null;
}

export function findMathBlockRange(doc: Doc, lineNumber: number): FenceRange | null {
    const b = findFencedBlock(doc, lineNumber);
    return b?.type === BlockType.MathBlock ? b.range : null;
}

export function findCodeBlockRange(doc: Doc, lineNumber: number): FenceRange | null {
    const b = findFencedBlock(doc, lineNumber);
    return b?.type === BlockType.CodeBlock ? b.range : null;
}
