import type { MovementType } from '../types';

/**
 * Query-string construction for the inventory endpoints.
 *
 * Split out of `apiService.ts` purely so it can be unit-tested: importing
 * `apiService` pulls in `lib/aws`, which calls `Amplify.configure` at module
 * load. These functions have no runtime dependencies at all.
 *
 * Each builder maps fields explicitly, one line per parameter — the same shape
 * `clientsApi.list` uses inline. Deliberately NOT a generic `qs(object)`
 * serializer: an object-walker would happily forward a typo'd or renamed field
 * to the server, where it is silently ignored and the filter just seems not to
 * work.
 */

// ── Filter shapes ───────────────────────────────────────────────────────────

export interface ProductFilters {
    search?: string;
    category?: string;
    /** 'In Stock' | 'Low Stock' | 'Out of Stock' — derived server-side. */
    stockStatus?: string;
    /** Products whose cached earliestExpiry falls in today … today+N. */
    expiringInDays?: number;
    /**
     * `'expired'` — earliestExpiry < today. Distinct from `expiringInDays`,
     * which cannot express the past.
     */
    status?: 'expired';
    /** 'name' | 'stockNo' | 'quantity' | 'value' | 'expiry'. Orders the page. */
    sortBy?: string;
    limit?: number;
    nextToken?: string;
}

export interface BatchFilters {
    /** Expiring in today … today+N, over GSI6-InventoryDate. */
    expiringInDays?: number;
    /** `'expired'` — invDate < today. */
    status?: 'expired';
    productId?: string;
    limit?: number;
    nextToken?: string;
}

export interface StockMovementFilters {
    productId?: string;
    type?: MovementType;
    /** Date (`2026-07-22`) or full timestamp; a bare date covers that whole day. */
    from?: string;
    to?: string;
    limit?: number;
    nextToken?: string;
}

// ── Builders ────────────────────────────────────────────────────────────────
//
// 'All' is the UI's "no filter" sentinel and must never reach the server, which
// would treat it as a literal category/status and match nothing.

export const productParams = (filters: ProductFilters = {}): URLSearchParams => {
    const params = new URLSearchParams();
    if (filters.search)      params.set('search', filters.search);
    if (filters.category && filters.category !== 'All')       params.set('category', filters.category);
    if (filters.stockStatus && filters.stockStatus !== 'All') params.set('stockStatus', filters.stockStatus);
    if (filters.expiringInDays !== undefined) params.set('expiringInDays', String(filters.expiringInDays));
    if (filters.status)      params.set('status', filters.status);
    if (filters.sortBy)      params.set('sortBy', filters.sortBy);
    if (filters.limit)       params.set('limit', String(filters.limit));
    if (filters.nextToken)   params.set('nextToken', filters.nextToken);
    return params;
};

export const batchParams = (filters: BatchFilters = {}): URLSearchParams => {
    const params = new URLSearchParams();
    if (filters.expiringInDays !== undefined) params.set('expiringInDays', String(filters.expiringInDays));
    if (filters.status)    params.set('status', filters.status);
    if (filters.productId) params.set('productId', filters.productId);
    if (filters.limit)     params.set('limit', String(filters.limit));
    if (filters.nextToken) params.set('nextToken', filters.nextToken);
    return params;
};

export const stockMovementParams = (filters: StockMovementFilters = {}): URLSearchParams => {
    const params = new URLSearchParams();
    if (filters.productId) params.set('productId', filters.productId);
    if (filters.type)      params.set('type', filters.type);
    if (filters.from)      params.set('from', filters.from);
    if (filters.to)        params.set('to', filters.to);
    if (filters.limit)     params.set('limit', String(filters.limit));
    if (filters.nextToken) params.set('nextToken', filters.nextToken);
    return params;
};

/** `?a=b` when there is anything to send, otherwise the empty string. */
export const suffix = (params: URLSearchParams): string => {
    const qs = params.toString();
    return qs ? `?${qs}` : '';
};

// ── UI filter state → request filters ───────────────────────────────────────

/** What the Inventory page's filter bar holds. */
export interface InventoryFilterState {
    search: string;
    /** 'All' or a ProductCategory. */
    category: string;
    /** 'All' | 'In Stock' | 'Low Stock' | 'Out of Stock'. */
    stockStatus: string;
    /** 'All' | 'expiring' (≤ soonDays) | 'expired'. */
    expiry: string;
    sortBy: string;
}

export const EMPTY_INVENTORY_FILTERS: InventoryFilterState = {
    search: '', category: 'All', stockStatus: 'All', expiry: 'All', sortBy: 'name',
};

/**
 * Map the filter bar onto `ProductFilters`.
 *
 * The expiry control is one dropdown but two different server parameters —
 * `expiringInDays` cannot express "already expired", so 'expired' has to become
 * `status`. Blank strings and 'All' are dropped rather than sent.
 */
export const toProductFilters = (
    state: Partial<InventoryFilterState> = {},
    soonDays = 30,
): ProductFilters => {
    const filters: ProductFilters = {};

    const search = state.search?.trim();
    if (search) filters.search = search;
    if (state.category && state.category !== 'All') filters.category = state.category;
    if (state.stockStatus && state.stockStatus !== 'All') filters.stockStatus = state.stockStatus;
    if (state.sortBy) filters.sortBy = state.sortBy;

    if (state.expiry === 'expiring') filters.expiringInDays = soonDays;
    else if (state.expiry === 'expired') filters.status = 'expired';

    return filters;
};

/** The same control mapped onto the batch endpoint. */
export const toBatchFilters = (
    state: Partial<InventoryFilterState> = {},
    soonDays = 30,
): BatchFilters => {
    const filters: BatchFilters = {};
    if (state.expiry === 'expiring') filters.expiringInDays = soonDays;
    else if (state.expiry === 'expired') filters.status = 'expired';
    return filters;
};
