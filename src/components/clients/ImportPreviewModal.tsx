import React, { useState, useEffect, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faCheckCircle,
    faExclamationTriangle,
    faTimes,
    faSearch,
    faCloudUploadAlt,
    faDownload,
    faExclamationCircle,
    faBan
} from '@fortawesome/free-solid-svg-icons';
import type { Client } from '../../types';
import { validateClientRow, type ValidationResult, exportToExcel } from '../../utils/excelUtils';
import { useClients } from '../../hooks/useClients';
import { useToast } from '../../context/ToastContext';
import { toInputDate, fromInputDate } from '../../utils/dateUtils';
import { logger } from '../../utils/logger';
import BulkUpdatePopover from './BulkUpdatePopover';

interface ImportPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    fileData: Record<string, unknown>[]; // Raw data from Excel
    existingClients: Client[];
    onImportComplete: () => void;
}

type RowAction = 'Import' | 'Skip' | 'Update';

interface ProcessedRow extends ValidationResult {
    originalIndex: number; // To track index even after filter
    action: RowAction;
    changedFields?: string[];
}

const ImportPreviewModal: React.FC<ImportPreviewModalProps> = ({ isOpen, onClose, fileData, existingClients, onImportComplete }) => {
    // Migration: Using hook-based data access instead of DataContext
    const { bulkAddClients } = useClients();
    const { error: showError } = useToast();
    const [rows, setRows] = useState<ProcessedRow[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState('');
    const [showSummary, setShowSummary] = useState(false);
    const [summaryStats, setSummaryStats] = useState({ total: 0, added: 0, updated: 0, skipped: 0, failed: 0 });

    // Filters
    const [activeFilter, setActiveFilter] = useState<'Valid' | 'Invalid' | 'Duplicate' | null>(null);

    const toggleFilter = (filter: 'Valid' | 'Invalid' | 'Duplicate') => {
        setActiveFilter(prev => prev === filter ? null : filter);
    };

    // Bulk Update State
    const [bulkUpdatePrompt, setBulkUpdatePrompt] = useState<{ index: number, field: keyof Client, value: string, anchorEl: HTMLElement | null } | null>(null);

    const handleBulkApply = (applyToAll: boolean) => {
        if (!bulkUpdatePrompt) return;

        if (applyToAll) {
            setRows(prev => {
                return prev.map((row) => {
                    // Update field
                    const updatedClient = { ...row.client, [bulkUpdatePrompt.field]: bulkUpdatePrompt.value };

                    // Re-validate
                    const validation = validateClientRow(updatedClient, existingClients);

                    // Determine new action
                    let action = row.action;
                    if (validation.isValid && action === 'Skip' && !validation.isDuplicate) {
                        action = 'Import';
                    }

                    return {
                        ...row,
                        client: updatedClient,
                        isValid: validation.isValid,
                        errors: validation.errors,
                        isDuplicate: validation.isDuplicate,
                        duplicateOfId: validation.duplicateOfId,
                        action
                    };
                });
            });
        }
        setBulkUpdatePrompt(null);
    };
    useEffect(() => {
        if (isOpen && fileData.length > 0) {
            const processed = fileData.map((row, index) => {
                const result = validateClientRow(row, existingClients);
                let action: RowAction = 'Import';
                let changedFieldsForRow: string[] = [];

                if (!result.isValid) {
                    action = 'Skip';
                } else if (result.isDuplicate && result.duplicateOfId) {
                    // Smart Duplicate Handling
                    const existing = existingClients.find(c => c.id === result.duplicateOfId);

                    if (existing) {
                        // 1. Preserve Existing Date (Critical Rule)
                        result.client.nextFollowUpDate = existing.nextFollowUpDate;

                        // 1.5 Preserve Existing Notes if incoming is empty (Safeguard)
                        if (!result.client.notes || !result.client.notes.trim()) {
                            result.client.notes = existing.notes;
                        }

                        // 2. Compare Fields to detect changes
                        const changes: string[] = [];
                        if (result.client.clientName !== existing.clientName) changes.push('Client Name');
                        if (result.client.email !== existing.email) changes.push('Email');
                        if (result.client.clientType !== existing.clientType) changes.push('Type');
                        if (result.client.status !== existing.status) changes.push('Status');
                        if (result.client.frequency !== existing.frequency) changes.push('Frequency');
                        if ((result.client.notes || '').trim() !== (existing.notes || '').trim()) changes.push('Notes');

                        // 3. Auto-Set Action
                        if (changes.length > 0) {
                            action = 'Update';
                            // Add changed fields to result - handled by spreading below but we need to inject it
                        } else {
                            action = 'Skip'; // No relevant changes
                        }

                        // Store changes for later use in return
                        changedFieldsForRow = changes;
                    } else {
                        action = 'Skip'; // Fallback
                    }
                }

                return {
                    ...result,
                    originalIndex: index,
                    action,
                    changedFields: changedFieldsForRow
                };
            });
            setRows(processed);
            setShowSummary(false);
            setImportProgress('');
        }
    }, [isOpen, fileData, existingClients]);


    // Validation Stats
    const stats = useMemo(() => {
        const total = rows.length;
        const valid = rows.filter(r => r.isValid && !r.isDuplicate).length;
        const invalid = rows.filter(r => !r.isValid).length;
        const duplicates = rows.filter(r => r.isDuplicate).length;
        const toImport = rows.filter(r => r.action === 'Import').length;
        const toUpdate = rows.filter(r => r.action === 'Update').length;
        const toSkip = rows.filter(r => r.action === 'Skip').length;
        return { total, valid, invalid, duplicates, toImport, toUpdate, toSkip };
    }, [rows]);

    const filteredRows = useMemo(() => {
        let result = rows;

        // 1. Apply Status Filter
        if (activeFilter === 'Valid') {
            result = result.filter(r => r.isValid && !r.isDuplicate);
        } else if (activeFilter === 'Invalid') {
            result = result.filter(r => !r.isValid);
        } else if (activeFilter === 'Duplicate') {
            result = result.filter(r => r.isDuplicate);
        }

        // 2. Apply Search
        if (searchQuery) {
            const lower = searchQuery.toLowerCase();
            result = result.filter(r =>
                r.client.clientName.toLowerCase().includes(lower) ||
                r.client.mobile.includes(lower) ||
                r.client.email.toLowerCase().includes(lower)
            );
        }

        return result;
    }, [rows, searchQuery, activeFilter]);


    // Handlers
    const handleActionChange = (index: number, action: RowAction) => {
        setRows(prev => {
            const next = [...prev];
            next[index].action = action;
            return next;
        });
    };

    const handleUpdateCell = (index: number, field: keyof Client, value: string, target?: HTMLElement) => {
        setRows(prev => {
            const next = [...prev];
            const currentRow = next[index];

            // 1. Update the client object locally
            const finalValue = field === 'nextFollowUpDate' ? fromInputDate(value) : value;
            const updatedClient = { ...currentRow.client, [field]: finalValue };

            // 2. Re-validate
            // We need to construct a "row" like object for validation, or update validate to take client
            // Since validateClientRow takes "row" (any) mostly, we can pass updatedClient as row
            // Note: Validation might rely on 'Client Name' vs 'clientName'. 
            // Our validator checks both. So passing updatedClient works.
            const validation = validateClientRow(updatedClient, existingClients);

            // 3. Merge Back
            next[index] = {
                ...currentRow,
                client: updatedClient,
                isValid: validation.isValid,
                errors: validation.errors,
                isDuplicate: validation.isDuplicate,
                duplicateOfId: validation.duplicateOfId
            };

            // 4. Auto-update action if valid
            if (next[index].isValid && next[index].action === 'Skip' && !next[index].isDuplicate) {
                next[index].action = 'Import';
            }

            return next;
        });

        // Trigger Bulk Prompt for Type/Frequency
        if ((field === 'clientType' || field === 'frequency') && target) {
            setBulkUpdatePrompt({ index, field, value, anchorEl: target });
        }
    };



    const handleDownloadErrors = async () => {
        const errorRows = rows.filter(r => !r.isValid).map(r => ({
            ...r.client,
            Errors: r.errors.join(', ')
        }));
        try {
            await exportToExcel(errorRows, 'Import_Errors');
        } catch (err) {
            logger.error('Error report download failed:', err);
            showError('Download failed', 'Could not generate the error report. Please try again.');
        }
    };

    const handleConfirmImport = async () => {
        setIsImporting(true);
        setImportProgress('Preparing...');

        const rowsToProcess = rows.filter(r => r.action === 'Import' || r.action === 'Update');

        // Chunking handled by DataContext, but we can update UI state
        // DataContext's bulkAdd handles both Set (new) and Set (merge/update) if ID exists.

        try {
            const clientsToSave = rowsToProcess.map(r => r.client);

            // To provide granular progress, we might need to batch here or trust DataContext.
            // DataContext uses 500 batches. 
            // Let's just call it and await.
            setImportProgress(`Importing ${clientsToSave.length} clients...`);

            await bulkAddClients(clientsToSave);

            setSummaryStats({
                total: clientsToSave.length,
                added: rows.filter(r => r.action === 'Import').length,
                updated: rows.filter(r => r.action === 'Update').length,
                skipped: stats.toSkip,
                failed: 0 // Assuming basic success if no throw
            });
            setShowSummary(true);
            onImportComplete(); // Maybe trigger refresh parent
        } catch (err) {
            logger.error('Import failed', err);
            showError('Import Failed', 'An error occurred during import. Please try again.');
        } finally {
            setIsImporting(false);
        }
    };

    if (!isOpen) return null;

    if (showSummary) {
        return (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-8 text-center animate-fade-in">
                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-6">
                        <FontAwesomeIcon icon={faCheckCircle} />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">Import Successful!</h2>
                    <p className="text-slate-500 mb-6">Your client database has been updated.</p>

                    <div className="space-y-3 mb-8">
                        <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                            <span className="text-slate-600">Total Processed</span>
                            <span className="font-bold text-slate-800">{stats.total}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg text-green-700">
                            <span className="font-medium">Added</span>
                            <span className="font-bold">+{summaryStats.added}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg text-blue-700">
                            <span className="font-medium">Updated</span>
                            <span className="font-bold">{summaryStats.updated}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-slate-100 rounded-lg text-slate-500">
                            <span className="font-medium">Skipped</span>
                            <span className="font-bold">{summaryStats.skipped}</span>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 px-4 rounded-xl transition"
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 font-sans">
            <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full h-[90vh] flex flex-col overflow-hidden animate-scale-in border border-slate-100">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-3 font-heading tracking-tight">
                            <div className="bg-blue-100 text-primary w-10 h-10 rounded-xl flex items-center justify-center shadow-sm">
                                <FontAwesomeIcon icon={faCloudUploadAlt} className="text-lg" />
                            </div>
                            Import Preview
                        </h2>
                        <p className="text-sm text-slate-500 mt-1 ml-13">Review and validate your data before importing.</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-lg hover:bg-slate-100">
                        <FontAwesomeIcon icon={faTimes} className="text-xl" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="p-4 border-b border-slate-100 flex flex-wrap gap-4 justify-between items-center bg-white sticky top-0 z-10">
                    <div className="relative w-full md:w-72">
                        <FontAwesomeIcon icon={faSearch} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                        <input
                            type="text"
                            placeholder="Search preview..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all text-sm font-medium text-slate-700 bg-slate-50/50 focus:bg-white"
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 mr-4 border-r border-slate-200 pr-4">
                            <button
                                onClick={() => toggleFilter('Valid')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${activeFilter === 'Valid' ? 'bg-green-100 text-green-700 ring-2 ring-green-500/20' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                            >
                                <FontAwesomeIcon icon={faCheckCircle} className={activeFilter === 'Valid' ? 'text-green-600' : 'text-green-400'} />
                                {stats.valid} Valid
                            </button>
                            <button
                                onClick={() => toggleFilter('Invalid')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${activeFilter === 'Invalid' ? 'bg-red-100 text-red-700 ring-2 ring-red-500/20' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                            >
                                <FontAwesomeIcon icon={faExclamationTriangle} className={activeFilter === 'Invalid' ? 'text-red-600' : 'text-red-400'} />
                                {stats.invalid} Invalid
                            </button>
                            <button
                                onClick={() => toggleFilter('Duplicate')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${activeFilter === 'Duplicate' ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-500/20' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                            >
                                <FontAwesomeIcon icon={faExclamationCircle} className={activeFilter === 'Duplicate' ? 'text-amber-600' : 'text-amber-400'} />
                                {stats.duplicates} Duplicates
                            </button>
                        </div>


                        <button onClick={handleDownloadErrors} disabled={stats.invalid === 0} className={`text-slate-600 hover:bg-slate-50 px-3 py-2 rounded-lg text-sm font-bold transition flex items-center gap-2 border border-transparent hover:border-slate-200 ${stats.invalid === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <FontAwesomeIcon icon={faDownload} /> Download Errors
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto bg-slate-50 p-4 custom-scrollbar">
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-w-[1000px]">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 text-[11px] uppercase font-bold tracking-wider font-mono sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="p-4 w-12 text-center">#</th>
                                    <th className="p-4 w-32">Action</th>
                                    <th className="p-4 w-48">Client Name <span className="text-red-500">*</span></th>
                                    <th className="p-4 w-40">Mobile <span className="text-red-500">*</span></th>
                                    <th className="p-4 w-48">Email</th>
                                    <th className="p-4 w-32">Type</th>
                                    <th className="p-4 w-32">Frequency</th>
                                    <th className="p-4 w-40">Next Call</th>
                                    <th className="p-4">Notes</th>
                                    <th className="p-4 w-48">Validation</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredRows.map((row) => {
                                    // Use original index to find real state index
                                    const index = row.originalIndex;
                                    const isError = !row.isValid;
                                    const isDup = row.isDuplicate;

                                    return (
                                        <tr key={index} className={`hover:bg-slate-50 transition-colors duration-150 ${isError ? 'bg-red-50/30' : isDup ? 'bg-amber-50/30' : ''}`}>
                                            <td className="p-4 text-slate-400 text-xs font-mono text-center">{index + 1}</td>
                                            <td className="p-4">
                                                <select
                                                    value={row.action}
                                                    onChange={(e) => handleActionChange(index, e.target.value as RowAction)}
                                                    className={`w-full text-[11px] font-bold uppercase tracking-wider rounded-lg px-2 py-1.5 border focus:outline-none focus:ring-2 bg-white transition-all cursor-pointer ${row.action === 'Import' ? 'text-green-700 border-green-200 focus:border-green-500 focus:ring-green-500/20' :
                                                        row.action === 'Update' ? 'text-blue-700 border-blue-200 focus:border-blue-500 focus:ring-blue-500/20' :
                                                            'text-slate-500 border-slate-200 focus:border-slate-400 focus:ring-slate-400/20'
                                                        }`}
                                                    disabled={isError}
                                                >
                                                    <option value="Skip">Skip</option>
                                                    {!isDup && <option value="Import" disabled={isError}>Import</option>}
                                                    {isDup && <option value="Update">Update</option>}
                                                </select>
                                            </td>
                                            <td className="p-4">
                                                <input
                                                    type="text"
                                                    value={row.client.clientName}
                                                    onChange={e => handleUpdateCell(index, 'clientName', e.target.value)}
                                                    className={`w-full bg-transparent border-b border-transparent focus:border-primary p-0 pb-1 focus:ring-0 text-sm font-medium transition-colors ${!row.client.clientName ? 'placeholder-red-400' : 'text-slate-800'}`}
                                                    placeholder="Required"
                                                />
                                            </td>
                                            <td className="p-4">
                                                <input
                                                    type="text"
                                                    value={row.client.mobile}
                                                    onChange={e => handleUpdateCell(index, 'mobile', e.target.value)}
                                                    className={`w-full bg-transparent border-b border-transparent focus:border-primary p-0 pb-1 focus:ring-0 text-sm font-mono text-slate-600 transition-colors ${!row.client.mobile ? 'placeholder-red-400' : ''}`}
                                                    placeholder="Required"
                                                />
                                            </td>
                                            <td className="p-4">
                                                <input
                                                    type="text"
                                                    value={row.client.email}
                                                    onChange={e => handleUpdateCell(index, 'email', e.target.value)}
                                                    className="w-full bg-transparent border-b border-transparent focus:border-primary p-0 pb-1 focus:ring-0 text-sm text-slate-600 placeholder-slate-300 transition-colors"
                                                    placeholder="Optional"
                                                />
                                            </td>
                                            <td className="p-4">
                                                <select
                                                    value={row.client.clientType}
                                                    onChange={e => handleUpdateCell(index, 'clientType', e.target.value, e.target as HTMLElement)}
                                                    className="w-full bg-transparent border-none p-0 focus:ring-0 text-sm font-medium text-slate-600 cursor-pointer"
                                                >
                                                    <option value="Prospect">Prospect</option>
                                                    <option value="Associate">Associate</option>
                                                    <option value="User">User</option>
                                                    <option value="Supervisor">Supervisor</option>
                                                </select>
                                            </td>
                                            <td className="p-4">
                                                <select
                                                    value={row.client.frequency || 'Monthly'}
                                                    onChange={e => handleUpdateCell(index, 'frequency', e.target.value, e.target as HTMLElement)}
                                                    className="w-full bg-transparent border-none p-0 focus:ring-0 text-sm font-medium text-slate-600 cursor-pointer"
                                                >
                                                    <option value="Daily">Daily</option>
                                                    <option value="Weekly">Weekly</option>
                                                    <option value="Every 2 Weeks">Every 2 Weeks</option>
                                                    <option value="Monthly">Monthly</option>
                                                </select>
                                            </td>
                                            <td className="p-4">
                                                <input
                                                    type="date"
                                                    value={toInputDate(row.client.nextFollowUpDate)}
                                                    onChange={e => handleUpdateCell(index, 'nextFollowUpDate', e.target.value)}
                                                    onClick={(e) => (e.currentTarget as HTMLInputElement).showPicker()}
                                                    className="w-full bg-transparent border-none p-0 focus:ring-0 text-sm font-medium text-slate-600 cursor-pointer no-calendar-icon"
                                                />
                                            </td>
                                            <td className="p-4">
                                                <input
                                                    type="text"
                                                    value={row.client.notes}
                                                    onChange={e => handleUpdateCell(index, 'notes', e.target.value)}
                                                    className="w-full bg-transparent border-none p-0 focus:ring-0 text-sm text-slate-500 truncate"
                                                    placeholder="-"
                                                />
                                            </td>
                                            <td className="p-4">
                                                {isError ? (
                                                    <span className="text-red-500 text-xs font-bold flex items-center gap-1.5 bg-red-50 px-2 py-1 rounded-md border border-red-100 w-fit">
                                                        <FontAwesomeIcon icon={faBan} /> {row.errors[0]}
                                                    </span>
                                                ) : isDup ? (
                                                    row.action === 'Update' && row.changedFields && row.changedFields.length > 0 ? (
                                                        <span className="text-blue-600 text-xs font-bold flex items-center gap-1.5 bg-blue-50 px-2 py-1 rounded-md border border-blue-100 w-fit" title={row.changedFields.join(', ')}>
                                                            <FontAwesomeIcon icon={faExclamationCircle} /> Update: {row.changedFields.length > 2 ? `${row.changedFields.slice(0, 2).join(', ')}...` : row.changedFields.join(', ')}
                                                        </span>
                                                    ) : (
                                                        <span className="text-amber-600 text-xs font-bold flex items-center gap-1.5 bg-amber-50 px-2 py-1 rounded-md border border-amber-100 w-fit">
                                                            <FontAwesomeIcon icon={faExclamationTriangle} /> Duplicate
                                                        </span>
                                                    )
                                                ) : (
                                                    <span className="text-emerald-600 text-xs font-bold flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100 w-fit">
                                                        <FontAwesomeIcon icon={faCheckCircle} /> Ready
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {filteredRows.length === 0 && (
                            <div className="p-12 text-center text-slate-400 font-medium">
                                No rows found matching your search.
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-100 bg-white flex justify-between items-center z-10">
                    <div className="text-slate-500 text-sm font-medium">
                        <span className="font-bold text-slate-900">{stats.toImport}</span> New, <span className="font-bold text-primary">{stats.toUpdate}</span> Updates selected.
                    </div>
                    <div className="flex gap-4">
                        <button onClick={onClose} disabled={isImporting} className="px-6 py-3 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold transition disabled:opacity-50 uppercase tracking-wide text-xs">
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirmImport}
                            disabled={isImporting || (stats.toImport === 0 && stats.toUpdate === 0)}
                            className="px-6 py-3 rounded-xl bg-primary hover:bg-blue-700 text-white font-bold shadow-lg shadow-blue-500/20 transition flex items-center gap-2 disabled:opacity-50 disabled:shadow-none uppercase tracking-wide text-xs transform hover:scale-105 active:scale-95"
                        >
                            {isImporting ? (
                                <>
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                    {importProgress || 'Processing...'}
                                </>
                            ) : (
                                <>
                                    <FontAwesomeIcon icon={faCloudUploadAlt} />
                                    Proceed Import ({stats.toImport + stats.toUpdate})
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
            {bulkUpdatePrompt && (
                <BulkUpdatePopover
                    anchorEl={bulkUpdatePrompt.anchorEl}
                    fieldName={bulkUpdatePrompt.field === 'clientType' ? 'Client Type' : 'Frequency'}
                    value={bulkUpdatePrompt.value}
                    onApplySingle={() => handleBulkApply(false)}
                    onApplyAll={() => handleBulkApply(true)}
                    onClose={() => setBulkUpdatePrompt(null)}
                />
            )}
        </div>
    );
};

export default ImportPreviewModal;
