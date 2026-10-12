import { describe, expect, it } from 'vitest';
import { detectBlock, frontmatterEndLine } from '../block/block-detector';
import { type Block, BlockType } from '../block/block-types';
import type { DropPosition } from '../command/drop-position';
import type { Doc } from '../markdown/document-types';
import { locateDropPosition } from '../markdown/drop-locate';
import { getLineMap, listItemContaining } from '../markdown/line-map';
import { mergeLineRanges } from '../markdown/line-range';
import { planMove } from '../move/move-plan';
import { parseLine } from '../parse/parse-line';
import { convertsToItems } from '../rules/container-policy';
import { facingAt, needsBlankLine, runKind } from '../rules/separation';
import { selectBlocks } from '../selection/block-selection';
import type { DocEdit } from './block-transaction';
import { planDelete } from './delete-blocks';
import { moveTx } from './move-blocks';
import { stringDoc } from './string-doc';

const tabSize = 4;
const indentUnit = 4;

/**
 * Varied pages: blank-separated and tight callout runs, quote runs, lists
 * (nested ordered ones, and items with fence and table children), fences,
 * tables, rules used as section breaks, math, comments, frontmatter, paragraphs and
 * quotes bounded by headings, padding, and documents with and without a
 * final newline. Every line is unique within its page, so an output line
 * names its source line.
 */
const PAGES: Record<string, string> = {
    callouts:
        'Intro line.\n\n> [!note]+ First\n> First body.\n\n> [!note]+ Second\n> Second body.\n> More second body.\n\n> [!note]- Third (folded)\n> Hidden body.\n\n> [!note] Fourth (title only)\n',
    pair: 'alpha\n\n> [!note] First\n> first body\n\nbravo\n\n> [!tip] Second\n> second body\n\ncharlie\n',
    tight: '# Title\nIntro line.\n> [!a] A\n> a body\n# Next\n%%\nnext comment\n%%\n> [!b] B\n> b body\n## End\nlast line',
    mixed: '---\ntitle: x\n---\n\n# Title\n\nIntro paragraph.\nSecond intro line.\n\n- one\n- two\n    - two a\n    two para\n- three\n\n> [!note] Note\n> body\n\n> plain quote\n> second quote line\n\n```js\ncode\n\nmore code\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n***\n\n$$\nx^2\n$$\n\nLast paragraph.\n',
    edges: '\n\nfirst\n\n| h1 | h2 |\n|----|----|\n| c1 | c2 |\n\n---\n\n$$\ny\n$$\n\n%%\ncomment one\n\ncomment two\n%%\n\n> q1\n> q2\n\n> > deep1\n> > deep2\n\n- [ ] task a\n- [ ] task b\n\nlast',
    loose: 'Lead:\n1. alpha\n2. beta\n\n- x\n\n- y\n\n- z\n\npara one\npara two\npara three\n\n# Heading\nunder heading',
    lists: '1. a\n    1. b\n    2. c\n2. d\n- x\n- y\n    ```js\n    code\n    ```\n- z\n    | h |\n    |---|\n    | c |\n',
    rules: 'Intro\n\n---\n\nsecret: content\n\n---\n\nstay',
    nested: '- a\n    - a1\n    - a2\n\n- b\n\n- c\n\n1. o\n\n    1. o1\n\n    2. o2\n2. p\n',
    headings: '# A\nalpha\n# B\nbeta\n## C\n> qa\n## D\n> qb\n> qc\n## E\ngamma\ndelta\n\nepsilon\nzeta\n\n> qd',
    markers:
        '* star one\n* star two\n\n+ plus one\n+ plus two\n\n1) paren one\n2) paren two\n\n- bullet parent\n    1. ordered child one\n    2. ordered child two\n\n> quoted line\n>\n> after bare\n\n> ## Quoted heading\n\n## 1. Numbered heading\n\ntail',
    quotedparent: '> x\n> - a\n> - b\n# H\n\n- c\n- d',
};

/** Pages whose lists are swept with every pair of blocks at every nesting level too. */
const LIST_PAGES = ['lists', 'nested'];

/** Text without whitespace and with ordered numbers masked: relevelling and renumbering change only those. */
function norm(line: string): string {
    return line.replace(/\s+/g, '').replace(/^(>*)\d+[.)]/, '$1#.');
}

function blockStarts(doc: Doc): number[] {
    const starts = new Set<number>();
    for (let line = 1; line <= doc.lines; line++) {
        const block = detectBlock(doc, line, { tabSize });
        if (block) starts.add(block.lines.startLine);
    }
    return [...starts];
}

function listHeads(doc: Doc): number[] {
    return blockStarts(doc).filter((line) => detectBlock(doc, line, { tabSize })?.type === BlockType.ListItem);
}

function applyEdits(text: string, edits: DocEdit[]): string {
    let out = text;
    for (const edit of edits) for (const c of edit.changes) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
    return out;
}

function orderedNumber(text: string): number | null {
    const marker = parseLine(text, tabSize).marker;
    return marker?.kind === 'list' && marker.markerType === 'ordered' ? Number.parseInt(marker.text, 10) : null;
}

/** Where each output line came from: its source paragraph or quote run, and its source number, by its text. */
type Origins = {
    /** False when two output lines may not touch: separate source paragraphs or quotes. */
    mayJoin(upper: string, lower: string): boolean;
    /** The ordered number a line had in its source, by its text. */
    number(text: string): number | null | undefined;
};

