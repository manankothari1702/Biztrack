import { describe, expect, it } from 'vitest';
import type { DiscountTier, InvoiceLine, Product } from '../types';
import {
    DISCOUNT_TIERS,
    costPrice,
    formatInr,
    formatVp,
    invoiceTotals,
    priceForTier,
    priceLine,
    roundVp,
} from './pricing';

// Real rows from docs/inventory/herbalife_products_seed.csv — the four items in
// the worked example at INVOICE_FEATURE_BLUEPRINT.md §14.
const product = (over: Partial<Product> & Pick<Product, 'id' | 'name' | 'vp' | 'retail' | 'price25' | 'price35' | 'price42' | 'price50'>): Product => ({
    category:      'Weight Management',
    reorderLevel:  10,
    totalQuantity: 0,
    createdAt:     '2026-07-18T10:00:00.000Z',
    ...over,
});

const F1_STRAWBERRY = product({
    id: 'p_1239', stockNo: '1239', name: 'Formula 1 - Strawberry - 500 gms',
    vp: 21.75, retail: 2075, price25: 1713, price35: 1526, price42: 1396, price50: 1246,
});
const WOMANS_CHOICE = product({
    id: 'p_127K', stockNo: '127K', name: "Woman's Choice", category: "Women's Health",
    vp: 12.45, retail: 1185, price25: 978, price35: 872, price42: 798, price50: 712,
});
const AFRESH_LEMON = product({
    id: 'p_1295', stockNo: '1295', name: 'Afresh Energy Drink Mix - Lemon - 50 gms', category: 'Energy',
    vp: 7.8, retail: 773, price25: 638, price35: 568, price42: 520, price50: 464,
});
const PROTEIN_POWDER = product({
    id: 'p_1233', stockNo: '1233', name: 'Personalized Protein Powder - 200 gms',
    vp: 11.5, retail: 1233, price25: 1018, price35: 907, price42: 830, price50: 741,
});

describe('priceForTier', () => {
    it('maps each tier to its price column', () => {
        expect(priceForTier(F1_STRAWBERRY, 0)).toBe(2075);   // 0% = Retail, NOT MRP
        expect(priceForTier(F1_STRAWBERRY, 25)).toBe(1713);
        expect(priceForTier(F1_STRAWBERRY, 35)).toBe(1526);
        expect(priceForTier(F1_STRAWBERRY, 42)).toBe(1396);
        expect(priceForTier(F1_STRAWBERRY, 50)).toBe(1246);
    });

    it('covers every tier in DISCOUNT_TIERS', () => {
        for (const tier of DISCOUNT_TIERS) {
            expect(typeof priceForTier(WOMANS_CHOICE, tier)).toBe('number');
        }
    });

    it('prices descend as the discount deepens', () => {
        const prices = DISCOUNT_TIERS.map(t => priceForTier(AFRESH_LEMON, t));
        expect(prices).toEqual([...prices].sort((a, b) => b - a));
    });

    it('treats 50% as the cost price', () => {
        expect(priceForTier(F1_STRAWBERRY, 50)).toBe(costPrice(F1_STRAWBERRY));
    });
});

describe('VP is tier-independent', () => {
    it('gives the same unitVp at every tier', () => {
        const vps = DISCOUNT_TIERS.map(
            tier => priceLine(F1_STRAWBERRY, tier, 2, '2026-11-15').unitVp,
        );
        expect(new Set(vps)).toEqual(new Set([21.75]));
    });

    it('gives the same lineVp at every tier even though the amount changes', () => {
        const lines = DISCOUNT_TIERS.map(tier => priceLine(F1_STRAWBERRY, tier, 2, '2026-11-15'));
        expect(new Set(lines.map(l => l.lineVp))).toEqual(new Set([43.5]));
        expect(new Set(lines.map(l => l.lineAmount)).size).toBe(DISCOUNT_TIERS.length);
    });
});

describe('roundVp', () => {
    it('rounds to 2dp', () => {
        expect(roundVp(90.8500001)).toBe(90.85);
        expect(roundVp(23.400000000000002)).toBe(23.4);
        expect(roundVp(7.845)).toBe(7.85);
    });

    it('documents the known half-way limit of Math.round(x*100)/100', () => {
        // 1.005 * 100 === 100.49999999999999 in binary floating point, so this
        // rounds DOWN. TRD §7 prescribes this exact formula, and the domain
        // never reaches the boundary: VP is quoted to 2dp and quantities are
        // integers, so raw sums sit ~1e-14 from an exact 2dp value, never 5e-3.
        // Recorded so nobody "fixes" it by accident.
        expect(1.005 * 100).toBeLessThan(100.5);
        expect(roundVp(1.005)).toBe(1);
    });

    it('clears binary float drift from a raw sum', () => {
        expect(0.1 + 0.2).not.toBe(0.3);          // the problem
        expect(roundVp(0.1 + 0.2)).toBe(0.3);     // the fix
    });

    it('is a no-op on values already at 2dp', () => {
        expect(roundVp(90.85)).toBe(90.85);
        expect(roundVp(7.8)).toBe(7.8);
        expect(roundVp(0)).toBe(0);
    });
});

