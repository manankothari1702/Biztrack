import type { DiscountTier, InvoiceLine, Product } from '../types';

// ── Discount tiers ──────────────────────────────────────────────────────────

export const DISCOUNT_TIERS: readonly DiscountTier[] = [0, 25, 35, 42, 50] as const;

/** The `Product` price field each tier reads from. 0% is Retail, not MRP (PRD §6). */
const TIER_FIELD: Record<DiscountTier, keyof PriceFields> = {
    0:  'retail',
    25: 'price25',
    35: 'price35',
    42: 'price42',
    50: 'price50',
};

/** Just the pricing surface of a Product — so callers can pass a partial. */
export type PriceFields = Pick<Product, 'retail' | 'price25' | 'price35' | 'price42' | 'price50'>;

/**
 * Unit price for a product at a given discount tier.
 * VP is deliberately absent: volume points do NOT change with the tier.
 */
export const priceForTier = (product: PriceFields, tier: DiscountTier): number =>
    product[TIER_FIELD[tier]];

/** A purchase is always bought at 50% — this is the user's cost. */
export const costPrice = (product: Pick<Product, 'price50'>): number => product.price50;

// ── Volume points ───────────────────────────────────────────────────────────

/**
 * Round a VP figure to 2 decimal places.
 *
 * Apply this ONCE, to a total — never per line before summing. Rounding each
 * line first and then adding compounds the error; the price list quotes VP to
 * 2dp and the monthly volume figure has to reconcile with Herbalife's.
 */
export const roundVp = (vp: number): number => Math.round(vp * 100) / 100;

/** Display form for VP — always 2dp, e.g. `90.85`, `7.80`. */
export const formatVp = (vp: number): string => roundVp(vp).toFixed(2);

// ── Money ───────────────────────────────────────────────────────────────────

/**
 * Format whole rupees with Indian digit grouping: `7336` → `₹7,336`,
 * `1234567` → `₹12,34,567`.
 *
 * The price list carries no paise, so money is integer rupees throughout.
 */
export const formatInr = (amount: number): string => {
    const rupees = Math.round(amount);
    // `rupees === 0` also catches -0, which would otherwise render as "-0".
    return `₹${(rupees === 0 ? 0 : rupees).toLocaleString('en-IN')}`;
};

// ── Line & invoice arithmetic ───────────────────────────────────────────────

/**
 * Compute the priced fields of a line from a product + tier + quantity.
 * The server does this authoritatively on save; the builder uses it for live
 * preview so the two agree before the round-trip.
 */
export const priceLine = (
    product: Product,
    tier: DiscountTier,
    quantity: number,
    expiryDate: string,
): InvoiceLine => {
    const unitPrice = priceForTier(product, tier);
    return {
        productId:  product.id,
        stockNo:    product.stockNo,
        name:       product.name,
        unitPrice,
        unitVp:     product.vp,
        quantity,
        lineAmount: unitPrice * quantity,
        lineVp:     product.vp * quantity,   // raw — rounded once at the total
        expiryDate,
        unitCost:   product.price50,
    };
};

export interface InvoiceTotals {
    totalAmount: number;   // Σ lineAmount, whole rupees
    totalVp: number;       // Σ lineVp, rounded ONCE to 2dp
    totalItems: number;    // Σ quantity
    totalCost: number;     // Σ unitCost × quantity — INTERNAL, never printed on a SALE
}

/**
 * Invoice totals. This is where the VP rounding rule is enforced: line VPs are
 * summed raw and the sum is rounded a single time.
 */
export const invoiceTotals = (lines: readonly InvoiceLine[]): InvoiceTotals => {
    let totalAmount = 0;
    let rawVp       = 0;
    let totalItems  = 0;
    let totalCost   = 0;

    for (const line of lines) {
        totalAmount += line.lineAmount;
        rawVp       += line.lineVp;
        totalItems  += line.quantity;
        totalCost   += (line.unitCost ?? 0) * line.quantity;
    }

    return { totalAmount, totalVp: roundVp(rawVp), totalItems, totalCost };
};
