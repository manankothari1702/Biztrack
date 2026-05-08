import React, { useState, useEffect } from 'react';
import type { Client } from '../../../shared/types';
import { addDays, addWeeks, addMonths } from 'date-fns';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faPlus, faEnvelope, faCalendar, faUser } from '@fortawesome/free-solid-svg-icons';
import PhoneNumberInput from '../../../shared/components/common/PhoneNumberInput';
import { toInputDate, fromInputDate } from '../../../shared/utils/dateUtils';

interface ClientModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (client: Client) => void;
    initialClient?: Client | null;
    existingClients?: Client[]; // For duplicate phone number checking
}

const ClientModal: React.FC<ClientModalProps> = ({ isOpen, onClose, onSave, initialClient, existingClients = [] }) => {
    const clients = existingClients; // Use prop for duplicate check
    const [formData, setFormData] = useState<Partial<Client>>(() => {
        if (initialClient) {
            return {
                ...initialClient,
                nextFollowUpDate: toInputDate(initialClient.nextFollowUpDate)
            };
        }
        // Default State
        return {
            clientName: '',
            profileImage: '',
            mobile: '',
            phoneNumber: '',
            country: 'India',
            countryCode: '+91',
            email: '',
            clientType: 'Prospect',
            frequency: 'Weekly',
            notes: '',
            status: 'Active',
            nextFollowUpDate: toInputDate(addWeeks(new Date(), 1).toISOString())
        };
    });

    const [errors, setErrors] = useState<{ [key: string]: string }>({});

    useEffect(() => {
        if (isOpen) {
            if (initialClient) {
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setFormData({
                    ...initialClient,
                    nextFollowUpDate: toInputDate(initialClient.nextFollowUpDate)
                });
            } else {
                // Reset to defaults
                const nextCall = toInputDate(addWeeks(new Date(), 1).toISOString());
                setFormData({
                    clientName: '',
                    profileImage: '',
                    mobile: '',
                    phoneNumber: '',
                    country: 'India',
                    countryCode: '+91',
                    email: '',
                    clientType: 'Prospect',
                    frequency: 'Weekly',
                    notes: '',
                    status: 'Active',
                    nextFollowUpDate: nextCall
                });
            }
            setErrors({});
        }
    }, [initialClient, isOpen]);

    if (!isOpen) return null;

    const validate = () => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.clientName?.trim()) newErrors.clientName = 'Full Name is required';

        // Fix: Robust Phone Validation
        // Strip everything except digits
        const phoneDigits = (formData.mobile || '').replace(/\D/g, '');
        // Allow if at least 10 digits (covers local 10-digit and country code logic)
        if (phoneDigits.length < 10) {
            newErrors.mobile = 'Valid phone number is required (min 10 digits)';
        }

        if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = 'Invalid email format';

        // Duplicate Check (using normalized digits)
        if (!initialClient && phoneDigits.length >= 10) {
            const isDuplicate = clients.some(c => (c.mobile || '').replace(/\D/g, '') === phoneDigits);
            if (isDuplicate) newErrors.mobile = 'Client with this number already exists';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;

        if (name === 'frequency') {
            const now = new Date();
            let newDate = now;
            if (value === 'Daily') newDate = addDays(now, 1);
            else if (value === 'Weekly') newDate = addWeeks(now, 1);
            else if (value === 'Bi-Weekly') newDate = addWeeks(now, 2);
            else if (value === 'Monthly') newDate = addMonths(now, 1);

            setFormData(prev => ({
                ...prev,
                [name]: value,
                nextFollowUpDate: toInputDate(newDate.toISOString())
            } as Partial<Client>));
            return;
        }
        setFormData(prev => ({ ...prev, [name]: value }));
        // Clear error if field exists
        if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setFormData(prev => ({ ...prev, profileImage: reader.result as string }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handlePhoneChange = (fullNumber: string, data: { country: string, countryCode: string, number: string }) => {
        setFormData(prev => ({
            ...prev,
            mobile: fullNumber,
            phoneNumber: data.number,
            country: data.country,
            countryCode: data.countryCode
        }));
        if (errors.mobile) setErrors(prev => ({ ...prev, mobile: '' }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate()) return;

        const newClient: Client = {
            ...initialClient,
            ...formData,
            id: initialClient?.id || crypto.randomUUID(),
            clientName: formData.clientName || '',
            mobile: formData.mobile || '',
            countryCode: formData.countryCode || '+91',
            frequency: formData.frequency as 'Daily' | 'Weekly' | 'Bi-Weekly' | 'Monthly',
            notes: formData.notes || '',
            status: formData.status as 'Active' | 'Archived' | 'Converted',
            nextFollowUpDate: fromInputDate(formData.nextFollowUpDate!),
            // lastContactDate is inherited from ...initialClient if present, otherwise undefined and effectively omitted because we won't explicitly add it as undefined.
            // WAIT. If I remove it, and it's NOT in initialClient (e.g. new client), it won't be in newClient.
            // But verify: logic below `newClient` definition uses `as Client`.
            // Does Firestore care if key is missing? No.
            // Does Firestore care if key is present but value undefined? Yes.
            // So removing the explicit assignment is the fix.
            createdAt: initialClient?.createdAt || new Date().toISOString(),
        } as Client;

        // Explicitly sanitize undefined values and remove deprecated fields
        if (newClient.lastContactDate === undefined) {
            delete newClient.lastContactDate;
        }
        // @ts-ignore
        if (newClient.priority) {
            // @ts-ignore
            delete newClient.priority;
        }
        onSave(newClient);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-all duration-300 overflow-y-auto font-sans">
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-scale-in my-auto border border-slate-100">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight font-heading">
                        {initialClient ? 'Edit Client' : 'Add New Client'}
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-lg hover:bg-slate-100">
                        <FontAwesomeIcon icon={faTimes} className="text-lg" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 md:p-8 max-h-[80vh] overflow-y-auto custom-scrollbar">
                    <div className="flex flex-col md:flex-row gap-8 mb-8 items-start">
                        {/* 1) Profile Photo Upload */}
                        <div className="flex-shrink-0 relative group self-center md:self-start">
                            <div className="w-24 h-24 rounded-2xl bg-slate-50 border-2 border-slate-100 flex items-center justify-center overflow-hidden shadow-sm group-hover:border-primary/20 transition-colors">
                                {formData.profileImage ? (
                                    <img src={formData.profileImage} alt="Profile" className="w-full h-full object-cover" />
                                ) : (
                                    <FontAwesomeIcon icon={faUser} className="text-4xl text-slate-300" />
                                )}
                            </div>
                            <label className="absolute -bottom-2 -right-2 bg-white text-primary w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer shadow-md hover:shadow-lg transition-all border border-slate-100 hover:text-blue-700 hover:scale-105">
                                <FontAwesomeIcon icon={faPlus} className="text-sm" />
                                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                            </label>
                        </div>

                        {/* 2) Full Name (Required) */}
                        <div className="flex-grow w-full space-y-5">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">
                                    Full Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    name="clientName"
                                    placeholder="e.g. Sarah Jenkins"
                                    value={formData.clientName}
                                    onChange={handleChange}
                                    className={`w-full px-4 py-3 border rounded-xl outline-none transition-all font-medium text-slate-800 ${errors.clientName ? 'border-red-300 bg-red-50 focus:border-red-500' : 'border-slate-200 bg-slate-50/50 focus:bg-white focus:border-primary focus:ring-4 focus:ring-primary/10'}`}
                                />
                                {errors.clientName && <p className="text-red-500 text-xs mt-1 font-medium flex items-center gap-1"><FontAwesomeIcon icon={faTimes} /> {errors.clientName}</p>}
                            </div>
                        </div>
                    </div>

                    {/* 3) Contact Information Card */}
                    <div className="bg-white rounded-xl p-6 border border-slate-200 mb-8 shadow-sm">
                        <h3 className="text-sm font-bold text-slate-800 mb-5 flex items-center gap-2 font-mono uppercase tracking-wider border-b border-slate-100 pb-2">
                            <span className="bg-blue-100 text-primary w-6 h-6 rounded flex items-center justify-center text-[10px]"><FontAwesomeIcon icon={faEnvelope} /></span>
                            Contact Details
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Mobile Number */}
                            <div>
                                <div className="mb-1">
                                    <PhoneNumberInput
                                        value={formData.mobile}
                                        onChange={handlePhoneChange}
                                        error={errors.mobile}
                                        placeholder="98765 43210"
                                    />
                                </div>
                            </div>

                            {/* Email Address */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">Email Address</label>
                                <div className="relative">
                                    <FontAwesomeIcon icon={faEnvelope} className="absolute left-4 top-3.5 text-slate-400" />
                                    <input
                                        type="email"
                                        name="email"
                                        placeholder="client@example.com"
                                        value={formData.email}
                                        onChange={handleChange}
                                        className={`w-full pl-10 pr-4 py-3 border rounded-xl outline-none transition-all ${errors.email ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50/50 focus:bg-white focus:border-primary focus:ring-4 focus:ring-primary/10'}`}
                                    />
                                </div>
                                {errors.email && <p className="text-red-500 text-xs mt-1 font-medium">{errors.email}</p>}
                            </div>
                        </div>
                    </div>

                    {/* 4) Follow-up Settings Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">Follow-up Frequency</label>
                            <div className="relative">
                                <select
                                    name="frequency"
                                    value={formData.frequency}
                                    onChange={handleChange}
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
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">Next Call Date</label>
                            <div className="relative">
                                <FontAwesomeIcon icon={faCalendar} className="absolute left-4 top-3.5 text-slate-400" />
                                <input
                                    type="date"
                                    name="nextFollowUpDate"
                                    value={formData.nextFollowUpDate}
                                    onChange={e => setFormData({ ...formData, nextFollowUpDate: e.target.value })}
                                    onClick={e => e.currentTarget.showPicker()}
                                    className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 bg-white cursor-pointer transition-all font-medium text-slate-700"
                                />
                            </div>
                        </div>
                    </div>

                    {/* 5) Type Dropdown */}
                    <div className="mb-8">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">Client Type</label>
                        <div className="relative">
                            <select
                                name="clientType"
                                value={formData.clientType}
                                onChange={handleChange}
                                className="w-full appearance-none px-4 py-3 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 bg-white cursor-pointer transition-all font-medium text-slate-700"
                            >
                                <option value="Prospect">Prospect</option>
                                <option value="Associate">Associate</option>
                                <option value="User">User</option>
                                <option value="Supervisor">Supervisor</option>
                            </select>
                            <div className="absolute right-4 top-3.5 pointer-events-none text-slate-400">
                                <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
                            </div>
                        </div>
                    </div>

                    {/* 6) Notes Text Area */}
                    <div className="mb-8">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">Initial Context & Notes</label>
                        <textarea
                            name="notes"
                            value={formData.notes}
                            onChange={handleChange}
                            rows={3}
                            placeholder="Enter any important details regarding this client..."
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 bg-white resize-none transition-all font-medium text-slate-700 placeholder:text-slate-400"
                        ></textarea>
                    </div>

                    {/* 7) Modal Footer Buttons */}
                    <div className="flex gap-4 pt-6 border-t border-slate-100 mt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl font-bold transition duration-200 uppercase tracking-wide text-xs"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-1 py-3 bg-primary hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-500/20 transition duration-200 transform hover:scale-[1.01] active:scale-[0.99] uppercase tracking-wide text-xs"
                        >
                            {initialClient ? 'Update Client' : 'Add Client'}
                        </button>
                    </div>
                </form>
            </div >
        </div >
    );
};

export default ClientModal;