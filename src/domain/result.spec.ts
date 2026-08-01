import { describe, expect, it } from 'vitest';
import { isReject, reject } from './result';

describe('domain/result', () => {
    it('reject builds a reject result with the given reason', () => {
        expect(reject('no_target')).toEqual({ type: 'reject', reason: 'no_target' });
    });

    it('isReject narrows reject-shaped values', () => {
        expect(isReject(reject('empty_selection'))).toBe(true);
        expect(isReject({ type: 'reject', reason: 'table_before' })).toBe(true);
    });

    it('isReject rejects non-reject values', () => {
        expect(isReject(null)).toBe(false);
        expect(isReject({ type: 'ok' })).toBe(false);
        expect(isReject('no_target')).toBe(false);
    });
});
