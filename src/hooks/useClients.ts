import { useCallback, useMemo, useState, useEffect } from 'react';
import { orderBy, where, collection, query, getCountFromServer } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useFirestoreQuery } from './useFirestoreQuery';
import { firebaseService } from '../services/firebaseService';
import { useAuth } from '../context/AuthContext';
import type { Client } from '../types';
import { queryCache } from '../utils/cache';

export const useClients = (
    filterType: 'All' | 'Prospect' | 'User' | 'Associate' | 'Supervisor' = 'All',
    searchQuery: string = '',
    sortBy: 'clientName' | 'nextFollowUpDate' = 'nextFollowUpDate',
    page: number = 1,
    pageSize: number = 50
) => {
    const { currentUser } = useAuth();

    // Construct Query Constraints
    const constraints: import('firebase/firestore').QueryConstraint[] = [];

    // Filter Type
    if (filterType !== 'All') {
        constraints.push(where('clientType', '==', filterType));
    }

    // Search (Prefix)
    // Search (Prefix)
    // REFACTOR: Use clientNameLower for case-insensitive search
    // This relies on the migrationService to have populated this field.
    if (searchQuery) {
        const searchLower = searchQuery.toLowerCase().trim();
        constraints.push(where('clientNameLower', '>=', searchLower));
        constraints.push(where('clientNameLower', '<=', searchLower + '\uf8ff'));
        constraints.push(orderBy('clientNameLower', 'asc'));
    } else {
        // Sort
        if (sortBy === 'clientName') {
            constraints.push(orderBy('clientName', 'asc'));
        } else {
            constraints.push(orderBy('nextFollowUpDate', 'asc'));
        }
    }

    // Fetch enough data for current page (page * pageSize)
    // This allows client-side pagination within fetched data
    const fetchLimit = page * pageSize;

    const { data: allFetchedClients, loading, error, hasMore, refresh } = useFirestoreQuery<Client>(
        'clients',
        constraints,
        fetchLimit,
        [filterType, searchQuery, sortBy, page] // Include page in dependencies to re-fetch on page change
    );

    // Slice data for current page (client-side pagination within fetched data)
    const clients = useMemo(() => {
        const startIndex = (page - 1) * pageSize;
        return allFetchedClients.slice(startIndex, startIndex + pageSize);
    }, [allFetchedClients, page, pageSize]);

    // Calculate total pages based on fetched data
    const [totalCount, setTotalCount] = useState(0);

    // Track mutations to refresh count reactively
    const [countVersion, setCountVersion] = useState(0);

    // Effect: Fetch total count when filters change OR after mutations
    useEffect(() => {
        if (!currentUser) return;

        const fetchCount = async () => {
            try {
                const collRef = collection(db, `users/${currentUser.uid}/clients`);
                const q = query(collRef, ...constraints); // Use same constraints as main query (minus limit/pagination)
                // Filter out limit/startAfter if they were in constraints (they are not - we build constraints above without them)

                // Note: The constraints variable above contains orderBy which is fine for count, 
                // but if we had limits we would need to remove them. 
                // Fortunately 'constraints' array defined above only has 'where' and 'orderBy'.

                const snapshot = await getCountFromServer(q);
                setTotalCount(snapshot.data().count);
            } catch (err) {
                console.error("Failed to fetch client count:", err);
            }
        };

        fetchCount();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser, filterType, searchQuery, countVersion]); // Re-run when filters change OR after mutations

    const addClient = useCallback(async (client: Client) => {
        if (!currentUser) return;

        try {
            await firebaseService.addClient(currentUser.uid, client);
            refresh();
            setCountVersion(v => v + 1); // Trigger count refresh
        } catch (err) {
            throw err;
        }
    }, [currentUser, refresh]);

    const updateClient = useCallback(async (client: Client) => {
        if (!currentUser) return;

        // Key must match what useFirestoreQuery stores: dependencies = [filterType, searchQuery, sortBy, page]
        const key = queryCache.generateKey('clients', currentUser.uid, { constraints: [filterType, searchQuery, sortBy, page], page: 'first' });
        const cached = await queryCache.get(key);
        const previousData = cached ? cached.data : [];

        if (cached) {
            const updatedData = cached.data.map((c: Client) => c.id === client.id ? client : c);
            await queryCache.set(key, updatedData, currentUser.uid);
            refresh();
        }

        try {
            await firebaseService.updateClient(currentUser.uid, client);
        } catch (err) {
            if (cached) {
                await queryCache.set(key, previousData, currentUser.uid);
                refresh();
            }
            throw err;
        }
    }, [currentUser, refresh, filterType, searchQuery, sortBy, page]);

    const deleteClient = useCallback(async (clientId: string) => {
        if (!currentUser) return;

        // Key must match what useFirestoreQuery stores: dependencies = [filterType, searchQuery, sortBy, page]
        const key = queryCache.generateKey('clients', currentUser.uid, { constraints: [filterType, searchQuery, sortBy, page], page: 'first' });
        const cached = await queryCache.get(key);
        const previousData = cached ? cached.data : [];

        if (cached) {
            const updatedData = cached.data.filter((c: Client) => c.id !== clientId);
            await queryCache.set(key, updatedData, currentUser.uid);
            refresh();
        }

        try {
            await firebaseService.deleteClient(currentUser.uid, clientId);
            setCountVersion(v => v + 1);
        } catch (err) {
            if (cached) {
                await queryCache.set(key, previousData, currentUser.uid);
                refresh();
            }
            throw err;
        }
    }, [currentUser, refresh, filterType, searchQuery, sortBy, page]);

    const bulkDeleteClients = useCallback(async (ids: string[]) => {
        if (!currentUser) return;
        try {
            await firebaseService.bulkDeleteClients(currentUser.uid, ids);
            refresh();
            setCountVersion(v => v + 1); // Trigger count refresh
        } catch (err) {
            throw err;
        }
    }, [currentUser, refresh]);

    const bulkUpdateClients = useCallback(async (ids: string[], updates: Partial<Client>) => {
        if (!currentUser) return;
        try {
            await firebaseService.bulkUpdateClients(currentUser.uid, ids, updates);
            refresh();
        } catch (err) {
            throw err;
        }
    }, [currentUser, refresh]);

    const bulkAddClients = useCallback(async (newClients: Client[]) => {
        if (!currentUser) return;
        try {
            await firebaseService.bulkAddClients(currentUser.uid, newClients);
            refresh();
            setCountVersion(v => v + 1); // Trigger count refresh
        } catch (err) {
            throw err;
        }
    }, [currentUser, refresh]);

    return {
        clients,
        allClients: allFetchedClients, // Full fetched data for filtering
        totalFetched: totalCount, // Mapping totalCount to totalFetched for backward compatibility or updating UI to use totalCount
        loading,
        error,
        hasMore,
        refresh,
        addClient,
        updateClient,
        deleteClient,
        bulkDeleteClients,
        bulkUpdateClients,
        bulkAddClients
    };
};

