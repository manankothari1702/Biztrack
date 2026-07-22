import { describe, expect, it } from 'vitest';
import { planBatchAdjustment, planWriteOff } from './batches';
import {
    applyStockChange,
    earliestExpiryOf,
    type ProductSnapshot,
    type StockChange,
} from './lib/stock';

const UID = 'u_1';
const NOW = '2026-07-22T10:00:00.000Z';
const PK  = `USER#${UID}`;

const F1: ProductSnapshot = { id: 'p_1', name: 'Formula 1 - Strawberry' };

const ids = () => {
    let n = 0;
    return () => `mv_${++n}`;
};

const plan = (changes: StockChange[], product: ProductSnapshot = F1) =>
    applyStockChange({
        uid: UID, changes, products: { [product.id]: product }, now: NOW, newId: ids(),
    });

const updates = (p: ReturnType<typeof plan>) => p.items.filter(i => 'Update' in i).map(i => i.Update!);
const batchUpdates = (p: ReturnType<typeof plan>) =>
    updates(p).filter(u => String(u.Key!.SK).startsWith('BATCH#'));

/**
 * Apply changes to an in-memory batch list the way DynamoDB's `ADD` would, so a
 * plan can be checked against the state it will actually produce. This is what
 * makes the post-transaction recompute assertable without a live table.
 */
const project = (
    before: { expiryDate: string; quantity: number }[],
    changes: StockChange[],
): { expiryDate: string; quantity: number }[] => {
    const byExpiry = new Map(before.map(b => [b.expiryDate, { ...b }]));
    for (const change of changes) {
        const row = byExpiry.get(change.expiryDate) ?? { expiryDate: change.expiryDate, quantity: 0 };
        row.quantity += change.delta;
        byExpiry.set(change.expiryDate, row);
    }
    return [...byExpiry.values()];
};

// ── planBatchAdjustment: quantity-only correction ───────────────────────────

describe('planBatchAdjustment — quantity correction, same expiry', () => {
    it('derives the delta from an absolute target', () => {
        expect(planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8, targetQuantity: 5,
        })).toEqual([expect.objectContaining({ expiryDate: '2026-11-15', delta: -3, type: 'ADJUST' })]);

        expect(planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8, targetQuantity: 12,
        })).toEqual([expect.objectContaining({ delta: 4, type: 'ADJUST' })]);
    });

    it('emits nothing when the quantity is unchanged', () => {
        expect(planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8, targetQuantity: 8,
        })).toEqual([]);
    });

    it('treats an unchanged expiryDate as a plain correction, not a re-key', () => {
        const changes = planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8,
            targetQuantity: 5, targetExpiry: '2026-11-15',
        });
        expect(changes).toHaveLength(1);
        expect(changes[0].delta).toBe(-3);
    });

    it('can zero a batch out', () => {
        const changes = planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8, targetQuantity: 0,
        });
        expect(changes[0].delta).toBe(-8);
    });

    it('carries an operator note into the movement reason', () => {
        const [change] = planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8,
            targetQuantity: 5, note: 'recount after audit',
        });
        expect(change.reason).toContain('recount after audit');
    });
});

// ── planBatchAdjustment: re-key ─────────────────────────────────────────────

describe('planBatchAdjustment — re-key to a new expiry', () => {
    it('removes from the old expiry and adds at the new one', () => {
        const changes = planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8,
            targetQuantity: 8, targetExpiry: '2026-12-01',
        });
        expect(changes).toEqual([
            expect.objectContaining({ expiryDate: '2026-11-15', delta: -8, type: 'ADJUST' }),
            expect.objectContaining({ expiryDate: '2026-12-01', delta:  8, type: 'ADJUST' }),
        ]);
    });

    it('can re-key and re-count at once', () => {
        const changes = planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8,
            targetQuantity: 5, targetExpiry: '2026-12-01',
        });
        expect(changes.map(c => c.delta)).toEqual([-8, 5]);
    });

    it('omits the removal leg when the source batch is already empty', () => {
        const changes = planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 0,
            targetQuantity: 5, targetExpiry: '2026-12-01',
        });
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ expiryDate: '2026-12-01', delta: 5 });
    });

    it('omits the addition leg when re-keying to a zero quantity', () => {
        const changes = planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8,
            targetQuantity: 0, targetExpiry: '2026-12-01',
        });
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ expiryDate: '2026-11-15', delta: -8 });
    });

    it('records both directions in the movement reasons', () => {
        const changes = planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8,
            targetQuantity: 8, targetExpiry: '2026-12-01',
        });
        expect(changes[0].reason).toContain('to 2026-12-01');
        expect(changes[1].reason).toContain('from 2026-11-15');
    });
});

// ── CASE 1: re-key onto an expiry that already holds stock ──────────────────

