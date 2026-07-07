export function clampTargetLineNumber(totalLines: number, lineNumber: number): number {
    if (lineNumber < 1) return 1;
    if (lineNumber > totalLines + 1) return totalLines + 1;
    return lineNumber;
}
