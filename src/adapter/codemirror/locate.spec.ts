import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { BlockType, detectBlock, listLevel as domainListLevel, snapDrop as domainSnap, selectOne } from '../../domain';
import { stringDoc } from '../../domain/transaction/string-doc';
import * as codeMirror from './index';
import { resolveDropPositionAtPoint, snapDrop } from './locate';
import { registerView, withPointerDocument } from './views';

const tabSize = 4;
const indentUnit = 4;

describe('adapter/codemirror locate', () => {
    it('re-exports snapDrop from domain', () => {
        expect(snapDrop).toBe(domainSnap);
    });

    it('preserves the public sourceListLevel name without wrapping the domain function', () => {
        expect(codeMirror.sourceListLevel).toBe(domainListLevel);
        expect(codeMirror.sourceListLevel('    - child', tabSize, indentUnit)).toBe(1);
    });

    it('resolves nested list drop position when dragging into an editor in another window', () => {
        const sourceDoc = stringDoc('- source item');
        const targetDoc = stringDoc('- target 1\n- target 2');
        const sourceBlock = detectBlock(sourceDoc, 1, { tabSize });
        if (!sourceBlock) throw new Error('missing block');
        const selection = selectOne(sourceBlock);

        const targetDocObj = {
            elementFromPoint: () => null,
        } as unknown as Document;

        const targetView = {
            dom: {
                ownerDocument: targetDocObj,
                contains: () => false,
                getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 200 }),
            },
            contentDOM: {
                getBoundingClientRect: () => ({ left: 40, top: 0, right: 400, bottom: 200 }),
            },
            state: {
                doc: targetDoc,
                facet: () => tabSize,
                lineAt: (pos: number) => targetDoc.lineAt(pos),
            },
            lineBlockAt: () => ({ top: 0, bottom: 20 }),
            posAtCoords: () => 1,
            documentTop: 0,
        } as unknown as EditorView;

        const unregister = registerView(targetView);
        try {
            const sourceDocObj = { elementFromPoint: () => null } as unknown as Document;
            const sourceView = {
                dom: { ownerDocument: sourceDocObj },
                state: {
                    doc: sourceDoc,
                    facet: () => tabSize,
                },
            } as unknown as EditorView;

            // Target content left is 40. listIndentWidthPx is 20.
            // Point at x: 65 is 25px right of contentLeft => 1 indent step!
            const position = withPointerDocument(targetDocObj, () =>
                resolveDropPositionAtPoint(sourceView, { x: 65, y: 15 }, selection, {
                    config: { tabSize, listIndentUnit: indentUnit },
                    listIndentWidthPx: 20,
                }),
            );

            expect(position).not.toBeNull();
            expect(position?.line).toBe(2);
            expect(position?.parent?.type).toBe(BlockType.ListItem);
            expect(position?.parent?.lines.startLine).toBe(1);
        } finally {
            unregister();
        }
    });
});
