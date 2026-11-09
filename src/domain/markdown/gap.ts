import { detectBlock, frontmatterEndLine } from '../block/block-detector';
import { type Block, BlockType } from '../block/block-types';
import type { Doc } from './document-types';
import type { LineMap } from './line-map';
import type { LineRange } from './line-range-types';

/** The place between two consecutive Blocks, together with its blank lines. A drop targets a Gap. */
export type Gap = {
    /** Canonical seam: first line of `below`, or doc.lines + 1. */
    seam: number;
    /** Innermost block at the last non-blank line above `seam`; null at the top edge (document start or frontmatter end). */
    above: Block | null;
    /** Innermost block at `seam`; null at the bottom edge. */
    below: Block | null;
    /** Blank lines between them; 0 at an edge (padding is not a separator). */
    blankLines: number;
};

export type GapAt =
    | { type: 'gap'; gap: Gap }
    | {
          type: 'interior';
          reason: 'inside_frontmatter' | AtomicInterior;
          region: LineRange;
      };

type AtomicInterior = 'inside_code_block' | 'inside_math_block' | 'inside_comment_block' | 'inside_table';

/** Blocks whose interior is never a gap, by the reason a seam inside them is rejected. */
const ATOMIC_INTERIOR = new Map<BlockType, AtomicInterior>([
    [BlockType.CodeBlock, 'inside_code_block'],
    [BlockType.MathBlock, 'inside_math_block'],
    [BlockType.Comment, 'inside_comment_block'],
    [BlockType.Table, 'inside_table'],
]);

/**
 * The one seam shared by every raw seam of a gap: the first non-blank line at
 * or after `line`, or doc.lines + 1. The lower half of a block's last line,
 * the gap's blank lines and the upper half of the next block's first line all
 * give the same seam. Seams inside frontmatter, and on blank lines inside a
 * fence, math or comment block (its content, not a gap), stay where they are.
 */
export function canonicalSeam(doc: Doc, line: number, options: { lineMap: LineMap }): number {
    const { lineMap } = options;
    const seam = Math.max(1, Math.min(doc.lines + 1, line));
    if (seam <= frontmatterEndLine(doc)) return seam;
    if (seam <= doc.lines && lineMap.lineMeta[seam].isEmpty && seam > 1) {
        const above = lineMap.prevNonEmpty[seam - 1];
        const block = above > 0 ? detectBlock(doc, above, { tabSize: lineMap.tabSize }) : null;
        if (block && ATOMIC_INTERIOR.has(block.type) && block.lines.endLine >= seam) return seam;
    }
    const next = seam <= doc.lines ? lineMap.nextNonEmpty[seam] : 0;
    return next > 0 ? next : doc.lines + 1;
}

/** The gap at a raw seam, or the protected region the seam lies inside. */
export function gapAt(doc: Doc, line: number, options: { lineMap: LineMap; tabSize: number }): GapAt {
    const seam = canonicalSeam(doc, line, options);
    const frontmatterEnd = frontmatterEndLine(doc);
    if (seam <= frontmatterEnd) {
        return { type: 'interior', reason: 'inside_frontmatter', region: { startLine: 1, endLine: frontmatterEnd } };
    }

    const aboveLine = seam > 1 ? options.lineMap.prevNonEmpty[seam - 1] : 0;
    const above = aboveLine > frontmatterEnd ? blockAt(doc, aboveLine, options) : null;
    const below = seam <= doc.lines ? blockAt(doc, seam, options) : null;
    for (const block of [above, below]) {
        const reason = block && ATOMIC_INTERIOR.get(block.type);
        if (reason && block.lines.startLine < seam && block.lines.endLine >= seam) {
            return { type: 'interior', reason, region: block.lines };
        }
    }
    return { type: 'gap', gap: { seam, above, below, blankLines: above && below ? seam - aboveLine - 1 : 0 } };
}

/** The innermost block at a non-blank line. */
export function blockAt(doc: Doc, line: number, options: { tabSize: number }): Block {
    const block = detectBlock(doc, line, options);
    if (!block) throw new Error(`md-dragger: no block at non-blank line ${line}`);
    return block;
}
