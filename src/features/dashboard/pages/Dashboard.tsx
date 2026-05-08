import React, { useState } from 'react';
import { useDashboardData } from '../hooks/useDashboardData';
import { useClients } from '../../clients/hooks/useClients';
import StatsCard from '../components/StatsCard';
import OutreachList from '../components/OutreachList';
import PriorityTaskList from '../components/PriorityTaskList';
import QuickActions from '../components/QuickActions';
import TaskStatsCard from '../components/TaskStatsCard';
import UpcomingFollowUps from '../components/UpcomingFollowUps';
import RecentActivity from '../components/RecentActivity';
import DashboardSearch from '../components/DashboardSearch';
import CallOutcomeModal, { type OutcomeResult } from '../../clients/components/CallOutcomeModal';
import { faUsers, faPhone, faExclamationTriangle, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Client } from '../../../shared/types';
import { fromInputDate } from '../../../shared/utils/dateUtils';
import LoadingScreen from '../../../shared/components/common/LoadingScreen';
import { useToast } from '../../../shared/context/ToastContext';

const Dashboard: React.FC = () => {
    const {
        recentClients,
        dueClients,
        priorityTasks,
        recentContacts,
        upcomingFollowUps,
        counts,
        loading,
        hasError,
        failedSections,
        refresh,
        loadMoreDue,
        loadMoreTasks,
        loadingMoreDue,
        loadingMoreTasks
    } = useDashboardData();
    const { success, error } = useToast();


    const { updateClient } = useClients();
    const [selectedClientForOutcome, setSelectedClientForOutcome] = useState<Client | null>(null);
    const [bannerDismissed, setBannerDismissed] = useState(false);

    // Re-show banner if new errors appear after a retry
    React.useEffect(() => {
        if (hasError) setBannerDismissed(false);
    }, [hasError]);

    if (loading) {
        return <LoadingScreen />;
    }

    const handleCallOutcome = async (result: OutcomeResult) => {
        if (!selectedClientForOutcome) return;

        const updatedClient: Client = {
            ...selectedClientForOutcome,
            lastContactDate: new Date().toISOString(),
        };

        if (result.outcome === 'WrongNumber') {
            updatedClient.status = 'Archived';
            updatedClient.nextFollowUpDate = '';
            updatedClient.notes = result.notes
                ? `${selectedClientForOutcome.notes}\n[Wrong Number]: ${result.notes}`
                : selectedClientForOutcome.notes;
        } else {
            if (result.date) {
                updatedClient.nextFollowUpDate = fromInputDate(result.date);
            }
            if (result.frequency) {
                updatedClient.frequency = result.frequency;
            }
            if (result.clientType) {
                updatedClient.clientType = result.clientType;
            }
            if (result.notes) {
                updatedClient.notes = selectedClientForOutcome.notes
                    ? `${selectedClientForOutcome.notes}\n[${result.outcome}]: ${result.notes}`
                    : result.notes;
            }
        }

        try {
            await updateClient(updatedClient);
            success('Follow-Up Logged', 'Client status has been updated successfully.');
            refresh();
            setSelectedClientForOutcome(null);
        } catch (err) {
            console.error("Failed to update client outcome", err);
            error('Update Failed', 'Failed to save call outcome. Please try again.');
        }
    };

    const callsDue = counts.dueCalls;
    const allCaughtUp = callsDue === 0;

    return (
        <div className="space-y-8 max-w-[1600px] mx-auto pb-12 min-w-0 px-0 overflow-x-hidden font-sans">
            {/* Partial-load error banner */}
            {hasError && !bannerDismissed && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <FontAwesomeIcon icon={faExclamationTriangle} className="mt-0.5 shrink-0 text-amber-500" />
                    <div className="flex-1">
                        <span className="font-semibold">Some data failed to load: </span>
                        {failedSections.join(', ')}.
                        {' '}Figures shown may be incomplete.{' '}
                        <button
                            onClick={() => { setBannerDismissed(true); refresh(); }}
                            className="underline font-semibold hover:text-amber-900"
                        >
                            Retry
                        </button>
                    </div>
                    <button
                        onClick={() => setBannerDismissed(true)}
                        aria-label="Dismiss"
                        className="shrink-0 text-amber-400 hover:text-amber-700"
                    >
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>
            )}
            {/* Header: title + search */}
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-8">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight font-heading">
                        Dashboard
                    </h2>
                    <p className="text-slate-500 text-sm mt-1 font-sans">
                        Overview of your current performance
                    </p>
                </div>
                <div className="w-full md:w-auto md:min-w-[320px]">
                    <DashboardSearch />
                </div>
            </header>

            {/* Primary hero: Calls due today */}
            <section
                className={`rounded-2xl border p-6 md:p-8 shadow-sm transition-all duration-300 relative overflow-hidden group ${allCaughtUp
                    ? 'bg-white border-slate-200/80 hover:shadow-md'
                    : 'bg-white border-amber-200/50 shadow-amber-100/50 hover:shadow-amber-100'
                    }`}
                aria-label="Calls due today"
            >
                <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br transition-opacity opacity-10 rounded-full blur-3xl -mr-16 -mt-16 ${allCaughtUp ? 'from-emerald-400 to-emerald-600' : 'from-amber-400 to-amber-600'}`}></div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 relative z-10">
                    <div className="flex items-center gap-6">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm ${allCaughtUp ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                            <span className="text-3xl font-bold tabular-nums font-mono">{callsDue}</span>
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-slate-900 tracking-tight font-heading">
                                Calls Due Today
                            </h1>
                            <p className="text-sm text-slate-500 mt-1 font-medium">
                                {allCaughtUp
                                    ? 'All caught up — excellent work!'
                                    : 'Clients waiting for your connection.'}
                            </p>
                        </div>
                    </div>
                    {!allCaughtUp && (
                        <a
                            href="#outreach-list"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-primary transition-all shadow-sm hover:shadow-primary/30 active:scale-[0.98]"
                        >
                            <span>Start Outreach</span>
                            <span aria-hidden>↓</span>
                        </a>
                    )}
                </div>
            </section>

            {/* Stats row */}
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-6" aria-label="Key metrics">
                <StatsCard
                    title="Calls Due"
                    value={counts.dueCalls}
                    icon={faPhone}
                    color={allCaughtUp ? 'green' : 'orange'}
                    trend={allCaughtUp ? 'All caught up' : 'Needs attention'}
                />
                <TaskStatsCard
                    overdue={counts.overdueTasks}
                    pending={counts.pendingTasks}
                    completed={counts.completedTasks || 0}
                />
                <StatsCard
                    title="Active Clients"
                    value={counts.totalClients}
                    icon={faUsers}
                    color="blue"
                    trend="Total Database"
                />
            </section>

            {/* Quick actions */}
            <QuickActions />

            {/* Main content grid */}
            <div
                id="outreach-list"
                className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start scroll-mt-24"
            >
                <div className="lg:col-span-2 space-y-8">
                    <OutreachList
                        clients={dueClients}
                        onMarkDone={setSelectedClientForOutcome}
                        onLoadMore={loadMoreDue}
                        loading={loadingMoreDue}
                        totalCount={counts.dueCalls}
                    />
                    <PriorityTaskList
                        tasks={priorityTasks}
                        onLoadMore={loadMoreTasks}
                        loading={loadingMoreTasks}
                    />
                </div>
                <div className="space-y-8 flex flex-col">
                    <UpcomingFollowUps clients={upcomingFollowUps} />
                    <RecentActivity newClients={recentClients} recentContacts={recentContacts} />
                </div>
            </div>

            <CallOutcomeModal
                isOpen={!!selectedClientForOutcome}
                onClose={() => setSelectedClientForOutcome(null)}
                onConfirm={handleCallOutcome}
                clientName={selectedClientForOutcome?.clientName || ''}
                currentClientType={selectedClientForOutcome?.clientType}
                initialFrequency={selectedClientForOutcome?.frequency}
            />
        </div>
    );
};

export default Dashboard;