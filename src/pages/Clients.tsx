import React, { useState } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { useClients, useDueClients } from '../hooks/useClients';
import { useToast } from '../context/ToastContext';
import type { Client, ClientType } from '../types';
import ClientCard from '../components/clients/ClientCard';
import ClientModal from '../components/clients/ClientModal';
import CallOutcomeModal, { type OutcomeResult } from '../components/clients/CallOutcomeModal';
import ImportPreviewModal from '../components/clients/ImportPreviewModal';
import ClientFilters from '../components/clients/ClientFilters';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faSortAmountDown, faSortAmountUp, faFileImport, faFileExport, faCheckCircle, faEdit, faTrash, faCheck, faChevronLeft, faChevronRight, faSpinner } from '@fortawesome/free-solid-svg-icons';

import { parseExcel, exportClientsToExcel } from '../utils/excelUtils';
import { getWhatsAppLink } from '../utils/phoneUtils';
import { formatDisplayDate } from '../utils/dateUtils';
import { logger } from '../utils/logger';

const Clients: React.FC = () => {
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 50;

    // Filter & Sort State (Must be defined before useClients)
    const [filterType, setFilterType] = useState<ClientType | 'All'>('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortField, setSortField] = useState<'clientName' | 'nextFollowUpDate'>('nextFollowUpDate');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [followUpSearchQuery, setFollowUpSearchQuery] = useState(''); // Moved up for useDueClients

    // Cards Pagination (kept separate, MUST be before useDueClients)
    const [currentCardsPage, setCurrentCardsPage] = useState(1);
    const CARDS_PER_PAGE = 24;

    // Using hook-based data access with page-based pagination
    const {
        clients,
        // clients is now the data for the current page
        loading: clientsLoading,
        totalFetched, // This is now the real total count from server
        addClient,
        updateClient,
        deleteClient,
        bulkDeleteClients,
        bulkUpdateClients,
    } = useClients(filterType, searchQuery, sortField, currentPage, ITEMS_PER_PAGE);

    // Separate hook for due clients (optimized query), now with server-side pagination & search
    const {
        data: dueClients, // Data is now already filtered/sorted/paginated by hook
        // loading: dueLoading,
        totalFetched: totalDueCount
    } = useDueClients(currentCardsPage, CARDS_PER_PAGE, followUpSearchQuery);

    const { success, error } = useToast();
    const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());


    // Modal States
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);

    const [isOutcomeModalOpen, setIsOutcomeModalOpen] = useState(false);
    const [activeClientForOutcome, setActiveClientForOutcome] = useState<Client | null>(null);

    // Import Modal State
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [importData, setImportData] = useState<Record<string, unknown>[]>([]);

    // Bulk Delete State
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [clientToDelete, setClientToDelete] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // REMOVED DUPLICATE Cards Pagination Logic (Moved to top)
    // Filter & Sort Logic
    // Dashboard Logic: Due Today & Overdue - Now uses optimized server query via useDueClients hook


    // Cards Pagination Logic (Total pages based on server total)
    const totalCardPages = Math.ceil(totalDueCount / CARDS_PER_PAGE);

    // Cards Pagination Safety Check (Auto-navigate if empty)
    React.useEffect(() => {
        if (currentCardsPage > totalCardPages && totalCardPages > 0) {
            setCurrentCardsPage(totalCardPages);
        } else if (totalCardPages === 0 && currentCardsPage !== 1) {
            setCurrentCardsPage(1);
        }
    }, [totalDueCount, totalCardPages, currentCardsPage]);

    // Resets: Reset page when filters change
    React.useEffect(() => {
        setCurrentPage(1);
    }, [filterType, searchQuery]);

    // Clear selection on page change
    React.useEffect(() => {
        setSelectedClientIds(new Set());
    }, [currentPage]);

    // ... Handlers ...
    // (We skip handlers for brevity of replacement if possible, but replace_file_content needs contiguous block)
    // I need to be careful not to delete handlers if I replace a large chunk.
    // The previous view showed handlers starting around line 143.
    // I will use START and END lines carefully.

    // Wait, the ReplacementContent must include everything between StartLine and EndLine.
    // My StartLine is 26.
    // My EndLine should coverage until... line 140 (before Handlers).
    // And I also need to update the JSX later.

    // Let's do this in chunks.
    // Chunk 1: Update useClients call and remove allClients (lines 26-140 approx).



    // Handlers
    const handleAddClient = async (client: Client) => {
        try {
            if (editingClient) {
                await updateClient(client);
                success('Client Updated', `${client.clientName} has been updated successfully.`);
            } else {
                await addClient(client);
                success('Client Added', `${client.clientName} has been added successfully.`);
            }
            setEditingClient(null);
        } catch (err) {
            logger.error('Client operation failed:', err);
            error('Operation Failed', editingClient ? 'Failed to update client. Please try again.' : 'Failed to add client. Please try again.');
        }
    };

    const openEditModal = (client: Client) => {
        setEditingClient(client);
        setIsClientModalOpen(true);
    };

    const openOutcomeModal = (client: Client) => {
        setActiveClientForOutcome(client);
        setIsOutcomeModalOpen(true);
    };

    const handleCallOutcome = async (result: OutcomeResult) => {
        if (!activeClientForOutcome) return;

        const { outcome, date, notes, clientType } = result;

        const updatedClient = { ...activeClientForOutcome };
        const now = new Date();
        updatedClient.lastContactDate = now.toISOString();

        if (notes) updatedClient.notes = notes;

        if (outcome === 'WrongNumber') {
            updatedClient.status = 'Archived';
        } else {
            if (date) updatedClient.nextFollowUpDate = new Date(date).toISOString();

            if (result.frequency) updatedClient.frequency = result.frequency;

            if (outcome === 'Sale' && clientType) {
                updatedClient.clientType = clientType;
            }
        }

        try {
            await updateClient(updatedClient);
            success('Follow-Up Logged', `Call outcome recorded for ${updatedClient.clientName}.`);
        } catch (err) {
            logger.error('Failed to log call outcome:', err);
            error('Failed to Save', 'Could not save call outcome. Please try again.');
        }
        setIsOutcomeModalOpen(false);
        setActiveClientForOutcome(null);
    };

    const toggleSort = (field: 'clientName' | 'nextFollowUpDate') => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const handleDeleteClient = (id: string) => {
        setClientToDelete(id);
        setIsDeleteModalOpen(true);
    };

    // Bulk Selection Logic
    const toggleSelectAll = () => {
        if (selectedClientIds.size === clients.length && clients.length > 0) {
            setSelectedClientIds(new Set());
        } else {
            // Select only visible clients on current page
            setSelectedClientIds(new Set(clients.map(c => c.id)));
        }
    };

    const toggleSelectClient = (id: string) => {
        const newSelected = new Set(selectedClientIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedClientIds(newSelected);
    };


    const handleBulkDelete = () => {
        setIsDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        setIsDeleting(true);
        try {
            if (clientToDelete) {
                await deleteClient(clientToDelete);
                success('Client Deleted', 'Client has been removed successfully.');
            } else {
                const count = selectedClientIds.size;
                await bulkDeleteClients(Array.from(selectedClientIds));
                setSelectedClientIds(new Set());
                success('Bulk Delete Complete', `${count} client(s) have been removed.`);
            }
            setIsDeleteModalOpen(false);
            setClientToDelete(null);
        } catch (err) {
            logger.error("Delete failed", err);
            error('Delete Failed', 'Failed to delete client(s). Please try again.');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleBulkStatusUpdate = async (status: 'Active' | 'Archived') => {
        try {
            const count = selectedClientIds.size;
            await bulkUpdateClients(Array.from(selectedClientIds), { status });
            success('Status Updated', `${count} client(s) have been ${status === 'Archived' ? 'archived' : 'set to active'}.`);
            setSelectedClientIds(new Set());
        } catch (err) {
            logger.error('Bulk status update failed:', err);
            error('Update Failed', 'Failed to update client status. Please try again.');
        }
    };

    // Excel Handlers
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleExport = async () => {
        try {
            await exportClientsToExcel(clients);
            success('Export complete', 'Your client list has been downloaded.');
        } catch (err) {
            logger.error('Export failed:', err);
            error('Export failed', 'Could not generate the Excel file. Please try again.');
        }
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const rawData = await parseExcel(file);
            setImportData(rawData);
            setIsImportModalOpen(true);
        } catch (err) {
            logger.error('Import parsing failed', err);
            error('Import Failed', 'Failed to parse file. Please check the format and try again.');
        }
        // Reset input
        e.target.value = '';
    };


    const [searchParams] = useSearchParams();
    const location = useLocation();
    const navigate = useNavigate();
    const databaseRef = React.useRef<HTMLDivElement>(null);
    const searchInputRef = React.useRef<HTMLInputElement>(null); // For auto-focus
    const [highlightedClientId, setHighlightedClientId] = useState<string | null>(null);
    const appliedSearchParamRef = React.useRef<string | null>(null); // Track URL param sync state

    // Clean up URL on page load/refresh - remove search param from URL
    // This runs once after initial mount to clean the URL while preserving the search functionality
    const hasCleanedUrlRef = React.useRef(false);
    React.useEffect(() => {
        const searchParam = searchParams.get('search');
        if (searchParam && !hasCleanedUrlRef.current) {
            hasCleanedUrlRef.current = true;
            // Use setTimeout to ensure the search is applied first, then clean URL
            setTimeout(() => {
                navigate('/clients', { replace: true });
            }, 200);
        }
    }, []); // Empty dependency - only run once on mount

    // Scroll to database section on navigation with search param
    // Uses location.search to detect fresh navigation
    const prevLocationSearch = React.useRef<string>('');
    React.useEffect(() => {
        const searchParam = searchParams.get('search');

        // Only scroll if this is a new navigation (location.search changed) and has search param
        if (searchParam && location.search !== prevLocationSearch.current) {
            prevLocationSearch.current = location.search;

            // Use requestAnimationFrame to ensure DOM is ready
            requestAnimationFrame(() => {
                setTimeout(() => {
                    databaseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    searchInputRef.current?.focus();
                }, 100);
            });
        }

        // Reset tracking when there's no search param in URL
        if (!location.search) {
            prevLocationSearch.current = '';
        }
    }, [location.search, searchParams]);

    // Sync searchQuery from URL params - only once per unique param value
    React.useEffect(() => {
        const searchParam = searchParams.get('search');

        if (searchParam && appliedSearchParamRef.current !== searchParam) {
            appliedSearchParamRef.current = searchParam;
            setSearchQuery(searchParam);
            setFilterType('All');
        }

        if (!searchParam) {
            appliedSearchParamRef.current = null;
        }
    }, [searchParams]);

    // Separate effect for client highlighting (depends on clients loading)
    React.useEffect(() => {
        const searchParam = searchParams.get('search');
        if (searchParam && clients.length > 0) {
            const match = clients.find(c => c.clientName.toLowerCase() === searchParam.toLowerCase());
            if (match && highlightedClientId !== match.id) {
                setHighlightedClientId(match.id);
                const timerId = setTimeout(() => setHighlightedClientId(null), 2000);
                return () => clearTimeout(timerId);
            }
        }
    }, [clients, searchParams, highlightedClientId]);

    const handleImportComplete = () => {
        setIsImportModalOpen(false);
        setImportData([]);
        // Force refresh? Handled by snapshot listeners usually.
    };

    return (
        <div className="max-w-[1600px] mx-auto w-full">

            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6 font-sans">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-slate-900 font-mono tracking-tight">Follow Ups</h2>
                    <p className="text-slate-500 text-sm mt-2 font-medium">Manage client relationships and sales pipeline.</p>
                </div>
                <div className="flex flex-wrap gap-3 w-full lg:w-auto">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".xlsx, .xls, .csv"
                        className="hidden"
                    />
                    <button
                        onClick={handleImportClick}
                        className="flex-1 lg:flex-none justify-center bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition shadow-sm h-11"
                    >
                        <FontAwesomeIcon icon={faFileImport} className="text-slate-400" />
                        <span>Import</span>
                    </button>
                    <button
                        onClick={handleExport}
                        className="flex-1 lg:flex-none justify-center bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition shadow-sm h-11"
                    >
                        <FontAwesomeIcon icon={faFileExport} className="text-slate-400" />
                        <span>Export</span>
                    </button>
                    <button
                        onClick={() => { setEditingClient(null); setIsClientModalOpen(true); }}
                        className="flex-1 lg:flex-none justify-center bg-primary hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-blue-500/20 flex items-center gap-2 transition whitespace-nowrap h-11 active:scale-95"
                    >
                        <FontAwesomeIcon icon={faPlus} />
                        Add Client
                    </button>
                </div>
            </div>

            {/* SECTION 1: Calls Due Today & Overdue */}
            {/* SECTION 1: Calls Due Today & Overdue */}
            <div className="mb-12 font-sans">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold text-slate-800 font-mono tracking-tight uppercase">Calls Due Today & Overdue</h3>
                        <span className="bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1 rounded-full font-mono border border-red-200">
                            {totalDueCount}
                        </span>
                    </div>
                    {/* Follow-Ups Search Bar */}
                    <div className="w-full sm:w-72 relative group">
                        <input
                            type="text"
                            placeholder="Search follow-ups..."
                            value={followUpSearchQuery}
                            onChange={(e) => setFollowUpSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm group-hover:border-slate-300 font-sans"
                        />
                        {/* Search Icon (Simulated via class since I can't easily add FontAwesomeIcon inside input without wrapper, keeping it simple as before but wrapper layout is possible) */}
                        {/* Actually I'll wrap it properly or leave it. The original code didn't have icon inside? It just had input. I'll stick to input but cleaner. */}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {dueClients.length > 0 ? (
                        dueClients.map(client => (
                            <ClientCard
                                key={client.id}
                                client={client}
                                onEdit={openEditModal}
                                onDelete={handleDeleteClient}
                                onMarkDone={openOutcomeModal}
                            />
                        ))
                    ) : (
                        <div className="col-span-full py-16 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
                            {totalDueCount > 0 ? (
                                <>
                                    <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-4">
                                        <FontAwesomeIcon icon={faCheckCircle} className="text-3xl text-slate-300" />
                                    </div>
                                    <p className="font-medium text-slate-600">No clients found matching "{followUpSearchQuery}"</p>
                                    <button onClick={() => setFollowUpSearchQuery('')} className="text-primary font-bold text-sm mt-2 hover:underline">Clear Search</button>
                                </>
                            ) : (
                                <>
                                    <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4 border border-emerald-100">
                                        <FontAwesomeIcon icon={faCheckCircle} className="text-3xl text-emerald-400" />
                                    </div>
                                    <p className="font-bold text-slate-800 text-lg">All caught up!</p>
                                    <p className="text-slate-500 mt-1">No pending calls due today.</p>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Cards Pagination Footer */}
                {totalDueCount > CARDS_PER_PAGE && (
                    <div className="mt-8 flex flex-col sm:flex-row justify-between items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                        <div className="text-xs text-slate-500 font-medium font-mono uppercase tracking-wide">
                            Showing <span className="text-slate-800 font-bold">{(currentCardsPage - 1) * CARDS_PER_PAGE + 1}</span> - <span className="text-slate-800 font-bold">{Math.min(currentCardsPage * CARDS_PER_PAGE, totalDueCount)}</span> of <span className="text-slate-800 font-bold">{totalDueCount}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentCardsPage(prev => Math.max(1, prev - 1))}
                                disabled={currentCardsPage === 1}
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-white hover:text-primary hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center gap-1"
                            >
                                <FontAwesomeIcon icon={faChevronLeft} className="text-xs" /> Previous
                            </button>
                            <span className="text-xs font-bold font-mono px-3 text-slate-600">
                                {currentCardsPage} / {totalCardPages}
                            </span>
                            <button
                                onClick={() => setCurrentCardsPage(prev => Math.min(totalCardPages, prev + 1))}
                                disabled={currentCardsPage === totalCardPages}
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-white hover:text-primary hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center gap-1"
                            >
                                Next <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* SECTION 2: All Clients Database */}
            <div ref={databaseRef} className="scroll-mt-24 font-sans">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg md:text-xl font-bold text-slate-900 font-mono tracking-tight uppercase border-l-4 border-primary pl-3">All Clients Database ({totalFetched})</h3>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex flex-wrap gap-4 justify-between items-center bg-slate-50/30">
                        {selectedClientIds.size > 0 ? (
                            <div className="flex items-center gap-4 w-full animate-fade-in text-slate-700">
                                <span className="font-bold text-primary bg-blue-100 px-3 py-1 rounded-lg text-sm font-mono">
                                    {selectedClientIds.size} SELECTED
                                </span>
                                <div className="h-6 w-px bg-slate-300 mx-2"></div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleBulkStatusUpdate('Active')}
                                        className="bg-white border border-slate-200 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 text-slate-600 px-4 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 shadow-sm"
                                    >
                                        <FontAwesomeIcon icon={faCheck} /> Set Active
                                    </button>
                                    <button
                                        onClick={() => handleBulkStatusUpdate('Archived')}
                                        className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-sm font-semibold transition shadow-sm"
                                    >
                                        Archive
                                    </button>
                                    <button
                                        onClick={handleBulkDelete}
                                        disabled={isDeleting}
                                        className={`bg-white border border-red-200 hover:bg-red-50 hover:text-red-600 text-slate-600 px-4 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 shadow-sm ${isDeleting ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <FontAwesomeIcon icon={faTrash} /> Delete
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <ClientFilters
                                filterType={filterType}
                                setFilterType={setFilterType}
                                searchQuery={searchQuery}
                                setSearchQuery={setSearchQuery}
                                searchInputRef={searchInputRef}
                            />
                        )}
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-[11px] uppercase font-bold tracking-wider font-mono">
                                    <th className="p-5 w-4">
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/20 cursor-pointer"
                                            checked={clients.length > 0 && selectedClientIds.size === clients.length}
                                            onChange={toggleSelectAll}
                                            disabled={isDeleting}
                                        />
                                    </th>
                                    <th className="p-5 cursor-pointer hover:text-primary transition-colors" onClick={() => toggleSort('clientName')}>
                                        Client <FontAwesomeIcon icon={sortField === 'clientName' && sortDirection === 'desc' ? faSortAmountUp : faSortAmountDown} className={`ml-1 ${sortField === 'clientName' ? 'opacity-100' : 'opacity-30'}`} />
                                    </th>
                                    <th className="p-5 hidden md:table-cell">Contact</th>
                                    <th className="p-5 hidden sm:table-cell">Type</th>
                                    <th className="p-5 hidden lg:table-cell">Status</th>
                                    <th className="p-5 cursor-pointer hover:text-primary transition-colors" onClick={() => toggleSort('nextFollowUpDate')}>
                                        Next Call <FontAwesomeIcon icon={sortField === 'nextFollowUpDate' && sortDirection === 'desc' ? faSortAmountUp : faSortAmountDown} className={`ml-1 ${sortField === 'nextFollowUpDate' ? 'opacity-100' : 'opacity-30'}`} />
                                    </th>
                                    <th className="p-5 hidden xl:table-cell">Notes</th>
                                    <th className="p-5 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm">
                                {clients.map(client => (
                                    <tr key={client.id} className={`hover:bg-slate-50 transition-colors duration-200 group ${selectedClientIds.has(client.id) ? 'bg-blue-50/40' : ''} ${highlightedClientId === client.id ? 'bg-blue-100 ring-2 ring-blue-500/20' : ''}`}>
                                        <td className="p-5">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/20 cursor-pointer"
                                                checked={selectedClientIds.has(client.id)}
                                                onChange={() => toggleSelectClient(client.id)}
                                                disabled={isDeleting}
                                            />
                                        </td>
                                        <td className="p-5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs overflow-hidden border border-slate-200 flex-shrink-0 shadow-sm">
                                                    {client.profileImage ? (
                                                        <img src={client.profileImage} alt={client.clientName} className="w-full h-full object-cover" />
                                                    ) : (
                                                        client.clientName.charAt(0)
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-800 text-base">{client.clientName}</div>
                                                    <div className="md:hidden text-xs text-slate-500 mt-0.5 font-medium">
                                                        {client.mobile}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-5 hidden md:table-cell">
                                            <div className="text-slate-700 font-medium">
                                                {getWhatsAppLink(client.mobile) ? (
                                                    <a
                                                        href={getWhatsAppLink(client.mobile)!}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="hover:text-emerald-600 hover:underline flex items-center gap-1.5"
                                                    >
                                                        {client.mobile}
                                                    </a>
                                                ) : (
                                                    client.mobile
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-400 mt-0.5">{client.email}</div>
                                        </td>
                                        <td className="p-5 hidden sm:table-cell">
                                            <span className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${client.clientType === 'Prospect' ? 'bg-purple-50 text-purple-700 border-purple-100' :
                                                client.clientType === 'User' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                                    client.clientType === 'Supervisor' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-blue-50 text-blue-700 border-blue-100'
                                                }`}>
                                                {client.clientType}
                                            </span>
                                        </td>
                                        <td className="p-5 hidden lg:table-cell">
                                            <span className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${client.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'
                                                }`}>
                                                {client.status}
                                            </span>
                                        </td>
                                        <td className="p-5">
                                            <div className="font-semibold text-slate-700">
                                                {formatDisplayDate(client.nextFollowUpDate)}
                                            </div>
                                            <div className="text-xs text-slate-400 mt-0.5">{client.frequency}</div>
                                        </td>
                                        <td className="p-5 max-w-xs truncate text-slate-500 hidden xl:table-cell italic" title={client.notes}>
                                            {client.notes}
                                        </td>
                                        <td className="p-5 text-right">
                                            <button onClick={() => openEditModal(client)} className="text-slate-400 hover:text-primary p-2 transition-colors rounded-lg hover:bg-blue-50">
                                                <FontAwesomeIcon icon={faEdit} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {clients.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="p-12 text-center text-slate-400 italic bg-slate-50/50">
                                            {clientsLoading ? (
                                                <div className="flex items-center justify-center gap-3">
                                                    <FontAwesomeIcon icon={faSpinner} spin className="text-primary" />
                                                    <span>Loading clients...</span>
                                                </div>
                                            ) : 'No clients found matching your filters.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Footer */}
                    <div className="p-6 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-50/30">
                        <div className="text-xs text-slate-500 font-medium font-mono uppercase tracking-wide">
                            Showing <span className="text-slate-800 font-bold">{totalFetched > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}</span> - <span className="text-slate-800 font-bold">{Math.min(currentPage * ITEMS_PER_PAGE, totalFetched)}</span> of <span className="text-slate-800 font-bold">{totalFetched}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-white hover:text-primary hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center gap-1"
                            >
                                <FontAwesomeIcon icon={faChevronLeft} className="text-xs" /> Previous
                            </button>
                            <span className="text-xs font-bold font-mono px-3 text-slate-600">
                                {currentPage} / {Math.max(1, Math.ceil(totalFetched / ITEMS_PER_PAGE))}
                            </span>
                            <button
                                onClick={() => setCurrentPage(prev => prev + 1)}
                                disabled={currentPage >= Math.ceil(totalFetched / ITEMS_PER_PAGE)}
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-white hover:text-primary hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center gap-1"
                            >
                                Next <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <ClientModal
                isOpen={isClientModalOpen}
                onClose={() => setIsClientModalOpen(false)}
                onSave={handleAddClient}
                initialClient={editingClient}
                existingClients={clients}
            />

            <CallOutcomeModal
                isOpen={isOutcomeModalOpen}
                onClose={() => setIsOutcomeModalOpen(false)}
                onConfirm={handleCallOutcome}
                clientName={activeClientForOutcome?.clientName || ''}
                currentClientType={activeClientForOutcome?.clientType}
                initialFrequency={activeClientForOutcome?.frequency}
            />

            <ConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => {
                    if (!isDeleting) {
                        setIsDeleteModalOpen(false);
                        setClientToDelete(null);
                    }
                }}
                onConfirm={confirmDelete}
                title={clientToDelete ? "Delete Client?" : "Delete Clients?"}
                message={clientToDelete
                    ? "Are you sure you want to delete this client? This action cannot be undone."
                    : `Are you sure you want to delete ${selectedClientIds.size} clients? This action cannot be undone.`
                }
                confirmText={isDeleting ? 'Deleting...' : 'Delete'}
                isDestructive={true}
                isLoading={isDeleting}
            />

            <ImportPreviewModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                fileData={importData}
                existingClients={clients}
                onImportComplete={handleImportComplete}
            />
        </div>
    );
};

export default Clients;