/**
 * Origins of the lines of the source documents. A paragraph or quote run is
 * the maximal stack of lines of one run kind; one that moves only in part is
 * a reorder of lines, whose lines may join any paragraph or quote.
 */
function originsOf(docs: Doc[], moved: string[]): Origins {
    const runs = new Map<string, string | null>();
    const numbers = new Map<string, number | null>();
    const ambiguous = new Set<string>();
    const runLines = new Map<string, string[]>();
    docs.forEach((doc, d) => {
        const lineMap = getLineMap(doc, { tabSize });
        let previous: { kind: string | null; run: string | null } = { kind: null, run: null };
        for (let line = frontmatterEndLine(doc) + 1; line <= doc.lines; line++) {
            const text = doc.line(line).text;
            if (!text.trim()) {
                previous = { kind: null, run: null };
                continue;
            }
            const kind = runKind(doc, line, { lineMap, tabSize });
            const joins = kind !== null && kind !== 'list';
            const run = joins ? (previous.kind === kind ? previous.run : `${d}:${line}`) : null;
            previous = { kind, run };
            const key = norm(text);
            if (runs.has(key)) ambiguous.add(key);
            runs.set(key, run);
            numbers.set(key, orderedNumber(text));
            if (run) runLines.set(run, [...(runLines.get(run) ?? []), key]);
        }
    });
    const partial = new Set(
        [...runLines]
            .filter(([, keys]) => keys.some((k) => moved.includes(k)) && keys.some((k) => !moved.includes(k)))
            .map(([run]) => run),
    );
    return {
        mayJoin(upper, lower) {
            const [u, l] = [norm(upper), norm(lower)];
            if (ambiguous.has(u) || ambiguous.has(l)) return true;
            const [ru, rl] = [runs.get(u), runs.get(l)];
            if (!ru || !rl) return true;
            return ru === rl || partial.has(ru) || partial.has(rl);
        },
        number: (text) => (ambiguous.has(norm(text)) ? undefined : numbers.get(norm(text))),
    };
}

/** Adjacent non-blank lines of different blocks that would not stay apart. */
function hazards(doc: Doc, origins: Origins, before: Set<string>): string[] {
    const found: string[] = [];
    for (let i = frontmatterEndLine(doc) + 1; i < doc.lines; i++) {
        const upperText = doc.line(i).text;
        const lowerText = doc.line(i + 1).text;
        if (!upperText.trim() || !lowerText.trim()) continue;
        if (before.has(`${norm(upperText)}|${norm(lowerText)}`)) continue;
        const upper = detectBlock(doc, i, { tabSize });
        const lower = detectBlock(doc, i + 1, { tabSize });
        if (!upper || !lower) {
            found.push(`unblocked line near ${i}`);
            continue;
        }
        // No empty item can interrupt a line: under a list line it is a setext underline or text of that line.
        if (LIST_MARKER.test(upperText) && /^\s*([-*+](\s+\[[ xX]\])?|\d+[.)])\s*$/.test(lowerText))
            found.push(`empty item under list line ${i}: ${JSON.stringify(upperText)} / ${JSON.stringify(lowerText)}`);
        if (upper.lines.startLine === lower.lines.startLine && upper.type === lower.type) continue;
        const up = parseLine(upperText, tabSize);
        const lo = parseLine(lowerText, tabSize);
        const open = [BlockType.Paragraph, BlockType.Blockquote, BlockType.Callout].includes(upper.type);
        const tag = `${i}: ${JSON.stringify(upperText)} / ${JSON.stringify(lowerText)}`;
        if (
            (upper.type === BlockType.Callout || upper.type === BlockType.Blockquote) &&
            lower.type === BlockType.Paragraph
        )
            found.push(`quote over paragraph ${tag}`);
        if (upper.type === BlockType.Callout && lower.type === BlockType.Callout) found.push(`callout|callout ${tag}`);
        // Obsidian needs a blank line before a table, but none after it or next to math.
        if (upper.type !== BlockType.Table && lower.type === BlockType.Table) found.push(`table touch ${tag}`);
        if (upper.type === BlockType.Paragraph && lower.type === BlockType.HorizontalRule) found.push(`setext ${tag}`);
        // Obsidian comments are inline: a paragraph or list line next to one runs into it.
        if (
            (upper.type === BlockType.Comment && lower.type === BlockType.Paragraph) ||
            (lower.type === BlockType.Comment && [BlockType.Paragraph, BlockType.ListItem].includes(upper.type))
        )
            found.push(`comment touch ${tag}`);
        if (
            upper.type === BlockType.Paragraph &&
            lower.type === BlockType.Paragraph &&
            up.indent.width !== lo.indent.width
        )
            found.push(`lazy indent ${tag}`);
        // A quote line dropped inside a tight quote run joins that run; everywhere else two separate source
        // paragraphs or quotes never touch.
        const quoteAt = (line: number) =>
            detectBlock(doc, line, { tabSize })?.type === BlockType.Blockquote
                ? parseLine(doc.line(line).text, tabSize).quote.depth
                : 0;
        const insideQuoteRun = (line: number) =>
            line > 1 && line < doc.lines && quoteAt(line - 1) === quoteAt(line) && quoteAt(line + 1) === quoteAt(line);
        const sameParagraph =
            upper.type === BlockType.Paragraph &&
            lower.type === BlockType.Paragraph &&
            up.indent.width === lo.indent.width;
        const sameQuote =
            upper.type === BlockType.Blockquote &&
            lower.type === BlockType.Blockquote &&
            up.quote.depth === lo.quote.depth &&
            !insideQuoteRun(i) &&
            !insideQuoteRun(i + 1);
        if ((sameParagraph || sameQuote) && !origins.mayJoin(upperText, lowerText))
            found.push(`separate paragraphs or quotes merged ${tag}`);
        if (upper.type === BlockType.ListItem && lower.type === BlockType.Paragraph && lo.indent.width === 0)
            found.push(`list over paragraph ${tag}`);
        if (open && lower.type === BlockType.ListItem && (orderedNumber(lowerText) ?? 1) !== 1)
            found.push(`ordered item continues ${tag}`);
        if (
            upper.type === BlockType.Blockquote &&
            lower.type === BlockType.Blockquote &&
            up.quote.depth !== lo.quote.depth
        )
            found.push(`quote depth ${tag}`);
    }
    return found;
}

