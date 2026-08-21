import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import {
    EXPIRY_FILTERS, PRODUCT_CATEGORIES, SORT_OPTIONS, STOCK_STATUSES,
} from '../../../shared/constants/productCategories';
import type { InventoryFilterState } from '../../../shared/services/apiParams';

interface ProductFiltersProps {
    filters: InventoryFilterState;
    onChange: (next: InventoryFilterState) => void;
    searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

const selectClass =
    'w-full sm:w-auto px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm font-medium '
    + 'text-slate-700 cursor-pointer transition-all focus:bg-white focus:outline-none focus:border-primary '
    + 'focus:ring-4 focus:ring-primary/10';

/** Search + category + stock status + expiry + sort. Mirrors ClientFilters. */
const ProductFilters: React.FC<ProductFiltersProps> = ({ filters, onChange, searchInputRef }) => {
    const set = <K extends keyof InventoryFilterState>(key: K, value: InventoryFilterState[K]) =>
        onChange({ ...filters, [key]: value });

    return (
        <div className="flex flex-col lg:flex-row gap-3 justify-between items-stretch lg:items-center w-full">
            <div className="w-full lg:w-72 relative">
                <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none" />
                <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search name or stock no…"
                    value={filters.search}
                    onChange={e => set('search', e.target.value)}
                    aria-label="Search products"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all font-medium text-slate-700 text-sm placeholder:text-slate-400"
                />
            </div>

            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                <select
                    value={filters.category}
                    onChange={e => set('category', e.target.value)}
                    aria-label="Filter by category"
                    className={selectClass}
                >
                    <option value="All">All categories</option>
                    {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <select
                    value={filters.stockStatus}
                    onChange={e => set('stockStatus', e.target.value)}
                    aria-label="Filter by stock status"
                    className={selectClass}
                >
                    <option value="All">Any stock level</option>
                    {STOCK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>

                <select
                    value={filters.expiry}
                    onChange={e => set('expiry', e.target.value)}
                    aria-label="Filter by expiry"
                    className={selectClass}
                >
                    {EXPIRY_FILTERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>

                <select
                    value={filters.sortBy}
                    onChange={e => set('sortBy', e.target.value)}
                    aria-label="Sort products"
                    className={selectClass}
                >
                    {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
                </select>
            </div>
        </div>
    );
};

export default ProductFilters;
