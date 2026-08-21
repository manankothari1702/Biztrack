import { describe, expect, it } from 'vitest';
import type { Batch, Product } from '../types';
import {
    DEFAULT_TIMEZONE,
    EXPIRING_SOON_DAYS,
    addDaysIso,
    batchValue,
    daysUntil,
    getBatchExpiryStatus,
    getExpiryStatus,
    getProductExpiryStatus,
    getStockStatus,
    inventoryStats,
    inventoryTotals,
    isExpired,
    isLowStock,
    productValue,
    sortBatchesByExpiry,
    todayIso,
    vpInStock,
    withStock,
} from './inventory';

// A fixed "today" so the expiry bands are deterministic. Every test that cares
// passes it explicitly rather than relying on the clock.
const TODAY = '2026-07-22';

const product = (over: Partial<Product> = {}): Product => ({
    id:            'p_1',
    name:          'Formula 1 - Strawberry - 500 gms',
    category:      'Weight Management',
    vp:            21.75,
    retail:        2075,
    price25:       1713,
    price35:       1526,
    price42:       1396,
    price50:       1246,
    reorderLevel:  10,
    totalQuantity: 20,
    createdAt:     '2026-07-18T10:00:00.000Z',
    ...over,
});

const batch = (over: Partial<Batch> = {}): Batch => ({
    id:         'p_1#2026-11-15',
    productId:  'p_1',
    expiryDate: '2026-11-15',
    quantity:   8,
    createdAt:  '2026-07-18T10:00:00.000Z',
    ...over,
});

