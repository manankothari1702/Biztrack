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
    const versionRef = useRef(0);

    const fetchClients = useCallback(async () => {
        if (!currentUser) return;
        const version = ++versionRef.current;
        setLoading(true);
        setError(null);
        try {
            // Exhaust all pages so totalFetched and pagination reflect the true count.
            // DynamoDB's Count is per-page, so we must aggregate across nextToken pages.
            const accumulated: Client[] = [];
            let token: string | null = null;
            do {
                const res = await clientsApi.list({
                    clientType: filterType !== 'All' ? filterType : undefined,
                    search: searchQuery || undefined,
                    sortBy,
                    limit: pageSize,
                    ...(token ? { nextToken: token } : {}),
                });
                if (version !== versionRef.current) return;
                accumulated.push(...res.clients);
                token = res.nextToken;
            } while (token);

            if (version !== versionRef.current) return;
            setClients(accumulated);
            setTotalFetched(accumulated.length);
            setHasMore(false);
        } catch (err) {
            if (version !== versionRef.current) return;
            setError(err instanceof Error ? err.message : 'Failed to fetch clients');
        } finally {
            if (version === versionRef.current) setLoading(false);
        }
    }, [currentUser, filterType, searchQuery, sortBy, pageSize]);

    useEffect(() => { void fetchClients(); }, [fetchClients]);

    const refresh = useCallback(() => { void fetchClients(); }, [fetchClients]);

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
            const dueBefore = today.toISOString(); // end of LOCAL today — identical cutoff to before

            // Server-scoped due query (audit B1): GSI1 nextFollowUpDate <= dueBefore + Active,
            // instead of pulling the whole client DB and filtering locally. Still paginate to
            // completeness — but over the (small) due-candidate set, not every client.
            const due: Client[] = [];
            let token: string | null = null;
            do {
                const res = await clientsApi.list({
                    dueBefore,
                    status: 'Active',
                    search: searchQuery || undefined,
                    limit: 200,
                    ...(token ? { nextToken: token } : {}),
                });
                due.push(...res.clients);
                token = res.nextToken;
            } while (token);

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