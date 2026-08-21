import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPen, faTrash } from '@fortawesome/free-solid-svg-icons';
import StockBadge from './StockBadge';
import ExpiryBadge from './ExpiryBadge';
import { formatInr, formatVp } from '../../../shared/utils/pricing';
import { formatIsoDate, inventoryTotals, productValue, vpInStock } from '../../../shared/utils/inventory';
import type { IsoDate, Product } from '../../../shared/types';

interface ProductSummaryTableProps {
    /** The rows to render — one page of the filtered catalogue. */
    products: Product[];
    /**
     * The WHOLE filtered set the TOTAL row sums.
     *
     * Separate from `products` because that is only the visible page. Summing
     * the page would label a page subtotal "Total" and disagree with the
     * valuation cards above, which count the entire catalogue — two totals on
     * one screen, differing, with nothing saying why.
     */
    totalsProducts: Product[];
    loading?: boolean;
    today?: IsoDate;
    onEdit: (product: Product) => void;
    onDelete: (product: Product) => void;
}

const SkeletonRows: React.FC<{ cols: number }> = ({ cols }) => (
    <>
        {[0, 1, 2, 3, 4].map(i => (
            <tr key={i} className="border-b border-slate-100">
                {Array.from({ length: cols }).map((_, c) => (
                    <td key={c} className="p-4">
                        <div className="h-4 rounded bg-slate-100 animate-pulse" style={{ width: c === 0 ? '70%' : '45%' }} />
                    </td>
                ))}
            </tr>
        ))}
    </>
);

/**
 * Per-product roll-up with a totals row. Quantities and expiry here are the
 * product's CACHED aggregates; the batch table below is the per-lot truth.
 */
