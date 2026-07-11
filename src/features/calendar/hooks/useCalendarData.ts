import { useState, useEffect, useCallback } from 'react';
import { clientsApi, tasksApi } from '../../../shared/services/apiService';
import { useAuth } from '../../auth/context/AuthContext';
import type { Task, Client } from '../../../shared/types';

export const useCalendarData = (currentDate: Date) => {
    const { currentUser } = useAuth();
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const [tasks, setTasks] = useState<Task[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);

    const startOfMonth = new Date(year, month, 1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startIso = startOfMonth.toISOString();

    const endOfMonth = new Date(year, month + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);
    const endIso = endOfMonth.toISOString();

    const fetchData = useCallback(async () => {
        if (!currentUser) return;
        setLoading(true);
        try {
            // Server-scoped, month-bounded, paginated to completeness (audit B1). Replaces
            // the old single-page limit:500 (server-capped to 200) + client-side filter,
            // which silently dropped month items beyond the first page. New queries return
            // the full month regardless of total record count.
            const [monthTasks, monthClients] = await Promise.all([
                (async () => {
                    const out: Task[] = [];
                    let token: string | null = null;
                    do {
                        const res = await tasksApi.list({
                            from: startIso, to: endIso, excludeCompleted: '1',
                            limit: 500, ...(token ? { nextToken: token } : {}),
                        });
                        out.push(...res.tasks);
                        token = res.nextToken;
                    } while (token);
                    return out;
                })(),
                (async () => {
                    const out: Client[] = [];
                    let token: string | null = null;
                    do {
                        const res = await clientsApi.list({
                            dueFrom: startIso, dueBefore: endIso, status: 'Active',
                            limit: 500, ...(token ? { nextToken: token } : {}),
                        });
                        out.push(...res.clients);
                        token = res.nextToken;
                    } while (token);
                    return out;
                })(),
            ]);

            setTasks(monthTasks);
            setClients(monthClients);
        } catch {
            // Silently fail — calendar is non-critical
        } finally {
            setLoading(false);
        }
    }, [currentUser, startIso, endIso]);

    useEffect(() => { void fetchData(); }, [fetchData]);

    return {
        tasks,
        clients,
        loading,
        refresh: fetchData,
    };
};