describe('todayIso', () => {
    it('returns a date-only ISO string', () => {
        expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('resolves the day in the given timezone, not UTC', () => {
        // Kiribati is UTC+14, Baker Island UTC-12: 26 hours apart, so on any
        // real instant they cannot both be on the same calendar day.
        expect(todayIso('Pacific/Kiritimati')).not.toBe(todayIso('Etc/GMT+12'));
    });
});

describe('addDaysIso', () => {
    it('stays date-only and crosses month and year ends', () => {
        expect(addDaysIso('2026-07-22', 30)).toBe('2026-08-21');
        expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
        expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');  // leap year
    });
});

describe('getExpiryStatus — boundaries', () => {
    it('today is Expiring Soon, not Expired (still sellable)', () => {
        expect(getExpiryStatus(TODAY, EXPIRING_SOON_DAYS, TODAY)).toBe('Expiring Soon');
    });

    it('yesterday is Expired', () => {
        expect(getExpiryStatus('2026-07-21', EXPIRING_SOON_DAYS, TODAY)).toBe('Expired');
    });

    it('today + 30 is the last Expiring Soon day', () => {
        expect(getExpiryStatus('2026-08-21', EXPIRING_SOON_DAYS, TODAY)).toBe('Expiring Soon');
    });

    it('today + 31 is OK', () => {
        expect(getExpiryStatus('2026-08-22', EXPIRING_SOON_DAYS, TODAY)).toBe('OK');
    });

    it('honours a custom window', () => {
        expect(getExpiryStatus('2026-07-29', 7, TODAY)).toBe('Expiring Soon');
        expect(getExpiryStatus('2026-07-30', 7, TODAY)).toBe('OK');
    });

    it('handles a zero-day window — only today counts', () => {
        expect(getExpiryStatus(TODAY, 0, TODAY)).toBe('Expiring Soon');
        expect(getExpiryStatus('2026-07-23', 0, TODAY)).toBe('OK');
    });
});

describe('getExpiryStatus — compares lexicographically', () => {
    it('bands correctly across a year boundary', () => {
        const nye = '2026-12-31';
        expect(getExpiryStatus('2026-12-30', EXPIRING_SOON_DAYS, nye)).toBe('Expired');
        expect(getExpiryStatus('2027-01-01', EXPIRING_SOON_DAYS, nye)).toBe('Expiring Soon');
        expect(getExpiryStatus('2027-01-30', EXPIRING_SOON_DAYS, nye)).toBe('Expiring Soon');
        expect(getExpiryStatus('2027-01-31', EXPIRING_SOON_DAYS, nye)).toBe('OK');
    });

    it('is unaffected by the host timezone', () => {
        // A Date-based implementation would parse '2026-07-22' as UTC midnight
        // and could land on the 21st for anyone west of UTC. String comparison
        // cannot: the same inputs must always give the same band.
        expect(getExpiryStatus('2026-07-22', 30, '2026-07-22')).toBe('Expiring Soon');
        expect(getExpiryStatus('2026-01-01', 30, '2026-01-01')).toBe('Expiring Soon');
    });

    it('orders ISO dates the same way chronology does', () => {
        expect('2026-08-21' < '2026-08-22').toBe(true);
        expect('2026-12-31' < '2027-01-01').toBe(true);
        expect('2026-09-01' < '2026-10-01').toBe(true);
    });
});

describe('daysUntil', () => {
    it('counts calendar days in both directions', () => {
        expect(daysUntil('2026-07-22', TODAY)).toBe(0);
        expect(daysUntil('2026-08-21', TODAY)).toBe(30);
        expect(daysUntil('2026-07-21', TODAY)).toBe(-1);
    });
});

describe('isExpired', () => {
    it('is exclusive of today', () => {
        expect(isExpired('2026-07-21', TODAY)).toBe(true);
        expect(isExpired(TODAY, TODAY)).toBe(false);
        expect(isExpired('2026-07-23', TODAY)).toBe(false);
    });
});

describe('getBatchExpiryStatus / getProductExpiryStatus', () => {
    it('bands a batch by its own expiry', () => {
        expect(getBatchExpiryStatus(batch({ expiryDate: '2026-07-01' }), 30, TODAY)).toBe('Expired');
        expect(getBatchExpiryStatus(batch({ expiryDate: '2026-08-01' }), 30, TODAY)).toBe('Expiring Soon');
        expect(getBatchExpiryStatus(batch({ expiryDate: '2027-06-30' }), 30, TODAY)).toBe('OK');
    });

    it('bands a product by its cached earliest expiry', () => {
        expect(getProductExpiryStatus(product({ earliestExpiry: '2026-07-01' }), 30, TODAY)).toBe('Expired');
        expect(getProductExpiryStatus(product({ earliestExpiry: '2027-06-30' }), 30, TODAY)).toBe('OK');
    });

    it('reports OK when a product has no batches at all', () => {
        expect(getProductExpiryStatus(product({ earliestExpiry: undefined }), 30, TODAY)).toBe('OK');
    });
});

describe('getStockStatus — boundaries', () => {
    it('is Low Stock at exactly reorderLevel', () => {
        expect(getStockStatus(product({ totalQuantity: 10, reorderLevel: 10 }))).toBe('Low Stock');
    });

    it('is In Stock one unit above reorderLevel', () => {
        expect(getStockStatus(product({ totalQuantity: 11, reorderLevel: 10 }))).toBe('In Stock');
    });

    it('is Low Stock one unit below reorderLevel', () => {
        expect(getStockStatus(product({ totalQuantity: 9, reorderLevel: 10 }))).toBe('Low Stock');
    });

    it('is Out of Stock at zero, which beats Low Stock', () => {
        expect(getStockStatus(product({ totalQuantity: 0, reorderLevel: 10 }))).toBe('Out of Stock');
        expect(getStockStatus(product({ totalQuantity: 0, reorderLevel: 0 }))).toBe('Out of Stock');
    });

    it('treats negative stock as Out of Stock rather than crashing', () => {
        expect(getStockStatus(product({ totalQuantity: -3, reorderLevel: 10 }))).toBe('Out of Stock');
    });

    it('never reports Low Stock when reorderLevel is 0', () => {
        expect(getStockStatus(product({ totalQuantity: 1, reorderLevel: 0 }))).toBe('In Stock');
    });

    it('isLowStock agrees with getStockStatus', () => {
        expect(isLowStock(product({ totalQuantity: 10, reorderLevel: 10 }))).toBe(true);
        expect(isLowStock(product({ totalQuantity: 0,  reorderLevel: 10 }))).toBe(false); // Out, not Low
    });
});

describe('valuation', () => {
    it('values stock at the 50% cost price', () => {
        expect(productValue(product({ totalQuantity: 20, price50: 1246 }))).toBe(24920);
    });

    it('values a single batch', () => {
        expect(batchValue(batch({ quantity: 8 }), product())).toBe(9968);
    });

    it('computes VP in stock', () => {
        expect(vpInStock(product({ totalQuantity: 20, vp: 21.75 }))).toBe(435);
        expect(vpInStock(product({ totalQuantity: 6,  vp: 12.45 }))).toBe(74.7);
    });

    it('is zero for an empty shelf', () => {
        const empty = product({ totalQuantity: 0 });
        expect(productValue(empty)).toBe(0);
        expect(vpInStock(empty)).toBe(0);
    });
});

describe('inventoryTotals', () => {
    // UI_REFERENCE §2 shows 20 × F1 @1246 and 6 × Woman's Choice @712.
    const shelf = [
        product({ id: 'p_1', totalQuantity: 20, price50: 1246, vp: 21.75 }),
        product({ id: 'p_2', totalQuantity: 6,  price50: 712,  vp: 12.45 }),
    ];

    it('sums units, value and VP', () => {
        expect(inventoryTotals(shelf)).toEqual({
            totalUnits:   26,
            stockValue:   24920 + 4272,
            vpInStock:    435 + 74.7,
            productCount: 2,
        });
    });

    it('rounds VP once at the total, not per product', () => {
        const drifty = [0.1, 0.1, 0.1].map((vp, i) =>
            product({ id: `p_${i}`, totalQuantity: 1, vp, price50: 0 }));
        expect(drifty.reduce((s, p) => s + p.totalQuantity * p.vp, 0)).not.toBe(0.3);
        expect(inventoryTotals(drifty).vpInStock).toBe(0.3);
    });

    it('counts zero-stock products in productCount but not in the totals', () => {
        const totals = inventoryTotals([...shelf, product({ id: 'p_3', totalQuantity: 0 })]);
        expect(totals.productCount).toBe(3);
        expect(totals.totalUnits).toBe(26);
    });

    it('returns zeroes for an empty catalogue', () => {
        expect(inventoryTotals([])).toEqual({
            totalUnits: 0, stockValue: 0, vpInStock: 0, productCount: 0,
        });
    });
});

describe('inventoryStats', () => {
    // TODAY = 2026-07-22, soonDays = 30 -> the window closes on 2026-08-21.
    const stocked = (over: Partial<Product> = {}) =>
        product({ totalQuantity: 20, reorderLevel: 10, price50: 1246, vp: 21.75, ...over });

    it('returns all zeroes for an empty catalogue', () => {
        expect(inventoryStats([], [], { today: TODAY })).toEqual({
            totalUnits: 0, stockValue: 0, vpInStock: 0, productCount: 0,
            expiringSoon: 0, expired: 0, lowStock: 0, outOfStock: 0,
        });
    });

    it('handles products with no batches at all', () => {
        // A freshly imported catalogue: priced, counted, but nothing on the shelf.
        const stats = inventoryStats(
            [product({ totalQuantity: 0 }), product({ totalQuantity: 0 })], [], { today: TODAY });
        expect(stats.productCount).toBe(2);
        expect(stats.outOfStock).toBe(2);
        expect(stats.lowStock).toBe(0);
        expect(stats.totalUnits).toBe(0);
        expect(stats.stockValue).toBe(0);
        expect(stats.expiringSoon).toBe(0);
        expect(stats.expired).toBe(0);
    });

    it('treats a product whose batches sum to zero as out of stock, not low', () => {
        // Every lot emptied. The batch rows survive as history and must not be
        // counted as an expiry problem.
        const stats = inventoryStats(
            [product({ totalQuantity: 0, reorderLevel: 10 })],
            [
                batch({ expiryDate: '2026-07-01', quantity: 0 }),   // would be Expired if counted
                batch({ expiryDate: '2026-08-01', quantity: 0 }),   // would be Expiring Soon if counted
            ],
            { today: TODAY },
        );
        expect(stats.outOfStock).toBe(1);
        expect(stats.lowStock).toBe(0);
        expect(stats.expired).toBe(0);
        expect(stats.expiringSoon).toBe(0);
        expect(stats.stockValue).toBe(0);
    });

    describe('expiry boundaries, resolved against an explicit today', () => {
        const at = (expiryDate: string) =>
            inventoryStats([stocked()], [batch({ expiryDate, quantity: 5 })], { today: TODAY });

        it('today counts as expiring soon, not expired — still sellable', () => {
            expect(at('2026-07-22')).toMatchObject({ expiringSoon: 1, expired: 0 });
        });

        it('today-1 is expired', () => {
            expect(at('2026-07-21')).toMatchObject({ expiringSoon: 0, expired: 1 });
        });

        it('today+30 is the last expiring-soon day', () => {
            expect(at('2026-08-21')).toMatchObject({ expiringSoon: 1, expired: 0 });
        });

        it('today+31 is neither', () => {
            expect(at('2026-08-22')).toMatchObject({ expiringSoon: 0, expired: 0 });
        });

        it('honours a custom window', () => {
            const within = inventoryStats([stocked()], [batch({ expiryDate: '2026-07-29', quantity: 5 })],
                { today: TODAY, soonDays: 7 });
            const beyond = inventoryStats([stocked()], [batch({ expiryDate: '2026-07-30', quantity: 5 })],
                { today: TODAY, soonDays: 7 });
            expect(within.expiringSoon).toBe(1);
            expect(beyond.expiringSoon).toBe(0);
        });
    });

    it("defaults today to the user's timezone, not a UTC slice", () => {
        // No fixed date here — the point is which clock the default uses.
        // new Date().toISOString().slice(0,10) is UTC and disagrees with
        // Asia/Kolkata for 5.5 hours of every day, which would mis-band a lot
        // expiring today or yesterday.
        const todayLocal = todayIso(DEFAULT_TIMEZONE);
        const yesterdayLocal = addDaysIso(todayLocal, -1);

        expect(inventoryStats([stocked()], [batch({ expiryDate: todayLocal, quantity: 5 })]))
            .toMatchObject({ expiringSoon: 1, expired: 0 });
        expect(inventoryStats([stocked()], [batch({ expiryDate: yesterdayLocal, quantity: 5 })]))
            .toMatchObject({ expiringSoon: 0, expired: 1 });
    });

    it('bands the same batch differently in timezones a day apart', () => {
        // Kiritimati (UTC+14) and Baker Island (UTC-12) are 26 hours apart, so
        // they can never share a calendar day. A lot expiring on the earlier of
        // the two dates is already expired in the later zone.
        const [earlier, later] = [todayIso('Etc/GMT+12'), todayIso('Pacific/Kiritimati')].sort();
        const lot = [batch({ expiryDate: earlier, quantity: 5 })];

        expect(inventoryStats([stocked()], lot, { today: earlier }))
            .toMatchObject({ expiringSoon: 1, expired: 0 });
        expect(inventoryStats([stocked()], lot, { today: later }))
            .toMatchObject({ expiringSoon: 0, expired: 1 });
    });

    describe('stock banding', () => {
        it('counts Low Stock at EXACTLY reorderLevel', () => {
            expect(inventoryStats([product({ totalQuantity: 10, reorderLevel: 10 })], [], { today: TODAY }))
                .toMatchObject({ lowStock: 1, outOfStock: 0 });
        });

        it('one unit above reorderLevel is neither low nor out', () => {
            expect(inventoryStats([product({ totalQuantity: 11, reorderLevel: 10 })], [], { today: TODAY }))
                .toMatchObject({ lowStock: 0, outOfStock: 0 });
        });

        it('zero is out of stock, never also low', () => {
            const stats = inventoryStats([product({ totalQuantity: 0, reorderLevel: 10 })], [], { today: TODAY });
            expect(stats.outOfStock).toBe(1);
            expect(stats.lowStock).toBe(0);
        });

        it('a product is never counted in both bands', () => {
            const stats = inventoryStats([
                product({ totalQuantity: 0,  reorderLevel: 10 }),
                product({ totalQuantity: 10, reorderLevel: 10 }),
                product({ totalQuantity: 50, reorderLevel: 10 }),
            ], [], { today: TODAY });
            expect(stats.lowStock + stats.outOfStock).toBeLessThanOrEqual(stats.productCount);
            expect(stats).toMatchObject({ lowStock: 1, outOfStock: 1, productCount: 3 });
        });
    });

    it('counts expiry per BATCH and stock per PRODUCT', () => {
        // One product, three lots: two problematic, one fine. That is 2 expiry
        // alerts (each lot is separately written off), from 1 product.
        const stats = inventoryStats(
            [stocked({ totalQuantity: 30 })],
            [
                batch({ expiryDate: '2026-07-01', quantity: 5 }),   // expired
                batch({ expiryDate: '2026-08-01', quantity: 10 }),  // expiring soon
                batch({ expiryDate: '2027-06-30', quantity: 15 }),  // fine
            ],
            { today: TODAY },
        );
        expect(stats).toMatchObject({ expired: 1, expiringSoon: 1, productCount: 1 });
    });

    it('carries the valuation totals through unchanged', () => {
        const shelf = [
            product({ totalQuantity: 20, price50: 1246, vp: 21.75 }),
            product({ totalQuantity: 6,  price50: 712,  vp: 12.45 }),
        ];
        const stats = inventoryStats(shelf, [], { today: TODAY });
        expect(stats).toMatchObject({
            totalUnits: 26, stockValue: 24920 + 4272, vpInStock: 435 + 74.7, productCount: 2,
        });
        expect(stats.stockValue).toBe(inventoryTotals(shelf).stockValue);
    });

    it('values from the cached product roll-up, not from summing batches', () => {
        // The two disagree here; the product row is what the server maintains
        // transactionally and is therefore authoritative.
        const stats = inventoryStats(
            [product({ totalQuantity: 20, price50: 100 })],
            [batch({ quantity: 3 })],
            { today: TODAY },
        );
        expect(stats.stockValue).toBe(2000);
        expect(stats.totalUnits).toBe(20);
    });
});

describe('batch listing helpers', () => {
    const batches = [
        batch({ id: 'b3', expiryDate: '2027-06-30', quantity: 12 }),
        batch({ id: 'b1', expiryDate: '2026-11-15', quantity: 8 }),
        batch({ id: 'b2', expiryDate: '2027-01-20', quantity: 0 }),
    ];

    it('sorts soonest-expiry-first for display', () => {
        expect(sortBatchesByExpiry(batches).map(b => b.id)).toEqual(['b1', 'b2', 'b3']);
    });

    it('does not mutate the input', () => {
        const before = batches.map(b => b.id);
        sortBatchesByExpiry(batches);
        expect(batches.map(b => b.id)).toEqual(before);
    });

    it('hides zero-quantity batches', () => {
        expect(withStock(batches).map(b => b.id)).toEqual(['b3', 'b1']);
    });

    // v1 has NO FEFO: sorting is presentation only. There is deliberately no
    // "suggested batch" helper here — the user picks the batch they physically
    // took, and selling a later expiry while an earlier one has stock is normal.
    it('exposes no batch auto-selection helper', async () => {
        const api = Object.keys(await import('./inventory'));
        const autoSelectors = api.filter(k =>
            /fefo|pickBatch|selectBatch|suggestedBatch|defaultBatch|autoSelect|earliestBatch/i.test(k));
        expect(autoSelectors).toEqual([]);
    });
});
