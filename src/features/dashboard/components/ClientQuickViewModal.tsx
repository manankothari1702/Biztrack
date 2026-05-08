import React, { useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPhone, faEnvelope, faCalendar, faUserTag, faTimes, faExternalLinkAlt, faCheckCircle } from '@fortawesome/free-solid-svg-icons';
import { Button } from '../../../shared/components/common/Compat/Button';
import type { Client } from '../../../shared/types';
import { toUtcIso } from '../../../shared/utils/dateUtils';

interface ClientQuickViewModalProps {
    isOpen: boolean;
    onClose: () => void;
    client: Client | null;
    onMarkDone: (client: Client) => void;
    onMoreInfo: (client: Client) => void;
}

const ClientQuickViewModal: React.FC<ClientQuickViewModalProps> = ({
    isOpen,
    onClose,
    client,
    onMarkDone,
    onMoreInfo
}) => {
    // Handle Esc key to close
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || !client) return null;

    const formattedDate = client.nextFollowUpDate
        ? new Date(toUtcIso(client.nextFollowUpDate)).toLocaleDateString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })
        : '—';

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-all">
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-scale-in my-auto border border-slate-100">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="text-lg font-bold text-slate-800">Quick View</h3>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Client Identity */}
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-lg font-bold">
                            {client.clientName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 leading-tight">{client.clientName}</h2>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 mt-1.5">
                                <FontAwesomeIcon icon={faUserTag} className="text-slate-400 text-[10px]" />
                                {client.clientType}
                            </span>
                        </div>
                    </div>

                    {/* Details Grid */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                            <div className="w-8 h-8 rounded-lg bg-white shadow-sm flex items-center justify-center text-slate-400">
                                <FontAwesomeIcon icon={faPhone} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Mobile</p>
                                <p className="text-sm font-medium text-slate-900 truncate">{client.mobile || '—'}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                            <div className="w-8 h-8 rounded-lg bg-white shadow-sm flex items-center justify-center text-slate-400">
                                <FontAwesomeIcon icon={faEnvelope} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Email</p>
                                <p className="text-sm font-medium text-slate-900 truncate" title={client.email}>{client.email || '—'}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 border border-blue-100">
                            <div className="w-8 h-8 rounded-lg bg-white shadow-sm flex items-center justify-center text-blue-500">
                                <FontAwesomeIcon icon={faCalendar} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Next Follow-Up</p>
                                <p className="text-sm font-bold text-blue-900">{formattedDate}</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="flex gap-3 p-5 border-t border-slate-100 bg-white">
                    <Button
                        variant="ghost"
                        className="flex-1 gap-2"
                        onClick={() => onMoreInfo(client)}
                    >
                        <FontAwesomeIcon icon={faExternalLinkAlt} />
                        More Info
                    </Button>
                    <Button
                        variant="primary"
                        className="flex-1 gap-2 shadow-lg shadow-blue-500/20"
                        onClick={() => onMarkDone(client)}
                    >
                        <FontAwesomeIcon icon={faCheckCircle} />
                        Mark Done
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ClientQuickViewModal;