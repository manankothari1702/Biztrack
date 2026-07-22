import { describe, expect, it } from 'vitest';
import {
    MAX_TRANSACT_ITEMS,
    StockChangeError,
    applyStockChange,
    earliestExpiryOf,
    type ApplyStockChangeInput,
    type ProductSnapshot,
    type StockChange,
} from './stock';

const UID  = 'u_1';
const NOW  = '2026-07-22T10:00:00.000Z';
const PK   = `USER#${UID}`;

const F1: ProductSnapshot = { id: 'p_1', name: 'Formula 1 - Strawberry' };
const WC: ProductSnapshot = { id: 'p_2', name: "Woman's Choice" };

/** Deterministic id factory so item construction is byte-comparable. */
const ids = () => {
    let n = 0;
    return () => `mv_${++n}`;
};

const build = (
    changes: StockChange[],
    products: Record<string, ProductSnapshot> = { p_1: F1, p_2: WC },
    over: Partial<ApplyStockChangeInput> = {},
) => applyStockChange({ uid: UID, changes, products, now: NOW, newId: ids(), ...over });

// Narrow helpers — TransactItem is a union, so tests need the branch.
const updates = (plan: ReturnType<typeof build>) =>
    plan.items.filter(i => 'Update' in i).map(i => i.Update!);
const puts = (plan: ReturnType<typeof build>) =>
    plan.items.filter(i => 'Put' in i).map(i => i.Put!);
const batchUpdates = (plan: ReturnType<typeof build>) =>
    updates(plan).filter(u => String(u.Key!.SK).startsWith('BATCH#'));
const productUpdates = (plan: ReturnType<typeof build>) =>
    updates(plan).filter(u => String(u.Key!.SK).startsWith('PRODUCT#'));

const IN_12 = (over: Partial<StockChange> = {}): StockChange => ({
    productId: 'p_1', expiryDate: '2027-06-30', delta: 12, type: 'IN',
    reason: 'Purchase — PUR-2026-0007', ...over,
});
const OUT_2 = (over: Partial<StockChange> = {}): StockChange => ({
    productId: 'p_1', expiryDate: '2026-11-15', delta: -2, type: 'OUT',
    reason: 'Sale — INV-2026-0001', ...over,
});

// ── Item construction ───────────────────────────────────────────────────────

describe('item construction — purchase (IN)', () => {
    const plan = build([IN_12()]);

    it('emits exactly one batch update, one product update, one movement', () => {
        expect(batchUpdates(plan)).toHaveLength(1);
        expect(productUpdates(plan)).toHaveLength(1);
        expect(puts(plan)).toHaveLength(1);
        expect(plan.items).toHaveLength(3);
    });

    it('keys the batch by product and expiry', () => {
        expect(batchUpdates(plan)[0].Key).toEqual({ PK, SK: 'BATCH#p_1#2027-06-30' });
    });

    it('upserts the batch with ADD so a new expiry creates the row', () => {
        const u = batchUpdates(plan)[0];
        expect(u.UpdateExpression).toContain('ADD #qty :delta');
        expect(u.ExpressionAttributeValues![':delta']).toBe(12);
        expect(u.ExpressionAttributeNames!['#qty']).toBe('quantity');
    });

    it('sets invDate to the expiry — the GSI6-InventoryDate sort key', () => {
        const u = batchUpdates(plan)[0];
        expect(u.UpdateExpression).toContain('invDate = :expiryDate');
        expect(u.ExpressionAttributeValues![':expiryDate']).toBe('2027-06-30');
    });

    it('does not stamp a condition on an increment', () => {
        expect(batchUpdates(plan)[0].ConditionExpression).toBeUndefined();
    });

    it('preserves createdAt on an existing batch but sets it on a new one', () => {
        expect(batchUpdates(plan)[0].UpdateExpression)
            .toContain('createdAt = if_not_exists(createdAt, :now)');
    });

    it('adds the delta to the product roll-up', () => {
        const u = productUpdates(plan)[0];
        expect(u.Key).toEqual({ PK, SK: 'PRODUCT#p_1' });
        expect(u.UpdateExpression).toContain('ADD totalQuantity :delta');
        expect(u.ExpressionAttributeValues![':delta']).toBe(12);
    });

    it('writes an IN movement with a positive quantity', () => {
        expect(puts(plan)[0].Item).toMatchObject({
            PK, SK: `STOCKMOVE#${NOW}#mv_1`,
            id: 'mv_1', productId: 'p_1', productName: 'Formula 1 - Strawberry',
            batchExpiry: '2027-06-30', type: 'IN', quantity: 12,
            reason: 'Purchase — PUR-2026-0007', createdAt: NOW,
        });
    });

    it('returns the movements it wrote', () => {
        expect(plan.movements).toHaveLength(1);
        expect(plan.movements[0]).toMatchObject({ id: 'mv_1', type: 'IN', quantity: 12 });
    });
});

