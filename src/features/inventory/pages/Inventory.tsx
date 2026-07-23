import React, { useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faBoxesStacked, faChevronLeft, faChevronRight, faCircleXmark,
    faFileExport, faFileImport, faPlus, faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { useInventory } from '../hooks/useInventory';
import { useInventoryStats } from '../hooks/useInventoryStats';
import { useToast } from '../../../shared/context/ToastContext';
import { useData } from '../../../shared/context/DataContext';
import { EMPTY_INVENTORY_FILTERS } from '../../../shared/services/apiParams';
import type { InventoryFilterState } from '../../../shared/services/apiParams';
import { DEFAULT_TIMEZONE, todayIso } from '../../../shared/utils/inventory';
import { logger } from '../../../shared/utils/logger';
import InventoryValueCards from '../components/InventoryValueCards';
import ProductSummaryTable from '../components/ProductSummaryTable';
import BatchTable from '../components/BatchTable';
import ProductFilters from '../components/ProductFilters';
import ProductModal from '../components/ProductModal';
import BatchModal from '../components/BatchModal';
import WriteOffModal from '../components/WriteOffModal';
import { ConfirmationModal } from '../../../shared/components/common/ConfirmationModal';
import type { Batch, Product, WriteOffReason } from '../../../shared/types';

const ITEMS_PER_PAGE = 50;

const Inventory: React.FC = () => {
    const { success, error: toastError } = useToast();
    const { userProfile } = useData();

    const [filters, setFilters]   = useState<InventoryFilterState>(EMPTY_INVENTORY_FILTERS);
    const [page, setPage]         = useState(1);
    const [includeEmpty, setIncludeEmpty] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const timeZone = userProfile.timezone || DEFAULT_TIMEZONE;
    // One "today" for the whole page, so every badge bands against the same day
    // even if the user leaves the tab open across midnight.
    const today = useMemo(() => todayIso(timeZone), [timeZone]);

    const {
        products, allProducts, batches, totalFetched, loading, error,
        refresh, addProduct, updateProduct, deleteProduct, adjustBatch, writeOffBatch,
    } = useInventory(filters, page, ITEMS_PER_PAGE);

    const { stats, loading: statsLoading, refresh: refreshStats } = useInventoryStats(timeZone);

    // Modal state
    const [productModalOpen, setProductModalOpen] = useState(false);
    const [editingProduct, setEditingProduct]     = useState<Product | null>(null);
    const [batchModalOpen, setBatchModalOpen]     = useState(false);
    const [editingBatch, setEditingBatch]         = useState<Batch | null>(null);
    const [writeOffOpen, setWriteOffOpen]         = useState(false);
    const [writeOffBatchRow, setWriteOffBatchRow] = useState<Batch | null>(null);
    const [deleteTarget, setDeleteTarget]         = useState<Product | null>(null);
    const [deleting, setDeleting]                 = useState(false);

    const productsById = useMemo(
        () => new Map(allProducts.map(p => [p.id, p])),
        [allProducts],
    );

    const changeFilters = (next: InventoryFilterState) => {
        setFilters(next);
        setPage(1);
    };

    // ── Handlers ────────────────────────────────────────────────────────────
    // The hook rejects; the page decides what the user sees. Modals stay open
    // on failure and keep their state — they surface the message inline.

    const handleSaveProduct = async (product: Product) => {
        const isEdit = Boolean(editingProduct);
        await (isEdit ? updateProduct(product) : addProduct(product));
        success(isEdit ? 'Product updated' : 'Product added', product.name);
        refreshStats();
    };

    const handleAdjustBatch = async (
        productId: string, expiry: string, body: Parameters<typeof adjustBatch>[2],
    ) => {
        await adjustBatch(productId, expiry, body);
        success('Batch corrected', 'Stock and the movement log have been updated.');
        refreshStats();
    };

    const handleWriteOff = async (
        productId: string, expiry: string, reason: WriteOffReason, note?: string,
    ) => {
        const result = await writeOffBatch(productId, expiry, reason, note);
        success('Stock written off', `${result?.writtenOff ?? 0} units removed (${reason}).`);
        refreshStats();
    };

    const confirmDeleteProduct = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteProduct(deleteTarget.id);
            success('Product deleted', `${deleteTarget.name} has been removed from the catalogue.`);
            setDeleteTarget(null);
            refreshStats();
        } catch (err) {
            logger.error('Product delete failed:', err);
            toastError('Delete failed', err instanceof Error ? err.message : 'Please try again.');
        } finally {
            setDeleting(false);
        }
    };

    const totalPages = Math.max(1, Math.ceil(totalFetched / ITEMS_PER_PAGE));
    const filtersActive = filters.search !== '' || filters.category !== 'All'
        || filters.stockStatus !== 'All' || filters.expiry !== 'All';
    const emptyCatalogue = !loading && totalFetched === 0 && !filtersActive;

    return (
        <div className="max-w-[1600px] mx-auto w-full">
            {/* Header */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6 font-sans">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-slate-900 font-mono tracking-tight">Inventory</h2>
                    <p className="text-slate-500 text-sm mt-2 font-medium">
                        {statsLoading
                            ? 'Loading stock…'
                            : `${stats.productCount} ${stats.productCount === 1 ? 'product' : 'products'} · stock and expiry tracking`}
                    </p>
                </div>
                <div className="flex flex-wrap gap-3 w-full lg:w-auto">
                    <button
                        disabled
                        title="Excel import arrives with the import/export phase"
                        className="flex-1 lg:flex-none justify-center bg-white border border-slate-200 text-slate-400 px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 shadow-sm h-11 cursor-not-allowed"
                    >
                        <FontAwesomeIcon icon={faFileImport} />
                        <span>Import</span>
                    </button>
                    <button
                        disabled
                        title="Excel export arrives with the import/export phase"
                        className="flex-1 lg:flex-none justify-center bg-white border border-slate-200 text-slate-400 px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 shadow-sm h-11 cursor-not-allowed"
                    >
                        <FontAwesomeIcon icon={faFileExport} />
                        <span>Export</span>
                    </button>
                    <button
                        onClick={() => { setEditingProduct(null); setProductModalOpen(true); }}
                        className="cursor-pointer flex-1 lg:flex-none justify-center bg-primary hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-blue-500/20 flex items-center gap-2 transition whitespace-nowrap h-11 active:scale-95 focus:outline-none focus:ring-4 focus:ring-primary/30"
                    >
                        <FontAwesomeIcon icon={faPlus} />
                        Add product
                    </button>
                </div>
            </div>

            {/* Load failure — distinct from "nothing here yet" */}
            {error && (
                <div role="alert" className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 flex items-start gap-3">
                    <FontAwesomeIcon icon={faCircleXmark} className="text-red-600 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 text-sm">Couldn't load inventory</p>
                        <p className="text-sm text-slate-600 mt-0.5">{error}</p>
                    </div>
                    <button onClick={refresh} className="cursor-pointer text-sm font-bold text-primary hover:underline shrink-0">
                        Retry
                    </button>
                </div>
            )}

            {/* Valuation */}
            <div className="mb-6">
                <InventoryValueCards stats={stats} loading={statsLoading} />
            </div>

            {/* Alert strip — counts only, each links nowhere yet; the filter bar
                below is the way to act on them. */}
            {!statsLoading && (stats.expiringSoon > 0 || stats.expired > 0 || stats.lowStock > 0) && (
                <div className="mb-6 flex flex-wrap gap-3">
                    {stats.expired > 0 && (
                        <button
                            onClick={() => changeFilters({ ...filters, expiry: 'expired' })}
                            className="cursor-pointer inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors focus:outline-none focus:ring-4 focus:ring-red-200"
                        >
                            <FontAwesomeIcon icon={faCircleXmark} />
                            {stats.expired} expired {stats.expired === 1 ? 'batch' : 'batches'}
                        </button>
                    )}
                    {stats.expiringSoon > 0 && (
                        <button
                            onClick={() => changeFilters({ ...filters, expiry: 'expiring' })}
                            className="cursor-pointer inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 transition-colors focus:outline-none focus:ring-4 focus:ring-amber-200"
                        >
                            <FontAwesomeIcon icon={faTriangleExclamation} />
                            {stats.expiringSoon} expiring in 30 days
                        </button>
                    )}
                    {stats.lowStock > 0 && (
                        <button
                            onClick={() => changeFilters({ ...filters, stockStatus: 'Low Stock' })}
                            className="cursor-pointer inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 transition-colors focus:outline-none focus:ring-4 focus:ring-amber-200"
                        >
                            <FontAwesomeIcon icon={faTriangleExclamation} />
                            {stats.lowStock} low on stock
                        </button>
                    )}
                </div>
            )}

            {emptyCatalogue ? (
                /* Empty inventory — the whole page collapses to one call to action */
                <div className="bg-white rounded-2xl border border-dashed border-slate-300 py-16 px-6 text-center">
                    <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4 border border-blue-100">
                        <FontAwesomeIcon icon={faBoxesStacked} className="text-3xl text-primary" />
                    </div>
                    <p className="font-bold text-slate-800 text-lg">No products yet</p>
                    <p className="text-slate-500 mt-1 max-w-md mx-auto">
                        Import your catalogue or add a product to start tracking stock, value and expiry.
                    </p>
                    <div className="flex flex-wrap gap-3 justify-center mt-6">
                        <button
                            disabled
                            title="Excel import arrives with the import/export phase"
                            className="bg-white border border-slate-200 text-slate-400 px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 shadow-sm cursor-not-allowed"
                        >
                            <FontAwesomeIcon icon={faFileImport} />
                            Import catalogue
                        </button>
                        <button
                            onClick={() => { setEditingProduct(null); setProductModalOpen(true); }}
                            className="cursor-pointer bg-primary hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-blue-500/20 flex items-center gap-2 transition active:scale-95"
                        >
                            <FontAwesomeIcon icon={faPlus} />
                            Add product
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Filters */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
                        <ProductFilters filters={filters} onChange={changeFilters} searchInputRef={searchInputRef} />
                    </div>

                    {/* No match for the current filters — distinct from an empty catalogue */}
                    {!loading && totalFetched === 0 && filtersActive ? (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm py-14 text-center">
                            <p className="font-bold text-slate-700">No products match these filters</p>
                            <button
                                onClick={() => changeFilters(EMPTY_INVENTORY_FILTERS)}
                                className="cursor-pointer text-primary font-bold text-sm mt-2 hover:underline"
                            >
                                Clear filters
                            </button>
                        </div>
                    ) : (
                        <>
                            <ProductSummaryTable
                                products={products}
                                loading={loading}
                                today={today}
                                onEdit={p => { setEditingProduct(p); setProductModalOpen(true); }}
                                onDelete={p => setDeleteTarget(p)}
                            />

                            {totalFetched > ITEMS_PER_PAGE && (
                                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 px-1">
                                    <div className="text-xs text-slate-500 font-medium font-mono uppercase tracking-wide">
                                        Showing <span className="text-slate-800 font-bold">{(page - 1) * ITEMS_PER_PAGE + 1}</span>
                                        {' – '}
                                        <span className="text-slate-800 font-bold">{Math.min(page * ITEMS_PER_PAGE, totalFetched)}</span>
                                        {' of '}<span className="text-slate-800 font-bold">{totalFetched}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setPage(p => Math.max(1, p - 1))}
                                            disabled={page === 1}
                                            className="cursor-pointer px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:text-primary hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center gap-1"
                                        >
                                            <FontAwesomeIcon icon={faChevronLeft} className="text-xs" /> Previous
                                        </button>
                                        <span className="text-xs font-bold font-mono px-3 text-slate-600">{page} / {totalPages}</span>
                                        <button
                                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                            disabled={page >= totalPages}
                                            className="cursor-pointer px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:text-primary hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center gap-1"
                                        >
                                            Next <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            <BatchTable
                                batches={batches}
                                products={allProducts}
                                loading={loading}
                                today={today}
                                includeEmpty={includeEmpty}
                                onToggleIncludeEmpty={setIncludeEmpty}
                                onEdit={b => { setEditingBatch(b); setBatchModalOpen(true); }}
                                onWriteOff={b => { setWriteOffBatchRow(b); setWriteOffOpen(true); }}
                            />
                        </>
                    )}
                </div>
            )}

            {/* ── Modals ─────────────────────────────────────────────────── */}

            <ProductModal
                isOpen={productModalOpen}
                onClose={() => { setProductModalOpen(false); setEditingProduct(null); }}
                onSave={handleSaveProduct}
                initialProduct={editingProduct}
            />

            <BatchModal
                isOpen={batchModalOpen}
                onClose={() => { setBatchModalOpen(false); setEditingBatch(null); }}
                batch={editingBatch}
                productName={editingBatch ? productsById.get(editingBatch.productId)?.name : undefined}
                onSave={handleAdjustBatch}
            />

            <WriteOffModal
                isOpen={writeOffOpen}
                onClose={() => { setWriteOffOpen(false); setWriteOffBatchRow(null); }}
                batch={writeOffBatchRow}
                product={writeOffBatchRow ? productsById.get(writeOffBatchRow.productId) : undefined}
                onConfirm={handleWriteOff}
            />

            <ConfirmationModal
                isOpen={Boolean(deleteTarget)}
                onClose={() => { if (!deleting) setDeleteTarget(null); }}
                onConfirm={confirmDeleteProduct}
                title="Delete product?"
                message={
                    deleteTarget
                        ? `Remove "${deleteTarget.name}" from the catalogue? Its batches and movement history are kept for audit, but the product will no longer appear in inventory or invoices.`
                        : ''
                }
                confirmText={deleting ? 'Deleting…' : 'Delete'}
                isDestructive
                isLoading={deleting}
            />
        </div>
    );
};

export default Inventory;