// Specialized hook for "Due Today & Overdue" widget
// Query: status == 'Active' && nextFollowUpDate <= endOfToday
export const useDueClients = (page: number = 1, pageSize: number = 20, searchQuery: string = '') => {
    const { currentUser } = useAuth();

    // Use end of today in UTC for comparison
    // This ensures we catch all clients with dates <= today regardless of timezone
    const now = new Date();
    const endOfTodayUtc = new Date(Date.UTC(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23, 59, 59, 999
    )).toISOString();

    // IMPORTANT: Only use single field query to avoid composite index requirement
    // Query only by date, filter status client-side
    // OR Query by Name (if searching), then filter Date and Status client-side

    // Determine Query Strategy
    const isSearch = !!searchQuery.trim();
    const searchLower = searchQuery.toLowerCase().trim();

    const constraints: import('firebase/firestore').QueryConstraint[] = useMemo(() => {
        if (isSearch) {
            // SEARCH STRATEGY:
            // Query: clientNameLower >= query
            // Filter: status == 'Active' && nextFollowUpDate <= today
            return [
                where('clientNameLower', '>=', searchLower),
                where('clientNameLower', '<=', searchLower + '\uf8ff'),
                orderBy('clientNameLower', 'asc')
            ];
        } else {
            // DEFAULT STRATEGY:
            // Query: nextFollowUpDate <= endOfToday
            // Filter: status == 'Active'
            return [
                where('nextFollowUpDate', '<=', endOfTodayUtc),
                orderBy('nextFollowUpDate', 'asc') // Ensure sorted by date
            ];
        }
    }, [isSearch, searchLower, endOfTodayUtc]);

    // Fetch Total Count
    const [totalCount, setTotalCount] = useState(0);

    useEffect(() => {
        if (!currentUser) return;
        const fetchCount = async () => {
            try {
                const collRef = collection(db, `users/${currentUser.uid}/clients`);
                const q = query(collRef, ...constraints);
                const snapshot = await getCountFromServer(q);
                setTotalCount(snapshot.data().count);
            } catch (err) {
                console.error("Failed to fetch due count:", err);
            }
        };
        fetchCount();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser, endOfTodayUtc, isSearch, searchLower]); // Re-run when query changes

    // Fetch Data
    // If searching, we fetch MORE items because many might not be "Due Today"
    // We need to fetch enough candidates to fill the page after filtering
    const effectiveFetchLimit = isSearch ? (page * pageSize * 5) : (page * pageSize);

    const result = useFirestoreQuery<Client>(
        'clients',
        constraints,
        effectiveFetchLimit,
        ['due-clients', endOfTodayUtc.substring(0, 10), page, isSearch, searchLower] // Include search params in key
    );

    // Filter/Sort Logic
    const filteredAndSortedData = useMemo(() => {
        let processed = result.data.filter(client => client.status === 'Active');

        // If Searching, we still need to filter by Date (since we queried by Name)
        if (isSearch) {
            processed = processed.filter(client => {
                if (!client.nextFollowUpDate) return false;
                // Simple string comparison for ISO dates works
                return client.nextFollowUpDate <= endOfTodayUtc;
            });
            // And we should sort by Date for consistency with default view?
            // Or keep name sort? Default view is sorted by date.
            // Let's sort by date to match the "Due" context.
            processed.sort((a, b) => {
                const dateA = new Date(a.nextFollowUpDate || 0).getTime();
                const dateB = new Date(b.nextFollowUpDate || 0).getTime();
                return dateA - dateB;
            });
        } else {
            // Default view: already queried by date, but need to ensure sort if not guaranteed (FireStore guarantees it if orderBy is used)
            // We added orderBy('nextFollowUpDate') so it should be good.
            // But existing code did manual sort, let's keep it safe.
            processed.sort((a, b) => {
                const dateA = new Date(a.nextFollowUpDate || 0).getTime();
                const dateB = new Date(b.nextFollowUpDate || 0).getTime();
                return dateA - dateB;
            });
        }

        return processed;
    }, [result.data, isSearch, endOfTodayUtc]);

    // Slice for pagination
    const paginatedData = useMemo(() => {
        const startIndex = (page - 1) * pageSize;
        return filteredAndSortedData.slice(startIndex, startIndex + pageSize);
    }, [filteredAndSortedData, page, pageSize]);

    return {
        ...result,
        data: paginatedData, // Return only current page
        allDueClients: filteredAndSortedData, // Return all fetched
        totalFetched: isSearch ? filteredAndSortedData.length : totalCount // For search, true server count is hard, use client count
    };
};
