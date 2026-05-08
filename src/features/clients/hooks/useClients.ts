import { useCallback, useState, useEffect, useRef } from 'react';
import { clientsApi } from '../../../shared/services/apiService';
import { useAuth } from '../../auth/context/AuthContext';
import type { Client } from '../../../shared/types';

export const useClients = (
    filterType: 'All' | 'Prospect' | 'User' | 'Associate' | 'Supervisor' = 'All',
    searchQuery: string = '',
    sortBy: 'clientName' | 'nextFollowUpDate' = 'nextFollowUpDate',
    page: number = 1,
    pageSize: number = 50
) => {
    const { currentUser } = useAuth();
    const [clients, setClients] = useState<Client[]>([]);
    const [totalFetched, setTotalFetched] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [nextToken, setNextToken] = useState<string | null>(null);
    const versionRef = useRef(0);

    const fetchClients = useCallback(async () => {
        if (!currentUser) return;
        const version = ++versionRef.current;
        setLoading(true);
        setError(null);
        try {
            const res = await clientsApi.list({
                clientType: filterType !== 'All' ? filterType : undefined,
                search: searchQuery || undefined,
                sortBy,
                limit: pageSize,
            });
            if (version !== versionRef.current) return;
            setClients(res.clients);
            setTotalFetched(res.count);
            setNextToken(res.nextToken);
            setHasMore(!!res.nextToken);
        } catch (err) {
            if (version !== versionRef.current) return;
            setError(err instanceof Error ? err.message : 'Failed to fetch clients');
        } finally {
            if (version === versionRef.current) setLoading(false);
        }
    }, [currentUser, filterType, searchQuery, sortBy, pageSize]);

    useEffect(() => { void fetchClients(); }, [fetchClients]);

    const refresh = useCallback(() => { void fetchClients(); }, [fetchClients]);

    const loadMore = useCallback(async () => {
        if (!currentUser || !nextToken) return;
        try {
            const res = await clientsApi.list({
                clientType: filterType !== 'All' ? filterType : undefined,
                search: searchQuery || undefined,
                sortBy,
                limit: pageSize,
                nextToken,
            });
            setClients(prev => [...prev, ...res.clients]);
            setTotalFetched(prev => prev + res.clients.length);
            setNextToken(res.nextToken);
            setHasMore(!!res.nextToken);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load more');
        }
    }, [currentUser, nextToken, filterType, searchQuery, sortBy, pageSize]);

    const addClient = useCallback(async (client: Client) => {
        if (!currentUser) return;
        await clientsApi.add(client);
        refresh();
    }, [currentUser, refresh]);

    const updateClient = useCallback(async (client: Client) => {
        if (!currentUser) return;
        const updated = await clientsApi.update(client);
        setClients(prev => prev.map(c => c.id === client.id ? updated : c));
    }, [currentUser]);

    const deleteClient = useCallback(async (clientId: string) => {
        if (!currentUser) return;
        await clientsApi.delete(clientId);
        setClients(prev => prev.filter(c => c.id !== clientId));
        setTotalFetched(prev => Math.max(0, prev - 1));
    }, [currentUser]);

    const bulkDeleteClients = useCallback(async (ids: string[]) => {
        if (!currentUser) return;
        await clientsApi.bulkDelete(ids);
        refresh();
    }, [currentUser, refresh]);

    const bulkUpdateClients = useCallback(async (ids: string[], updates: Partial<Client>) => {
        if (!currentUser) return;
        // Apply updates locally; server doesn't have a bulk-update endpoint
        await Promise.all(
            ids.map(id => {
                const existing = clients.find(c => c.id === id);
                if (existing) return clientsApi.update({ ...existing, ...updates });
                return Promise.resolve();
            })
        );
        refresh();
    }, [currentUser, clients, refresh]);

    const bulkAddClients = useCallback(async (newClients: Client[]) => {
        if (!currentUser) return;
        await clientsApi.bulkAdd(newClients);
        refresh();
    }, [currentUser, refresh]);

    // Slice for requested page from fetched data
    const paginatedClients = clients.slice((page - 1) * pageSize, page * pageSize);

    return {
        clients: paginatedClients,
        allClients: clients,
        totalFetched,
        loading,
        error,
        hasMore,
        refresh,
        loadMore,
        addClient,
        updateClient,
        deleteClient,
        bulkDeleteClients,
        bulkUpdateClients,
        bulkAddClients,
    };
};

export const useDueClients = (page: number = 1, pageSize: number = 20, searchQuery: string = '') => {
    const { currentUser } = useAuth();
    const [allDueClients, setAllDueClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasMore] = useState(false);

    const fetch = useCallback(async () => {
        if (!currentUser) return;
        setLoading(true);
        try {
            const today = new Date();
            today.setHours(23, 59, 59, 999);
            // Fetch clients and filter client-side (API doesn't have a dueClients endpoint)
            const res = await clientsApi.list({
                search: searchQuery || undefined,
                sortBy: 'nextFollowUpDate',
                limit: 500,
            });
            const todayIso = today.toISOString();
            const due = res.clients.filter(
                c => c.status === 'Active' && c.nextFollowUpDate && c.nextFollowUpDate <= todayIso
            );
            setAllDueClients(due);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch');
        } finally {
            setLoading(false);
        }
    }, [currentUser, searchQuery]);

    useEffect(() => { void fetch(); }, [fetch]);

    const data = allDueClients.slice((page - 1) * pageSize, page * pageSize);

    return {
        data,
        allDueClients,
        totalFetched: allDueClients.length,
        loading,
        error,
        hasMore,
        refresh: fetch,
    };
};