/**
 * Ordered runs (lines with one indent and quote depth, as the renumberer
 * reads them) must be numbered 1, 2, 3 … or keep every line's source number.
 */
function numbering(doc: Doc, origins: Origins): string[] {
    const found: string[] = [];
    let run: string[] = [];
    const close = () => {
        const sequential = run.every((text, i) => orderedNumber(text) === i + 1);
        const kept = run.every((text) => {
            const source = origins.number(text);
            return source === undefined || source === orderedNumber(text);
        });
        if (run.length > 0 && !sequential && !kept) found.push(`misnumbered run ${JSON.stringify(run)}`);
        run = [];
    };
    for (let line = 1; line <= doc.lines; line++) {
        const text = doc.line(line).text;
        const p = parseLine(text, tabSize);
        const previous = run.length > 0 ? parseLine(run[run.length - 1], tabSize) : null;
        const continues =
            previous !== null && p.indent.width === previous.indent.width && p.quote.depth === previous.quote.depth;
        if (orderedNumber(text) === null || !continues) close();
        if (orderedNumber(text) !== null) run.push(text);
    }
    close();
    return found;
}

/** A block as (type, normalised text), a list item by its first line. */
function signatureOf(doc: Doc, start: number): string {
    const block = detectBlock(doc, start, { tabSize }) as Block;
    const text =
        block.type === BlockType.ListItem
            ? norm(doc.line(start).text)
            : Array.from({ length: block.lines.endLine - start + 1 }, (_, i) => norm(doc.line(start + i).text)).join(
                  '/',
              );
    return `${block.type}:${text}`;
}

/** Every block as signatureOf: merging or splitting a callout, quote or fence changes it. */
function blockSignature(doc: Doc): string[] {
    return blockStarts(doc)
        .map((start) => signatureOf(doc, start))
        .sort();
}

/** A list line's marker (bullet with an optional checkbox, or number and delimiter) and the spaces after it. */
const LIST_MARKER = /^\s*([-*+](\s+\[[ xX]\])?|\d+[.)])\s+/;

