import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faPhone,
    faEnvelope,
    faCalendar,
    faEdit,
    faTrash,
    faCheckCircle
} from '@fortawesome/free-solid-svg-icons';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import type { Client } from '../../../shared/types';
import { formatDisplayDate } from '../../../shared/utils/dateUtils';
import { getWhatsAppLink } from '../../../shared/utils/phoneUtils';

interface ClientCardProps {
    client: Client;
    onEdit: (client: Client) => void;
    onDelete: (id: string) => void;
    onMarkDone: (client: Client) => void;
}

const ClientCard: React.FC<ClientCardProps> = ({ client, onEdit, onDelete, onMarkDone }) => {
    const isOverdue = new Date(client.nextFollowUpDate) < new Date();
    const whatsappLink = getWhatsAppLink(client.mobile);

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-primary/20 transition-all duration-300 flex flex-col h-full group relative overflow-hidden ring-0 ring-primary/0 hover:ring-1 hover:ring-primary/10">
            {/* Top Right Actions - Edit */}
            {/*
                Touch-aware visibility:
                - On touch devices (no hover capability): button is always visible with subtle styling
                - On desktop (hover capable devices): button appears on hover/focus
                Using CSS @media (hover: hover) and (pointer: fine) for detection
            */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onEdit(client);
                }}
                className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-white/80 backdrop-blur-sm border border-slate-200 rounded-lg text-slate-400 hover:text-primary hover:border-primary/30 hover:bg-blue-50 transition-all shadow-sm focus:opacity-100 edit-button-touch-aware"
                title="Edit Client"
            >
                <FontAwesomeIcon icon={faEdit} className="text-xs" />
            </button>

            <div className="p-5 flex-1 flex flex-col gap-4">
                {/* Header: Name & Type */}
                <div className="flex justify-between items-start gap-3 pr-8">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 font-bold text-lg overflow-hidden border border-slate-100 flex-shrink-0 shadow-sm group-hover:scale-105 transition-transform duration-300">
                            {client.profileImage ? (
                                <img src={client.profileImage} alt={client.clientName} className="w-full h-full object-cover" />
                            ) : (
                                client.clientName.charAt(0)
                            )}
                        </div>
                        <div className="min-w-0">
                            <h4 className="font-bold text-slate-900 text-lg leading-tight truncate font-heading group-hover:text-primary transition-colors tracking-tight" title={client.clientName}>
                                {client.clientName}
                            </h4>
                            <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full font-bold inline-block mt-1 border ${client.clientType === 'Prospect' ? 'bg-purple-50 text-purple-700 border-purple-100' :
                                client.clientType === 'User' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                    client.clientType === 'Supervisor' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-blue-50 text-blue-700 border-blue-100'
                                }`}>
                                {client.clientType}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Contact Info */}
                <div className="space-y-2 py-3 border-t border-b border-slate-50 font-sans">
                    <div className="flex items-center gap-2.5 text-sm text-slate-600">
                        {whatsappLink ? (
                            <a
                                href={whatsappLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2.5 hover:text-emerald-600 transition-colors w-full min-w-0 group/link"
                            >
                                <div className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-500 flex items-center justify-center flex-shrink-0 group-hover/link:bg-emerald-100 transition-colors">
                                    <FontAwesomeIcon icon={faWhatsapp} className="w-3" />
                                </div>
                                <span className="truncate font-medium">{client.mobile}</span>
                            </a>
                        ) : (
                            <div className="flex items-center gap-2.5 w-full min-w-0">
                                <div className="w-5 h-5 rounded-md bg-slate-50 text-slate-400 flex items-center justify-center flex-shrink-0">
                                    <FontAwesomeIcon icon={faPhone} className="w-2.5" />
                                </div>
                                <span className="truncate font-medium">{client.mobile}</span>
                            </div>
                        )}
                    </div>
                    {client.email && (
                        <div className="flex items-center gap-2.5 text-sm text-slate-600 min-w-0">
                            <div className="w-5 h-5 rounded-md bg-slate-50 text-slate-400 flex items-center justify-center flex-shrink-0">
                                <FontAwesomeIcon icon={faEnvelope} className="w-2.5" />
                            </div>
                            <span className="truncate">{client.email}</span>
                        </div>
                    )}
                </div>

                {/* Next Call */}
                <div>
                    <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                        <FontAwesomeIcon icon={faCalendar} className="text-slate-300" />
                        Next Call
                    </div>
                    <div className={`text-base font-bold font-sans flex items-center justify-between ${isOverdue ? 'text-red-600' : 'text-slate-800'}`}>
                        <span>{formatDisplayDate(client.nextFollowUpDate)}</span>
                        {client.frequency && (
                            <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                                {client.frequency}
                            </span>
                        )}
                    </div>
                </div>

                {/* Notes Preview */}
                {client.notes && (
                    <div className="bg-amber-50/40 p-3 rounded-xl border border-amber-100/50 relative">
                        <div className="absolute top-3 left-0 w-1 h-4 bg-amber-300/50 rounded-r-full"></div>
                        <p className="text-xs text-slate-600 italic line-clamp-2 leading-relaxed font-sans pl-1">
                            "{client.notes}"
                        </p>
                    </div>
                )}
            </div>

            {/* Actions Bottom Row */}
            <div className="p-4 pt-0 flex items-center gap-3 mt-auto">
                <button
                    onClick={() => onMarkDone(client)}
                    className="flex-1 bg-primary hover:bg-blue-700 text-white py-2.5 rounded-xl text-sm font-bold shadow-sm shadow-blue-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 font-sans group/btn border border-transparent"
                    title="Mark call done / Log outcome"
                >
                    <FontAwesomeIcon icon={faCheckCircle} className="group-hover/btn:scale-110 transition-transform" />
                    <span>Mark Done</span>
                </button>
                <button
                    onClick={() => onDelete(client.id)}
                    className="w-12 h-[42px] flex items-center justify-center bg-white border border-slate-200 hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-slate-400 rounded-xl transition-all shadow-sm active:scale-95"
                    title="Delete Client"
                >
                    <FontAwesomeIcon icon={faTrash} />
                </button>
            </div>
        </div>
    );
};

export default ClientCard;