import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPhone, faCheckCircle, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import type { Client } from '../../../shared/types';
import { formatDisplayDate, getTodayInput, toInputDate } from '../../../shared/utils/dateUtils';
import { getWhatsAppLink } from '../../../shared/utils/phoneUtils';

/** Follow-up status for display and sorting: overdue (date < today) vs due today */
type FollowUpStatus = 'overdue' | 'due_today';

function getFollowUpStatus(nextFollowUpDate: string, todayStr: string): FollowUpStatus {
    const dateStr = toInputDate(nextFollowUpDate || '');
    if (!dateStr) return 'overdue'; // treat missing as overdue so they surface first
    return dateStr < todayStr ? 'overdue' : 'due_today';
}

function sortClientsByPriority(clients: Client[]): Client[] {
    const todayStr = getTodayInput();
    const overdue: Client[] = [];
    const dueToday: Client[] = [];
    for (const c of clients) {
        if (getFollowUpStatus(c.nextFollowUpDate, todayStr) === 'overdue') overdue.push(c);
        else dueToday.push(c);
    }
    const byDate = (a: Client, b: Client) =>
        new Date(a.nextFollowUpDate || 0).getTime() - new Date(b.nextFollowUpDate || 0).getTime();
    overdue.sort(byDate);
    dueToday.sort(byDate);
    return [...overdue, ...dueToday];
}

const SCROLL_LOAD_THRESHOLD_PX = 200;
const LOAD_TRIGGER_DEBOUNCE_MS = 150;

interface OutreachListProps {
    clients: Client[];
    onMarkDone: (client: Client) => void;
    onLoadMore: () => void;
    loading: boolean;
    totalCount: number;
}

