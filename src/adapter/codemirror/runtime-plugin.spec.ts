import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import type { DropPosition } from '../../domain/command/drop-position';
import { stringDoc } from '../../domain/transaction/string-doc';
import { resolveCommitOptions, resolveExternalTargetOptions, resolveUxOptions } from './config';
import { resolveDropPositionWithExternalTarget } from './runtime-plugin';

describe('CodeMirror host option resolution', () => {
    it('resolves UX and external-target factories against the live view', () => {
        const view = {} as EditorView;
        const uxFactory = vi.fn(() => ({ selectionFromInput: () => null }));
        const targetFactory = vi.fn(() => ({ resolveDropPosition: () => undefined }));

        expect(resolveUxOptions(uxFactory, view)).toBe(uxFactory.mock.results[0]?.value);
        expect(resolveExternalTargetOptions(targetFactory, view)).toBe(targetFactory.mock.results[0]?.value);
        expect(uxFactory).toHaveBeenCalledOnce();
        expect(targetFactory).toHaveBeenCalledOnce();
        expect(uxFactory).toHaveBeenCalledWith(view);
        expect(targetFactory).toHaveBeenCalledWith(view);
    });

    it('resolves a custom commit factory against the live view', () => {
        const view = {} as EditorView;
        const apply = vi.fn(async () => undefined);
        const commitFactory = vi.fn(() => ({ apply }));

        expect(resolveCommitOptions(commitFactory, view)?.apply).toBe(apply);
        expect(commitFactory).toHaveBeenCalledWith(view);
        expect(resolveCommitOptions(undefined, view)).toBeUndefined();
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
