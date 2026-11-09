import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { detectBlock, locateDropPosition, selectOne } from '../../domain';
import type { PipelineOutput } from '../../runtime';
import { dropSeamDecoration } from './decoration';

const tabSize = 4;
const indentUnit = 4;

/** The line and classes of the drop indicator painted for a pointer at `hitLine` (lower half when `belowMid`). */
function paint(text: string, source: number, hitLine: number, belowMid: boolean): { line: number; classes: string } {
    const state = EditorState.create({ doc: text });
    const block = detectBlock(state.doc, source, { tabSize });
    if (!block) throw new Error('no block');
    const selection = selectOne(block);
    const position = locateDropPosition({
        doc: state.doc,
        selection,
        hitLine,
        belowMid,
        sourceIndentWidth: 0,
        targetIndentWidth: 0,
        tabSize,
        indentUnit,
    });
    const outputs: PipelineOutput[] = [
        {
            type: 'drag_over',
            selection,
            drop: { position, rejectReason: null },
            sourceDoc: state.doc,
            pointerType: null,
        },
    ];
    const painted: { line: number; classes: string }[] = [];
    dropSeamDecoration(outputs, state).between(0, state.doc.length, (from, _to, deco) => {
        painted.push({ line: state.doc.lineAt(from).number, classes: String(deco.spec.class) });
    });
    if (painted.length !== 1) throw new Error(`painted ${painted.length} rows`);
    return painted[0];
}

describe('adapter/codemirror drop seam decoration', () => {
    const text = 'x\n\na\nb\n\ny';

    it('paints the effective zone of a line payload where the line lands', () => {
        expect(paint(text, 4, 3, false)).toEqual({ line: 3, classes: 'md-dragger-drop-seam md-dragger-drop-seam-top' });
        expect(paint(text, 4, 1, true)).toEqual({
            line: 1,
            classes: 'md-dragger-drop-seam md-dragger-drop-seam-below',
        });
        expect(paint(text, 4, 2, false)).toEqual({
            line: 2,
            classes: 'md-dragger-drop-seam md-dragger-drop-seam-center',
        });
    });

    it('paints a join that does not apply apart, centred on the blank lines', () => {
        expect(paint('a\nb\n\n> q\n> r', 2, 4, false)).toEqual({
            line: 3,
            classes: 'md-dragger-drop-seam md-dragger-drop-seam-center',
        });
    });

    it('paints apart between two blank lines on the bottom of the first', () => {
        expect(paint('x\n\n\na\nb', 5, 2, false)).toEqual({
            line: 2,
            classes: 'md-dragger-drop-seam md-dragger-drop-seam-below',
        });
    });

    it('paints a standalone payload on the gap’s last blank line, as before', () => {
        const callouts = 'x\n\n> [!note] A\n> a\n\n> [!note] B\n> b\n\ny';
        expect(paint(callouts, 3, 6, false)).toEqual({
            line: 5,
            classes: 'md-dragger-drop-seam md-dragger-drop-seam-below',
        });
        expect(paint(callouts, 3, 5, false)).toEqual({
            line: 5,
            classes: 'md-dragger-drop-seam md-dragger-drop-seam-below',
        });
    });
});
