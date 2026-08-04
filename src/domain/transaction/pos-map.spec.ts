import { describe, expect, it } from 'vitest';
import { buildPosMapper } from './pos-map';

describe('domain/transaction buildPosMapper', () => {
    // original: "abcdefghijklmnop" (16 chars); delete [8,12) ("ijkl"),
    // insert "XY" at 2.
    const mapper = buildPosMapper(
        [
            { from: 2, to: 2, insert: 'XY' },
            { from: 8, to: 12, insert: '' },
        ],
        16,
    );

    it('maps original positions forward through insert and delete', () => {
        expect(mapper.forward(0)).toBe(0); // 'a' unchanged
        expect(mapper.forward(2)).toBe(4); // 'c' shifts past "XY"
        expect(mapper.forward(5)).toBe(7); // 'f' after insert, before delete
        expect(mapper.forward(8)).toBeNull(); // inside deleted range
        expect(mapper.forward(11)).toBeNull(); // inside deleted range
        expect(mapper.forward(12)).toBe(10); // 'm' after the delete
        expect(mapper.forward(16)).toBe(14); // doc end (16 - 4 + 2)
    });

    it('maps edited positions backward to the original doc', () => {
        expect(mapper.backward(0)).toBe(0);
        expect(mapper.backward(2)).toBe('insert'); // inside "XY"
        expect(mapper.backward(3)).toBe('insert');
        expect(mapper.backward(4)).toBe(2); // 'c' maps back before the insert
        expect(mapper.backward(12)).toBe(14); // 'o'
        expect(mapper.backward(14)).toBe(16); // doc end
    });

    it('maps through a replace as one change', () => {
        const r = buildPosMapper([{ from: 4, to: 6, insert: 'XYZ' }], 10);
        expect(r.forward(4)).toBeNull(); // start of replaced range
        expect(r.forward(5)).toBeNull();
        expect(r.forward(3)).toBe(3);
        expect(r.forward(6)).toBe(7); // first char after the replaced range
        expect(r.backward(3)).toBe(3);
        expect(r.backward(4)).toBe('insert');
        expect(r.backward(6)).toBe('insert');
        expect(r.backward(7)).toBe(6);
    });
});