describe('formatInr', () => {
    it('uses Indian digit grouping', () => {
        expect(formatInr(7336)).toBe('₹7,336');
        expect(formatInr(33832)).toBe('₹33,832');
        expect(formatInr(1234567)).toBe('₹12,34,567');   // lakh grouping, not 1,234,567
    });

    it('renders whole rupees only', () => {
        expect(formatInr(1246.4)).toBe('₹1,246');
        expect(formatInr(1246.5)).toBe('₹1,247');
    });

    it('never renders a negative zero', () => {
        expect(formatInr(0)).toBe('₹0');
        expect(formatInr(-0.2)).toBe('₹0');
    });
});

describe('formatVp', () => {
    it('always shows 2dp', () => {
        expect(formatVp(7.8)).toBe('7.80');
        expect(formatVp(90.85)).toBe('90.85');
        expect(formatVp(261)).toBe('261.00');
    });
});

// INVOICE_FEATURE_BLUEPRINT.md §14 — tier 25%, four lines.
describe('worked example: 25% sale invoice', () => {
    const lines: InvoiceLine[] = [
        priceLine(F1_STRAWBERRY,  25, 2, '2026-11-15'),
        priceLine(WOMANS_CHOICE,  25, 1, '2027-03-15'),
        priceLine(AFRESH_LEMON,   25, 3, '2027-01-20'),
        priceLine(PROTEIN_POWDER, 25, 1, '2027-02-10'),
    ];

    it('prices each line off the price25 column', () => {
        expect(lines.map(l => l.unitPrice)).toEqual([1713, 978, 638, 1018]);
        expect(lines.map(l => l.lineAmount)).toEqual([3426, 978, 1914, 1018]);
    });

    it('computes per-line VP', () => {
        expect(lines.map(l => roundVp(l.lineVp))).toEqual([43.5, 12.45, 23.4, 11.5]);
    });

    it('totals to ₹7,336 · 90.85 VP · 7 items', () => {
        const totals = invoiceTotals(lines);
        expect(totals.totalAmount).toBe(7336);
        expect(totals.totalVp).toBe(90.85);
        expect(totals.totalItems).toBe(7);
        expect(formatInr(totals.totalAmount)).toBe('₹7,336');
    });

    it('tracks internal cost at 50%, separate from the sale total', () => {
        // 2×1246 + 1×712 + 3×464 + 1×741 = 2492 + 712 + 1392 + 741 = 5337.
        // NB: the blueprint §14 prose states 5381 for this sum — that is an
        // arithmetic slip in the doc. Every multiplicand there matches the seed
        // (1246 / 712 / 464 / 741); only the stated total is wrong.
        expect(invoiceTotals(lines).totalCost).toBe(5337);
    });

    it('keeps cost strictly below the sale total (this invoice is profitable)', () => {
        const totals = invoiceTotals(lines);
        expect(totals.totalCost).toBeLessThan(totals.totalAmount);
    });
});

describe('invoiceTotals', () => {
    it('rounds VP once at the total, not per line', () => {
        // Three lines whose raw sum drifts in binary floating point.
        const drifty: InvoiceLine[] = [0.1, 0.1, 0.1].map((vp, i) => ({
            productId: `p_${i}`, name: `p${i}`, unitPrice: 100, unitVp: vp,
            quantity: 1, lineAmount: 100, lineVp: vp, expiryDate: '2027-01-01',
        }));
        expect(drifty.reduce((s, l) => s + l.lineVp, 0)).not.toBe(0.3);
        expect(invoiceTotals(drifty).totalVp).toBe(0.3);
    });

    it('returns zeroes for an empty invoice', () => {
        expect(invoiceTotals([])).toEqual({
            totalAmount: 0, totalVp: 0, totalItems: 0, totalCost: 0,
        });
    });

    it('treats a line with no unitCost as zero cost', () => {
        const line: InvoiceLine = {
            productId: 'p_1', name: 'x', unitPrice: 100, unitVp: 1,
            quantity: 2, lineAmount: 200, lineVp: 2, expiryDate: '2027-01-01',
        };
        expect(invoiceTotals([line]).totalCost).toBe(0);
    });

    it('sums a purchase at 50% — blueprint §14 restock example', () => {
        const lines: InvoiceLine[] = [
            priceLine(F1_STRAWBERRY, 50, 12, '2027-06-30'),
            priceLine(WOMANS_CHOICE, 50,  6, '2027-03-15'),
            priceLine(AFRESH_LEMON,  50, 10, '2027-01-20'),
        ];
        const totals = invoiceTotals(lines);
        expect(totals.totalAmount).toBe(23864);
        expect(totals.totalVp).toBe(413.7);
        expect(totals.totalItems).toBe(28);
        expect(formatInr(totals.totalAmount)).toBe('₹23,864');
    });
});

describe('type safety', () => {
    it('accepts only the five defined tiers', () => {
        const tiers: DiscountTier[] = [0, 25, 35, 42, 50];
        expect(DISCOUNT_TIERS).toEqual(tiers);
    });
});
