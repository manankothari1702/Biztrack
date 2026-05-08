import React, { useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faUsers, faTimes } from '@fortawesome/free-solid-svg-icons';

interface BulkUpdatePopoverProps {
    anchorEl: HTMLElement | null;
    fieldName: string;
    value: string;
    onApplySingle: () => void;
    onApplyAll: () => void;
    onClose: () => void;
}

const BulkUpdatePopover: React.FC<BulkUpdatePopoverProps> = ({
    anchorEl,
    fieldName,
    value,
    onApplySingle,
    onApplyAll,
    onClose
}) => {
    const popoverRef = useRef<HTMLDivElement>(null);

    // Calculate position
    const getPosition = () => {
        if (!anchorEl) return { top: 0, left: 0 };
        const rect = anchorEl.getBoundingClientRect();
        // Position below the cell
        return {
            top: rect.bottom + window.scrollY + 5,
            left: rect.left + window.scrollX
        };
    };

    const position = getPosition();

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node) && anchorEl && !anchorEl.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose, anchorEl]);

    if (!anchorEl) return null;

    return (
        <div
            ref={popoverRef}
            className="fixed z-[70] bg-white rounded-lg shadow-xl border border-slate-200 w-72 animate-fade-in"
            style={{ top: position.top, left: position.left }}
        >
            <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-lg">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Update {fieldName}</span>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                    <FontAwesomeIcon icon={faTimes} />
                </button>
            </div>

            <div className="p-2">
                <p className="text-sm text-slate-600 px-2 pb-2">
                    Set <strong>{value}</strong> for:
                </p>

                <div className="space-y-1">
                    <button
                        onClick={onApplySingle}
                        className="w-full text-left px-3 py-2 rounded flex items-center gap-3 hover:bg-blue-50 hover:text-blue-700 transition group"
                    >
                        <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center group-hover:bg-blue-200 group-hover:text-blue-600 transition">
                            <FontAwesomeIcon icon={faUser} className="text-sm" />
                        </div>
                        <div>
                            <div className="text-sm font-bold text-slate-700 group-hover:text-blue-700">This Client Only</div>
                            <div className="text-xs text-slate-500 group-hover:text-blue-600/80">Update just this row</div>
                        </div>
                    </button>

                    <button
                        onClick={onApplyAll}
                        className="w-full text-left px-3 py-2 rounded flex items-center gap-3 hover:bg-purple-50 hover:text-purple-700 transition group"
                    >
                        <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center group-hover:bg-purple-200 group-hover:text-purple-600 transition">
                            <FontAwesomeIcon icon={faUsers} className="text-sm" />
                        </div>
                        <div>
                            <div className="text-sm font-bold text-slate-700 group-hover:text-purple-700">All Imported Clients</div>
                            <div className="text-xs text-slate-500 group-hover:text-purple-600/80">Update {fieldName} for all rows</div>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BulkUpdatePopover;