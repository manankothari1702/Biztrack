import React, { useState, useCallback } from 'react';
import { useTasks } from '../hooks/useTasks';

import TaskItem from '../components/TaskItem';
import AddTaskModal from '../components/AddTaskModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Task } from '../../../shared/types';
import {
    faPlus,
    faSortAmountDown,
    faSortAmountUp
} from '@fortawesome/free-solid-svg-icons';
import { logger } from '../../../shared/utils/logger';

const Tasks: React.FC = () => {
    // Filters & Sorting State - Lifted up to drive the hook
    const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Completed' | 'Overdue'>('All');
    const [priorityFilter, setPriorityFilter] = useState<'All' | 'High' | 'Medium' | 'Low'>('All');
    const [sortBy, setSortBy] = useState<'date' | 'priority'>('date');

    const {
        tasks,
        loading,
        addTask,
        updateTask,
        deleteTask,
        hasMore,
        loadMore
    } = useTasks(statusFilter, priorityFilter, sortBy);

    // Toast handled internally by hook for CRUD, but we can expose more if needed.
    // Actually hook handles it.
    const [isAdding, setIsAdding] = useState(false);

    const toggleSort = () => {
        setSortBy(prev => prev === 'date' ? 'priority' : 'date');
    };

    // Wrapper functions with handling if needed, or pass directly
    const handleAddTask = useCallback(async (task: Task) => {
        try {
            await addTask(task);
            setIsAdding(false);
        } catch (err) {
            logger.error('Failed to add task:', err);
        }
    }, [addTask]);

    const handleUpdateTask = useCallback(async (task: Task) => {
        try {
            await updateTask(task);
        } catch (err) {
            logger.error('Failed to update task:', err);
        }
    }, [updateTask]);

    const handleDeleteTask = useCallback(async (id: string) => {
        try {
            await deleteTask(id);
        } catch (err) {
            logger.error('Failed to delete task:', err);
        }
    }, [deleteTask]);

    return (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
            {/* Header Card */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col items-center gap-6 mb-8">

                {/* Top Row: Title, Stats, Controls */}
                <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-4">

                    {/* Left: Title & Subtitle */}
                    <div className="flex-1 text-center sm:text-left">
                        <h2 className="text-2xl font-bold text-slate-800">Task Manager</h2>
                        <p className="text-slate-500 font-medium mt-1">
                            Manage your tasks efficiently
                        </p>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex flex-wrap items-center justify-center sm:justify-end gap-3 flex-[1.5]">

                        {/* Status Filter */}
                        <div className="relative">
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as 'All' | 'Pending' | 'Completed' | 'Overdue')}
                                className="appearance-none bg-slate-50 border border-slate-200 text-slate-600 text-sm font-semibold rounded-lg py-2.5 pl-4 pr-8 focus:ring-2 focus:ring-blue-500/20 outline-none cursor-pointer hover:bg-slate-100 transition-colors"
                            >
                                <option value="All">All Status</option>
                                <option value="Pending">Pending</option>
                                <option value="Completed">Completed</option>
                                <option value="Overdue">Overdue</option>
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                <div className="w-1.5 h-1.5 border-r-2 border-b-2 border-slate-400 rotate-45 mb-0.5"></div>
                            </div>
                        </div>

                        {/* Priority Filter */}
                        <div className="relative">
                            <select
                                value={priorityFilter}
                                onChange={(e) => setPriorityFilter(e.target.value as 'All' | 'High' | 'Medium' | 'Low')}
                                className="appearance-none bg-slate-50 border border-slate-200 text-slate-600 text-sm font-semibold rounded-lg py-2.5 pl-4 pr-8 focus:ring-2 focus:ring-blue-500/20 outline-none cursor-pointer hover:bg-slate-100 transition-colors"
                            >
                                <option value="All">All Priority</option>
                                <option value="High">High</option>
                                <option value="Medium">Medium</option>
                                <option value="Low">Low</option>
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                <div className="w-1.5 h-1.5 border-r-2 border-b-2 border-slate-400 rotate-45 mb-0.5"></div>
                            </div>
                        </div>

                        {/* Sort Button */}
                        <button
                            onClick={toggleSort}
                            className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 transition-all shadow-sm"
                            title={`Sorted by ${sortBy === 'date' ? 'Date' : 'Priority'}`}
                        >
                            <FontAwesomeIcon icon={sortBy === 'date' ? faSortAmountDown : faSortAmountUp} />
                        </button>

                        {/* Add Task Button */}
                        <button
                            onClick={() => setIsAdding(true)}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg shadow-lg shadow-blue-500/30 flex items-center gap-2 transition-all transform active:scale-95"
                        >
                            <FontAwesomeIcon icon={faPlus} />
                            Add Task
                        </button>
                    </div>
                </div>
            </div>

            {/* Task List */}
            <div className="space-y-4">
                {loading && tasks.length === 0 ? (
                    <div className="text-center py-10 text-slate-500">Loading tasks...</div>
                ) : tasks.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
                        <p className="text-slate-400 font-medium">No tasks found matching your filters.</p>
                        <button
                            onClick={() => { setStatusFilter('All'); setPriorityFilter('All'); }}
                            className="text-blue-600 font-semibold mt-2 hover:underline"
                        >
                            Clear Filters
                        </button>
                    </div>
                ) : (
                    <>
                        {tasks.map(task => (
                            <TaskItem key={task.id} task={task} onUpdate={handleUpdateTask} onDelete={handleDeleteTask} />
                        ))}

                        {hasMore && (
                            <div className="text-center pt-4">
                                <button
                                    onClick={() => loadMore()}
                                    disabled={loading}
                                    className="px-4 py-2 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 transition"
                                >
                                    {loading ? 'Loading...' : 'Load More'}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Add Task Modal */}
            <AddTaskModal
                isOpen={isAdding}
                onClose={() => setIsAdding(false)}
                onAdd={handleAddTask}
            />
        </div>
    );
};

export default Tasks;