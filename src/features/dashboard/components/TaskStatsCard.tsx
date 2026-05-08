import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTasks, faExclamationCircle, faClock, faCheck } from '@fortawesome/free-solid-svg-icons';

interface TaskStatsCardProps {
    overdue: number;
    pending: number;
    completed: number;
}

const TaskStatsCard: React.FC<TaskStatsCardProps> = ({ overdue, pending, completed }) => {
    const activeTotal = overdue + pending;

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between min-h-[140px] shadow-sm hover:shadow-md transition-all duration-200 group">
            <div className="flex justify-between items-start gap-4 mb-4">
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-heading font-bold text-slate-500 uppercase tracking-tight mb-2">
                        Tasks
                    </p>
                    <p className="text-3xl font-bold text-slate-900 tabular-nums tracking-tight font-sans">
                        {activeTotal}
                        <span className="text-sm font-normal text-slate-400 ml-2">active</span>
                    </p>
                </div>
                <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-50 text-slate-600 transition-transform group-hover:scale-110"
                    aria-hidden
                >
                    <FontAwesomeIcon icon={faTasks} className="text-xl" />
                </div>
            </div>
            {/* Compact single-row breakdown */}
            <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-red-600 bg-red-50 px-2.5 py-1 rounded-md border border-red-100">
                    <FontAwesomeIcon icon={faExclamationCircle} className="text-[10px]" />
                    {overdue}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-100">
                    <FontAwesomeIcon icon={faClock} className="text-[10px]" />
                    {pending}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                    <FontAwesomeIcon icon={faCheck} className="text-[10px]" />
                    {completed}
                </span>
            </div>
        </div>
    );
};

export default TaskStatsCard;