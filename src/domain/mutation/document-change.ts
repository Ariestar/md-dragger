import { DocLikeWithRange } from '../markdown/document-types';

export type TextChange = {
    from: number;
    to: number;
    insert?: string;
};

export function resolveInsertionChange(
    doc: DocLikeWithRange,
    targetLineNumber: number,
    insertText: string,
    options?: {
        remainingLengthAfterDelete?: number;
    }
): { pos: number; text: string } {
    if (targetLineNumber <= doc.lines) {
        return {
            pos: doc.line(targetLineNumber).from,
            text: insertText,
        };
    }
    const normalized = insertText.endsWith('\n')
        ? insertText.slice(0, -1)
        : insertText;
    if (!normalized.length) {
        return { pos: doc.length, text: normalized };
    }
    const remainingLengthAfterDelete = options?.remainingLengthAfterDelete ?? doc.length;
    if (remainingLengthAfterDelete <= 0) {
        return { pos: 0, text: normalized };
    }
    return {
        pos: doc.length,
        text: `\n${normalized}`,
    };
}

export function resolveDeleteRange(
    doc: DocLikeWithRange,
    sourceFrom: number,
    sourceTo: number
): { from: number; to: number } {
    if (sourceTo < doc.length) {
        return {
            from: sourceFrom,
            to: Math.min(sourceTo + 1, doc.length),
        };
    }

    if (sourceFrom > 0) {
        return {
            from: sourceFrom - 1,
            to: sourceTo,
        };
    }

    return {
        from: sourceFrom,
        to: sourceTo,
    };
}
