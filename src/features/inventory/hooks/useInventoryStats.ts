import { useCallback, useEffect, useRef, useState } from 'react';
import { productsApi, batchesApi } from '../../../shared/services/apiService';
import { collectAllPages } from '../../../shared/utils/pagination';
import { inventoryStats, todayIso, EXPIRING_SOON_DAYS, DEFAULT_TIMEZONE } from '../../../shared/utils/inventory';
import type { InventoryStats } from '../../../shared/utils/inventory';
import { useAuth } from '../../auth/context/AuthContext';
import type { Batch, Product } from '../../../shared/types';

const EMPTY_STATS: InventoryStats = {
    totalUnits: 0, stockValue: 0, vpInStock: 0, productCount: 0,
    expiringSoon: 0, expired: 0, lowStock: 0, outOfStock: 0,
};

/**
 * Valuation totals and alert counts for the Inventory cards.
 *
 * Mirrors `useDueClients`: its own fetch, its own loading/error, its own
 * refresh, so a page can mount it beside `useInventory` without coordinating.
 *
 * Counting happens client-side over the full (unfiltered) catalogue rather than
 * asking the server per card. Three reasons: the totals must reflect ALL stock
 * regardless of what the filter bar is showing; `GET /dashboard` is a six-query
 * aggregate already throttled to 5 rps, so the cards must not add to it; and
 * one product list plus one batch list is two round trips instead of five.
 *
 * `timeZone` decides what "today" means — an expiry boundary resolved in UTC is
 * wrong for Asia/Kolkata for five and a half hours of every day. Pass
 * `userProfile.timezone`.
 */
export const useInventoryStats = (
    timeZone: string = DEFAULT_TIMEZONE,
    soonDays: number = EXPIRING_SOON_DAYS,
) => {
    const { currentUser } = useAuth();

    const [stats, setStats]     = useState<InventoryStats>(EMPTY_STATS);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState<string | null>(null);
    const versionRef = useRef(0);

    const fetchStats = useCallback(async () => {
        if (!currentUser) return;
        const version = ++versionRef.current;
        setLoading(true);
        setError(null);

        const stillCurrent = () => version === versionRef.current;

        try {
            const [products, batches] = await Promise.all([
                collectAllPages<Product>(
                    async (nextToken) => {
                        const res = await productsApi.list({
                            limit: 200,
                            ...(nextToken ? { nextToken } : {}),
                        });
                        return { items: res.products, nextToken: res.nextToken };
                    },
                    { shouldContinue: stillCurrent },
                ),
                collectAllPages<Batch>(
                    async (nextToken) => {
                        const res = await batchesApi.list({
                            limit: 200,
                            ...(nextToken ? { nextToken } : {}),
                        });
                        return { items: res.batches, nextToken: res.nextToken };
                    },
                    { shouldContinue: stillCurrent },
                ),
            ]);

            if (version !== versionRef.current) return;
            setStats(inventoryStats(products, batches, { today: todayIso(timeZone), soonDays }));
        } catch (err) {
            if (version !== versionRef.current) return;
            setError(err instanceof Error ? err.message : 'Failed to load inventory stats');
        } finally {
            if (version === versionRef.current) setLoading(false);
        }
    }, [currentUser, timeZone, soonDays]);

    useEffect(() => { void fetchStats(); }, [fetchStats]);

    const refresh = useCallback(() => { void fetchStats(); }, [fetchStats]);

    return { stats, loading, error, refresh };
};
