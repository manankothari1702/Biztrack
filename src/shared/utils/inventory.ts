import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Batch, ExpiryStatus, IsoDate, Product, StockStatus } from '../types';
import { roundVp } from './pricing';

// ── Date-only helpers ───────────────────────────────────────────────────────
//
// Expiries are calendar dates (`YYYY-MM-DD`). Because ISO dates sort
// lexicographically, all COMPARISONS below are plain string comparisons —
// no Date objects, so no timezone can shift a day boundary underneath us.
// date-fns is used only for ARITHMETIC (shifting a date by N days, counting
// days between two dates), and only on locally-parsed date-only values.

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Days-out threshold for the "Expiring Soon" badge. */
export const EXPIRING_SOON_DAYS = 30;

/**
 * Today as an `IsoDate`, in the user's timezone.
 *
 * `new Date().toISOString().slice(0, 10)` would be UTC and is wrong for
 * Asia/Kolkata (+05:30) for 5.5 hours of every day. The `en-CA` locale
 * formats as `YYYY-MM-DD`, which is exactly the shape we want.
 */
export const todayIso = (timeZone: string = DEFAULT_TIMEZONE): IsoDate =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year:  'numeric',
        month: '2-digit',
        day:   '2-digit',
    }).format(new Date());

/** Shift an `IsoDate` by N calendar days, staying date-only throughout. */
export const addDaysIso = (date: IsoDate, days: number): IsoDate =>
    format(addDays(parseISO(date), days), 'yyyy-MM-dd');

/** Calendar days from `today` until `date`. Negative once the date has passed. */
export const daysUntil = (date: IsoDate, today: IsoDate = todayIso()): number =>
    differenceInCalendarDays(parseISO(date), parseISO(today));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * `2026-11-15` → `15 Nov 2026`, for display.
 *
 * Formats from the string's own components rather than via `new Date(...)`,
 * which would parse a date-only value as UTC midnight and render the previous
 * day for any viewer west of UTC.
 */
export const formatIsoDate = (date?: IsoDate): string => {
    if (!date) return '—';
    const [y, m, d] = date.split('-');
    const month = MONTHS[Number(m) - 1];
    if (!month || !y || !d) return date;
    return `${Number(d)} ${month} ${y}`;
};

// ── Expiry status ───────────────────────────────────────────────────────────

/**
 * Expiry banding for a single date.
 *
 *   date <  today                 -> 'Expired'
 *   date <= today + soonDays      -> 'Expiring Soon'   (today itself counts)
 *   otherwise                     -> 'OK'
 *
 * Note a batch expiring TODAY is "Expiring Soon", not "Expired" — it is still
 * sellable for the rest of the day.
 */
export const getExpiryStatus = (
    date: IsoDate,
    soonDays: number = EXPIRING_SOON_DAYS,
    today: IsoDate = todayIso(),
): ExpiryStatus => {
    if (date < today) return 'Expired';
    return date <= addDaysIso(today, soonDays) ? 'Expiring Soon' : 'OK';
};

export const getBatchExpiryStatus = (
    batch: Pick<Batch, 'expiryDate'>,
    soonDays: number = EXPIRING_SOON_DAYS,
    today: IsoDate = todayIso(),
): ExpiryStatus => getExpiryStatus(batch.expiryDate, soonDays, today);

/**
 * Product-level badge, derived from the cached earliest expiry.
 * A product with no batches has nothing to warn about -> 'OK'.
 */
export const getProductExpiryStatus = (
    product: Pick<Product, 'earliestExpiry'>,
    soonDays: number = EXPIRING_SOON_DAYS,
    today: IsoDate = todayIso(),
): ExpiryStatus =>
    product.earliestExpiry
        ? getExpiryStatus(product.earliestExpiry, soonDays, today)
        : 'OK';

export const isExpired = (date: IsoDate, today: IsoDate = todayIso()): boolean =>
    date < today;

export const isExpiringSoon = (
    date: IsoDate,
    soonDays: number = EXPIRING_SOON_DAYS,
    today: IsoDate = todayIso(),
): boolean => getExpiryStatus(date, soonDays, today) === 'Expiring Soon';

// ── Stock status ────────────────────────────────────────────────────────────

/**
 * Stock banding from the cached roll-up.
 * At exactly `reorderLevel` the product IS Low Stock — the threshold is the
 * point at which you reorder, not the point after it.
 */
export const getStockStatus = (
    product: Pick<Product, 'totalQuantity' | 'reorderLevel'>,
): StockStatus => {
    if (product.totalQuantity <= 0) return 'Out of Stock';
    return product.totalQuantity <= product.reorderLevel ? 'Low Stock' : 'In Stock';
};

export const isLowStock = (
    product: Pick<Product, 'totalQuantity' | 'reorderLevel'>,
): boolean => getStockStatus(product) === 'Low Stock';

