import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPen, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import ExpiryBadge from './ExpiryBadge';
import { formatInr, formatVp } from '../../../shared/utils/pricing';
import { formatIsoDate, sortBatchesByExpiry } from '../../../shared/utils/inventory';
import { roundVp } from '../../../shared/utils/pricing';
import type { Batch, IsoDate, Product } from '../../../shared/types';

interface BatchTableProps {
    batches: Batch[];
    products: Product[];
    loading?: boolean;
    today?: IsoDate;
    includeEmpty: boolean;
    onToggleIncludeEmpty: (next: boolean) => void;
    onEdit: (batch: Batch) => void;
    onWriteOff: (batch: Batch) => void;
}

/**
 * One row per (product, expiry).
 *
 * Rows are ordered soonest-expiry-first — READABILITY ONLY. v1 has no FEFO:
 * the user picks the lot they physically took off the shelf, and selling from a
 * later-expiring lot while an earlier one still has stock is normal. Nothing
 * here preselects, recommends, or warns about lot choice.
 */
const BatchTable: React.FC<BatchTableProps> = ({
    batches, products, loading = false, today,
    includeEmpty, onToggleIncludeEmpty, onEdit, onWriteOff,
}) => {
    const byId = new Map(products.map(p => [p.id, p]));

    // Zero-quantity lots are kept server-side as history (movements reference
    // them) but hidden here unless asked for.
    const visible = sortBatchesByExpiry(
        includeEmpty ? batches : batches.filter(b => b.quantity > 0),
    );

    const nameOf  = (b: Batch) => b.productName ?? byId.get(b.productId)?.name ?? b.productId;
    const valueOf = (b: Batch) => b.quantity * (byId.get(b.productId)?.price50 ?? 0);
    const vpOf    = (b: Batch) => roundVp(b.quantity * (byId.get(b.productId)?.vp ?? 0));

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-bold text-slate-800 font-mono tracking-tight uppercase">Stock detail — by expiry</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Sorted soonest expiry first</p>
                </div>
                {/*
                  * Emptied lots are hidden by default and fetched only when this
                  * is on — GET /batches filters `quantity > 0` unless
                  * includeEmpty is set (05_API_CONTRACT §2). The rows are kept
                  * server-side because movement records reference them.
                  */}
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={includeEmpty}
                        onChange={e => onToggleIncludeEmpty(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/20 cursor-pointer"
                    />
                    Show empty batches
                </label>
            </div>

            {/* ── Desktop table ─────────────────────────────────────────── */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-[11px] uppercase font-bold tracking-wider font-mono">
                            <th className="p-4">Product</th>
                            <th className="p-4">Expiry</th>
                            <th className="p-4 text-right">Qty</th>
                            <th className="p-4 text-right hidden lg:table-cell">Value</th>
                            <th className="p-4 text-right hidden lg:table-cell">VP</th>
                            <th className="p-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                        {loading && [0, 1, 2, 3].map(i => (
                            <tr key={i} className="border-b border-slate-100">
                                {[0, 1, 2, 3, 4, 5].map(c => (
                                    <td key={c} className="p-4">
                                        <div className="h-4 rounded bg-slate-100 animate-pulse" style={{ width: c === 0 ? '70%' : '50%' }} />
                                    </td>
                                ))}
                            </tr>
                        ))}

                        {!loading && visible.map(batch => (
                            <tr
                                key={`${batch.productId}#${batch.expiryDate}`}
                                className={`hover:bg-slate-50 transition-colors duration-200 ${batch.quantity <= 0 ? 'opacity-50' : ''}`}
                            >
                                <td className="p-4 font-semibold text-slate-800">{nameOf(batch)}</td>
                                <td className="p-4">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-slate-600 whitespace-nowrap font-mono">{formatIsoDate(batch.expiryDate)}</span>
                                        <ExpiryBadge expiryDate={batch.expiryDate} today={today} />
                                    </div>
                                </td>
                                <td className="p-4 text-right font-mono font-semibold text-slate-700">{batch.quantity}</td>
                                <td className="p-4 text-right font-mono text-slate-600 hidden lg:table-cell">{formatInr(valueOf(batch))}</td>
                                <td className="p-4 text-right font-mono text-slate-500 hidden lg:table-cell">{formatVp(vpOf(batch))}</td>
                                <td className="p-4 text-right whitespace-nowrap">
                                    <button
                                        onClick={() => onEdit(batch)}
                                        aria-label={`Correct ${nameOf(batch)} expiring ${batch.expiryDate}`}
                                        className="cursor-pointer text-slate-400 hover:text-primary p-2 rounded-lg hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
                                    >
                                        <FontAwesomeIcon icon={faPen} />
                                    </button>
                                    <button
                                        onClick={() => onWriteOff(batch)}
                                        disabled={batch.quantity <= 0}
                                        aria-label={`Write off ${nameOf(batch)} expiring ${batch.expiryDate}`}
                                        className="cursor-pointer text-slate-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent focus:outline-none focus:ring-2 focus:ring-red-300"
                                    >
                                        <FontAwesomeIcon icon={faTrashCan} />
                                    </button>
                                </td>
                            </tr>
                        ))}

                        {!loading && visible.length === 0 && (
                            <tr>
                                <td colSpan={6} className="p-10 text-center text-slate-400 bg-slate-50/40">
                                    {includeEmpty
                                        ? 'No batches yet. Stock arrives through a purchase invoice.'
                                        : 'No batches with stock. Tick "Show empty batches" to see emptied lots.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* ── Mobile cards ──────────────────────────────────────────── */}
            <div className="md:hidden divide-y divide-slate-100">
                {loading && [0, 1, 2].map(i => (
                    <div key={i} className="p-4 space-y-2">
                        <div className="h-4 w-2/3 rounded bg-slate-100 animate-pulse" />
                        <div className="h-3 w-1/2 rounded bg-slate-100 animate-pulse" />
                    </div>
                ))}

                {!loading && visible.map(batch => (
                    <div key={`${batch.productId}#${batch.expiryDate}`} className={`p-4 ${batch.quantity <= 0 ? 'opacity-50' : ''}`}>
                        <div className="font-bold text-slate-800 text-sm">{nameOf(batch)}</div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="text-xs font-mono text-slate-600">{formatIsoDate(batch.expiryDate)}</span>
                            <ExpiryBadge expiryDate={batch.expiryDate} today={today} />
                        </div>
                        <dl className="grid grid-cols-3 gap-2 mt-3 text-xs">
                            <div>
                                <dt className="text-slate-400">Qty</dt>
                                <dd className="font-mono font-semibold text-slate-700">{batch.quantity}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-400">Value</dt>
                                <dd className="font-mono text-slate-700">{formatInr(valueOf(batch))}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-400">VP</dt>
                                <dd className="font-mono text-slate-600">{formatVp(vpOf(batch))}</dd>
                            </div>
                        </dl>
                        <div className="flex justify-end gap-1 mt-2">
                            <button
                                onClick={() => onEdit(batch)}
                                aria-label={`Correct ${nameOf(batch)}`}
                                className="cursor-pointer text-slate-400 hover:text-primary p-2 rounded-lg hover:bg-blue-50 transition-colors"
                            >
                                <FontAwesomeIcon icon={faPen} />
                            </button>
                            <button
                                onClick={() => onWriteOff(batch)}
                                disabled={batch.quantity <= 0}
                                aria-label={`Write off ${nameOf(batch)}`}
                                className="cursor-pointer text-slate-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <FontAwesomeIcon icon={faTrashCan} />
                            </button>
                        </div>
                    </div>
                ))}

                {!loading && visible.length === 0 && (
                    <div className="p-8 text-center text-slate-400 text-sm">
                        {includeEmpty
                            ? 'No batches yet. Stock arrives through a purchase invoice.'
                            : 'No batches with stock.'}
                    </div>
                )}
            </div>
        </div>
    );
};

export default BatchTable;
