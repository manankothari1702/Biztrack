import { describe, expect, it } from 'vitest';
import { movementSkBounds } from './stockMovements';

// SK layout: STOCKMOVE#<createdAt>#<id>
const sk = (createdAt: string, id = 'mv_1') => `STOCKMOVE#${createdAt}#${id}`;

const within = (value: string, bounds: { lower: string; upper: string }) =>
    value >= bounds.lower && value <= bounds.upper;

describe('movementSkBounds', () => {
    it('is null when neither end is given — caller falls back to begins_with', () => {
        expect(movementSkBounds()).toBeNull();
        expect(movementSkBounds(undefined, undefined)).toBeNull();
    });

    it('brackets a closed window', () => {
        const bounds = movementSkBounds('2026-07-01', '2026-07-31')!;
        expect(within(sk('2026-07-15T10:00:00.000Z'), bounds)).toBe(true);
        expect(within(sk('2026-06-30T23:59:59.999Z'), bounds)).toBe(false);
        expect(within(sk('2026-08-01T00:00:00.000Z'), bounds)).toBe(false);
    });

    it('includes the whole of a bare `to` date', () => {
        const bounds = movementSkBounds(undefined, '2026-07-22')!;
        expect(within(sk('2026-07-22T00:00:00.000Z'), bounds)).toBe(true);
        expect(within(sk('2026-07-22T23:59:59.999Z'), bounds)).toBe(true);
        expect(within(sk('2026-07-23T00:00:00.000Z'), bounds)).toBe(false);
    });

    it('includes the whole of a bare `from` date', () => {
        const bounds = movementSkBounds('2026-07-22')!;
        expect(within(sk('2026-07-22T00:00:00.000Z'), bounds)).toBe(true);
        expect(within(sk('2026-07-21T23:59:59.999Z'), bounds)).toBe(false);
    });

    it('accepts full timestamps at either end, inclusively', () => {
        const bounds = movementSkBounds('2026-07-22T10:00:00.000Z', '2026-07-22T12:00:00.000Z')!;
        expect(within(sk('2026-07-22T10:00:00.000Z'), bounds)).toBe(true);   // exact lower
        expect(within(sk('2026-07-22T12:00:00.000Z'), bounds)).toBe(true);   // exact upper
        expect(within(sk('2026-07-22T09:59:59.999Z'), bounds)).toBe(false);
        expect(within(sk('2026-07-22T12:00:00.001Z'), bounds)).toBe(false);
    });

    it('bounds ABOVE even with only `from`, so the query cannot spill into TASK#', () => {
        // 'TASK#' sorts after 'STOCKMOVE#', so an open-ended `SK >= …` would
        // read task rows. This is the bug the upper sentinel prevents.
        expect('TASK#anything' > 'STOCKMOVE#2026-07-22').toBe(true);

        const bounds = movementSkBounds('2026-07-22')!;
        expect(within('TASK#anything', bounds)).toBe(false);
        expect(within('PRODUCT#p_1', bounds)).toBe(false);
        expect(within('INVOICE#inv_1', bounds)).toBe(false);
        expect(within('COUNTER#SALE', bounds)).toBe(false);
    });

    it('bounds BELOW even with only `to`, excluding earlier entity prefixes', () => {
        const bounds = movementSkBounds(undefined, '2026-07-22')!;
        expect(within('PRODUCT#p_1', bounds)).toBe(false);
        expect(within('BATCH#p_1#2026-11-15', bounds)).toBe(false);
        expect(within('CLIENT#c_1', bounds)).toBe(false);
    });

    it('keeps every movement inside an all-encompassing window', () => {
        const bounds = movementSkBounds('0000', '9999')!;
        for (const stamp of ['2020-01-01T00:00:00.000Z', '2026-07-22T10:00:00.000Z', '2099-12-31T23:59:59.999Z']) {
            expect(within(sk(stamp), bounds)).toBe(true);
        }
        expect(within('TASK#x', bounds)).toBe(false);
    });

    it('orders bounds so lower <= upper in every form', () => {
        for (const [from, to] of [
            ['2026-07-01', '2026-07-31'],
            [undefined, '2026-07-22'],
            ['2026-07-22', undefined],
        ] as const) {
            const bounds = movementSkBounds(from, to)!;
            expect(bounds.lower <= bounds.upper).toBe(true);
        }
    });

    it('tolerates ids of any shape after the timestamp', () => {
        const bounds = movementSkBounds('2026-07-22', '2026-07-22')!;
        for (const id of ['mv_1', '00000000-0000-4000-8000-000000000000', 'z'.repeat(40)]) {
            expect(within(sk('2026-07-22T10:00:00.000Z', id), bounds)).toBe(true);
        }
    });
});
