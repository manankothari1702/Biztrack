import React from 'react';
import type { Task } from '../../../shared/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationCircle, faChevronRight, faCalendar, faSpinner, faCheckCircle } from '@fortawesome/free-solid-svg-icons';
import { Link } from 'react-router-dom';
import { toUtcIso, formatDisplayDate } from '../../../shared/utils/dateUtils';

interface PriorityTaskListProps {
    tasks: Task[];
    onLoadMore?: () => void;
    loading?: boolean;
}

const getPriorityStyles = (priority: string) => {
    switch (priority) {
        case 'High':
            return { card: 'bg-red-50/80 border-red-100 text-red-600', strip: 'bg-red-500' };
        case 'Medium':
            return { card: 'bg-amber-50/80 border-amber-100 text-amber-600', strip: 'bg-amber-500' };
        case 'Low':
            return { card: 'bg-blue-50/80 border-blue-100 text-blue-600', strip: 'bg-blue-500' };
        default:
            return { card: 'bg-slate-50 border-slate-100 text-slate-600', strip: 'bg-slate-500' };
    }
};

const isOverdue = (dateString: string) => {
    const date = new Date(toUtcIso(dateString));
    date.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date.getTime() < today.getTime();
};

const PriorityTaskList: React.FC<PriorityTaskListProps> = ({ tasks, onLoadMore, loading }) => {
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        if (!onLoadMore) return;
        const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
        if (scrollTop + clientHeight >= scrollHeight - 80) onLoadMore();
    };

    return (
        <section
            className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0 max-h-[min(55vh,480px)] h-full"
            aria-labelledby="priority-tasks-heading"
        >
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between gap-4 flex-shrink-0 bg-slate-50/50">
                <h2
                    id="priority-tasks-heading"
                    className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-3 font-mono"
                >
                    <span
                        className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 flex items-center justify-center flex-shrink-0 shadow-sm"
                        aria-hidden
                    >
                        <FontAwesomeIcon icon={faExclamationCircle} className="text-sm" />
                    </span>
                    PRIORITY TASKS
                </h2>
                <Link
                    to="/tasks"
                    className="text-xs font-bold font-mono uppercase tracking-wider text-primary hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2"
                >
                    View all
                    <FontAwesomeIcon icon={faChevronRight} className="text-[10px]" />
                </Link>
            </div>

            <div
                className="p-4 md:p-5 overflow-y-auto min-h-0 flex-1 font-sans"
                onScroll={handleScroll}
            >
                {tasks.length === 0 ? (
                    <div className="py-12 text-center h-full flex flex-col items-center justify-center">
                        <div className="w-14 h-14 rounded-2xl bg-slate-50 text-slate-300 flex items-center justify-center mb-3">
                            <FontAwesomeIcon icon={faCheckCircle} className="text-2xl" />
                        </div>
                        <p className="text-sm font-medium text-slate-600">No pending tasks</p>
                        <p className="text-xs text-slate-400 mt-1">Great job clearing your list!</p>
                    </div>
                ) : (
                    <ul className="space-y-3" role="list">
                        {tasks.map((task) => {
                            const { strip: stripClass } = getPriorityStyles(task.priority);
                            const overdue = isOverdue(task.dueDate);

                            // Adjust card class to be simpler background but keep color accents
                            const simpleCardClass = "bg-white border-slate-200 hover:border-slate-300 hover:shadow-md";

                            return (
                                <li key={task.id}>
                                    <div
                                        className={`flex items-center gap-4 p-4 rounded-xl border relative overflow-hidden group transition-all duration-200 ${simpleCardClass}`}
                                    >
                                        {/* Priority Strip */}
                                        <div
                                            className={`absolute left-0 top-0 bottom-0 w-1 ${stripClass}`}
                                            aria-hidden
                                        />

                                        <div
                                            className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ml-1 ${task.priority === 'High' ? 'bg-red-50 text-red-500' :
                                                    task.priority === 'Medium' ? 'bg-amber-50 text-amber-500' :
                                                        'bg-blue-50 text-blue-500'
                                                }`}
                                            aria-hidden
                                        >
                                            <FontAwesomeIcon icon={faExclamationCircle} className="text-sm" />
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <p className="font-bold text-slate-900 text-sm truncate group-hover:text-primary transition-colors">
                                                    {task.title}
                                                </p>
                                                {overdue && (
                                                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100">
                                                        Overdue
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${task.priority === 'High' ? 'bg-red-50 text-red-600 border-red-100' :
                                                        task.priority === 'Medium' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                                            'bg-blue-50 text-blue-600 border-blue-100'
                                                    }`}>
                                                    {task.priority}
                                                </span>
                                                <span className="flex items-center gap-1.5 text-slate-400">
                                                    <FontAwesomeIcon icon={faCalendar} className="text-[10px]" />
                                                    {formatDisplayDate(task.dueDate)}
                                                </span>
                                            </div>
                                        </div>

                                        <Link
                                            to="/tasks"
                                            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-primary hover:bg-blue-50 transition-colors"
                                            aria-label={`View task: ${task.title}`}
                                        >
                                            <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
                                        </Link>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {loading && (
                    <div
                        className="flex items-center justify-center gap-2 py-4 text-slate-400"
                        role="status"
                    >
                        <FontAwesomeIcon icon={faSpinner} spin className="text-sm" />
                        <span className="text-xs font-mono uppercase tracking-wider">Loading...</span>
                    </div>
                )}
            </div>
        </section>
    );
};

export default PriorityTaskList;