import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import type { DropPosition } from '../../domain/command/drop-position';
import { stringDoc } from '../../domain/transaction/string-doc';
import { resolvePerView } from './config';
import { resolveDropPositionWithExternalTarget } from './runtime-plugin';

describe('CodeMirror host option resolution', () => {
    it('resolves a static value or a per-view factory against the live view', () => {
        const view = {} as EditorView;
        const factory = vi.fn(() => ({ apply: async () => undefined }));

        expect(resolvePerView(factory, view)?.apply).toBeDefined();
        expect(factory).toHaveBeenCalledOnce();
        expect(factory).toHaveBeenCalledWith(view);
        expect(resolvePerView(undefined, view)).toBeUndefined();
        expect(resolvePerView({ selectionFromInput: () => null }, view)).toEqual({
            selectionFromInput: expect.any(Function),
        });
    });
});

describe('resolveDropPositionWithExternalTarget', () => {
    const selection = { blocks: [] };
    const point = { x: 10, y: 20 };
    const defaultPosition: DropPosition = { doc: stringDoc('default'), line: 1, parent: null };
    const externalPosition: DropPosition = { doc: stringDoc('external'), line: 2, parent: null };

    it('falls through to normal CodeMirror resolution only on undefined', () => {
        const fallback = vi.fn(() => defaultPosition);

        expect(resolveDropPositionWithExternalTarget(() => undefined, fallback, point, { selection })).toBe(
            defaultPosition,
        );
        expect(fallback).toHaveBeenCalledOnce();
    });

    it('treats null as a handled invalid external target', () => {
        const fallback = vi.fn(() => defaultPosition);

        expect(resolveDropPositionWithExternalTarget(() => null, fallback, point, { selection })).toBeNull();
        expect(fallback).not.toHaveBeenCalled();
    });

    it('accepts a position whose document has no registered editor view', () => {
        const fallback = vi.fn(() => defaultPosition);

        expect(resolveDropPositionWithExternalTarget(() => externalPosition, fallback, point, { selection })).toBe(
            externalPosition,
        );
        expect(fallback).not.toHaveBeenCalled();
    });
});
