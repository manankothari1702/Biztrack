import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faCalendarAlt } from '@fortawesome/free-solid-svg-icons';
import { getTodayInput, toInputDate } from '../../../shared/utils/dateUtils';

interface RescheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (newDate: string) => void;
    initialDate?: string;
    title?: string;
}

const RescheduleModal: React.FC<RescheduleModalProps> = ({ isOpen, onClose, onConfirm, initialDate, title = 'Reschedule' }) => {
    const [date, setDate] = useState('');

    useEffect(() => {
        if (isOpen) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            setDate(initialDate || toInputDate(tomorrow.toISOString()));
        }
    }, [isOpen, initialDate]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onConfirm(date);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in ring-1 ring-slate-100">
                <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-white">
                    <h3 className="text-lg font-black text-slate-800 flex items-center gap-2 tracking-tight">
                        <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-500">
                            <FontAwesomeIcon icon={faCalendarAlt} className="text-sm" />
                        </div>
                        {title}
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors">
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6">
                    <div className="mb-6">
                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-3">
                            Select New Date
                        </label>
                        <div className="relative">
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all cursor-pointer text-slate-800 font-bold"
                                required
                                min={getTodayInput()}
                                onClick={(e) => e.currentTarget.showPicker()}
                            />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-2 font-medium px-1">*Tasks will be moved to this date.</p>
                    </div>

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl font-bold transition duration-200"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-500/30 transition duration-200"
                        >
                            Confirm
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default RescheduleModal;