import React, { useState, useEffect } from 'react';
import type { ClientType } from '../../../shared/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPhone, faVoicemail, faHandshake, faBan, faCalendar, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { Button } from '../../../shared/components/common/Compat/Button';
import { addDays, addWeeks, addMonths } from 'date-fns';
import { toInputDate } from '../../../shared/utils/dateUtils';

export type OutcomeType = 'Connected' | 'Voicemail' | 'Sale' | 'WrongNumber';

export interface OutcomeResult {
    outcome: OutcomeType;
    date?: string;
    notes?: string;
    clientType?: ClientType;
    frequency?: 'Daily' | 'Weekly' | 'Bi-Weekly' | 'Monthly';
}

interface CallOutcomeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (result: OutcomeResult) => void;
    clientName: string;
    currentClientType?: ClientType;
    initialFrequency?: 'Daily' | 'Weekly' | 'Bi-Weekly' | 'Monthly';
}

const CallOutcomeModal: React.FC<CallOutcomeModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    clientName,
    currentClientType = 'Prospect',
    initialFrequency = 'Weekly'
}) => {
    // State
    const [outcome, setOutcome] = useState<OutcomeType | null>(null);
    const [nextDate, setNextDate] = useState<string>('');
    const [notes, setNotes] = useState<string>('');
    const [userSelectedType, setUserSelectedType] = useState<ClientType | null>(null);
    const [frequency, setFrequency] = useState<'Daily' | 'Weekly' | 'Bi-Weekly' | 'Monthly'>(initialFrequency);

    const getClientTypeOptions = (): ClientType[] => {
        return ['User', 'Associate', 'Supervisor'];
    };

    // Calculate effective client type (derived state)
    const options = getClientTypeOptions();
    // Use user selection if valid, otherwise default based on current type
    // If current is 'User', suggest 'Associate', otherwise suggest 'User'
    const defaultType = currentClientType === 'User' ? 'Associate' : 'User';

    const effectiveClientType = (userSelectedType && options.includes(userSelectedType))
        ? userSelectedType
        : defaultType;

    // Reset state when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setOutcome(null);
            setNextDate('');
            setNotes('');
            setUserSelectedType(null); // Reset selection
            setFrequency(initialFrequency || 'Weekly');
        }
    }, [isOpen]);

    // Update defaults when outcome changes or frequency changes
    useEffect(() => {
        if (outcome === 'Voicemail') {
            // Default to tomorrow for voicemail
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setNextDate(toInputDate(addDays(new Date(), 1).toISOString()));
        } else if (outcome === 'Connected' || outcome === 'Sale') {
            // Calculate based on frequency
            const now = new Date();
            let date = now;
            switch (frequency) {
                case 'Daily': date = addDays(now, 1); break;
                case 'Weekly': date = addWeeks(now, 1); break;
                case 'Bi-Weekly': date = addWeeks(now, 2); break;
                case 'Monthly': date = addMonths(now, 1); break;
                default: date = addWeeks(now, 1);
            }
            setNextDate(toInputDate(date.toISOString()));
        } else {
            setNextDate('');
        }
    }, [outcome, frequency]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        if (!outcome) return;

        onConfirm({
            outcome,
            date: nextDate,
            notes,
            clientType: outcome === 'Sale' ? effectiveClientType : undefined,
            frequency
        });
        onClose();
    };

    const isValid = () => {
        if (!outcome) return false;
        if (outcome === 'WrongNumber') return true;
        // Require date for others
        return !!nextDate;
    };

    return (

        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-all overflow-y-auto font-sans">
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in my-auto border border-slate-100">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 text-center">
                    <h3 className="text-xl font-bold text-slate-900 font-heading tracking-tight">How did the call go?</h3>
                    <p className="text-slate-500 text-sm mt-1">Select outcome for <span className="font-semibold text-slate-900">{clientName}</span></p>
                </div>

                <div className="p-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Cards Grid */}
                    <div className="grid grid-cols-2 gap-3 mb-6">
                        <OutcomeCard
                            title="Connected"
                            subtitle={`Next: ${frequency === 'Bi-Weekly' ? 'Every 2 Wks' : frequency}`}
                            icon={faPhone}
                            color="blue"
                            selected={outcome === 'Connected'}
                            onClick={() => setOutcome('Connected')}
                        />
                        <OutcomeCard
                            title="Voicemail"
                            subtitle="Retry: 1 Day"
                            icon={faVoicemail}
                            color="orange"
                            selected={outcome === 'Voicemail'}
                            onClick={() => setOutcome('Voicemail')}
                        />
                        <OutcomeCard
                            title="Sale Closed"
                            subtitle="Convert"
                            icon={faHandshake}
                            color="emerald"
                            selected={outcome === 'Sale'}
                            onClick={() => setOutcome('Sale')}
                        />
                        <OutcomeCard
                            title="Wrong #"
                            subtitle="Archive"
                            icon={faBan}
                            color="red"
                            selected={outcome === 'WrongNumber'}
                            onClick={() => setOutcome('WrongNumber')}
                        />
                    </div>

                    {/* Dynamic Fields */}
                    {outcome && (
                        <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 space-y-5 animate-fade-in-up">

                            {/* Wrong Number Warning */}
                            {outcome === 'WrongNumber' ? (
                                <div className="flex gap-3 text-sm text-slate-600 bg-red-50 p-4 rounded-xl border border-red-100">
                                    <FontAwesomeIcon icon={faExclamationTriangle} className="text-red-500 py-0.5" />
                                    <p>
                                        This client will be <strong className="text-red-700">archived</strong> and removed from your active follow-up lists.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {/* Sale Closed - Client Type Dropdown */}
                                    {outcome === 'Sale' && (
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">
                                                Change Client Type To
                                            </label>
                                            <select
                                                value={effectiveClientType}
                                                onChange={(e) => setUserSelectedType(e.target.value as ClientType)}
                                                className="w-full px-4 py-3 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 bg-white transition-all font-medium text-slate-700"
                                            >
                                                {getClientTypeOptions().map(type => (
                                                    <option key={type} value={type}>{type}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {/* Follow-up Frequency - Only for Connected/Sale/Voicemail where next steps matter */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">
                                            Follow-up Frequency
                                        </label>
                                        <div className="relative">
                                            <select
                                                value={frequency}
                                                onChange={(e) => setFrequency(e.target.value as 'Daily' | 'Weekly' | 'Bi-Weekly' | 'Monthly')}
                                                className="w-full appearance-none px-4 py-3 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 bg-white cursor-pointer transition-all font-medium text-slate-700"
                                            >
                                                <option value="Daily">Daily</option>
                                                <option value="Weekly">Weekly</option>
                                                <option value="Bi-Weekly">Every 2 Weeks</option>
                                                <option value="Monthly">Monthly</option>
                                            </select>
                                            <div className="absolute right-4 top-3.5 pointer-events-none text-slate-400">
                                                <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Date Picker */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">
                                            Next Follow Up Date <span className="text-red-500">*</span>
                                        </label>
                                        <div className="relative">
                                            <FontAwesomeIcon icon={faCalendar} className="absolute left-4 top-3.5 text-slate-400" />
                                            <input
                                                type="date"
                                                value={nextDate}
                                                onChange={(e) => setNextDate(e.target.value)}
                                                onClick={(e) => e.currentTarget.showPicker()}
                                                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 bg-white cursor-pointer transition-all font-medium text-slate-700"
                                            />
                                        </div>
                                    </div>

                                    {/* Notes */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">
                                            Notes {outcome === 'Connected' && 'for Next Call'}
                                        </label>
                                        <textarea
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            rows={2}
                                            placeholder="Add context for the next follow-up..."
                                            className="w-full px-4 py-3 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 bg-white resize-none transition-all font-medium text-slate-700 placeholder:text-slate-400"
                                        ></textarea>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-6 pt-4 border-t border-slate-100 bg-white">
                    <Button variant="ghost" className="flex-1 rounded-xl uppercase tracking-wide text-xs font-bold border border-slate-200" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        className="flex-1 rounded-xl bg-primary hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20 uppercase tracking-wide text-xs font-bold"
                        onClick={handleConfirm}
                        disabled={!isValid()}
                    >
                        Confirm
                    </Button>
                </div>
            </div>
        </div>
    );
};

// Sub-component for Cards
interface OutcomeCardProps {
    title: string;
    subtitle: string;
    icon: typeof faPhone;
    color: 'blue' | 'orange' | 'emerald' | 'red';
    selected: boolean;
    onClick: () => void;
}

const OutcomeCard = ({ title, subtitle, icon, color, selected, onClick }: OutcomeCardProps) => {
    const colorClasses: Record<string, string> = {
        blue: 'hover:border-primary hover:bg-blue-50 text-primary',
        orange: 'hover:border-orange-500 hover:bg-orange-50 text-orange-600',
        emerald: 'hover:border-emerald-500 hover:bg-emerald-50 text-emerald-600',
        red: 'hover:border-red-500 hover:bg-red-50 text-red-600',
    };

    const selectedClasses: Record<string, string> = {
        blue: 'border-primary bg-blue-50 ring-2 ring-primary/20',
        orange: 'border-orange-500 bg-orange-50 ring-2 ring-orange-500/20',
        emerald: 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20',
        red: 'border-red-500 bg-red-50 ring-2 ring-red-500/20',
    };

    const isSelected = selected ? selectedClasses[color] : 'border-slate-200 bg-white shadow-sm';

    return (
        <button
            onClick={onClick}
            className={`flex flex-col items-start p-4 rounded-xl border transition-all duration-200 text-left w-full group ${isSelected} ${!selected && colorClasses[color]}`}
        >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 text-sm transition-colors ${selected ? 'bg-white shadow-sm' : 'bg-slate-100 group-hover:bg-white group-hover:shadow-sm'}`}>
                <FontAwesomeIcon icon={icon} />
            </div>
            <span className={`text-sm font-bold block mb-0.5 ${selected ? 'text-slate-900' : 'text-slate-700 group-hover:text-slate-900'}`}>{title}</span>
            <span className={`text-[10px] font-mono font-medium uppercase tracking-wide ${selected ? 'text-slate-500' : 'text-slate-400'}`}>{subtitle}</span>
        </button>
    );
};

export default CallOutcomeModal;