import React, { useState, useMemo, useCallback } from 'react';
import { useCalendarData } from '../hooks/useCalendarData';
import { useAuth } from '../../auth/context/AuthContext';
import { tasksApi, clientsApi } from '../../../shared/services/apiService';
import { useToast } from '../../../shared/context/ToastContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import DayDetailsModal from '../components/DayDetailsModal';
import type { Task, Client } from '../../../shared/types';
import { isSameDay, fromInputDate, getTodayInput } from '../../../shared/utils/dateUtils';
import { logger } from '../../../shared/utils/logger';
import LoadingScreen from '../../../shared/components/common/LoadingScreen';

const Calendar: React.FC = () => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const { tasks, clients, loading, refresh } = useCalendarData(currentDate);
    const { currentUser } = useAuth();
    const { success, error } = useToast();

    const [isMonthSelectorOpen, setIsMonthSelectorOpen] = useState(false);
    const [viewYear, setViewYear] = useState(new Date().getFullYear());
    const [selectedDay, setSelectedDay] = useState<string | null>(null);

    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);

    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
    const goToToday = () => {
        const now = new Date();
        setCurrentDate(now);
        setViewYear(now.getFullYear());
    };

    const toggleMonthSelector = () => {
        if (!isMonthSelectorOpen) {
            setViewYear(year);
        }
        setIsMonthSelectorOpen(!isMonthSelectorOpen);
    };

    const selectMonth = (newMonth: number) => {
        setCurrentDate(new Date(viewYear, newMonth, 1));
        setIsMonthSelectorOpen(false);
    };

    const changeSelectorYear = (offset: number) => {
        setViewYear(prev => prev + offset);
    };

    // useCallback so the renderDays memo below can depend on it. Its identity
    // changes exactly when tasks, clients, year or month change - the same four
    // values that memo used to list directly - so nothing recomputes more often.
    const getItemsForDay = useCallback((day: number) => {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        // tasks and clients are already filtered by Date Range in the hook,
        // but we still need to filter for the specific day *within* that loaded month.
        const dayTasks = tasks.filter(t => isSameDay(t.dueDate, dateStr) && t.status !== 'Completed');
        const allDayCalls = clients.filter(c => isSameDay(c.nextFollowUpDate, dateStr) && c.status === 'Active');

        return {
            dateStr,
            tasks: dayTasks,
            calls: allDayCalls,
            total: dayTasks.length + allDayCalls.length
        };
    }, [tasks, clients, year, month]);

    const handleRescheduleTask = async (task: Task, newDate: string) => {
        if (!currentUser) return;
        try {
            await tasksApi.update({ ...task, dueDate: fromInputDate(newDate) });
            success('Task Rescheduled', `"${task.title}" rescheduled to ${newDate}`);
            refresh();
        } catch (err) {
            logger.error('Failed to reschedule task:', err);
            error('Reschedule Failed', 'Could not reschedule task. Please try again.');
        }
    };

    const handleRescheduleClient = async (client: Client, newDate: string) => {
        if (!currentUser) return;
        try {
            await clientsApi.update({ ...client, nextFollowUpDate: fromInputDate(newDate) });
            success('Follow-Up Rescheduled', `${client.clientName} rescheduled to ${newDate}`);
            refresh();
        } catch (err) {
            logger.error('Failed to reschedule follow-up:', err);
            error('Reschedule Failed', 'Could not reschedule follow-up. Please try again.');
        }
    };

    const handleToggleTask = async (task: Task) => {
        if (!currentUser) return;
        try {
            await tasksApi.update({ ...task, status: task.status === 'Completed' ? 'Pending' : 'Completed' });
            refresh();
        } catch (err) {
            logger.error('Failed to toggle task:', err);
            error('Update Failed', 'Could not update task status.');
        }
    };

    const renderDays = useMemo(() => {
        if (loading) return null; // Or handle generically

        const todayStr = getTodayInput();
        const cells = [];

        // Leading empty cells
        for (let i = 0; i < firstDay; i++) {
            cells.push(
                <div key={`empty-lead-${i}`} className="bg-white border-b border-r border-slate-100/50"></div>
            );
        }

        // Days of the month
        for (let day = 1; day <= daysInMonth; day++) {
            const { dateStr, tasks: dayTasks, calls: dayCalls } = getItemsForDay(day);
            const isToday = dateStr === todayStr;

            cells.push(
                <div
                    key={day}
                    onClick={() => setSelectedDay(dateStr)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${day} ${new Intl.DateTimeFormat('en-US', { month: 'long' }).format(currentDate)}, ${dayTasks.length} tasks, ${dayCalls.length} calls`}
                    className="bg-white border-b border-r border-slate-100/50 p-1.5 sm:p-2 transition-colors hover:bg-slate-50 cursor-pointer group flex flex-col gap-1 overflow-hidden h-full focus:ring-2 focus:ring-inset focus:ring-blue-400 focus:outline-none"
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedDay(dateStr); }}
                >
                    <div className="flex justify-between items-start">
                        <span className={`text-xs sm:text-sm font-semibold ${isToday ? 'text-blue-600' : 'text-slate-700'}`}>
                            {day}
                        </span>
                    </div>

                    <div className="flex flex-col gap-0.5 w-full relative">
                        {/* Calls Pill */}
                        {dayCalls.length > 0 && (
                            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[9px] sm:text-[10px] font-bold border border-blue-100 w-full shadow-sm max-w-full overflow-hidden">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                                <span className="truncate">{dayCalls.length} Call{dayCalls.length !== 1 ? 's' : ''}</span>
                            </div>
                        )}

                        {/* Tasks Pill */}
                        {dayTasks.length > 0 && (
                            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[9px] sm:text-[10px] font-bold border border-purple-100 w-full shadow-sm max-w-full overflow-hidden">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0"></span>
                                <span className="truncate">{dayTasks.length} Task{dayTasks.length !== 1 ? 's' : ''}</span>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        // Trailing empty cells - Force 42 total cells
        const totalSlots = firstDay + daysInMonth;
        const remainingSlots = 42 - totalSlots;

        for (let i = 0; i < remainingSlots; i++) {
            cells.push(
                <div key={`empty-trail-${i}`} className="bg-white border-b border-r border-slate-100/50"></div>
            );
        }

        return cells;
    }, [currentDate, firstDay, daysInMonth, loading, getItemsForDay]);

    // Month Selector Component
    const renderMonthSelector = () => {
        if (!isMonthSelectorOpen) return null;

        const months = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];

        const containerClasses = [
            'fixed bottom-0 left-0 right-0 w-full z-50 bg-white rounded-t-3xl shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.2)] p-6 flex flex-col gap-6 animate-in slide-in-from-bottom duration-300',
            'md:absolute md:top-full md:bottom-auto md:left-0 md:right-auto md:w-[320px] md:rounded-xl md:shadow-xl md:border md:border-slate-200 md:p-5 md:gap-4 md:mt-2 md:slide-in-from-top-2 md:origin-top-left'
        ].join(' ');

        return (
            <>
                {/* Backdrop */}
                <div
                    className="fixed inset-0 bg-black/20 z-40 md:hidden"
                    onClick={() => setIsMonthSelectorOpen(false)}
                />

                {/* Selector Container */}
                <div className={containerClasses}>
                    {/* Year Nav */}
                    <div className="flex items-center justify-between">
                        <button
                            onClick={(e) => { e.stopPropagation(); changeSelectorYear(-1); }}
                            className="p-3 md:p-2 hover:bg-slate-50 rounded-xl md:rounded-lg text-slate-500 hover:text-blue-600 transition-colors active:scale-95"
                            aria-label="Previous Year"
                        >
                            <FontAwesomeIcon icon={faChevronLeft} className="sm:text-sm text-base" />
                        </button>
                        <span className="text-xl md:text-lg font-bold text-slate-800">{viewYear}</span>
                        <button
                            onClick={(e) => { e.stopPropagation(); changeSelectorYear(1); }}
                            className="p-3 md:p-2 hover:bg-slate-50 rounded-xl md:rounded-lg text-slate-500 hover:text-blue-600 transition-colors active:scale-95"
                            aria-label="Next Year"
                        >
                            <FontAwesomeIcon icon={faChevronRight} className="sm:text-sm text-base" />
                        </button>
                    </div>

                    {/* Month Grid */}
                    <div className="grid grid-cols-4 gap-3 md:gap-3">
                        {months.map((m, idx) => (
                            <button
                                key={m}
                                onClick={(e) => { e.stopPropagation(); selectMonth(idx); }}
                                className={`py-3 md:py-2.5 rounded-xl md:rounded-lg text-sm font-medium transition-all active:scale-95
                                    ${idx === month && viewYear === year
                                        ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                                        : 'text-slate-600 bg-slate-50 md:bg-transparent hover:bg-slate-50 hover:text-blue-600 border border-transparent md:border-transparent'
                                    }`}
                            >
                                {m}
                            </button>
                        ))}
                    </div>
                </div>
            </>
        );
    };

    return (
        <div className="h-[calc(100dvh-5rem)] md:h-[calc(100dvh-2rem)] flex flex-col px-4 pt-4 pb-8 w-full max-w-[1600px] mx-auto animate-fade-in gap-3 overflow-hidden min-w-0">
            {/* 1. Header Section - no clip on tablet */}
            <div className="flex flex-wrap items-center justify-between gap-3 shrink-0 relative z-20 min-h-0">
                {/* Title & Date Selector */}
                <div className="flex flex-col relative min-w-0">
                    <div
                        className="flex items-center gap-2 cursor-pointer group min-w-0"
                        onClick={toggleMonthSelector}
                    >
                        <h2 className="text-xl sm:text-2xl md:text-2xl min-[810px]:text-3xl font-bold text-slate-900 tracking-tight group-hover:text-blue-700 transition-colors flex items-center gap-2 truncate">
                            <span>
                                <span className="md:hidden">
                                    {new Intl.DateTimeFormat('en-US', { month: 'short' }).format(currentDate).toUpperCase()}
                                </span>
                                <span className="hidden md:inline">
                                    {new Intl.DateTimeFormat('en-US', { month: 'long' }).format(currentDate)}
                                </span>
                            </span>
                            <span>{year}</span>
                        </h2>
                        <FontAwesomeIcon
                            icon={isMonthSelectorOpen ? faChevronLeft : faChevronRight}
                            className={`text-slate-400 text-sm transition-transform duration-200 ${isMonthSelectorOpen ? '-rotate-90' : 'rotate-90'}`}
                        />
                    </div>
                    {renderMonthSelector()}
                </div>

                {/* Right Controls - never clip */}
                <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                    {/* Toggle Pills (Desktop Only) */}
                    <div className="hidden md:flex gap-2">
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-200 shadow-sm text-[10px] sm:text-xs font-semibold text-slate-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Calls
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-200 shadow-sm text-[10px] sm:text-xs font-semibold text-slate-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span> Tasks
                        </div>
                    </div>

                    {/* Quick Nav - touch-friendly */}
                    <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                        <button
                            onClick={prevMonth}
                            className="w-9 h-9 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 hover:text-blue-600 transition-all focus:ring-2 focus:ring-blue-400 focus:outline-none min-w-[36px]"
                            aria-label="Previous Month"
                        >
                            <FontAwesomeIcon icon={faChevronLeft} className="text-sm" />
                        </button>

                        <button
                            onClick={goToToday}
                            className="h-9 min-w-[36px] px-2 flex items-center justify-center rounded-md bg-slate-50 text-slate-700 font-bold text-xs hover:bg-slate-100 hover:text-blue-600 transition-all border border-slate-200"
                            title="Go to Today"
                        >
                            <span className="hidden min-[810px]:inline">Today</span>
                            <span className="min-[810px]:hidden text-sm font-extrabold rounded px-1 min-w-[24px] flex items-center justify-center h-6 leading-none bg-slate-800 text-white">
                                {new Date().getDate()}
                            </span>
                        </button>

                        <button
                            onClick={nextMonth}
                            className="w-9 h-9 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 hover:text-blue-600 transition-all focus:ring-2 focus:ring-blue-400 focus:outline-none min-w-[36px]"
                            aria-label="Next Month"
                        >
                            <FontAwesomeIcon icon={faChevronRight} className="text-sm" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Mobile Legend */}
            <div className="md:hidden flex items-center gap-3 px-1">
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white border border-slate-100 shadow-sm text-[10px] font-semibold text-slate-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Calls
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white border border-slate-100 shadow-sm text-[10px] font-semibold text-slate-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span> Tasks
                </div>
            </div>

            {/* 3. Calendar Grid - no horizontal scroll */}
            <div className="flex-1 min-h-0 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col relative">
                {loading && (
                    <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
                        <LoadingScreen />
                    </div>
                )}

                {/* Days Header */}
                <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/50">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                        <div key={day} className="py-2 text-center text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            <span className="sm:hidden">{day.charAt(0)}</span>
                            <span className="hidden sm:block lg:hidden">{day}</span>
                            <span className="hidden lg:block">
                                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][idx]}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Days Grid - contained, no overflow */}
                <div className="grid grid-cols-7 grid-rows-6 flex-1 min-h-0 bg-slate-50 auto-rows-fr">
                    {renderDays}
                </div>
            </div>

            {/* Day Details Modal */}
            {selectedDay && (
                <DayDetailsModal
                    isOpen={!!selectedDay}
                    onClose={() => setSelectedDay(null)}
                    date={new Date(`${selectedDay}T00:00:00`)}
                    tasks={getItemsForDay(parseInt(selectedDay.split('-')[2])).tasks}
                    clients={getItemsForDay(parseInt(selectedDay.split('-')[2])).calls}
                    onRescheduleTask={handleRescheduleTask}
                    onRescheduleClient={handleRescheduleClient}
                    onToggleTaskStatus={handleToggleTask}
                />
            )}
        </div>
    );
};


export default Calendar;