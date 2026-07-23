import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck, faCircleXmark, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { EXPIRING_SOON_DAYS, getExpiryStatus } from '../../../shared/utils/inventory';
import type { ExpiryStatus, IsoDate } from '../../../shared/types';

interface ExpiryBadgeProps {
    expiryDate?: IsoDate;
    /** The user's calendar day. Passed down so every row bands against one date. */
    today?: IsoDate;
    soonDays?: number;
    /** `sm` for inside dense table rows. */
    size?: 'sm' | 'md';
}

const STYLES: Record<ExpiryStatus, { chip: string; icon: typeof faCircleCheck; label: string }> = {
    'Expired':       { chip: 'bg-red-50 text-red-700 border-red-100',       icon: faCircleXmark,          label: 'Expired' },
    'Expiring Soon': { chip: 'bg-amber-50 text-amber-700 border-amber-100', icon: faTriangleExclamation,  label: 'Expiring soon' },
    'OK':            { chip: 'bg-slate-50 text-slate-500 border-slate-200', icon: faCircleCheck,          label: 'OK' },
};

/**
 * Expiry state for one date. Colour alone never carries the meaning — each
 * badge pairs a tint with an icon and a word, so it survives greyscale and
 * colour-blindness (WCAG).
 */
const ExpiryBadge: React.FC<ExpiryBadgeProps> = ({
    expiryDate, today, soonDays = EXPIRING_SOON_DAYS, size = 'sm',
}) => {
    if (!expiryDate) return null;

    const status = getExpiryStatus(expiryDate, soonDays, today);
    const { chip, icon, label } = STYLES[status];
    const scale = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-bold uppercase tracking-wider whitespace-nowrap ${chip} ${scale}`}
            title={`Expires ${expiryDate}`}
        >
            <FontAwesomeIcon icon={icon} className="text-[0.85em]" />
            {label}
        </span>
    );
};

export default ExpiryBadge;
