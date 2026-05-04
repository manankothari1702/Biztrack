import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { collection, query, where, orderBy, limit, getCountFromServer, getDocs } from 'firebase/firestore';
import type { Client, Task } from '../types';
import { logger } from '../utils/logger';

// Section keys used to track which parts of the dashboard failed to load
type DashboardSection = 'counts' | 'recentClients' | 'dueClients' | 'priorityTasks' | 'recentContacts' | 'upcomingFollowUps';

const SECTION_LABELS: Record<DashboardSection, string> = {
    counts:           'Summary counts',
    recentClients:    'Recent clients',
    dueClients:       'Due calls list',
    priorityTasks:    'Priority tasks',
    recentContacts:   'Recent contacts',
    upcomingFollowUps:'Upcoming follow-ups',
};

export const useDashboardData = () => {
    const { currentUser } = useAuth();

    const [counts, setCounts] = useState({
        totalClients: 0,
        activeClients: 0,
        dueCalls: 0,
        pendingTasks: 0,
        overdueTasks: 0,
        completedTasks: 0
    });

    // Tracks which sections failed their last fetch
    const [failedSections, setFailedSections] = useState<Set<DashboardSection>>(new Set());

    const markFailed = (section: DashboardSection) =>
        setFailedSections(prev => new Set(prev).add(section));

    const markOk = (section: DashboardSection) =>
        setFailedSections(prev => { const next = new Set(prev); next.delete(section); return next; });

    // Limits for progressive loading
    const [dueLimit, setDueLimit] = useState(100);
    const [tasksLimit, setTasksLimit] = useState(100);

    // 1. Fetch Counts
    useEffect(() => {
        if (!currentUser) return;

        const fetchCounts = async () => {
            try {
                const clientsRef = collection(db, `users/${currentUser.uid}/clients`);
                const tasksRef   = collection(db, `users/${currentUser.uid}/tasks`);

                const today = new Date();
                today.setHours(23, 59, 59, 999);
                const todayIso = today.toISOString();

                const [
                    totalSnap,
                    dueSnap,
                    pendingSnap,
                    completedSnap,
                    overdueSnap,
                ] = await Promise.all([
                    getCountFromServer(clientsRef),
                    getCountFromServer(query(clientsRef, where('nextFollowUpDate', '<=', todayIso))),
                    getCountFromServer(query(tasksRef,   where('status', '!=', 'Completed'))),
                    getCountFromServer(query(tasksRef,   where('status', '==', 'Completed'))),
                    getCountFromServer(query(tasksRef,   where('dueDate', '<', new Date().toISOString()))),
                ]);

                setCounts({
                    totalClients:  totalSnap.data().count,
                    activeClients: totalSnap.data().count,
                    dueCalls:      dueSnap.data().count,
                    pendingTasks:  pendingSnap.data().count,
                    completedTasks:completedSnap.data().count,
                    overdueTasks:  overdueSnap.data().count,
                });
                markOk('counts');
            } catch (err) {
                logger.error('Failed to fetch dashboard counts:', err);
                markFailed('counts');
            }
        };

        fetchCounts();
    }, [currentUser]);


    // 2. Lists with Progressive Loading

    const [recentClients, setRecentClients] = useState<Client[]>([]);
    const [loadingRecent, setLoadingRecent] = useState(true);

    const fetchRecentClients = useCallback(async () => {
        if (!currentUser) return;
        setLoadingRecent(true);
        try {
            const q = query(
                collection(db, `users/${currentUser.uid}/clients`),
                orderBy('createdAt', 'desc'),
                limit(5)
            );
            const snap = await getDocs(q);
            setRecentClients(snap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
            markOk('recentClients');
        } catch (err) {
            logger.error('Failed to fetch recent clients:', err);
            markFailed('recentClients');
        } finally {
            setLoadingRecent(false);
        }
    }, [currentUser]);


    const [dueClients, setDueClients] = useState<Client[]>([]);
    const [loadingDue, setLoadingDue] = useState(true);

    const fetchDueClients = useCallback(async () => {
        if (!currentUser) return;
        setLoadingDue(true);
        try {
            const today = new Date();
            today.setHours(23, 59, 59, 999);
            const q = query(
                collection(db, `users/${currentUser.uid}/clients`),
                where('nextFollowUpDate', '<=', today.toISOString()),
                orderBy('nextFollowUpDate', 'asc'),
                limit(dueLimit)
            );
            const snap = await getDocs(q);
            setDueClients(
                snap.docs.map(d => ({ id: d.id, ...d.data() } as Client))
                    .filter(c => c.status === 'Active')
            );
            markOk('dueClients');
        } catch (err) {
            logger.error('Failed to fetch due clients:', err);
            markFailed('dueClients');
        } finally {
            setLoadingDue(false);
        }
    }, [currentUser, dueLimit]);


    const [priorityTasks, setPriorityTasks] = useState<Task[]>([]);
    const [loadingTasks, setLoadingTasks] = useState(true);

    const fetchPriorityTasks = useCallback(async () => {
        if (!currentUser) return;
        setLoadingTasks(true);
        try {
            const q = query(
                collection(db, `users/${currentUser.uid}/tasks`),
                orderBy('dueDate', 'asc'),
                limit(tasksLimit)
            );
            const snap = await getDocs(q);
            setPriorityTasks(
                snap.docs.map(d => ({ id: d.id, ...d.data() } as Task))
                    .filter(t => t.status !== 'Completed' && t.priority === 'High')
            );
            markOk('priorityTasks');
        } catch (err) {
            logger.error('Failed to fetch priority tasks:', err);
            markFailed('priorityTasks');
        } finally {
            setLoadingTasks(false);
        }
    }, [currentUser, tasksLimit]);


    const [recentContacts, setRecentContacts] = useState<Client[]>([]);

    const fetchRecentContacts = useCallback(async () => {
        if (!currentUser) return;
        try {
            const q = query(
                collection(db, `users/${currentUser.uid}/clients`),
                where('lastContactDate', '!=', ''),
                orderBy('lastContactDate', 'desc'),
                limit(5)
            );
            const snap = await getDocs(q);
            setRecentContacts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
            markOk('recentContacts');
        } catch (err) {
            logger.error('Failed to fetch recent contacts:', err);
            markFailed('recentContacts');
        }
    }, [currentUser]);


    const [upcomingFollowUps, setUpcomingFollowUps] = useState<Client[]>([]);

    const fetchUpcoming = useCallback(async () => {
        if (!currentUser) return;
        try {
            const today = new Date();
            const nextWeek = new Date(today);
            nextWeek.setDate(nextWeek.getDate() + 7);
            const q = query(
                collection(db, `users/${currentUser.uid}/clients`),
                where('nextFollowUpDate', '>=', today.toISOString()),
                where('nextFollowUpDate', '<=', nextWeek.toISOString()),
                orderBy('nextFollowUpDate', 'asc'),
                limit(20)
            );
            const snap = await getDocs(q);
            setUpcomingFollowUps(
                snap.docs.map(d => ({ id: d.id, ...d.data() } as Client))
                    .filter(c => c.status === 'Active')
            );
            markOk('upcomingFollowUps');
        } catch (err) {
            logger.error('Failed to fetch upcoming follow-ups:', err);
            markFailed('upcomingFollowUps');
        }
    }, [currentUser]);


    useEffect(() => { void fetchRecentClients(); },  [fetchRecentClients]);
    useEffect(() => { void fetchDueClients(); },     [fetchDueClients]);
    useEffect(() => { void fetchPriorityTasks(); },  [fetchPriorityTasks]);
    useEffect(() => { void fetchRecentContacts(); }, [fetchRecentContacts]);
    useEffect(() => { void fetchUpcoming(); },       [fetchUpcoming]);

    const refresh = useCallback(() => {
        fetchRecentClients();
        fetchDueClients();
        fetchPriorityTasks();
        fetchRecentContacts();
        fetchUpcoming();
    }, [fetchRecentClients, fetchDueClients, fetchPriorityTasks, fetchRecentContacts, fetchUpcoming]);

    const isInitialDueLoad    = loadingDue    && dueLimit    === 100;
    const isInitialTasksLoad  = loadingTasks  && tasksLimit  === 100;
    const isInitialRecentLoad = loadingRecent;
    const isInitialCombined   = isInitialDueLoad || isInitialTasksLoad || isInitialRecentLoad;

    const failedSectionLabels = Array.from(failedSections).map(k => SECTION_LABELS[k]);

    return {
        counts,
        recentClients,
        dueClients,
        priorityTasks,
        recentContacts,
        upcomingFollowUps,
        loading: isInitialCombined,
        loadingMoreDue:   loadingDue   && dueLimit   > 100,
        loadingMoreTasks: loadingTasks && tasksLimit > 100,
        // Error surface — empty array means everything loaded fine
        hasError: failedSections.size > 0,
        failedSections: failedSectionLabels,
        refresh,
        loadMoreDue:   () => setDueLimit(prev => prev + 100),
        loadMoreTasks: () => setTasksLimit(prev => prev + 100),
    };
};
