import React from 'react';
import type { Task, Client } from '../../../shared/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faCalendarAlt, faPhone, faTasks, faCheckCircle } from '@fortawesome/free-solid-svg-icons';
import { format } from 'date-fns';
import RescheduleModal from './RescheduleModal';

interface DayDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    date: Date;
    tasks: Task[];
    clients: Client[]; // Clients with calls due on this date
    onRescheduleTask: (task: Task, newDate: string) => void;
    onRescheduleClient: (client: Client, newDate: string) => void;
    onToggleTaskStatus: (task: Task) => void;
}

const DayDetailsModal: React.FC<DayDetailsModalProps> = ({
    isOpen, onClose, date, tasks, clients, onRescheduleTask, onRescheduleClient, onToggleTaskStatus
}) => {
    const [rescheduleState, setRescheduleState] = React.useState<{
        isOpen: boolean;
        item: Task | Client | null;
        type: 'task' | 'client' | null;
    }>({
        isOpen: false,
        item: null,
        type: null
    });

    const [visibleClientsCount, setVisibleClientsCount] = React.useState(20);
    const [visibleTasksCount, setVisibleTasksCount] = React.useState(20);

    const handleReschedule = (item: Task | Client, type: 'task' | 'client') => {
        setRescheduleState({
            isOpen: true,
            item,
            type
        });
    };

    const handleConfirmReschedule = (newDate: string) => {
        if (rescheduleState.item && rescheduleState.type) {
            if (rescheduleState.type === 'task') {
                onRescheduleTask(rescheduleState.item as Task, newDate);
            } else {
                onRescheduleClient(rescheduleState.item as Client, newDate);
            }
        }
        setRescheduleState({ isOpen: false, item: null, type: null });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-fade-in">
            <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-slate-900/20 w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh] ring-1 ring-white/50 animate-scale-in">

                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white/50">
                    <div>
                        <h2 className="text-2xl font-black text-slate-800 tracking-tight">{format(date, 'MMMM d')}</h2>
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">{format(date, 'EEEE, yyyy')}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-all focus:outline-none focus:ring-2 focus:ring-slate-300"
                        aria-label="Close Modal"
                    >
                        <FontAwesomeIcon icon={faTimes} className="text-lg" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                    {/* Outreach Section */}
                    <div className="animate-fade-in-up" style={{ animationDelay: '0ms' }}>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                <FontAwesomeIcon icon={faPhone} className="text-sm" />
                            </div>
                            <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">
                                Outreach <span className="text-slate-400 font-medium ml-1">({clients.length})</span>
                            </h3>
                        </div>

                        <div className="space-y-3">
                            {clients.length === 0 && (
                                <div className="p-6 text-center border-2 border-dashed border-slate-100 rounded-2xl bg-slate-50/50">
                                    <p className="text-sm text-slate-400 font-medium italic">No calls scheduled for today.</p>
                                </div>
                            )}
                            {clients.slice(0, visibleClientsCount).map((client, idx) => (
                                <div
                                    key={client.id}
                                    className="group bg-white border border-slate-100 p-4 rounded-2xl shadow-sm hover:shadow-md hover:border-blue-100 hover:translate-x-1 transition-all duration-200 flex justify-between items-center"
                                    style={{ animationDelay: `${idx * 50}ms` }}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 shadow-blue-200 text-white font-bold flex items-center justify-center text-sm shadow-lg">
                                            {client.clientName.charAt(0)}
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-800 text-base">{client.clientName}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{client.clientType}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleReschedule(client, 'client')}
                                        className="text-xs font-bold text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 px-3 py-2 rounded-xl transition-colors"
                                    >
                                        <FontAwesomeIcon icon={faCalendarAlt} className="mr-1.5" />
                                        Reschedule
                                    </button>
                                </div>
                            ))}
                            {visibleClientsCount < clients.length && (
                                <button
                                    onClick={() => setVisibleClientsCount(prev => prev + 20)}
                                    className="w-full py-2 text-sm font-bold text-blue-600 hover:bg-blue-50 rounded-xl transition-colors mt-2"
                                >
                                    Load More Calls ({clients.length - visibleClientsCount} remaining)
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Tasks Section */}
                    <div className="animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
                                <FontAwesomeIcon icon={faTasks} className="text-sm" />
                            </div>
                            <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">
                                Tasks <span className="text-slate-400 font-medium ml-1">({tasks.length})</span>
                            </h3>
                        </div>

                        <div className="space-y-3">
                            {tasks.length === 0 && (
                                <div className="p-6 text-center border-2 border-dashed border-slate-100 rounded-2xl bg-slate-50/50">
                                    <p className="text-sm text-slate-400 font-medium italic">No tasks due today.</p>
                                </div>
                            )}
                            {tasks.slice(0, visibleTasksCount).map((task, idx) => (
                                <div
                                    key={task.id}
                                    className={`group bg-white border border-slate-100 p-3 rounded-2xl shadow-sm hover:shadow-md hover:border-purple-100 transition-all duration-200 flex justify-between items-center ${task.status === 'Completed' ? 'opacity-60' : ''}`}
                                    style={{ animationDelay: `${idx * 50}ms` }}
                                >
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <button
                                            onClick={() => onToggleTaskStatus(task)}
                                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${task.status === 'Completed'
                                                ? 'bg-green-500 border-green-500 text-white'
                                                : 'border-slate-300 text-transparent hover:border-purple-400'
                                                }`}
                                        >
                                            <FontAwesomeIcon icon={faCheckCircle} className="text-xs" />
                                        </button>

                                        <div className="min-w-0">
                                            <p className={`font-bold text-slate-800 text-sm truncate ${task.status === 'Completed' ? 'line-through text-slate-400' : ''}`}>
                                                {task.title}
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className={`w-2 h-2 rounded-full ${task.priority === 'High' ? 'bg-red-500' : task.priority === 'Medium' ? 'bg-orange-500' : 'bg-blue-400'}`}></span>
                                                {/* Time removed as tasks are date-only */}
                                            </div>
                                        </div>
                                    </div>

                                    {!task.status.includes('Completed') && (
                                        <button
                                            onClick={() => handleReschedule(task, 'task')}
                                            className="ml-2 text-xs font-bold text-slate-400 hover:text-purple-600 bg-slate-50 hover:bg-purple-50 px-3 py-2 rounded-xl transition-colors shrink-0"
                                        >
                                            <FontAwesomeIcon icon={faCalendarAlt} className="mr-1.5" />
                                            Reschedule
                                        </button>
                                    )}
                                </div>
                            ))}
                            {visibleTasksCount < tasks.length && (
                                <button
                                    onClick={() => setVisibleTasksCount(prev => prev + 20)}
                                    className="w-full py-2 text-sm font-bold text-purple-600 hover:bg-purple-50 rounded-xl transition-colors mt-2"
                                >
                                    Load More Tasks ({tasks.length - visibleTasksCount} remaining)
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>


            {/* Mounted only while open, so it picks up a fresh default date each
                time rather than resetting itself from an effect after first paint. */}
            {rescheduleState.isOpen && (
                <RescheduleModal
                    isOpen={rescheduleState.isOpen}
                    onClose={() => setRescheduleState({ ...rescheduleState, isOpen: false })}
                    onConfirm={handleConfirmReschedule}
                    title={`Reschedule ${rescheduleState.type === 'task' ? 'Task' : 'Call'}`}
                />
            )}
        </div>
    );
};

export default DayDetailsModal;