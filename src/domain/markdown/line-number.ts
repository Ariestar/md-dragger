/** Clamp to a content line: [1, docLines]. */
export function clampLine(docLines: number, line: number): number {
    if (docLines <= 0) return 1;
    if (line < 1) return 1;
    if (line > docLines) return docLines;
    return line;
}

/** Clamp to an insertion seam: [1, docLines + 1]. */
export function clampInsertLine(docLines: number, line: number): number {
    if (line < 1) return 1;
    if (line > docLines + 1) return docLines + 1;
    return line;
}
