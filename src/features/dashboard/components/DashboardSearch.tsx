import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faUser } from '@fortawesome/free-solid-svg-icons';
import type { Client } from '../../../shared/types';
import { useClientQuickSearch } from '../../clients/hooks/useClientQuickSearch';
import ClientQuickViewModal from './ClientQuickViewModal';
import CallOutcomeModal, { type OutcomeResult } from '../../clients/components/CallOutcomeModal';
import { fromInputDate } from '../../../shared/utils/dateUtils';

const DashboardSearch: React.FC = () => {
    const { results: searchResults, search, updateClient, clearResults } = useClientQuickSearch();
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [showResults, setShowResults] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    const [quickViewClient, setQuickViewClient] = useState<Client | null>(null);
    const [outcomeClient, setOutcomeClient] = useState<Client | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setShowResults(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!searchTerm.trim()) {
            clearResults();
            return;
        }
        const timeoutId = setTimeout(() => search(searchTerm), 300);
        return () => clearTimeout(timeoutId);
    }, [searchTerm, search, clearResults]);

    const filteredClients = searchResults;

    const handleSelectClient = (client: Client) => {
        setQuickViewClient(client);
        setSearchTerm('');
        setShowResults(false);
    };

    const handleMoreInfo = (client: Client) => {
        setQuickViewClient(null);
        navigate(`/clients?search=${encodeURIComponent(client.clientName)}`);
    };

    const handleMarkDone = (client: Client) => {
        setQuickViewClient(null);
        setTimeout(() => setOutcomeClient(client), 50);
    };

    const handleCallOutcome = (result: OutcomeResult) => {
        if (!outcomeClient) return;
        const updatedClient: Client = {
            ...outcomeClient,
            lastContactDate: new Date().toISOString(),
        };
        if (result.outcome === 'WrongNumber') {
            updatedClient.status = 'Archived';
            updatedClient.nextFollowUpDate = '';
            updatedClient.notes = result.notes
                ? `${outcomeClient.notes}\n[Wrong Number]: ${result.notes}`
                : outcomeClient.notes;
        } else {
            if (result.date) updatedClient.nextFollowUpDate = fromInputDate(result.date);
            if (result.frequency) updatedClient.frequency = result.frequency;
            if (result.clientType) updatedClient.clientType = result.clientType;
            if (result.notes) {
                updatedClient.notes = outcomeClient.notes
                    ? `${outcomeClient.notes}\n[${result.outcome}]: ${result.notes}`
                    : result.notes;
            }
        }
        updateClient(updatedClient);
        setOutcomeClient(null);
    };

    return (
        <div className="relative w-full max-w-md" ref={searchRef}>
            <label htmlFor="dashboard-search" className="sr-only">
                Quick search clients
            </label>
            <div className="relative">
                <span
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                    aria-hidden
                >
                    <FontAwesomeIcon icon={faSearch} className="text-sm" />
                </span>
                <input
                    id="dashboard-search"
                    type="search"
                    autoComplete="off"
                    className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200/80 bg-white text-slate-900 placeholder:text-slate-400 text-sm shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition"
                    placeholder="Search clients…"
                    value={searchTerm}
                    onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setShowResults(true);
                    }}
                    onFocus={() => setShowResults(true)}
                />
            </div>

            {showResults && searchTerm && (
                <div
                    className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200/80 shadow-lg py-2 z-50 max-h-[min(70vh,320px)] overflow-y-auto"
                    role="listbox"
                    aria-label="Search results"
                >
                    {filteredClients.length > 0 ? (
                        filteredClients.map((client) => (
                            <button
                                key={client.id}
                                type="button"
                                role="option"
                                className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3 transition-colors min-h-[44px] rounded-lg mx-2"
                                onClick={() => handleSelectClient(client)}
                            >
                                <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0">
                                    <FontAwesomeIcon icon={faUser} className="text-sm" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-slate-900 truncate">
                                        {client.clientName}
                                    </p>
                                    <p className="text-xs text-slate-500 truncate">
                                        {client.clientType}
                                    </p>
                                </div>
                            </button>
                        ))
                    ) : (
                        <div className="px-4 py-3 text-sm text-slate-500">
                            No clients found.
                        </div>
                    )}
                </div>
            )}

            <ClientQuickViewModal
                isOpen={!!quickViewClient}
                client={quickViewClient}
                onClose={() => setQuickViewClient(null)}
                onMarkDone={handleMarkDone}
                onMoreInfo={handleMoreInfo}
            />
            <CallOutcomeModal
                isOpen={!!outcomeClient}
                onClose={() => setOutcomeClient(null)}
                onConfirm={handleCallOutcome}
                clientName={outcomeClient?.clientName || ''}
                currentClientType={outcomeClient?.clientType}
                initialFrequency={outcomeClient?.frequency}
            />
        </div>
    );
};

export default DashboardSearch;