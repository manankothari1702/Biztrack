import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck, faCircleXmark, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { getStockStatus } from '../../../shared/utils/inventory';
import type { Product, StockStatus } from '../../../shared/types';

interface StockBadgeProps {
    product: Pick<Product, 'totalQuantity' | 'reorderLevel'>;
    size?: 'sm' | 'md';
}

const STYLES: Record<StockStatus, { chip: string; icon: typeof faCircleCheck }> = {
    'In Stock':     { chip: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: faCircleCheck },
    'Low Stock':    { chip: 'bg-amber-50 text-amber-700 border-amber-100',       icon: faTriangleExclamation },
    'Out of Stock': { chip: 'bg-red-50 text-red-700 border-red-100',             icon: faCircleXmark },
};

/** In / Low / Out, from the cached roll-up. Icon + word, never colour alone. */
const StockBadge: React.FC<StockBadgeProps> = ({ product, size = 'sm' }) => {
    const status = getStockStatus(product);
    const { chip, icon } = STYLES[status];
    const scale = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-bold uppercase tracking-wider whitespace-nowrap ${chip} ${scale}`}>
            <FontAwesomeIcon icon={icon} className="text-[0.85em]" />
            {status}
        </span>
    );
};

export default StockBadge;
