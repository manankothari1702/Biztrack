import React, { useState } from 'react';
import type { Task, Priority } from '../../../shared/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faCalendarAlt } from '@fortawesome/free-solid-svg-icons';
import { getTodayInput, fromInputDate } from '../../../shared/utils/dateUtils';
import { logger } from '../../../shared/utils/logger';

interface AddTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (task: Task) => Promise<void>;
}

const AddTaskModal: React.FC<AddTaskModalProps> = ({ isOpen, onClose, onAdd }) => {
    const [title, setTitle] = useState('');
    const [notes, setNotes] = useState('');
    const [priority, setPriority] = useState<Priority>('Medium');
    const [dueDate, setDueDate] = useState(getTodayInput());

    const [isLoading, setIsLoading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const newTask: Task = {
            id: crypto.randomUUID(),
            title,
            priority,
            status: 'Pending',
            dueDate: fromInputDate(dueDate),
            notes: notes
        };

        setIsLoading(true);
        try {
            await onAdd(newTask);
            // Only reset and close on success (parent handles success toast)
            setTitle('');
            setNotes('');
            setPriority('Medium');
            setDueDate(getTodayInput());
            onClose();
        } catch (error) {
            // Error handling done by parent (toast), we just stop loading
            // and keep modal open so user doesn't lose data
            logger.error('Failed to add task in modal:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden transform transition-all scale-100">
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                    <h3 className="text-xl font-bold text-slate-800">Create New Task</h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <FontAwesomeIcon icon={faTimes} className="text-xl" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Task Title</label>
                        <input
                            type="text"
                            placeholder="What needs to be done?"
                            required
                            value={title}
                            autoFocus
                            onChange={e => setTitle(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 text-slate-800"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-5">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Due Date</label>
                            <div className="relative">
                                <input
                                    type="date"
                                    required
                                    value={dueDate}
                                    onChange={e => setDueDate(e.target.value)}
                                    onClick={(e) => e.currentTarget.showPicker()}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none cursor-pointer transition-all text-slate-800"
                                />
                                <FontAwesomeIcon icon={faCalendarAlt} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Priority</label>
                            <div className="relative">
                                <select
                                    value={priority}
                                    onChange={e => setPriority(e.target.value as Priority)}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none appearance-none transition-all text-slate-800"
                                >
                                    <option value="High">High</option>
                                    <option value="Medium">Medium</option>
                                    <option value="Low">Low</option>
                                </select>
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                                    <div className="w-2 h-2 border-r-2 border-b-2 border-slate-400 rotate-45 mb-0.5"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Notes</label>
                        <textarea
                            placeholder="Add extra notes..."
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none h-28 resize-none transition-all placeholder:text-slate-400 text-slate-800"
                        ></textarea>
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-blue-600 text-white py-3.5 rounded-xl hover:bg-blue-700 font-bold shadow-lg shadow-blue-500/30 transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <>
                                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                    Creating...
                                </>
                            ) : (
                                'Create Task'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddTaskModal;