import React from 'react';
import { Link } from 'react-router-dom';
import type { Client } from '../../../shared/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus, faPhone, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { toUtcIso } from '../../../shared/utils/dateUtils';

interface RecentActivityProps {
    newClients: Client[];
    recentContacts: Client[];
}

const RecentActivity: React.FC<RecentActivityProps> = ({ newClients, recentContacts }) => {
    const activities = [
        ...newClients.map((c) => ({
            type: 'new_client' as const,
            date: c.createdAt,
            client: c,
            id: `new-${c.id}`,
        })),
        ...recentContacts.map((c) => ({
            type: 'contact' as const,
            date: c.lastContactDate || '',
            client: c,
            id: `contact-${c.id}`,
        })),
    ]
        .sort((a, b) => new Date(toUtcIso(b.date)).getTime() - new Date(toUtcIso(a.date)).getTime())
        .slice(0, 10);

    const formatTimeAgo = (dateString: string) => {
        const date = new Date(toUtcIso(dateString));
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
        if (diffInSeconds < 60) return 'Just now';
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
        return `${Math.floor(diffInSeconds / 86400)}d ago`;
    };

    return (
        <section
            className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col min-h-0 max-h-[min(50vh,420px)]"
            aria-labelledby="recent-activity-heading"
        >
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between gap-4 flex-shrink-0">
                <h2
                    id="recent-activity-heading"
                    className="text-base font-semibold text-slate-900 tracking-tight"
                >
                    Recent activity
                </h2>
                <Link
                    to="/clients"
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-1 rounded-lg px-2 py-1.5 min-h-[36px] inline-flex items-center gap-1 transition-colors"
                >
                    View all
                    <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
                </Link>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
                {activities.length === 0 ? (
                    <div className="px-6 py-8 text-center">
                        <p className="text-sm text-slate-500">No recent activity.</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-100" role="list">
                        {activities.map((activity) => (
                            <li
                                key={activity.id}
                                className="px-6 py-3.5 hover:bg-slate-50/70 transition-colors min-h-[52px] flex items-center"
                            >
                                <div
                                    className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                        activity.type === 'new_client'
                                            ? 'bg-emerald-100 text-emerald-600'
                                            : 'bg-blue-100 text-blue-600'
                                    }`}
                                    aria-hidden
                                >
                                    <FontAwesomeIcon
                                        icon={activity.type === 'new_client' ? faUserPlus : faPhone}
                                        className="text-sm"
                                    />
                                </div>
                                <div className="flex-1 min-w-0 ml-3">
                                    <p className="text-sm text-slate-900">
                                        <span className="font-semibold">{activity.client.clientName}</span>
                                        <span className="text-slate-500 font-normal">
                                            {activity.type === 'new_client' ? ' added' : ' contacted'}
                                        </span>
                                    </p>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        {formatTimeAgo(activity.date)}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
};

export default RecentActivity;