describe('item construction — sale (OUT)', () => {
    const plan = build([OUT_2()]);

    it('decrements the batch by a negative delta', () => {
        expect(batchUpdates(plan)[0].ExpressionAttributeValues![':delta']).toBe(-2);
    });

    it('records the movement quantity as a positive magnitude', () => {
        expect(puts(plan)[0].Item!.quantity).toBe(2);
        expect(puts(plan)[0].Item!.type).toBe('OUT');
    });

    it('decrements the product roll-up', () => {
        expect(productUpdates(plan)[0].ExpressionAttributeValues![':delta']).toBe(-2);
    });
});

describe('movement rows', () => {
    it('spreads table keys LAST so a caller-supplied field cannot hijack PK/SK', () => {
        const plan = build([OUT_2()]);
        const item = puts(plan)[0].Item!;
        expect(item.PK).toBe(PK);
        expect(item.SK).toBe(`STOCKMOVE#${NOW}#mv_1`);
    });

    it('falls back to the product name when the change omits one', () => {
        const plan = build([OUT_2({ productName: undefined })]);
        expect(puts(plan)[0].Item!.productName).toBe('Formula 1 - Strawberry');
    });

    it('prefers an explicit snapshot name over the current product name', () => {
        const plan = build([OUT_2({ productName: 'Old Catalogue Name' })]);
        expect(puts(plan)[0].Item!.productName).toBe('Old Catalogue Name');
    });
});

// ── The oversell guard ──────────────────────────────────────────────────────

describe('condition expressions — every decrement is guarded', () => {
    it('guards a single decrement with quantity >= magnitude', () => {
        const u = batchUpdates(build([OUT_2()]))[0];
        expect(u.ConditionExpression).toBe('#qty >= :magnitude');
        expect(u.ExpressionAttributeNames!['#qty']).toBe('quantity');
        expect(u.ExpressionAttributeValues![':magnitude']).toBe(2);
    });

    it('guards EVERY decrement in a multi-line transaction', () => {
        const plan = build([
            OUT_2({ expiryDate: '2026-11-15', delta: -2 }),
            OUT_2({ expiryDate: '2027-06-30', delta: -5 }),
            OUT_2({ productId: 'p_2', expiryDate: '2027-03-15', delta: -1 }),
        ]);
        const decrements = batchUpdates(plan)
            .filter(u => Number(u.ExpressionAttributeValues![':delta']) < 0);

        expect(decrements).toHaveLength(3);
        for (const u of decrements) {
            expect(u.ConditionExpression).toBe('#qty >= :magnitude');
            expect(u.ExpressionAttributeValues![':magnitude'])
                .toBe(-Number(u.ExpressionAttributeValues![':delta']));
        }
    });

    it('guards a WRITE_OFF exactly like a sale', () => {
        const plan = build([{
            productId: 'p_1', expiryDate: '2026-08-01', delta: -8,
            type: 'WRITE_OFF', reason: 'Expired',
        }]);
        expect(batchUpdates(plan)[0].ConditionExpression).toBe('#qty >= :magnitude');
        expect(puts(plan)[0].Item!.type).toBe('WRITE_OFF');
        expect(puts(plan)[0].Item!.quantity).toBe(8);
    });

    it('guards a negative ADJUST but not a positive one', () => {
        const down = build([{ productId: 'p_1', expiryDate: '2026-11-15', delta: -3, type: 'ADJUST' }]);
        const up   = build([{ productId: 'p_1', expiryDate: '2026-11-15', delta:  3, type: 'ADJUST' }]);
        expect(batchUpdates(down)[0].ConditionExpression).toBe('#qty >= :magnitude');
        expect(batchUpdates(up)[0].ConditionExpression).toBeUndefined();
    });

    it('guards the NET decrement when increments and decrements collide on one batch', () => {
        // -5 then +2 nets to -3: the condition must protect 3, not 5.
        const plan = build([
            OUT_2({ expiryDate: '2026-11-15', delta: -5 }),
            IN_12({ expiryDate: '2026-11-15', delta:  2 }),
        ]);
        expect(batchUpdates(plan)).toHaveLength(1);
        expect(batchUpdates(plan)[0].ExpressionAttributeValues![':delta']).toBe(-3);
        expect(batchUpdates(plan)[0].ExpressionAttributeValues![':magnitude']).toBe(3);
    });
});

