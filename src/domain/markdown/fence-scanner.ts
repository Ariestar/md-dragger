import type { DocLike } from './document-types';
import { isMathFenceLine, isCodeFenceLine } from '../block/block-guards';

export type FenceRange = { startLine: number; endLine: number };

type FenceLazyScanState = {
    scannedUntilLine: number;
    openCodeStartLine: number;
    openMathStartLine: number;
    fullyScanned: boolean;
    codeRangeByLine: Map<number, FenceRange>;
    mathRangeByLine: Map<number, FenceRange>;
};

const fenceLazyScanCache = new WeakMap<DocLike, FenceLazyScanState>();

function isSingleLineMathFence(lineText: string): boolean {
    const trimmed = lineText.trimStart();
    if (!trimmed.startsWith('$$')) return false;
    return trimmed.slice(2).includes('$$');
}

function assignFenceRangeByLine(rangeByLine: Map<number, FenceRange>, startLine: number, endLine: number): void {
    const range: FenceRange = { startLine, endLine };
    for (let i = startLine; i <= endLine; i++) {
        rangeByLine.set(i, range);
    }
}

function createFenceLazyScanState(): FenceLazyScanState {
    return {
        scannedUntilLine: 0,
        openCodeStartLine: 0,
        openMathStartLine: 0,
        fullyScanned: false,
        codeRangeByLine: new Map<number, FenceRange>(),
        mathRangeByLine: new Map<number, FenceRange>(),
    };
}

function getFenceLazyScanState(doc: DocLike): FenceLazyScanState {
    const cached = fenceLazyScanCache.get(doc);
    if (cached) return cached;
    const created = createFenceLazyScanState();
    fenceLazyScanCache.set(doc, created);
    return created;
}

function scanFenceLine(
    state: FenceLazyScanState,
    lineNumber: number,
    text: string
): void {
    // When inside a code block, only look for closing code fence
    if (state.openCodeStartLine !== 0) {
        if (isCodeFenceLine(text)) {
            assignFenceRangeByLine(state.codeRangeByLine, state.openCodeStartLine, lineNumber);
            state.openCodeStartLine = 0;
        }
        // Ignore everything else (including $$) when inside code block
        return;
    }

    // When inside a math block, only look for closing math fence
    if (state.openMathStartLine !== 0) {
        if (isMathFenceLine(text)) {
            assignFenceRangeByLine(state.mathRangeByLine, state.openMathStartLine, lineNumber);
            state.openMathStartLine = 0;
        }
        // Ignore everything else when inside math block
        return;
    }

    // Not inside any block - check for opening fences
    // Code fences take priority over math fences
    if (isCodeFenceLine(text)) {
        state.openCodeStartLine = lineNumber;
        return;
    }

    if (isMathFenceLine(text)) {
        if (isSingleLineMathFence(text)) {
            assignFenceRangeByLine(state.mathRangeByLine, lineNumber, lineNumber);
        } else {
            state.openMathStartLine = lineNumber;
        }
    }
}

function finalizeFenceStateAtDocEnd(state: FenceLazyScanState): void {
    if (state.openCodeStartLine !== 0) {
        // Keep historical behavior for unclosed code fences.
        assignFenceRangeByLine(state.codeRangeByLine, state.openCodeStartLine, state.openCodeStartLine);
        state.openCodeStartLine = 0;
    }
    // Unclosed math fence intentionally remains unmatched.
    state.openMathStartLine = 0;
    state.fullyScanned = true;
}

function ensureFenceScanComplete(doc: DocLike): FenceLazyScanState {
    const state = getFenceLazyScanState(doc);
    if (state.fullyScanned) return state;

    // Build fence ranges against the whole document once per doc snapshot.
    // This avoids partial-range drift when users jump rapidly across long files.
    let cursor = state.scannedUntilLine + 1;
    while (cursor <= doc.lines) {
        scanFenceLine(state, cursor, doc.line(cursor).text);
        cursor++;
    }
    state.scannedUntilLine = Math.max(state.scannedUntilLine, cursor - 1);
    finalizeFenceStateAtDocEnd(state);
    return state;
}

/**
 * Pre-warm fence scan for a document to ensure code/math block boundaries
 * are fully computed before interaction. Call this during idle time.
 */
export function prewarmFenceScan(doc: DocLike): void {
    ensureFenceScanComplete(doc);
}

export function findMathBlockRange(doc: DocLike, lineNumber: number): FenceRange | null {
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const state = ensureFenceScanComplete(doc);
    return state.mathRangeByLine.get(lineNumber) ?? null;
}

export function findCodeBlockRange(doc: DocLike, lineNumber: number): FenceRange | null {
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const state = ensureFenceScanComplete(doc);
    return state.codeRangeByLine.get(lineNumber) ?? null;
}
