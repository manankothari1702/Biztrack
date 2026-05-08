import { useState, useCallback } from 'react';
import { clientsApi } from '../../../shared/services/apiService';
import { useAuth } from '../../auth/context/AuthContext';
import { useToast } from '../../../shared/context/ToastContext';
import type { Client } from '../../../shared/types';

export const useClientQuickSearch = () => {
    const { currentUser } = useAuth();
    const { success, error: showError } = useToast();
    const [results, setResults] = useState<Client[]>([]);
    const [loading, setLoading] = useState(false);

    const search = useCallback(async (searchTerm: string): Promise<Client[]> => {
        if (!currentUser || !searchTerm.trim()) {
            setResults([]);
            return [];
        }

        setLoading(true);
        try {
            const res = await clientsApi.list({ search: searchTerm.trim(), limit: 10 });
            setResults(res.clients);
            return res.clients;
        } catch {
            showError('Search failed');
            setResults([]);
            return [];
        } finally {
            setLoading(false);
        }
    }, [currentUser, showError]);

    const updateClient = useCallback(async (client: Client) => {
        if (!currentUser) return;
        try {
            await clientsApi.update(client);
            success('Client updated');
            setResults(prev => prev.map(c => c.id === client.id ? client : c));
        } catch {
            showError('Failed to update client');
            throw new Error('Failed to update client');
        }
    }, [currentUser, success, showError]);

    const clearResults = useCallback(() => {
        setResults([]);
    }, []);

    return {
        results,
        loading,
        search,
        updateClient,
        clearResults,
    };
};