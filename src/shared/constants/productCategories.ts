import type { ProductCategory } from '../types';

/**
 * The 15 categories present in `docs/inventory/herbalife_products_seed.csv`,
 * plus `Other`. The catalogue is the source of truth (PRD §7) — an earlier
 * draft used a different list that matched none of the 57 seed rows.
 */
export const PRODUCT_CATEGORIES: readonly ProductCategory[] = [
    'Bone & Joint Health',
    'Brain Health',
    'Cardiovascular Health',
    "Children's Health",
    'Digestive Health',
    'Energy',
    'Enhancers',
    'Eye Health',
    'Immune Health',
    "Men's Health",
    'Skin & Body Care',
    'Sleep Support',
    'Sports Nutrition',
    'Weight Management',
    "Women's Health",
    'Other',
] as const;

/** Stock bands, in the order the filter bar offers them. */
export const STOCK_STATUSES = ['In Stock', 'Low Stock', 'Out of Stock'] as const;

/** Expiry filter options. Two different server params behind one control. */
export const EXPIRY_FILTERS = [
    { value: 'All',      label: 'Any expiry' },
    { value: 'expiring', label: 'Expiring ≤30d' },
    { value: 'expired',  label: 'Expired' },
] as const;

export const SORT_OPTIONS = [
    { value: 'name',     label: 'Name' },
    { value: 'stockNo',  label: 'Stock no.' },
    { value: 'quantity', label: 'Quantity' },
    { value: 'value',    label: 'Value' },
    { value: 'expiry',   label: 'Expiry' },
] as const;
