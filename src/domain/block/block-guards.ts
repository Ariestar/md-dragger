/**
 * Canonical line-type detection helpers.
 * Every module that needs to classify a Markdown line should import from here
 * instead of re-implementing its own copy.
 */

export function isHorizontalRuleLine(text: string | null): boolean {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length < 3) return false;
    return /^([-*_])(?:\s*\1){2,}$/.test(trimmed);
}

export function isCalloutLine(text: string | null): boolean {
    if (!text) return false;
    return /^(\s*> ?)+\s*\[!/.test(text.trimStart());
}

export function isTableLine(text: string | null): boolean {
    if (!text) return false;
    return text.trimStart().startsWith('|');
}

export function isMathFenceLine(text: string | null): boolean {
    if (!text) return false;
    return text.trimStart().startsWith('$$');
}

export function isCodeFenceLine(text: string | null): boolean {
    if (!text) return false;
    return text.trimStart().startsWith('```');
}

/** Whether the line starts with %% after leading whitespace; null and empty text return false. */
export function isCommentFenceLine(text: string | null): boolean {
    if (!text) return false;
    return text.trimStart().startsWith('%%');
}

/**
 * Whether the line starts with marker after leading whitespace and contains another
 * occurrence after the opener. The second marker need not end the line.
 */
export function isSingleLineFence(text: string, marker: string): boolean {
    const trimmed = text.trimStart();
    if (!trimmed.startsWith(marker)) return false;
    return trimmed.slice(marker.length).includes(marker);
}

/**
 * Return the trimmed body between opening and closing markers, or null when the
 * trimmed text is not enclosed by two non-overlapping markers. An empty body is valid.
 */
export function singleLineFenceBody(text: string, marker: string): string | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith(marker) || !trimmed.endsWith(marker) || trimmed.length < marker.length * 2) return null;
    return trimmed.slice(marker.length, -marker.length).trim();
}
