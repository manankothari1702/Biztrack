import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { dashboardApi } from '../services/apiService';
import type { Client, Task } from '../types';
import { logger } from '../utils/logger';

export const useDashboardData = () => {
    const { currentUser } = useAuth();

    const [counts, setCounts] = useState({
        totalClients: 0,
        activeClients: 0,
        dueCalls: 0,
        pendingTasks: 0,
        overdueTasks: 0,
        completedTasks: 0,
    });

    const [recentClients, setRecentClients] = useState<Client[]>([]);
    const [dueClients, setDueClients] = useState<Client[]>([]);
    const [priorityTasks, setPriorityTasks] = useState<Task[]>([]);
    const [recentContacts, setRecentContacts] = useState<Client[]>([]);
    const [upcomingFollowUps, setUpcomingFollowUps] = useState<Client[]>([]);

    const [loading, setLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [failedSections, setFailedSections] = useState<string[]>([]);

    const fetchDashboard = useCallback(async () => {
        if (!currentUser) return;
        setLoading(true);
        setHasError(false);
        setFailedSections([]);
        try {
            const data = await dashboardApi.get();
            setCounts({
                totalClients:   data.counts.totalClients,
                activeClients:  data.counts.totalClients,
                dueCalls:       data.counts.dueCalls,
                pendingTasks:   data.counts.pendingTasks,
                overdueTasks:   data.counts.overdueTasks,
                completedTasks: data.counts.completedTasks,
            });
            setDueClients(data.dueClients);
            setUpcomingFollowUps(data.upcomingFollowUps);
            setPriorityTasks(data.priorityTasks);
            setRecentClients(data.recentClients);
            setRecentContacts(data.recentContacts);
        } catch (err) {
            logger.error('Failed to fetch dashboard:', err);
            setHasError(true);
            setFailedSections(['Dashboard data']);
        } finally {
            setLoading(false);
        }
    }, [currentUser]);

    useEffect(() => { void fetchDashboard(); }, [fetchDashboard]);

    const refresh = useCallback(() => { void fetchDashboard(); }, [fetchDashboard]);

    return {
        counts,
        recentClients,
        dueClients,
        priorityTasks,
        recentContacts,
        upcomingFollowUps,
        loading,
        loadingMoreDue: false,
        loadingMoreTasks: false,
        hasError,
        failedSections,
        refresh,
        loadMoreDue: () => {},
        loadMoreTasks: () => {},
    };
};
