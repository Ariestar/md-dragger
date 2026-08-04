import { EditorState, Facet, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView } from '@codemirror/view';
import { type DropPosition, parseLine, selectionLineRanges } from '../../domain';
import { dropSeamState, type PipelineOutput, selectionFromOutputs } from '../../runtime';
import type { CodeMirrorGeometryOptions } from './config';
import { dropSeam } from './geometry';

// Render protocol between the adapter and hosts: hosts style these classes /
// CSS variables in their stylesheet; the adapter owns the names so the
// decoration structure lives here, not re-derived per host.
export const DROP_SEAM_CLASS = 'md-dragger-drop-seam';
export const DROP_SEAM_TOP_CLASS = 'md-dragger-drop-seam-top';
export const DROP_SEAM_BELOW_CLASS = 'md-dragger-drop-seam-below';
export const INVALID_CLASS = 'is-invalid';
export const DRAG_SOURCE_LINE_CLASS = 'md-dragger-drag-source';
export const SOURCE_LEVEL_STYLE_VAR = '--d-source-level';

// mdDragger registers its config.listIndentUnit here; decoration derivation
// (nesting level) reads it from state, so hosts never pass it around.
export const listIndentUnitFacet = Facet.define<number, number>({
    combine: (values) => values[values.length - 1],
});

/** Nesting level of a list line (engine parseLine); non-list rows have none. */
export function sourceListLevel(lineText: string, tabSize: number, indentUnit: number): number {
    const parsed = parseLine(lineText, tabSize);
    if (parsed.marker?.kind !== 'list' || parsed.quote.prefix.length > 0) return 0;
    return Math.round(parsed.indent.width / indentUnit);
}

/** Source-highlight line decorations derived from one engine output batch:
 * the selected rows, each carrying its nesting level so the host can leave
 * the nesting gap on the left. */
export function sourceHighlightDecoration(outputs: readonly PipelineOutput[], state: EditorState): DecorationSet {
    const selection = selectionFromOutputs(outputs);
    if (selection === null) return Decoration.none;
    const tabSize = state.facet(EditorState.tabSize);
    const indentUnit = state.facet(listIndentUnitFacet);
    // The facet is the single source of the nesting step; an unregistered
    // facet would silently produce NaN levels, so fail explicitly instead.
    if (!(indentUnit > 0)) {
        throw new Error(
            'mdDragger: listIndentUnitFacet is not configured — mdDragger() registers it; when composing ' +
                'manually, add listIndentUnitFacet.of(config.listIndentUnit) to the extension array',
        );
    }
    const decorations: Range<Decoration>[] = [];
    for (const range of selectionLineRanges(state.doc.lines, selection)) {
        for (let line = range.startLine; line <= range.endLine; line++) {
            if (line < 1 || line > state.doc.lines) continue;
            decorations.push(
                Decoration.line({
                    class: DRAG_SOURCE_LINE_CLASS,
                    attributes: {
                        style: `${SOURCE_LEVEL_STYLE_VAR}: ${sourceListLevel(state.doc.line(line).text, tabSize, indentUnit)}`,
                    },
                }).range(state.doc.line(line).from),
            );
        }
    }
    return Decoration.set(decorations);
}

/** Drop-seam line decoration derived from one engine output batch: on the
 * seam row (above the first line, or below the previous line), marked
 * invalid when the drop is rejected. */
export function dropSeamDecoration(outputs: readonly PipelineOutput[], state: EditorState): DecorationSet {
    const { position, invalid } = dropSeamState(outputs, state.doc);
    if (position === null) return Decoration.none;
    const top = position.line <= 1;
    const seamRow = top ? 1 : Math.min(position.line - 1, state.doc.lines);
    return Decoration.set([
        Decoration.line({
            class: `${DROP_SEAM_CLASS} ${top ? DROP_SEAM_TOP_CLASS : DROP_SEAM_BELOW_CLASS}${invalid ? ` ${INVALID_CLASS}` : ''}`,
        }).range(state.doc.line(seamRow).from),
    ]);
}

/** The seam rect relative to the content edge, in px — dropSeam viewport
 * geometry minus the content's own left. Scroll-independent; null when the
 * target line is not measurable. */
export function seamOffset(
    view: EditorView,
    position: DropPosition,
    options: CodeMirrorGeometryOptions,
): { left: number; width: number } | null {
    const seam = dropSeam(view, position, options);
    if (!seam) return null;
    const contentLeft = view.contentDOM.getBoundingClientRect().left;
    return {
        left: Math.max(0, seam.left - contentLeft),
        width: Math.max(0, seam.right - seam.left),
    };
}