// ── Valuation ───────────────────────────────────────────────────────────────
//
// Stock is valued at price50 — what it cost you, not what you'd sell it for.

/** Value of a product's whole on-hand stock, in whole rupees. */
export const productValue = (
    product: Pick<Product, 'totalQuantity' | 'price50'>,
): number => product.totalQuantity * product.price50;

/** Value of a single batch, in whole rupees. Used by the write-off dialog. */
export const batchValue = (
    batch: Pick<Batch, 'quantity'>,
    product: Pick<Product, 'price50'>,
): number => batch.quantity * product.price50;

/** VP sitting in a product's stock, rounded for display. */
export const vpInStock = (product: Pick<Product, 'totalQuantity' | 'vp'>): number =>
    roundVp(product.totalQuantity * product.vp);

export interface InventoryTotals {
    totalUnits: number;    // Σ totalQuantity
    stockValue: number;    // Σ totalQuantity × price50, whole rupees
    vpInStock: number;     // Σ totalQuantity × vp, rounded ONCE to 2dp
    productCount: number;  // catalogue size (all products, stocked or not)
}

/**
 * Grand totals for the valuation cards.
 *
 * VP is accumulated raw across every product and rounded a single time at the
 * end — NOT by summing each product's already-rounded `vpInStock`.
 */
export const inventoryTotals = (
    products: readonly Pick<Product, 'totalQuantity' | 'price50' | 'vp'>[],
): InventoryTotals => {
    let totalUnits = 0;
    let stockValue = 0;
    let rawVp      = 0;

    for (const product of products) {
        totalUnits += product.totalQuantity;
        stockValue += product.totalQuantity * product.price50;
        rawVp      += product.totalQuantity * product.vp;
    }

    return {
        totalUnits,
        stockValue,
        vpInStock:    roundVp(rawVp),
        productCount: products.length,
    };
};

// ── Dashboard / page statistics ─────────────────────────────────────────────

export interface InventoryStats extends InventoryTotals {
    /** Batches WITH STOCK expiring today … today+soonDays. */
    expiringSoon: number;
    /** Batches WITH STOCK already past their expiry — value still counted until written off. */
    expired: number;
    /** Products at or below reorderLevel but not yet empty. */
    lowStock: number;
    /** Products with no stock at all. Distinct from lowStock, never both. */
    outOfStock: number;
}

/**
 * Everything the valuation cards and alert cards need, in one pass.
 *
 * Expiry counts are **per batch**, not per product: a product can hold one
 * expired lot and three healthy ones, and "1 expired batch" is the actionable
 * number — it is a batch that gets written off. Stock counts are **per product**,
 * because reordering is a product-level decision.
 *
 * Zero-quantity batches are ignored entirely. They are retained as history
 * (movement records reference them) but an emptied lot is not an expiry problem.
 *
 * Valuation comes from the products' cached `totalQuantity`, not from summing
 * batches, so it matches what the server considers authoritative.
 */
export const inventoryStats = (
    products: readonly Pick<Product, 'totalQuantity' | 'reorderLevel' | 'price50' | 'vp'>[],
    batches: readonly Pick<Batch, 'expiryDate' | 'quantity'>[],
    options: { today?: IsoDate; soonDays?: number } = {},
): InventoryStats => {
    const today    = options.today ?? todayIso();
    const soonDays = options.soonDays ?? EXPIRING_SOON_DAYS;

    let expiringSoon = 0;
    let expired      = 0;
    for (const batch of batches) {
        if (batch.quantity <= 0) continue;
        const status = getExpiryStatus(batch.expiryDate, soonDays, today);
        if (status === 'Expired') expired++;
        else if (status === 'Expiring Soon') expiringSoon++;
    }

    let lowStock   = 0;
    let outOfStock = 0;
    for (const product of products) {
        const status = getStockStatus(product);
        if (status === 'Low Stock') lowStock++;
        else if (status === 'Out of Stock') outOfStock++;
    }

    return { ...inventoryTotals(products), expiringSoon, expired, lowStock, outOfStock };
};

// ── Batch ordering ──────────────────────────────────────────────────────────

/**
 * Sort batches soonest-expiry-first.
 *
 * DISPLAY ORDER ONLY. There is no FEFO in v1: on a sale the user picks the
 * batch they physically took off the shelf, and selling from a later-expiring
 * batch while an earlier one still has stock is normal and must not be warned
 * about, blocked, or nudged against. Never use this to preselect a batch.
 */
export const sortBatchesByExpiry = <T extends Pick<Batch, 'expiryDate'>>(
    batches: readonly T[],
): T[] => [...batches].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

/** Batches with stock left. Zero-quantity batches are kept but hidden by default. */
export const withStock = <T extends Pick<Batch, 'quantity'>>(
    batches: readonly T[],
): T[] => batches.filter(b => b.quantity > 0);
