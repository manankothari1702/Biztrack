import React, { useState } from 'react';
import type { Task, Priority } from '../../../shared/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faChevronDown,
    faTrashAlt,
    faCalendarAlt,
    faPen,
    faSave,
    faTimes
} from '@fortawesome/free-solid-svg-icons';
import { isPast, isToday } from 'date-fns';
import { toInputDate, fromInputDate, toUtcIso } from '../../../shared/utils/dateUtils';
import { logger } from '../../../shared/utils/logger';

interface TaskItemProps {
    task: Task;
    onUpdate: (task: Task) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}

const TaskItem: React.FC<TaskItemProps> = ({ task, onUpdate, onDelete }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    // Edit State
    const [editTitle, setEditTitle] = useState(task.title);
    const [editNotes, setEditNotes] = useState(task.notes);
    const [editDueDate, setEditDueDate] = useState(toInputDate(task.dueDate));
    const [editPriority, setEditPriority] = useState<Priority>(task.priority);

    // Styling Config
    const priorityConfig = {
        High: {
            borderLeft: 'border-l-red-500',
            badge: 'bg-red-50 text-red-600 border-red-200',
            text: 'text-red-600'
        },
        Medium: {
            borderLeft: 'border-l-amber-500',
            badge: 'bg-amber-50 text-amber-600 border-amber-200',
            text: 'text-amber-600'
        },
        Low: {
            borderLeft: 'border-l-blue-500',
            badge: 'bg-blue-50 text-blue-600 border-blue-200',
            text: 'text-blue-600'
        },
    };

    const [isLoading, setIsLoading] = useState(false);

    const handleStatusToggle = async () => {
        const newStatus = task.status === 'Completed' ? 'Pending' : 'Completed';
        try {
            await onUpdate({ ...task, status: newStatus });
        } catch (error) {
            // Error managed by parent toast, but we can't do much here except revert if we did optimistic UI
            // Since we don't optimistic locally for status, it's fine.
            logger.error('Failed to toggle status:', error);
        }
    };

    const handleSave = async () => {
        setIsLoading(true);
        try {
            await onUpdate({
                ...task,
                title: editTitle,
                notes: editNotes,
                dueDate: fromInputDate(editDueDate),
                priority: editPriority
            });
            setIsEditing(false);
        } catch (error) {
            logger.error('Update failed:', error);
            // Keep editing mode open
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancel = () => {
        setEditTitle(task.title);
        setEditNotes(task.notes);
        setEditDueDate(toInputDate(task.dueDate));
        setEditPriority(task.priority);
        setIsEditing(false);
    };

    const isCompleted = task.status === 'Completed';
    // Strict Overdue logic: Date is past AND not today AND not completed
    const isOverdue = isPast(new Date(task.dueDate)) && !isToday(new Date(task.dueDate)) && !isCompleted;

    const [showDeleteModal, setShowDeleteModal] = useState(false);

    const toggleExpand = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsExpanded(!isExpanded);
    };

    const confirmDelete = async () => {
        setIsLoading(true); // Maybe show spinner?
        try {
            await onDelete(task.id);
            // Modal closes on unmount
        } catch (error) {
            logger.error('Delete failed:', error);
            setIsLoading(false); // Stop loading if failed (though likely parent handles error toast)
            setShowDeleteModal(false); // Or keep open? Let's close for now as parent toasts error
        }
    };

    if (isEditing) {
        return (
            <div className="bg-white rounded-xl border border-blue-200 shadow-lg p-5 animate-fade-in relative overflow-hidden">
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${priorityConfig[editPriority].borderLeft.replace('border-l-', 'bg-')}`}></div>
                <div className="pl-3">
                    <div className="flex gap-4 mb-4">
                        <div className="flex-1">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Title</label>
                            <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-slate-800 font-semibold"
                                autoFocus
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Due Date</label>
                            <input
                                type="date"
                                value={editDueDate}
                                onChange={(e) => setEditDueDate(e.target.value)}
                                onClick={(e) => e.currentTarget.showPicker()}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm cursor-pointer"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Priority</label>
                            <select
                                value={editPriority}
                                onChange={(e) => setEditPriority(e.target.value as Priority)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            >
                                <option value="High">High</option>
                                <option value="Medium">Medium</option>
                                <option value="Low">Low</option>
                            </select>
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notes</label>
                        <textarea
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm h-24 resize-none"
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                        <button
                            onClick={handleCancel}
                            className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-2"
                        >
                            <FontAwesomeIcon icon={faTimes} /> Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isLoading}
                            className="px-6 py-2 bg-blue-600 text-white font-medium hover:bg-blue-700 rounded-lg shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                            ) : (
                                <FontAwesomeIcon icon={faSave} />
                            )}
                            Save Changes
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`
                group relative bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-300 ease-in-out border border-slate-100
                ${isCompleted ? 'opacity-80' : ''}
                border-l-[6px] ${priorityConfig[task.priority].borderLeft}
            `}
            onClick={() => setIsExpanded(!isExpanded)}
        >
            <div className="flex items-center p-4 sm:p-5 cursor-pointer">

                {/* Checkbox (Left) */}
                <button
                    onClick={(e) => { e.stopPropagation(); handleStatusToggle(); }}
                    className={`
                        flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center mr-4 transition-all duration-200
                        ${isCompleted
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : 'bg-white border-slate-300 text-transparent hover:border-blue-400'
                        }
                    `}
                    aria-label={isCompleted ? "Mark as pending" : "Mark as completed"}
                >
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20"><path d="M0 11l2-2 5 5L18 3l2 2L7 18z" /></svg>
                </button>

                {/* Content (Middle) */}
                <div className="flex-1 min-w-0 pr-4">
                    <h4 className={`font-bold text-slate-800 text-[15px] mb-0.5 truncate ${isCompleted ? 'line-through text-slate-400' : ''}`}>
                        {task.title}
                    </h4>
                    <p className={`text-sm truncate ${isCompleted ? 'text-slate-300 line-through' : 'text-slate-400'}`}>
                        {task.notes || <span className="italic opacity-50">No notes</span>}
                    </p>
                </div>

                {/* Info (Right) */}
                <div className="flex items-center gap-2 sm:gap-4">

                    {/* Due Date */}
                    <div className={`flex items-center gap-2 text-sm font-medium ${isOverdue ? 'text-red-500' : 'text-slate-500'}`}>
                        <FontAwesomeIcon icon={faCalendarAlt} />
                        <span className="hidden sm:inline">
                            {new Date(toUtcIso(task.dueDate)).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: 'numeric' })}
                        </span>
                        <span className="sm:hidden">
                            {new Date(toUtcIso(task.dueDate)).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })}
                        </span>
                    </div>

                    {/* Overdue Badge */}
                    {isOverdue && (
                        <span className="hidden sm:inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-600 uppercase tracking-wide">
                            Overdue
                        </span>
                    )}

                    {/* Priority Badge */}
                    <span className={`
                        hidden sm:inline-flex px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border
                        ${priorityConfig[task.priority].badge}
                    `}>
                        {task.priority}
                    </span>

                    {/* Mobile Priority Indicator (Dot) */}
                    <div className={`sm:hidden w-2.5 h-2.5 rounded-full ${priorityConfig[task.priority].borderLeft.replace('border-l-', 'bg-')}`}></div>

                    {/* Expand Chevron */}
                    <button
                        onClick={toggleExpand}
                        className={`
                            text-slate-400 hover:text-blue-600 transition-all transform duration-300 ml-1 p-1
                            ${isExpanded ? 'rotate-180' : 'rotate-0'}
                        `}
                    >
                        <FontAwesomeIcon icon={faChevronDown} />
                    </button>
                </div>
            </div>

            {/* Expanded Details */}
            <div className={`
                overflow-hidden transition-all duration-300 ease-in-out border-t border-slate-50
                ${isExpanded ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'}
            `}>
                <div className="p-5 pl-[3.5rem] bg-slate-50/50">
                    <div className="flex flex-col sm:flex-row justify-between gap-4">
                        <div className="flex-1">
                            <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Full Notes</h5>
                            <p className="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed">
                                {task.notes || 'No notes provided.'}
                            </p>
                        </div>

                        <div className="flex sm:flex-col gap-2 justify-start sm:justify-start min-w-[120px]">
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:border-blue-300 hover:text-blue-600 rounded-lg text-sm font-semibold text-slate-600 transition-all shadow-sm"
                            >
                                <FontAwesomeIcon icon={faPen} /> Edit
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setShowDeleteModal(true); }}
                                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:border-red-300 hover:text-red-600 rounded-lg text-sm font-semibold text-slate-600 transition-all shadow-sm"
                            >
                                <FontAwesomeIcon icon={faTrashAlt} /> Delete
                            </button>
                        </div>
                    </div>
                    {/* Mobile Only Badges in Expanded view for clarity */}
                    <div className="sm:hidden flex items-center gap-3 mt-4 pt-4 border-t border-slate-200">
                        {isOverdue && <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-600">OVERDUE</span>}
                        <span className={`px-2 py-0.5 rounded text-xs font-bold border ${priorityConfig[task.priority].badge}`}>
                            {task.priority} PRIORITY
                        </span>
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6 transform transition-all scale-100 border border-slate-100">
                        <div className="flex flex-col items-center text-center">
                            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-500 text-xl mb-4">
                                <FontAwesomeIcon icon={faTrashAlt} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">Delete Task?</h3>
                            <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                                Are you sure you want to delete <span className="font-semibold text-slate-700">"{task.title}"</span>?
                                <br />This action cannot be undone.
                            </p>
                            <div className="flex gap-3 w-full">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowDeleteModal(false); }}
                                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); confirmDelete(); }}
                                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl shadow-lg shadow-red-500/30 transition-colors"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TaskItem;