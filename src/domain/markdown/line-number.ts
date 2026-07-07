export function clampLineNumber(docLines: number, lineNumber: number): number {
    if (docLines <= 0) return 1;
    if (lineNumber < 1) return 1;
    if (lineNumber > docLines) return docLines;
    return lineNumber;
}
