import { useCallback, useState, useEffect, useRef } from 'react';
import { tasksApi } from '../services/apiService';
import { useAuth } from '../context/AuthContext';
import type { Task } from '../types';
import { useToast } from '../context/ToastContext';

export const useTasks = (
    status: 'All' | 'Pending' | 'Completed' | 'Overdue',
    priority: 'All' | 'High' | 'Medium' | 'Low',
    _sortBy: 'date' | 'priority',
    pageSize: number = 20
) => {
    const { currentUser } = useAuth();
    const { success, error: showError } = useToast();
    const [rawTasks, setRawTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [nextToken, setNextToken] = useState<string | null>(null);
    const versionRef = useRef(0);

    const fetchTasks = useCallback(async () => {
        if (!currentUser) return;
        const version = ++versionRef.current;
        setLoading(true);
        setError(null);
        try {
            const res = await tasksApi.list({
                status: status !== 'All' ? status : undefined,
                priority: priority !== 'All' ? priority : undefined,
                limit: pageSize,
            });
            if (version !== versionRef.current) return;
            setRawTasks(res.tasks);
            setNextToken(res.nextToken);
            setHasMore(!!res.nextToken);
        } catch (err) {
            if (version !== versionRef.current) return;
            setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
        } finally {
            if (version === versionRef.current) setLoading(false);
        }
    }, [currentUser, status, priority, pageSize]);

    useEffect(() => { void fetchTasks(); }, [fetchTasks]);

    const refresh = useCallback(() => { void fetchTasks(); }, [fetchTasks]);

    const loadMore = useCallback(async () => {
        if (!currentUser || !nextToken) return;
        try {
            const res = await tasksApi.list({
                status: status !== 'All' ? status : undefined,
                priority: priority !== 'All' ? priority : undefined,
                limit: pageSize,
                nextToken,
            });
            setRawTasks(prev => [...prev, ...res.tasks]);
            setNextToken(res.nextToken);
            setHasMore(!!res.nextToken);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load more');
        }
    }, [currentUser, nextToken, status, priority, pageSize]);

    // Client-side overdue filtering (server returns tasks by status; overdue needs date check)
    const tasks = (() => {
        if (status !== 'Overdue') return rawTasks;
        const now = new Date().toISOString();
        return rawTasks.filter(t => t.status !== 'Completed' && t.dueDate && t.dueDate < now);
    })();

    const addTask = useCallback(async (task: Task) => {
        if (!currentUser) return;
        try {
            await tasksApi.add(task);
            success('Task added', 'The task has been successfully created.');
            refresh();
        } catch (err) {
            showError('Failed to add task', 'An error occurred while creating the task.');
            throw err;
        }
    }, [currentUser, refresh, success, showError]);

    const updateTask = useCallback(async (task: Task) => {
        if (!currentUser) return;
        // Optimistic update
        setRawTasks(prev => prev.map(t => t.id === task.id ? task : t));
        try {
            const updated = await tasksApi.update(task);
            setRawTasks(prev => prev.map(t => t.id === task.id ? updated : t));
            success('Task updated');
        } catch (err) {
            refresh(); // Revert on error
            showError('Failed to update task');
            throw err;
        }
    }, [currentUser, refresh, success, showError]);

    const deleteTask = useCallback(async (taskId: string) => {
        if (!currentUser) return;
        // Optimistic update
        setRawTasks(prev => prev.filter(t => t.id !== taskId));
        try {
            await tasksApi.delete(taskId);
            success('Task deleted');
        } catch (err) {
            refresh(); // Revert on error
            showError('Failed to delete task');
            throw err;
        }
    }, [currentUser, refresh, success, showError]);

    return {
        tasks,
        loading,
        error,
        hasMore,
        loadMore,
        refresh,
        addTask,
        updateTask,
        deleteTask,
    };
};