/** The text a payload line keeps as a list item, normalised: no quote prefix, no heading marker; empty for none. */
function itemBody(line: string): string {
    return norm(line.replace(/^\s*(>\s*)*/, '').replace(/^#{1,6}\s+/, ''));
}

/** A list line's text after its marker, normalised; null for a line that is no list line. */
function listBody(line: string): string | null {
    return LIST_MARKER.test(line) ? norm(line.replace(LIST_MARKER, '')) : null;
}

/** What makes two list lines items of one list: an ordered number, or the bullet character and checkbox. */
function markerKey(line: string): string {
    const marker = (line.match(LIST_MARKER) as RegExpMatchArray)[1];
    return /^\d/.test(marker) ? 'ordered' : `${marker[0]}${marker.length > 1 ? ' [ ]' : ''}`;
}

function indentOf(line: string): number {
    return line.replace(/\t/g, ' '.repeat(tabSize)).search(/\S|$/);
}

/**
 * Items a drop converted (outLines[start] … outLines[end]) carry the marker of the list they join, read on the
 * output: the nearest item at their indent above or below them in that list, or the parent's when it has no other
 * item; and they sit one level under the parent, or at the root.
 */
function convertedItems(outLines: string[], start: number, end: number, parentText: string | null): string[] {
    const found: string[] = [];
    const indent = parentText === null ? 0 : indentOf(parentText) + indentUnit;
    const sibling = (from: number, step: 1 | -1): string | null => {
        for (let i = from; i >= 0 && i < outLines.length; i += step) {
            const line = outLines[i];
            if (!line.trim()) continue;
            if (/^\s*>/.test(line) || indentOf(line) < indent) return null;
            if (indentOf(line) === indent) return LIST_MARKER.test(line) ? line : null;
        }
        return null;
    };
    const near = [sibling(start - 1, -1), sibling(end + 1, 1)].filter((line): line is string => line !== null);
    const expected = near.length > 0 ? near.map(markerKey) : parentText !== null ? [markerKey(parentText)] : [];
    for (let i = start; i <= end; i++) {
        const line = outLines[i];
        if (indentOf(line) !== indent) found.push(`converted item at indent ${indentOf(line)}, not ${indent}: ${line}`);
        if (expected.length > 0 && !expected.includes(markerKey(line)))
            found.push(`converted item ${JSON.stringify(line)} joins a list of ${expected.join(' or ')}`);
    }
    return found;
}

/** Quote lines that start a quote with four spaces or more after their `>`: indented code inside a new quote. */
function quotedCode(text: string): string[] {
    const lines = text.split('\n');
    return lines.filter((line, i) => /^\s*> ?\s{4,}\S/.test(line) && (i === 0 || !/^\s*>/.test(lines[i - 1])));
}

/** The longest run of blank lines between two non-blank lines (padding at the edges is not counted). */
function longestSeparator(text: string): number {
    let longest = 0;
    let run = -1;
    for (const line of text.split('\n')) {
        if (line.trim()) {
            if (run > longest) longest = run;
            run = 0;
        } else if (run >= 0) {
            run++;
        }
    }
    return longest;
}

function contentOf(text: string): string[] {
    return text
        .split('\n')
        .filter((line) => line.trim())
        .map(norm)
        .sort();
}

function pairsOf(text: string): string[] {
    const lines = text.split('\n');
    return lines.slice(1).map((line, i) => `${norm(lines[i])}|${norm(line)}`);
}

/** Non-blank lines of the given ranges, normalised. */
function linesIn(doc: Doc, ranges: { startLine: number; endLine: number }[]): string[] {
    const out: string[] = [];
    for (const { startLine, endLine } of ranges) {
        for (let line = startLine; line <= endLine; line++) {
            if (doc.line(line).text.trim()) out.push(norm(doc.line(line).text));
        }
    }
    return out;
}

/** `all` without one occurrence of each of `removed`, sorted. */
function without(all: string[], removed: string[]): string[] {
    const rest = [...all];
    for (const line of removed) rest.splice(rest.indexOf(line), 1);
    return rest.sort();
}

/** Line of each normalised non-blank text (lines are unique within a page). */
function lineOfText(doc: Doc): Map<string, number> {
    const at = new Map<string, number>();
    for (let line = 1; line <= doc.lines; line++)
        if (doc.line(line).text.trim()) at.set(norm(doc.line(line).text), line);
    return at;
}

/** Untouched paragraphs and quotes do not split: two adjacent lines of one, neither moved, stay adjacent unless the
 * moved block now sits between them. */
function splitParagraphs(doc: Doc, out: Doc, segments: { startLine: number; endLine: number }[]): string[] {
    const found: string[] = [];
    const lineMap = getLineMap(doc, { tabSize });
    const moved = new Set(linesIn(doc, segments));
    const at = lineOfText(out);
    for (let line = frontmatterEndLine(doc) + 1; line < doc.lines; line++) {
        const [u, l] = [doc.line(line).text, doc.line(line + 1).text];
        if (!u.trim() || !l.trim() || moved.has(norm(u)) || moved.has(norm(l))) continue;
        const kind = runKind(doc, line, { lineMap, tabSize });
        if (kind === null || kind === 'list' || kind !== runKind(doc, line + 1, { lineMap, tabSize })) continue;
        const [ou, ol] = [at.get(norm(u)), at.get(norm(l))];
        if (ou === undefined || ol === undefined || ol === ou + 1) continue;
        const between: string[] = [];
        for (let i = ou + 1; i < ol; i++) if (out.line(i).text.trim()) between.push(norm(out.line(i).text));
        if (between.length === 0 || between.some((t) => !moved.has(t))) found.push(`split ${JSON.stringify([u, l])}`);
    }
    return found;
}

/** No list turns loose or tight where nothing joined it: two adjacent sibling items, neither moved, keep the blank
 * lines between them while they stay adjacent siblings with no moved line between them (one inside the first
 * item's subtree joins that list). */
function relooseLists(doc: Doc, out: Doc, segments: { startLine: number; endLine: number }[]): string[] {
    const found: string[] = [];
    const moved = new Set(linesIn(doc, segments));
    const siblings = (d: Doc) => {
        const lineMap = getLineMap(d, { tabSize });
        const pairs = new Map<string, { blanks: number; inside: string[] }>();
        for (const head of listHeads(d)) {
            const end = lineMap.listSubtreeEndLine[head];
            const next = end < d.lines ? lineMap.nextNonEmpty[end + 1] : 0;
            if (
                next > 0 &&
                lineMap.lineMeta[next].isList &&
                lineMap.listParentLine[next] === lineMap.listParentLine[head]
            ) {
                const inside = linesIn(d, [{ startLine: head + 1, endLine: next - 1 }]);
                pairs.set(`${norm(d.line(head).text)}|${norm(d.line(next).text)}`, { blanks: next - end - 1, inside });
            }
        }
        return pairs;
    };
    const after = siblings(out);
    for (const [pair, { blanks }] of siblings(doc)) {
        const [h, q] = pair.split('|');
        const now = after.get(pair);
        if (moved.has(h) || moved.has(q) || !now || now.inside.some((line) => moved.has(line))) continue;
        if (now.blanks !== blanks) found.push(`list spacing changed ${pair}: ${blanks} → ${now.blanks}`);
    }
    return found;
}

/**
 * A moved list item takes the spacing of the list it joins, per side: next to one sibling, the blank lines
 * that list has between its items there; between two siblings, the gap's own. A side may rise from 0 to 1 where the
 * two lines need a blank line.
 */
function joinedListSpacing(out: Doc, head: number, last: number, gapBlanks: number): string[] {
    const lineMap = getLineMap(out, { tabSize });
    const parent = lineMap.listParentLine[head];
    const sibling = (line: number) => (line > 0 ? listItemContaining(lineMap, line, parent) : null);
    const before = head > 1 ? lineMap.prevNonEmpty[head - 1] : 0;
    const previous = sibling(before);
    // Measured from the payload's own last line: a root item dropped above an item's children adopts them.
    const end = last;
    const after = end < out.lines ? lineMap.nextNonEmpty[end + 1] : 0;
    const next = after > 0 && sibling(after) === after ? after : null;
    const blanksTo = (upper: number, lower: number) => lower - upper - 1;
    const raised = (upper: number, lower: number) =>
        needsBlankLine(facingAt(out, upper, { tabSize }), facingAt(out, lower, { tabSize }));
    const check = (upper: number, lower: number, expected: number) =>
        blanksTo(upper, lower) === expected || (expected === 0 && blanksTo(upper, lower) === 1 && raised(upper, lower))
            ? []
            : [
                  `joined list spacing ${JSON.stringify([out.line(upper).text, out.line(lower).text])}: ${blanksTo(upper, lower)}, list has ${expected}`,
              ];
    if (previous !== null && next !== null) return [...check(before, head, gapBlanks), ...check(end, next, gapBlanks)];
    if (previous !== null) {
        const ahead = previous > 1 ? lineMap.prevNonEmpty[previous - 1] : 0;
        return check(before, head, sibling(ahead) !== null ? blanksTo(ahead, previous) : 0);
    }
    if (next !== null) {
        const nextEnd = lineMap.listSubtreeEndLine[next];
        const beyond = nextEnd < out.lines ? lineMap.nextNonEmpty[nextEnd + 1] : 0;
        return check(end, next, beyond > 0 && sibling(beyond) === beyond ? blanksTo(nextEnd, beyond) : 0);
    }
    return [];
}

/** The nearest non-blank output line from `index` in `step` direction, normalised; null past an edge or into frontmatter. */
function neighbour(lines: string[], index: number, step: 1 | -1, frontmatterEnd: number): string | null {
    for (let i = index + step; i >= 0 && i < lines.length; i += step) {
        if (i < frontmatterEnd) return null;
        if (lines[i].trim()) return norm(lines[i]);
    }
    return null;
}

type Outcome = { ok: number; problems: string[]; converted?: number };

/**
 * Move the blocks at `fromLines` to `position` (built on the parsed page)
 * and check the result. `contentOnly` checks only that no line is lost,
 * duplicated or misnumbered, for drop parents the pointer never produces.
 */
function sweepMove(
    name: string,
    text: string,
    fromLines: number[],
    position: (doc: Doc, selection: ReturnType<typeof selectBlocks>) => DropPosition,
    outcome: Outcome,
    contentOnly = false,
): void {
    const doc = stringDoc(text);
    const blocks = fromLines.map((line) => detectBlock(doc, line, { tabSize }) as Block);
    const selection = selectBlocks(blocks);
    const at = position(doc, selection);
    const where = `${name} [${fromLines}] → ${at.line}${at.parent ? ` under ${at.parent.lines.startLine}` : ''}`;
    const planned = planMove({ sourceDoc: doc, selection, position: at, tabSize, indentUnit });
    if (planned.type !== 'ok') return;
    let edits: ReturnType<typeof moveTx>;
    try {
        edits = moveTx({ sourceDoc: doc, plan: planned.value });
    } catch (e) {
        outcome.problems.push(`${where}: moveTx threw ${(e as Error).message}`);
        return;
    }
    if (!Array.isArray(edits)) {
        outcome.problems.push(`${where}: moveTx rejected ${edits.reason}`);
        return;
    }
    outcome.ok++;
    const out = applyEdits(text, edits);
    const outDoc = stringDoc(out);
    const { gap, captured, allowIndent, asItems } = planned.value;
    // A payload a list turns into items lands as one list line per line with text, matched by the text after the
    // marker; everything else lands as it was.
    const converted = asItems !== null;
    const payload = converted
        ? captured.content.split('\n').map(itemBody).filter(Boolean)
        : captured.content.split('\n').map(norm);
    const lineKey = (line: string) => (converted ? listBody(line) : norm(line));
    if (converted) outcome.converted = (outcome.converted ?? 0) + 1;
    const sourceLines = linesIn(doc, captured.segments);
    const origins = originsOf([doc], sourceLines);
    const problems: string[] = [];
    const outLines = out.split('\n');
    const parent = planned.value.position.parent;
    const parentText = parent ? doc.line(parent.lines.startLine).text : null;
    // Where a conversion landed, by its text alone: content and blocks are then checked with the written markers.
    const landedAt = converted
        ? outLines.findIndex((_, i) => payload.every((p, j) => listBody(outLines[i + j] ?? '') === p))
        : -1;
    const landed = landedAt >= 0 ? outLines.slice(landedAt, landedAt + payload.length).map(norm) : [];
    if (converted && landedAt < 0) problems.push('converted items not found');

    const content = converted ? [...without(contentOf(text), sourceLines), ...landed].sort() : contentOf(text);
    if (contentOf(out).join('\n') !== content.join('\n')) problems.push('content changed');
    problems.push(...numbering(outDoc, origins));
    if (!contentOnly) {
        if (landedAt >= 0)
            problems.push(...convertedItems(outLines, landedAt, landedAt + payload.length - 1, parentText));
        const code = new Set(quotedCode(text));
        for (const line of quotedCode(out)) if (!code.has(line)) problems.push(`indented code in a quote: ${line}`);
        if (longestSeparator(out) > Math.max(1, longestSeparator(text))) problems.push('double blank line');
        if (frontmatterEndLine(outDoc) !== frontmatterEndLine(doc)) problems.push('frontmatter changed');
        const blocksAfter = asItems
            ? [
                  ...without(
                      blockSignature(doc),
                      blocks.map((block) => signatureOf(doc, block.lines.startLine)),
                  ),
                  ...landed.map((line) => `${BlockType.ListItem}:${line}`),
              ].sort()
            : blockSignature(doc);
        if (blockSignature(outDoc).join('\n') !== blocksAfter.join('\n')) problems.push('blocks merged or split');
        problems.push(...hazards(outDoc, origins, new Set(pairsOf(text))));

        // The payload lands in the indicated gap: between that gap's surviving neighbours.
        // (An in-place list indent change stays where it is.)
        const removed = (line: number) => captured.segments.some((s) => line >= s.startLine && line <= s.endLine);
        let aboveLine = gap.above ? gap.seam - gap.blankLines - 1 : 0;
        while (aboveLine > frontmatterEndLine(doc) && (removed(aboveLine) || !doc.line(aboveLine).text.trim()))
            aboveLine--;
        const expectedAbove = aboveLine > frontmatterEndLine(doc) ? norm(doc.line(aboveLine).text) : null;
        let belowLine = gap.below ? gap.seam : doc.lines + 1;
        while (belowLine <= doc.lines && (removed(belowLine) || !doc.line(belowLine).text.trim())) belowLine++;
        const expectedBelow = belowLine <= doc.lines ? norm(doc.line(belowLine).text) : null;
        const fm = frontmatterEndLine(outDoc);
        const start = outLines.findIndex(
            (_, i) =>
                payload.every((p, j) => lineKey(outLines[i + j] ?? '\u0000') === p) &&
                neighbour(outLines, i, -1, fm) === expectedAbove &&
                neighbour(outLines, i + payload.length - 1, 1, fm) === expectedBelow,
        );
        if (start < 0 && !allowIndent) problems.push('not in the indicated gap');

        problems.push(
            ...splitParagraphs(doc, outDoc, captured.segments),
            ...relooseLists(doc, outDoc, captured.segments),
        );
        // A root item dropped between an item and its children adopts them, as before: not a list it joins at an edge.
        const lineMap = getLineMap(doc, { tabSize });
        const parentLine = planned.value.position.parent?.lines.startLine ?? 0;
        const host =
            gap.above && gap.below ? listItemContaining(lineMap, gap.seam - gap.blankLines - 1, parentLine) : null;
        const adopts = host !== null && lineMap.listSubtreeEndLine[host] >= gap.seam;
        const items = asItems !== null || (fromLines.length === 1 && blocks[0].type === BlockType.ListItem);
        if (start >= 0 && !allowIndent && !adopts && items) {
            problems.push(...joinedListSpacing(outDoc, start + 1, start + payload.length, gap.blankLines));
        }
    }

    for (const p of problems) outcome.problems.push(`${where}: ${p} :: ${JSON.stringify(out)}`);
}

/** A drop at a raw seam, with a given parent (or at the root). */
const atSeam =
    (seam: number, parentLine: number | null = null) =>
    (doc: Doc): DropPosition => ({
        doc,
        line: seam,
        parent: parentLine === null ? null : (detectBlock(doc, parentLine, { tabSize }) as Block),
    });

/** A drop where the pointer puts it: the seam's gap, nesting at `targetIndentWidth` as far as the structure allows. */
const byPointer =
    (seam: number, targetIndentWidth: number) =>
    (doc: Doc, selection: ReturnType<typeof selectBlocks>): DropPosition => {
        const first = selection.blocks[0];
        const sourceIndentWidth =
            first.type === BlockType.ListItem
                ? parseLine(doc.line(first.lines.startLine).text, tabSize).indent.width
                : 0;
        return locateDropPosition({
            doc,
            sourceDoc: doc,
            selection,
            hitLine: seam,
            belowMid: false,
            sourceIndentWidth,
            targetIndentWidth,
            tabSize,
            indentUnit,
        });
    };

function sweepCross(
    names: string,
    sourceText: string,
    targetText: string,
    fromLines: number[],
    rawSeam: number,
    outcome: Outcome,
) {
    const sourceDoc = stringDoc(sourceText);
    const targetDoc = stringDoc(targetText);
    const blocks = fromLines.map((line) => detectBlock(sourceDoc, line, { tabSize }) as Block);
    const planned = planMove({
        sourceDoc,
        selection: selectBlocks(blocks),
        position: { doc: targetDoc, line: rawSeam, parent: null },
        tabSize,
        indentUnit,
    });
    if (planned.type !== 'ok') return;
    const where = `${names} [${fromLines}] → ${rawSeam}`;
    const edits = moveTx({ sourceDoc, plan: planned.value });
    if (!Array.isArray(edits)) {
        outcome.problems.push(`${where}: moveTx rejected ${edits.reason}`);
        return;
    }
    outcome.ok++;
    const targetOut = applyEdits(
        targetText,
        edits.filter((e) => e.doc === targetDoc),
    );
    const sourceOut = applyEdits(
        sourceText,
        edits.filter((e) => e.doc === sourceDoc),
    );
    const problems: string[] = [];
    const { captured, asItems } = planned.value;
    const moved = linesIn(sourceDoc, captured.segments);
    const sortedJoin = (lines: string[]) => [...lines].sort().join('\n');
    // Converted items are compared by their text after the marker.
    const bodies = (text: string) =>
        text
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => listBody(line) ?? norm(line));
    const targetChanged = asItems
        ? sortedJoin(bodies(targetOut)) !==
          sortedJoin([...bodies(targetText), ...captured.content.split('\n').map(itemBody).filter(Boolean)])
        : sortedJoin(contentOf(targetOut)) !== sortedJoin([...contentOf(targetText), ...moved]);
    if (targetChanged) problems.push('target content changed');
    if (sortedJoin(contentOf(sourceOut)) !== sortedJoin(without(contentOf(sourceText), moved)))
        problems.push('source content changed');
    for (const [before, after, label] of [
        [targetText, targetOut, 'target'],
        [sourceText, sourceOut, 'source'],
    ]) {
        if (longestSeparator(after) > Math.max(1, longestSeparator(before)))
            problems.push(`double blank line in ${label}`);
        if (frontmatterEndLine(stringDoc(after)) !== frontmatterEndLine(stringDoc(before)))
            problems.push(`frontmatter changed in ${label}`);
    }
    const before = new Set([...pairsOf(sourceText), ...pairsOf(targetText)]);
    const origins = originsOf([sourceDoc, targetDoc], moved);
    for (const out of [targetOut, sourceOut]) {
        problems.push(...hazards(stringDoc(out), origins, before), ...numbering(stringDoc(out), origins));
    }
    for (const p of problems) outcome.problems.push(`${where}: ${p} :: ${JSON.stringify([targetOut, sourceOut])}`);
}

function sweepDelete(name: string, text: string, lines: number[], outcome: Outcome): void {
    const doc = stringDoc(text);
    const blocks = lines.map((line) => detectBlock(doc, line, { tabSize }) as Block);
    const result = planDelete({ doc, selection: selectBlocks(blocks), tabSize });
    const where = `${name} delete [${lines}]`;
    if ('type' in result) {
        if (result.reason !== 'frontmatter_fence') outcome.problems.push(`${where}: rejected ${result.reason}`);
        return;
    }
    outcome.ok++;
    const out = applyEdits(text, [result]);
    const outDoc = stringDoc(out);
    // The union of the selected blocks: a selected block can contain another.
    const deleted = linesIn(
        doc,
        mergeLineRanges(
            doc.lines,
            blocks.map((b) => b.lines),
        ),
    );
    const problems: string[] = [];
    if (contentOf(out).join('\n') !== without(contentOf(text), deleted).join('\n')) problems.push('content changed');
    if (longestSeparator(out) > Math.max(1, longestSeparator(text))) problems.push('double blank line');
    if (frontmatterEndLine(outDoc) !== frontmatterEndLine(doc)) problems.push('frontmatter changed');
    const origins = originsOf([doc], deleted);
    problems.push(...hazards(outDoc, origins, new Set(pairsOf(text))), ...numbering(outDoc, origins));
    for (const p of problems) outcome.problems.push(`${where}: ${p} :: ${JSON.stringify(out)}`);
}

describe('moveTx invariant sweep', () => {
    it.each(Object.entries(PAGES))('moves every block of the %s page to every seam safely', (name, text) => {
        const doc = stringDoc(text);
        const outcome: Outcome = { ok: 0, problems: [] };
        for (const start of blockStarts(doc)) {
            for (let seam = 1; seam <= doc.lines + 1; seam++) sweepMove(name, text, [start], atSeam(seam), outcome);
        }
        expect(outcome.problems).toEqual([]);
        expect(outcome.ok).toBeGreaterThan(20);
    });

    it.each(Object.entries(PAGES))('moves every pair of blocks of the %s page to every seam safely', (name, text) => {
        const doc = stringDoc(text);
        const starts = blockStarts(doc);
        const outcome: Outcome = { ok: 0, problems: [] };
        for (let i = 0; i < starts.length; i++) {
            for (let j = i + 1; j < starts.length; j++) {
                for (let seam = 1; seam <= doc.lines + 1; seam++) {
                    sweepMove(name, text, [starts[i], starts[j]], atSeam(seam), outcome);
                }
            }
        }
        expect(outcome.problems).toEqual([]);
        expect(outcome.ok).toBeGreaterThan(20);
    });

    it.each(Object.entries(PAGES).filter(([, text]) => listHeads(stringDoc(text)).length > 0))(
        'nests and outdents every list item of the %s page where the pointer puts it',
        (name, text) => {
            const doc = stringDoc(text);
            const outcome: Outcome = { ok: 0, problems: [] };
            for (const start of listHeads(doc)) {
                for (let seam = 1; seam <= doc.lines + 1; seam++) {
                    for (const indent of [0, indentUnit, 2 * indentUnit]) {
                        sweepMove(name, text, [start], byPointer(seam, indent), outcome);
                    }
                }
            }
            expect(outcome.problems).toEqual([]);
            expect(outcome.ok).toBeGreaterThan(5);
        },
    );

    const convertible = (doc: Doc) =>
        blockStarts(doc).filter((start) => {
            const block = detectBlock(doc, start, { tabSize }) as Block;
            const content = doc.sliceString(doc.line(start).from, doc.line(block.lines.endLine).to);
            return convertsToItems({ blocks: [block], content }, tabSize);
        });
    it.each(
        Object.entries(PAGES).filter(
            ([, text]) => listHeads(stringDoc(text)).length > 0 && convertible(stringDoc(text)).length > 0,
        ),
    )(
        'turns every paragraph, heading and quote of the %s page into list items where the pointer puts it',
        (name, text) => {
            const doc = stringDoc(text);
            const outcome: Outcome = { ok: 0, problems: [] };
            for (const start of convertible(doc)) {
                for (let seam = 1; seam <= doc.lines + 1; seam++) {
                    for (const indent of [0, indentUnit, 2 * indentUnit]) {
                        sweepMove(name, text, [start], byPointer(seam, indent), outcome);
                    }
                }
            }
            expect(outcome.problems).toEqual([]);
            expect(outcome.converted).toBeGreaterThan(0);
        },
    );

    it.each(LIST_PAGES)(
        'nests and outdents every pair of list items of the %s page where the pointer puts it',
        (name) => {
            const text = PAGES[name];
            const doc = stringDoc(text);
            const heads = listHeads(doc);
            const outcome: Outcome = { ok: 0, problems: [] };
            for (let i = 0; i < heads.length; i++) {
                for (let j = i + 1; j < heads.length; j++) {
                    for (let seam = 1; seam <= doc.lines + 1; seam++) {
                        for (const indent of [0, indentUnit, 2 * indentUnit]) {
                            sweepMove(name, text, [heads[i], heads[j]], byPointer(seam, indent), outcome);
                        }
                    }
                }
            }
            expect(outcome.problems).toEqual([]);
            expect(outcome.ok).toBeGreaterThan(20);
        },
    );

    it.each(Object.entries(PAGES).filter(([, text]) => listHeads(stringDoc(text)).length > 0))(
        'moves every block of the %s page under every list item without losing a line',
        (name, text) => {
            const doc = stringDoc(text);
            const outcome: Outcome = { ok: 0, problems: [] };
            for (const start of blockStarts(doc)) {
                const block = detectBlock(doc, start, { tabSize }) as Block;
                for (const head of listHeads(doc)) {
                    if (head >= block.lines.startLine && head <= block.lines.endLine) continue;
                    for (let seam = 1; seam <= doc.lines + 1; seam++) {
                        sweepMove(name, text, [start], atSeam(seam, head), outcome, true);
                    }
                }
            }
            expect(outcome.problems).toEqual([]);
            expect(outcome.ok).toBeGreaterThan(5);
        },
    );

    it.each([
        ['callouts', 'pair'],
        ['edges', 'loose'],
        ['loose', 'tight'],
        ['tight', 'mixed'],
        ['rules', 'headings'],
        ['lists', 'callouts'],
    ])('moves every block of the %s page to every seam of the %s page safely', (from, to) => {
        const sourceText = PAGES[from];
        const sourceDoc = stringDoc(sourceText);
        const outcome: Outcome = { ok: 0, problems: [] };
        for (const target of [PAGES[to], '', '\n\n', '---\nt: x\n---\n']) {
            const lines = stringDoc(target).lines;
            for (const start of blockStarts(sourceDoc)) {
                for (let seam = 1; seam <= lines + 1; seam++) {
                    sweepCross(`${from}→${to}`, sourceText, target, [start], seam, outcome);
                }
            }
        }
        expect(outcome.problems).toEqual([]);
        expect(outcome.ok).toBeGreaterThan(20);
    });

    it.each(Object.keys(PAGES))(
        'moves every pair of blocks of the %s page into an empty or blank note safely',
        (name) => {
            const sourceText = PAGES[name];
            const starts = blockStarts(stringDoc(sourceText));
            const outcome: Outcome = { ok: 0, problems: [] };
            for (const target of ['', '\n\n', '---\nt: x\n---\n']) {
                const seams = stringDoc(target).lines + 1;
                for (let i = 0; i < starts.length; i++) {
                    for (let j = i + 1; j < starts.length; j++) {
                        for (let seam = 1; seam <= seams; seam++) {
                            sweepCross(
                                `${name}→${JSON.stringify(target)}`,
                                sourceText,
                                target,
                                [starts[i], starts[j]],
                                seam,
                                outcome,
                            );
                        }
                    }
                }
            }
            expect(outcome.problems).toEqual([]);
            expect(outcome.ok).toBeGreaterThan(5);
        },
    );

    it.each(Object.entries(PAGES))('deletes every block and pair of blocks of the %s page safely', (name, text) => {
        const starts = blockStarts(stringDoc(text));
        const outcome: Outcome = { ok: 0, problems: [] };
        for (let i = 0; i < starts.length; i++) {
            sweepDelete(name, text, [starts[i]], outcome);
            for (let j = i + 1; j < starts.length; j++) sweepDelete(name, text, [starts[i], starts[j]], outcome);
        }
        expect(outcome.problems).toEqual([]);
        expect(outcome.ok).toBeGreaterThan(2);
    });
});