const OutreachList: React.FC<OutreachListProps> = ({
    clients,
    onMarkDone,
    onLoadMore,
    loading,
    totalCount,
}) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const loadMoreDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const hasMore = clients.length > 0 && clients.length < totalCount;
    const shouldTriggerLoad = hasMore && !loading;

    const tryLoadMore = useCallback(() => {
        if (!shouldTriggerLoad) return;
        if (loadMoreDebounceRef.current) clearTimeout(loadMoreDebounceRef.current);
        loadMoreDebounceRef.current = window.setTimeout(() => {
            loadMoreDebounceRef.current = null;
            onLoadMore();
        }, LOAD_TRIGGER_DEBOUNCE_MS);
    }, [shouldTriggerLoad, onLoadMore]);

    useEffect(() => {
        const scrollEl = scrollContainerRef.current;
        const sentinelEl = sentinelRef.current;
        if (!scrollEl || !sentinelEl || !hasMore) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const [entry] = entries;
                if (!entry?.isIntersecting) return;
                if (loading) return;
                if (clients.length >= totalCount) return;
                tryLoadMore();
            },
            {
                root: scrollEl,
                rootMargin: `${SCROLL_LOAD_THRESHOLD_PX}px 0px`,
                threshold: 0,
            }
        );

        observer.observe(sentinelEl);
        return () => {
            observer.disconnect();
            if (loadMoreDebounceRef.current) {
                clearTimeout(loadMoreDebounceRef.current);
                loadMoreDebounceRef.current = null;
            }
        };
    }, [hasMore, loading, clients.length, totalCount, tryLoadMore]);

    const todayStr = useMemo(() => getTodayInput(), []);
    const sortedClients = useMemo(() => sortClientsByPriority(clients), [clients]);

    const allCaughtUp = totalCount === 0;

    return (
        <section
            className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0 h-full"
            aria-labelledby="outreach-heading"
        >
            <div className="px-6 py-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
                <h2
                    id="outreach-heading"
                    className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-3 font-mono"
                >
                    <span
                        className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-primary flex items-center justify-center flex-shrink-0 shadow-sm"
                        aria-hidden
                    >
                        <FontAwesomeIcon icon={faPhone} className="text-sm" />
                    </span>
                    TODAY'S OUTREACH
                </h2>
                <span
                    className={`text-[10px] font-mono uppercase tracking-wider font-bold px-3 py-1.5 rounded-full border ${allCaughtUp
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-amber-50 text-amber-700 border-amber-100'
                        }`}
                >
                    {allCaughtUp ? 'All caught up' : `${totalCount} PENDING`}
                </span>
            </div>

            <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto min-h-0 max-h-[min(60vh,520px)] overflow-x-hidden font-sans"
                aria-busy={loading}
                aria-label="Outreach list"
            >
                {clients.length === 0 && !loading ? (
                    <div className="px-6 py-16 text-center">
                        <div className="w-16 h-16 rounded-full bg-slate-50 text-slate-300 flex items-center justify-center mx-auto mb-4 border border-slate-100">
                            <FontAwesomeIcon icon={faCheckCircle} className="text-2xl" />
                        </div>
                        <p className="text-base font-medium text-slate-900">No calls due</p>
                        <p className="text-sm text-slate-500 mt-1">You&apos;re all caught up for today.</p>
                    </div>
                ) : (
                    <>
                        <ul className="divide-y divide-slate-100" role="list">
                            {sortedClients.map((client) => {
                                const status = getFollowUpStatus(client.nextFollowUpDate, todayStr);
                                const isOverdue = status === 'overdue';
                                const isDueToday = status === 'due_today';
                                return (
                                    <li
                                        key={client.id}
                                        className="relative p-4 hover:bg-slate-50 transition-all duration-200 group"
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                            <div className="flex items-start gap-4 min-w-0">
                                                <div className="relative">
                                                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm overflow-hidden border border-slate-200 flex-shrink-0 shadow-sm">
                                                        {client.profileImage ? (
                                                            <img
                                                                src={client.profileImage}
                                                                alt=""
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            client.clientName.charAt(0)
                                                        )}
                                                    </div>
                                                    {/* Status Dot */}
                                                    <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center ${isOverdue ? 'bg-red-500' : 'bg-amber-400'
                                                        }`}></div>
                                                </div>

                                                <div className="min-w-0 flex-1 pt-0.5">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="font-bold text-slate-900 truncate text-base group-hover:text-primary transition-colors">
                                                            {client.clientName}
                                                        </p>
                                                        {isOverdue && (
                                                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100 shrink-0">
                                                                Overdue
                                                            </span>
                                                        )}
                                                        {isDueToday && (
                                                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 shrink-0">
                                                                Due today
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center gap-4 text-xs text-slate-500 mt-1">
                                                        {getWhatsAppLink(client.mobile) ? (
                                                            <a
                                                                href={getWhatsAppLink(client.mobile)!}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-1.5 hover:text-emerald-600 transition-colors truncate font-medium bg-slate-50 px-2 py-0.5 rounded border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <FontAwesomeIcon icon={faWhatsapp} className="text-emerald-500" />
                                                                <span className="truncate">{client.mobile}</span>
                                                            </a>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1.5 truncate font-medium bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                                                                <FontAwesomeIcon icon={faPhone} className="text-slate-400" />
                                                                {client.mobile}
                                                            </span>
                                                        )}

                                                        {client.notes && (
                                                            <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-slate-300"></span>
                                                        )}

                                                        {client.notes && (
                                                            <p className="hidden sm:block truncate italic max-w-[200px] text-slate-400">
                                                                "{client.notes}"
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0 w-full sm:w-auto mt-2 sm:mt-0 pl-[60px] sm:pl-0">
                                                <div className="text-right mr-2 hidden sm:block">
                                                    <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-medium">Next Call</p>
                                                    <p className={`text-sm font-semibold ${isOverdue ? 'text-red-600' : 'text-slate-700'}`}>
                                                        {formatDisplayDate(client.nextFollowUpDate)}
                                                    </p>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => onMarkDone(client)}
                                                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 h-10 px-5 rounded-xl bg-white border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-primary hover:text-white hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 active:scale-[0.98] transition-all shadow-sm whitespace-nowrap group-hover:border-primary/30"
                                                >
                                                    <FontAwesomeIcon icon={faCheckCircle} />
                                                    Mark Done
                                                </button>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>

                        {/* Inline loading indicator */}
                        {loading && (
                            <div
                                className="flex items-center justify-center gap-2 py-6 text-slate-400 bg-slate-50/50"
                                role="status"
                                aria-live="polite"
                                aria-label="Loading more"
                            >
                                <FontAwesomeIcon icon={faSpinner} spin className="text-sm" />
                                <span className="text-sm font-medium font-mono uppercase tracking-wider">Loading...</span>
                            </div>
                        )}

                        {/* Sentinel */}
                        {hasMore && (
                            <div
                                ref={sentinelRef}
                                className="h-2 w-full flex-shrink-0"
                                aria-hidden
                            />
                        )}
                    </>
                )}
            </div>
        </section>
    );
};

export default OutreachList;