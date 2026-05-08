import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarAlt, faClock } from '@fortawesome/free-solid-svg-icons';
import type { Client } from '../../../shared/types';
import { formatDisplayDate } from '../../../shared/utils/dateUtils';

interface UpcomingFollowUpsProps {
    clients: Client[];
}

const UpcomingFollowUps: React.FC<UpcomingFollowUpsProps> = ({ clients }) => {
    return (
        <section
            className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col min-h-0"
            aria-labelledby="upcoming-heading"
        >
            <div className="px-6 py-5 border-b border-slate-100">
                <h2
                    id="upcoming-heading"
                    className="text-base font-semibold text-slate-900 tracking-tight flex items-center gap-2"
                >
                    <span
                        className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0"
                        aria-hidden
                    >
                        <FontAwesomeIcon icon={faClock} className="text-sm" />
                    </span>
                    Upcoming follow-ups
                </h2>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 max-h-[min(45vh,380px)]">
                {clients.length === 0 ? (
                    <div className="px-6 py-8 text-center">
                        <p className="text-sm text-slate-500">No upcoming follow-ups.</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-100" role="list">
                        {clients.map((client) => (
                            <li
                                key={client.id}
                                className="flex items-center gap-3 px-6 py-3.5 hover:bg-slate-50/70 transition-colors min-h-[56px]"
                            >
                                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 font-semibold text-xs overflow-hidden border border-slate-200/80 flex-shrink-0">
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
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-slate-900 text-sm truncate">
                                        {client.clientName}
                                    </p>
                                    <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                                        <FontAwesomeIcon icon={faCalendarAlt} className="text-[10px] text-slate-400" />
                                        <span>{formatDisplayDate(client.nextFollowUpDate)}</span>
                                    </p>
                                </div>
                                <span
                                    className={`text-xs font-medium px-2.5 py-1 rounded-lg flex-shrink-0 ${
                                        client.clientType === 'Prospect'
                                            ? 'bg-purple-100 text-purple-700'
                                            : client.clientType === 'User'
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-blue-100 text-blue-700'
                                    }`}
                                >
                                    {client.clientType}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
};

export default UpcomingFollowUps;