import { describe, expect, it } from 'vitest';
import { rebaseAppendChange } from './mutation';
import { stringDoc } from './transaction/string-doc';

describe('rebaseAppendChange', () => {
    it('rebases an append insertion without duplicating its newline separator', () => {
        const snapshot = stringDoc('target');
        const current = stringDoc('newer target text');

        expect(
            rebaseAppendChange(snapshot, { from: snapshot.length, to: snapshot.length, insert: '\nsource' }, current),
        ).toEqual({ pos: current.length, text: '\nsource' });
    });

    it('adds the separator when a formerly empty target now has content', () => {
        const snapshot = stringDoc('');
        const current = stringDoc('new content');

        expect(rebaseAppendChange(snapshot, { from: 0, to: 0, insert: 'source' }, current)).toEqual({
            pos: current.length,
            text: '\nsource',
        });
    });

    it('does not add a separator when the current document already ends with a newline', () => {
        const snapshot = stringDoc('target');
        const current = stringDoc('newer\n');

        expect(
            rebaseAppendChange(snapshot, { from: snapshot.length, to: snapshot.length, insert: '\nsource' }, current),
        ).toEqual({ pos: current.length, text: 'source' });
    });

    it('rejects changes that are not a pure end-of-document insertion', () => {
        const snapshot = stringDoc('target');
        const current = stringDoc('current');

        expect(rebaseAppendChange(snapshot, { from: 0, to: 1, insert: 'x' }, current)).toBeNull();
    });
});