describe('CASE 1 — re-keying onto an expiry that ALREADY has stock', () => {
    // The destination batch holds 10; we move 5 onto it from 2026-11-15.
    // The product caches 2026-11-15 as its earliest, since that is the source.
    const changes = planBatchAdjustment({
        productId: 'p_1', productName: 'Formula 1 - Strawberry',
        currentExpiry: '2026-11-15', currentQuantity: 5,
        targetQuantity: 5, targetExpiry: '2026-12-01',
    });
    const built = plan(changes, { ...F1, earliestExpiry: '2026-11-15' });

    it('emits exactly ONE update for the destination key', () => {
        const destination = batchUpdates(built)
            .filter(u => u.Key!.SK === 'BATCH#p_1#2026-12-01');
        expect(destination).toHaveLength(1);
    });

    it('never writes the same key twice anywhere in the transaction', () => {
        const keys = built.items.map(i =>
            'Update' in i ? `${i.Update!.Key!.PK}|${i.Update!.Key!.SK}`
                          : `${i.Put!.Item!.PK}|${i.Put!.Item!.SK}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('merges via ADD rather than overwriting the destination', () => {
        const [destination] = batchUpdates(built)
            .filter(u => u.Key!.SK === 'BATCH#p_1#2026-12-01');
        expect(destination.UpdateExpression).toContain('ADD #qty :delta');
        expect(destination.ExpressionAttributeValues![':delta']).toBe(5);
        // An increment needs no oversell guard.
        expect(destination.ConditionExpression).toBeUndefined();
    });

    it('guards the source leg so the move cannot overdraw it', () => {
        const [source] = batchUpdates(built).filter(u => u.Key!.SK === 'BATCH#p_1#2026-11-15');
        expect(source.ConditionExpression).toBe('#qty >= :magnitude');
        expect(source.ExpressionAttributeValues![':magnitude']).toBe(5);
    });

    it('lands the destination at existing + moved, not at moved', () => {
        const after = project(
            [{ expiryDate: '2026-11-15', quantity: 5 }, { expiryDate: '2026-12-01', quantity: 10 }],
            changes,
        );
        expect(after.find(b => b.expiryDate === '2026-12-01')!.quantity).toBe(15);
        expect(after.find(b => b.expiryDate === '2026-11-15')!.quantity).toBe(0);
    });

    it('leaves the product roll-up untouched — a move is not a stock change', () => {
        // Net delta is zero and the destination is LATER than the cached
        // earliest, so there is nothing to write on the product row.
        const productUpdates = updates(built).filter(u => String(u.Key!.SK).startsWith('PRODUCT#'));
        expect(productUpdates).toHaveLength(0);
    });

    it('still defers a recompute, since the source batch was emptied', () => {
        expect(built.productsNeedingExpiryRecompute).toEqual(['p_1']);
        // 2026-11-15 is now empty, so the true earliest becomes the destination.
        const after = project(
            [{ expiryDate: '2026-11-15', quantity: 5 }, { expiryDate: '2026-12-01', quantity: 10 }],
            changes,
        );
        expect(earliestExpiryOf(after)).toBe('2026-12-01');
    });

    it('still logs both legs in the audit trail', () => {
        const movements = built.items.filter(i => 'Put' in i);
        expect(movements).toHaveLength(2);
        expect(built.movements.map(m => m.quantity)).toEqual([5, 5]);
        expect(built.movements.every(m => m.type === 'ADJUST')).toBe(true);
    });
});

// ── CASE 2: re-key empties the batch holding earliestExpiry ─────────────────

describe('CASE 2 — re-key empties the batch that WAS the earliest expiry', () => {
    const before = [
        { expiryDate: '2026-11-15', quantity: 8 },    // the current earliest
        { expiryDate: '2027-06-30', quantity: 12 },
    ];

    it('moves earliestExpiry LATER when the earliest batch is emptied', () => {
        const product = { ...F1, earliestExpiry: '2026-11-15' };
        const changes = planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8,
            targetQuantity: 8, targetExpiry: '2027-12-01',   // moved to the far future
        });
        const built = plan(changes, product);

        // The engine cannot resolve this inline — a later minimum needs a query.
        expect(built.productsNeedingExpiryRecompute).toEqual(['p_1']);

        // ...and the recompute against committed state finds the right answer.
        const after = project(before, changes);
        expect(earliestExpiryOf(after)).toBe('2027-06-30');
        expect(earliestExpiryOf(after)).not.toBe('2026-11-15');   // no longer the emptied batch
    });

    it('ignores the emptied source row, which is retained at zero as history', () => {
        const changes = planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8,
            targetQuantity: 8, targetExpiry: '2027-12-01',
        });
        const after = project(before, changes);

        expect(after.find(b => b.expiryDate === '2026-11-15')).toEqual({
            expiryDate: '2026-11-15', quantity: 0,
        });
        expect(earliestExpiryOf(after)).toBe('2027-06-30');
    });

    it('moves earliestExpiry EARLIER, and the engine handles that one inline', () => {
        const product = { ...F1, earliestExpiry: '2026-11-15' };
        const changes = planBatchAdjustment({
            productId: 'p_1', currentExpiry: '2027-06-30', currentQuantity: 12,
            targetQuantity: 12, targetExpiry: '2026-01-05',
        });
        const built = plan(changes, product);

        const [productUpdate] = updates(built).filter(u => String(u.Key!.SK).startsWith('PRODUCT#'));
        expect(productUpdate.ExpressionAttributeValues![':earliestExpiry']).toBe('2026-01-05');

        // A decrement happened too, so the recompute still runs — and agrees.
        expect(built.productsNeedingExpiryRecompute).toEqual(['p_1']);
        expect(earliestExpiryOf(project(before, changes))).toBe('2026-01-05');
    });

    it('clears earliestExpiry entirely when the last stock is written off', () => {
        const changes = planWriteOff({
            productId: 'p_1', expiryDate: '2026-11-15', quantity: 8, reason: 'Expired',
        });
        const after = project([{ expiryDate: '2026-11-15', quantity: 8 }], changes);
        expect(earliestExpiryOf(after)).toBeUndefined();
    });

    it('keeps the correct earliest when only ONE of several batches is emptied', () => {
        const three = [
            { expiryDate: '2026-08-01', quantity: 4 },
            { expiryDate: '2026-11-15', quantity: 8 },
            { expiryDate: '2027-06-30', quantity: 12 },
        ];
        const changes = planWriteOff({
            productId: 'p_1', expiryDate: '2026-08-01', quantity: 4, reason: 'Expired',
        });
        expect(earliestExpiryOf(project(three, changes))).toBe('2026-11-15');
    });
});

// ── planWriteOff ────────────────────────────────────────────────────────────

describe('planWriteOff', () => {
    it('removes the whole remaining quantity as one WRITE_OFF', () => {
        expect(planWriteOff({
            productId: 'p_1', expiryDate: '2026-08-01', quantity: 8, reason: 'Expired',
        })).toEqual([expect.objectContaining({
            expiryDate: '2026-08-01', delta: -8, type: 'WRITE_OFF', reason: 'Expired',
        })]);
    });

    it('appends an optional note to the reason', () => {
        const [change] = planWriteOff({
            productId: 'p_1', expiryDate: '2026-08-01', quantity: 8,
            reason: 'Damaged', note: 'crushed in transit',
        });
        expect(change.reason).toBe('Damaged — crushed in transit');
    });

    it('emits nothing for an already-empty batch', () => {
        expect(planWriteOff({
            productId: 'p_1', expiryDate: '2026-08-01', quantity: 0, reason: 'Expired',
        })).toEqual([]);
    });

    it('is guarded by the engine like any other decrement', () => {
        const built = plan(planWriteOff({
            productId: 'p_1', expiryDate: '2026-08-01', quantity: 8, reason: 'Expired',
        }));
        expect(batchUpdates(built)[0].ConditionExpression).toBe('#qty >= :magnitude');
        expect(built.productsNeedingExpiryRecompute).toEqual(['p_1']);
    });

    it('decrements the product roll-up by the written-off amount', () => {
        const built = plan(planWriteOff({
            productId: 'p_1', expiryDate: '2026-08-01', quantity: 8, reason: 'Expired',
        }));
        const [productUpdate] = updates(built).filter(u => String(u.Key!.SK).startsWith('PRODUCT#'));
        expect(productUpdate.ExpressionAttributeValues![':delta']).toBe(-8);
    });
});

// ── Every path goes through the engine ──────────────────────────────────────

describe('planners hand off cleanly to lib/stock.ts', () => {
    it('produces changes the engine accepts, for every planner path', () => {
        const cases: StockChange[][] = [
            planBatchAdjustment({ productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8, targetQuantity: 5 }),
            planBatchAdjustment({ productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8, targetQuantity: 12 }),
            planBatchAdjustment({ productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8, targetQuantity: 8, targetExpiry: '2026-12-01' }),
            planWriteOff({ productId: 'p_1', expiryDate: '2026-08-01', quantity: 8, reason: 'Expired' }),
        ];
        for (const changes of cases) {
            expect(() => plan(changes)).not.toThrow();
        }
    });

    it('never emits a zero delta, which the engine rejects outright', () => {
        const changes = [
            ...planBatchAdjustment({ productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 0, targetQuantity: 0, targetExpiry: '2026-12-01' }),
            ...planBatchAdjustment({ productId: 'p_1', currentExpiry: '2026-11-15', currentQuantity: 8, targetQuantity: 8 }),
            ...planWriteOff({ productId: 'p_1', expiryDate: '2026-08-01', quantity: 0, reason: 'Expired' }),
        ];
        expect(changes).toEqual([]);
    });

    it('tags every movement PK with the caller uid, never a client-supplied one', () => {
        const built = plan(planWriteOff({
            productId: 'p_1', expiryDate: '2026-08-01', quantity: 8, reason: 'Expired',
        }));
        for (const item of built.items) {
            const key = 'Update' in item ? item.Update!.Key! : item.Put!.Item!;
            expect(key.PK).toBe(PK);
        }
    });
});