// ── Aggregation: the duplicate-key trap ─────────────────────────────────────

describe('aggregation — DynamoDB rejects duplicate keys in one transaction', () => {
    it('collapses two lines of the SAME product at DIFFERENT expiries into ONE roll-up', () => {
        const plan = build([
            OUT_2({ expiryDate: '2026-11-15', delta: -2 }),
            OUT_2({ expiryDate: '2027-06-30', delta: -3 }),
        ]);

        expect(batchUpdates(plan)).toHaveLength(2);          // two distinct batches
        expect(productUpdates(plan)).toHaveLength(1);        // but ONE product row
        expect(productUpdates(plan)[0].ExpressionAttributeValues![':delta']).toBe(-5);
    });

    it('collapses two lines at the SAME (product, expiry) into ONE batch update', () => {
        const plan = build([
            IN_12({ expiryDate: '2027-06-30', delta: 12 }),
            IN_12({ expiryDate: '2027-06-30', delta:  6 }),
        ]);

        expect(batchUpdates(plan)).toHaveLength(1);
        expect(batchUpdates(plan)[0].ExpressionAttributeValues![':delta']).toBe(18);
    });

    it('still writes one movement PER LINE when lines merge', () => {
        const plan = build([
            IN_12({ expiryDate: '2027-06-30', delta: 12 }),
            IN_12({ expiryDate: '2027-06-30', delta:  6 }),
        ]);
        expect(puts(plan)).toHaveLength(2);
        expect(puts(plan).map(p => p.Item!.quantity)).toEqual([12, 6]);
    });

    it('never emits the same key twice, across every dimension', () => {
        const plan = build([
            OUT_2({ productId: 'p_1', expiryDate: '2026-11-15', delta: -2 }),
            OUT_2({ productId: 'p_1', expiryDate: '2026-11-15', delta: -1 }),
            OUT_2({ productId: 'p_1', expiryDate: '2027-06-30', delta: -3 }),
            OUT_2({ productId: 'p_2', expiryDate: '2027-03-15', delta: -1 }),
        ]);

        const keys = plan.items.map(i =>
            'Update' in i ? `${i.Update!.Key!.PK}|${i.Update!.Key!.SK}`
                          : `${i.Put!.Item!.PK}|${i.Put!.Item!.SK}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('drops a batch update that nets to zero, but keeps the audit trail', () => {
        // The product already caches this expiry, so there is nothing to lower
        // and nothing to add — the whole write collapses to the two movements.
        const plan = build([
            OUT_2({ expiryDate: '2026-11-15', delta: -4 }),
            IN_12({ expiryDate: '2026-11-15', delta:  4 }),
        ], { p_1: { ...F1, earliestExpiry: '2026-11-15' } });

        expect(batchUpdates(plan)).toHaveLength(0);
        expect(productUpdates(plan)).toHaveLength(0);
        expect(puts(plan)).toHaveLength(2);      // both movements still recorded
    });
});

// ── earliestExpiry ──────────────────────────────────────────────────────────

describe('earliestExpiry — incoming stock is handled inline', () => {
    it('lowers the cache when a purchase arrives with an earlier expiry', () => {
        const plan = build([IN_12({ expiryDate: '2026-09-01' })],
            { p_1: { ...F1, earliestExpiry: '2027-01-01' } });

        const u = productUpdates(plan)[0];
        expect(u.UpdateExpression).toContain('earliestExpiry = :earliestExpiry');
        expect(u.ExpressionAttributeValues![':earliestExpiry']).toBe('2026-09-01');
    });

    it('leaves the cache alone when the incoming expiry is later', () => {
        const plan = build([IN_12({ expiryDate: '2027-06-30' })],
            { p_1: { ...F1, earliestExpiry: '2026-09-01' } });
        expect(productUpdates(plan)[0].UpdateExpression).not.toContain('earliestExpiry');
    });

    it('sets the cache when the product had none', () => {
        const plan = build([IN_12({ expiryDate: '2027-06-30' })],
            { p_1: { ...F1, earliestExpiry: undefined } });
        expect(productUpdates(plan)[0].ExpressionAttributeValues![':earliestExpiry'])
            .toBe('2027-06-30');
    });

    it('uses the earliest across several incoming lines', () => {
        const plan = build([
            IN_12({ expiryDate: '2027-06-30' }),
            IN_12({ expiryDate: '2026-10-01' }),
            IN_12({ expiryDate: '2027-01-01' }),
        ], { p_1: { ...F1, earliestExpiry: '2028-01-01' } });
        expect(productUpdates(plan)[0].ExpressionAttributeValues![':earliestExpiry'])
            .toBe('2026-10-01');
    });

    it('ignores OUTGOING expiries when lowering the cache', () => {
        // The sale is from an early batch, but selling never pulls the minimum earlier.
        const plan = build([OUT_2({ expiryDate: '2026-01-01' })],
            { p_1: { ...F1, earliestExpiry: '2027-01-01' } });
        expect(productUpdates(plan)[0].UpdateExpression).not.toContain('earliestExpiry');
    });
});

describe('earliestExpiry — outgoing stock defers to the caller', () => {
    it('flags a product that lost stock', () => {
        expect(build([OUT_2()]).productsNeedingExpiryRecompute).toEqual(['p_1']);
    });

    it('does not flag a pure purchase', () => {
        expect(build([IN_12()]).productsNeedingExpiryRecompute).toEqual([]);
    });

    it('flags a write-off', () => {
        const plan = build([{ productId: 'p_1', expiryDate: '2026-08-01', delta: -8, type: 'WRITE_OFF' }]);
        expect(plan.productsNeedingExpiryRecompute).toEqual(['p_1']);
    });

    it('flags each affected product exactly once', () => {
        const plan = build([
            OUT_2({ productId: 'p_1', expiryDate: '2026-11-15', delta: -1 }),
            OUT_2({ productId: 'p_1', expiryDate: '2027-06-30', delta: -1 }),
            OUT_2({ productId: 'p_2', expiryDate: '2027-03-15', delta: -1 }),
        ]);
        expect(plan.productsNeedingExpiryRecompute).toEqual(['p_1', 'p_2']);
    });

    it('flags a re-key, which both adds and removes', () => {
        // Moving a batch to a LATER expiry: -8 at the old date, +8 at the new.
        // Net quantity is unchanged and the new date cannot lower the cache, so
        // no product write is needed — but the minimum may now have moved later,
        // which only a query can settle. Hence the recompute flag.
        const plan = build([
            { productId: 'p_1', expiryDate: '2026-11-15', delta: -8, type: 'ADJUST' },
            { productId: 'p_1', expiryDate: '2026-12-01', delta:  8, type: 'ADJUST' },
        ], { p_1: { ...F1, earliestExpiry: '2026-11-15' } });

        expect(batchUpdates(plan)).toHaveLength(2);
        expect(productUpdates(plan)).toHaveLength(0);   // net zero, no expiry lowering
        expect(plan.productsNeedingExpiryRecompute).toEqual(['p_1']);
    });

    it('re-keying EARLIER lowers the cache inline and still flags a recompute', () => {
        const plan = build([
            { productId: 'p_1', expiryDate: '2026-11-15', delta: -8, type: 'ADJUST' },
            { productId: 'p_1', expiryDate: '2026-09-01', delta:  8, type: 'ADJUST' },
        ], { p_1: { ...F1, earliestExpiry: '2026-11-15' } });

        expect(productUpdates(plan)).toHaveLength(1);
        expect(productUpdates(plan)[0].ExpressionAttributeValues![':earliestExpiry']).toBe('2026-09-01');
        expect(productUpdates(plan)[0].UpdateExpression).not.toContain('ADD');  // net zero
        expect(plan.productsNeedingExpiryRecompute).toEqual(['p_1']);
    });
});

describe('earliestExpiryOf', () => {
    it('returns the minimum among batches that still hold stock', () => {
        expect(earliestExpiryOf([
            { expiryDate: '2027-06-30', quantity: 12 },
            { expiryDate: '2026-11-15', quantity: 8 },
        ])).toBe('2026-11-15');
    });

    it('ignores emptied batches — they are kept as history, not as a cache anchor', () => {
        expect(earliestExpiryOf([
            { expiryDate: '2026-11-15', quantity: 0 },
            { expiryDate: '2027-06-30', quantity: 12 },
        ])).toBe('2027-06-30');
    });

    it('is undefined when nothing is in stock', () => {
        expect(earliestExpiryOf([{ expiryDate: '2026-11-15', quantity: 0 }])).toBeUndefined();
        expect(earliestExpiryOf([])).toBeUndefined();
    });
});

// ── Input validation ────────────────────────────────────────────────────────

describe('validation — programming errors fail loudly', () => {
    it('rejects a zero delta', () => {
        expect(() => build([OUT_2({ delta: 0 })])).toThrow(StockChangeError);
    });

    it('rejects a fractional delta — stock is whole units', () => {
        expect(() => build([OUT_2({ delta: -1.5 })])).toThrow(/whole number/);
    });

    it('rejects IN that would remove stock', () => {
        expect(() => build([IN_12({ delta: -5 })])).toThrow(/IN must add stock/);
    });

    it('rejects OUT and WRITE_OFF that would add stock', () => {
        expect(() => build([OUT_2({ delta: 5 })])).toThrow(/OUT must remove stock/);
        expect(() => build([OUT_2({ delta: 5, type: 'WRITE_OFF' })])).toThrow(/WRITE_OFF must remove stock/);
    });

    it('allows ADJUST in either direction', () => {
        expect(() => build([OUT_2({ delta:  5, type: 'ADJUST' })])).not.toThrow();
        expect(() => build([OUT_2({ delta: -5, type: 'ADJUST' })])).not.toThrow();
    });

    it('rejects a change against an unknown product', () => {
        expect(() => build([OUT_2({ productId: 'p_missing' })])).toThrow(/product not found/);
    });

    it('returns an empty plan for no changes', () => {
        expect(build([])).toEqual({ items: [], movements: [], productsNeedingExpiryRecompute: [] });
    });
});

describe('transaction size', () => {
    it('stays within the limit for the 30-line cap', () => {
        // 30 lines, all distinct products+expiries: 30 batch + 30 product + 30 movement = 90.
        const products: Record<string, ProductSnapshot> = {};
        const changes: StockChange[] = [];
        for (let i = 0; i < 30; i++) {
            products[`p_${i}`] = { id: `p_${i}`, name: `Product ${i}` };
            changes.push({ productId: `p_${i}`, expiryDate: '2027-06-30', delta: -1, type: 'OUT' });
        }
        const plan = build(changes, products);
        expect(plan.items).toHaveLength(90);
        expect(plan.items.length).toBeLessThanOrEqual(MAX_TRANSACT_ITEMS);
        // Leaves room for the caller's own items (the invoice Put).
        expect(MAX_TRANSACT_ITEMS - plan.items.length).toBeGreaterThanOrEqual(1);
    });

    it('throws rather than letting DynamoDB reject an oversized transaction', () => {
        const products: Record<string, ProductSnapshot> = {};
        const changes: StockChange[] = [];
        for (let i = 0; i < 40; i++) {
            products[`p_${i}`] = { id: `p_${i}` };
            changes.push({ productId: `p_${i}`, expiryDate: '2027-06-30', delta: -1, type: 'OUT' });
        }
        expect(() => build(changes, products)).toThrow(/exceeding DynamoDB's limit of 100/);
    });
});

// ── Realistic end-to-end shapes ─────────────────────────────────────────────

describe('worked scenario — 3-line purchase then a 2-line sale', () => {
    it('builds a purchase that creates three batches and two roll-ups', () => {
        const plan = build([
            { productId: 'p_1', expiryDate: '2027-06-30', delta: 12, type: 'IN', reason: 'Purchase — PUR-2026-0007' },
            { productId: 'p_2', expiryDate: '2027-03-15', delta:  6, type: 'IN', reason: 'Purchase — PUR-2026-0007' },
            { productId: 'p_1', expiryDate: '2027-01-20', delta: 10, type: 'IN', reason: 'Purchase — PUR-2026-0007' },
        ]);

        expect(batchUpdates(plan)).toHaveLength(3);
        expect(productUpdates(plan)).toHaveLength(2);
        expect(puts(plan)).toHaveLength(3);

        const p1 = productUpdates(plan).find(u => u.Key!.SK === 'PRODUCT#p_1')!;
        expect(p1.ExpressionAttributeValues![':delta']).toBe(22);            // 12 + 10
        expect(p1.ExpressionAttributeValues![':earliestExpiry']).toBe('2027-01-20');
        expect(plan.productsNeedingExpiryRecompute).toEqual([]);
    });

    it('builds a sale that guards both lines and defers both recomputes', () => {
        const plan = build([
            { productId: 'p_1', expiryDate: '2027-06-30', delta: -2, type: 'OUT', reason: 'Sale — INV-2026-0001' },
            { productId: 'p_2', expiryDate: '2027-03-15', delta: -1, type: 'OUT', reason: 'Sale — INV-2026-0001' },
        ]);

        expect(batchUpdates(plan).every(u => u.ConditionExpression === '#qty >= :magnitude')).toBe(true);
        expect(plan.productsNeedingExpiryRecompute).toEqual(['p_1', 'p_2']);
        expect(plan.movements.every(m => m.reason === 'Sale — INV-2026-0001')).toBe(true);
    });
});