const ProductSummaryTable: React.FC<ProductSummaryTableProps> = ({
    products, totalsProducts, loading = false, today, onEdit, onDelete,
}) => {
    const totals = inventoryTotals(totalsProducts);

    // When the filtered set spills past one page the TOTAL row covers more than
    // the rows above it, so both the header and the row itself have to say so —
    // otherwise adding up the visible Qty column silently disagrees with Total.
    const paginated = totalsProducts.length > products.length;

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/40 flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-800 font-mono tracking-tight uppercase">Summary by product</h3>
                <span className="text-xs text-slate-400 font-mono">
                    {paginated ? `${products.length} of ${totalsProducts.length} shown` : `${products.length} shown`}
                </span>
            </div>

            {/* ── Desktop table ─────────────────────────────────────────── */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-[11px] uppercase font-bold tracking-wider font-mono">
                            <th className="p-4">Product</th>
                            <th className="p-4 text-right">Qty</th>
                            <th className="p-4 text-right hidden lg:table-cell">50% price</th>
                            <th className="p-4 text-right">Value</th>
                            <th className="p-4 text-right hidden lg:table-cell">VP</th>
                            <th className="p-4 hidden xl:table-cell">Earliest expiry</th>
                            <th className="p-4 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                        {loading && <SkeletonRows cols={7} />}

                        {!loading && products.map(product => (
                            <tr key={product.id} className="hover:bg-slate-50 transition-colors duration-200 group">
                                <td className="p-4">
                                    <div className="font-bold text-slate-800">{product.name}</div>
                                    <div className="flex items-center gap-2 mt-1">
                                        {product.stockNo && (
                                            <span className="text-[11px] font-mono text-slate-400">#{product.stockNo}</span>
                                        )}
                                        <StockBadge product={product} />
                                    </div>
                                </td>
                                <td className="p-4 text-right font-mono font-semibold text-slate-700">{product.totalQuantity}</td>
                                <td className="p-4 text-right font-mono text-slate-500 hidden lg:table-cell">{formatInr(product.price50)}</td>
                                <td className="p-4 text-right font-mono font-semibold text-slate-800">{formatInr(productValue(product))}</td>
                                <td className="p-4 text-right font-mono text-slate-500 hidden lg:table-cell">{formatVp(vpInStock(product))}</td>
                                <td className="p-4 hidden xl:table-cell">
                                    {product.earliestExpiry ? (
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-600 whitespace-nowrap">{formatIsoDate(product.earliestExpiry)}</span>
                                            <ExpiryBadge expiryDate={product.earliestExpiry} today={today} />
                                        </div>
                                    ) : (
                                        <span className="text-slate-300">—</span>
                                    )}
                                </td>
                                <td className="p-4 text-right whitespace-nowrap">
                                    <button
                                        onClick={() => onEdit(product)}
                                        aria-label={`Edit ${product.name}`}
                                        className="cursor-pointer text-slate-400 hover:text-primary p-2 rounded-lg hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
                                    >
                                        <FontAwesomeIcon icon={faPen} />
                                    </button>
                                    <button
                                        onClick={() => onDelete(product)}
                                        aria-label={`Delete ${product.name}`}
                                        className="cursor-pointer text-slate-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300"
                                    >
                                        <FontAwesomeIcon icon={faTrash} />
                                    </button>
                                </td>
                            </tr>
                        ))}

                        {!loading && products.length > 0 && (
                            <tr className="bg-slate-50/70 font-bold text-slate-800">
                                <td className="p-4 font-mono text-xs uppercase tracking-wider text-slate-500">
                                    Total
                                    {paginated && (
                                        <span className="block mt-0.5 font-sans text-[10px] font-medium normal-case tracking-normal text-slate-400">
                                            all {totalsProducts.length} filtered products
                                        </span>
                                    )}
                                </td>
                                <td className="p-4 text-right font-mono">{totals.totalUnits}</td>
                                <td className="p-4 hidden lg:table-cell" />
                                <td className="p-4 text-right font-mono">{formatInr(totals.stockValue)}</td>
                                <td className="p-4 text-right font-mono hidden lg:table-cell">{formatVp(totals.vpInStock)}</td>
                                <td className="p-4 hidden xl:table-cell" />
                                <td className="p-4" />
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* ── Mobile cards (≤768px): the same rows, stacked ─────────── */}
            <div className="md:hidden divide-y divide-slate-100">
                {loading && [0, 1, 2].map(i => (
                    <div key={i} className="p-4 space-y-2">
                        <div className="h-4 w-2/3 rounded bg-slate-100 animate-pulse" />
                        <div className="h-3 w-1/3 rounded bg-slate-100 animate-pulse" />
                    </div>
                ))}

                {!loading && products.map(product => (
                    <div key={product.id} className="p-4">
                        <div className="flex justify-between items-start gap-3">
                            <div className="min-w-0">
                                <div className="font-bold text-slate-800 text-sm">{product.name}</div>
                                {product.stockNo && (
                                    <div className="text-[11px] font-mono text-slate-400 mt-0.5">#{product.stockNo}</div>
                                )}
                            </div>
                            <StockBadge product={product} />
                        </div>
                        <dl className="grid grid-cols-3 gap-2 mt-3 text-xs">
                            <div>
                                <dt className="text-slate-400">Qty</dt>
                                <dd className="font-mono font-semibold text-slate-700">{product.totalQuantity}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-400">Value</dt>
                                <dd className="font-mono font-semibold text-slate-800">{formatInr(productValue(product))}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-400">VP</dt>
                                <dd className="font-mono text-slate-600">{formatVp(vpInStock(product))}</dd>
                            </div>
                        </dl>
                        <div className="flex justify-between items-center mt-3">
                            <ExpiryBadge expiryDate={product.earliestExpiry} today={today} />
                            <div className="flex gap-1">
                                <button
                                    onClick={() => onEdit(product)}
                                    aria-label={`Edit ${product.name}`}
                                    className="cursor-pointer text-slate-400 hover:text-primary p-2 rounded-lg hover:bg-blue-50 transition-colors"
                                >
                                    <FontAwesomeIcon icon={faPen} />
                                </button>
                                <button
                                    onClick={() => onDelete(product)}
                                    aria-label={`Delete ${product.name}`}
                                    className="cursor-pointer text-slate-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors"
                                >
                                    <FontAwesomeIcon icon={faTrash} />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}

                {!loading && products.length > 0 && (
                    <div className="p-4 bg-slate-50/70 flex justify-between gap-3 text-sm font-bold text-slate-800">
                        <span className="font-mono text-xs uppercase tracking-wider text-slate-500 shrink-0">
                            Total
                            {paginated && (
                                <span className="block mt-0.5 font-sans text-[10px] font-medium normal-case tracking-normal text-slate-400">
                                    all {totalsProducts.length}
                                </span>
                            )}
                        </span>
                        <span className="font-mono text-right">{totals.totalUnits} units · {formatInr(totals.stockValue)} · {formatVp(totals.vpInStock)} VP</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProductSummaryTable;
