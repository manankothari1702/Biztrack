import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBoxesStacked, faIndianRupeeSign, faStar } from '@fortawesome/free-solid-svg-icons';
import { formatInr, formatVp } from '../../../shared/utils/pricing';
import type { InventoryStats } from '../../../shared/utils/inventory';

interface InventoryValueCardsProps {
    stats: InventoryStats;
    loading?: boolean;
}

const CardSkeleton: React.FC = () => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="animate-pulse space-y-3">
            <div className="h-3 w-28 rounded bg-slate-100" />
            <div className="h-7 w-32 rounded bg-slate-200" />
            <div className="h-3 w-20 rounded bg-slate-100" />
        </div>
    </div>
);

/**
 * The three valuation figures: what the stock cost, the VP sitting in it, and
 * how many units that is. Stock is valued at the 50% price — what you paid,
 * not what you would sell it for.
 */
const InventoryValueCards: React.FC<InventoryValueCardsProps> = ({ stats, loading = false }) => {
    if (loading) {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                <CardSkeleton /><CardSkeleton /><CardSkeleton />
            </div>
        );
    }

    const cards = [
        {
            label: 'Total stock value',
            hint:  'at 50% (your cost)',
            value: formatInr(stats.stockValue),
            icon:  faIndianRupeeSign,
            tint:  'bg-blue-50 text-primary border-blue-100',
        },
        {
            label: 'Total VP in stock',
            hint:  'volume points held',
            value: formatVp(stats.vpInStock),
            icon:  faStar,
            tint:  'bg-emerald-50 text-emerald-600 border-emerald-100',
        },
        {
            label: 'Total units',
            hint:  `${stats.productCount} product${stats.productCount === 1 ? '' : 's'}`,
            value: stats.totalUnits.toLocaleString('en-IN'),
            icon:  faBoxesStacked,
            tint:  'bg-slate-50 text-slate-600 border-slate-200',
        },
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {cards.map(card => (
                <div
                    key={card.label}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow duration-200"
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[13px] font-medium text-slate-500 truncate">{card.label}</p>
                            <p className="mt-1.5 text-2xl md:text-[26px] font-medium text-slate-900 font-mono tracking-tight break-words">
                                {card.value}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">{card.hint}</p>
                        </div>
                        <span className={`shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center ${card.tint}`}>
                            <FontAwesomeIcon icon={card.icon} />
                        </span>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default InventoryValueCards;
