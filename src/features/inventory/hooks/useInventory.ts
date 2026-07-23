import { useCallback, useEffect, useRef, useState } from 'react';
import { productsApi, batchesApi } from '../../../shared/services/apiService';
import { toProductFilters, toBatchFilters, EMPTY_INVENTORY_FILTERS } from '../../../shared/services/apiParams';
import type { InventoryFilterState } from '../../../shared/services/apiParams';
import { collectAllPages } from '../../../shared/utils/pagination';
import { useAuth } from '../../auth/context/AuthContext';
import type { AdjustBatchBody } from '../../../shared/services/apiService';
import type { Batch, Product, WriteOffReason } from '../../../shared/types';

/**
 * Products + their batches for the Inventory page.
 *
 * Mirrors `useClients`: an auth gate, a version guard so a slow response cannot
 * overwrite a newer one, every page exhausted into a single array, and
 * client-side slicing for pagination. Like `useClients`, it raises NO toasts —
 * mutators reject and the page decides what the user sees, because only the
 * page knows whether a failure happened in a modal, a row action, or a bulk job.
 */
export const useInventory = (
    filters: InventoryFilterState = EMPTY_INVENTORY_FILTERS,
    page = 1,
    pageSize = 50,
    soonDays = 30,
    /** Fetch zero-quantity lots too — drives the batch table's toggle. */
    includeEmpty = false,
) => {
    const { currentUser } = useAuth();

    const [products, setProducts] = useState<Product[]>([]);
    const [batches, setBatches]   = useState<Batch[]>([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState<string | null>(null);
    const versionRef = useRef(0);

    // Destructured so the callback depends on the fields, not on the identity of
    // a filters object the page may recreate every render.
    const { search, category, stockStatus, expiry, sortBy } = filters;

    const fetchInventory = useCallback(async () => {
        if (!currentUser) return;
        const version = ++versionRef.current;
        setLoading(true);
        setError(null);

        const state = { search, category, stockStatus, expiry, sortBy };
        // Stop paging the moment a newer request starts — the results would be
        // discarded anyway, and a long walk would hold the network open.
        const stillCurrent = () => version === versionRef.current;

        try {
            const [nextProducts, nextBatches] = await Promise.all([
                collectAllPages<Product>(
                    async (nextToken) => {
                        const res = await productsApi.list({
                            ...toProductFilters(state, soonDays),
                            limit: pageSize,
                            ...(nextToken ? { nextToken } : {}),
                        });
                        return { items: res.products, nextToken: res.nextToken };
                    },
                    { shouldContinue: stillCurrent },
                ),
                collectAllPages<Batch>(
                    async (nextToken) => {
                        const res = await batchesApi.list({
                            ...toBatchFilters(state, soonDays),
                            ...(includeEmpty ? { includeEmpty: true } : {}),
                            limit: 200,
                            ...(nextToken ? { nextToken } : {}),
                        });
                        return { items: res.batches, nextToken: res.nextToken };
                    },
                    { shouldContinue: stillCurrent },
                ),
            ]);

            if (version !== versionRef.current) return;
            setProducts(nextProducts);
            setBatches(nextBatches);
        } catch (err) {
            if (version !== versionRef.current) return;
            setError(err instanceof Error ? err.message : 'Failed to load inventory');
        } finally {
            if (version === versionRef.current) setLoading(false);
        }
    }, [currentUser, search, category, stockStatus, expiry, sortBy, pageSize, soonDays, includeEmpty]);

    useEffect(() => { void fetchInventory(); }, [fetchInventory]);

    const refresh = useCallback(() => { void fetchInventory(); }, [fetchInventory]);

    // ── Catalogue mutators ──────────────────────────────────────────────────
    // Errors propagate to the caller. The page catches and toasts.

    const addProduct = useCallback(async (product: Product) => {
        if (!currentUser) return;
        await productsApi.add(product);
        refresh();
    }, [currentUser, refresh]);

    const updateProduct = useCallback(async (product: Product) => {
        if (!currentUser) return;
        // The server drops totalQuantity/earliestExpiry from the body and restores
        // them from the stored row, so the response — not our copy — is the truth.
        const updated = await productsApi.update(product);
        setProducts(prev => prev.map(p => (p.id === product.id ? updated : p)));
    }, [currentUser]);

    const deleteProduct = useCallback(async (id: string) => {
        if (!currentUser) return;
        await productsApi.delete(id);
        setProducts(prev => prev.filter(p => p.id !== id));
        setBatches(prev => prev.filter(b => b.productId !== id));
    }, [currentUser]);

    const bulkAddProducts = useCallback(async (rows: Product[]) => {
        if (!currentUser) return undefined;
        const result = await productsApi.bulkAdd(rows);
        refresh();
        return result;   // imported/updated/failed/timedOut — the page reports it honestly
    }, [currentUser, refresh]);

    const bulkDeleteProducts = useCallback(async (ids: string[]) => {
        if (!currentUser) return undefined;
        const result = await productsApi.bulkDelete(ids);
        refresh();
        return result;
    }, [currentUser, refresh]);

    // ── Batch mutators ──────────────────────────────────────────────────────
    // Both move stock, so both change a product roll-up and possibly a second
    // batch row (a re-key merges into its target). Local patching cannot model
    // that; refetch instead.

    const adjustBatch = useCallback(async (
        productId: string, expiryDate: string, body: AdjustBatchBody,
    ) => {
        if (!currentUser) return;
        await batchesApi.adjust(productId, expiryDate, body);
        refresh();
    }, [currentUser, refresh]);

    const writeOffBatch = useCallback(async (
        productId: string, expiryDate: string, reason: WriteOffReason, note?: string,
    ) => {
        if (!currentUser) return undefined;
        const result = await batchesApi.writeOff(productId, expiryDate, reason, note);
        refresh();
        return result;   // { batch, writtenOff } — the page shows the qty removed
    }, [currentUser, refresh]);

    // Slice the fully-fetched array, exactly as useClients does.
    const paginatedProducts = products.slice((page - 1) * pageSize, page * pageSize);

    return {
        products: paginatedProducts,
        allProducts: products,
        batches,
        totalFetched: products.length,
        loading,
        error,
        refresh,
        addProduct,
        updateProduct,
        deleteProduct,
        bulkAddProducts,
        bulkDeleteProducts,
        adjustBatch,
        writeOffBatch,
    };
};
