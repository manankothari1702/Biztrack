import { useState, useEffect, useCallback } from 'react';
import { clientsApi, tasksApi } from '../services/apiService';
import { useAuth } from '../context/AuthContext';
import type { Task, Client } from '../types';

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
            const [tasksRes, clientsRes] = await Promise.all([
                tasksApi.list({ limit: 500 }),
                clientsApi.list({ limit: 500 }),
            ]);

            setTasks(
                tasksRes.tasks.filter(
                    t => t.status !== 'Completed' && t.dueDate && t.dueDate >= startIso && t.dueDate <= endIso
                )
            );
            setClients(
                clientsRes.clients.filter(
                    c => c.status === 'Active' && c.nextFollowUpDate &&
                        c.nextFollowUpDate >= startIso && c.nextFollowUpDate <= endIso
                )
            );
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
