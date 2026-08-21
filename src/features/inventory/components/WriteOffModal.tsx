import React, { useEffect, useState } from 'react';
import { Modal } from '../../../shared/components/common/Compat/Modal';
import { Button } from '../../../shared/components/common/Compat/Button';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { formatInr, formatVp, roundVp } from '../../../shared/utils/pricing';
import { formatIsoDate } from '../../../shared/utils/inventory';
import type { Batch, Product, WriteOffReason } from '../../../shared/types';

interface WriteOffModalProps {
    isOpen: boolean;
    onClose: () => void;
    batch: Batch | null;
    product?: Product;
    onConfirm: (productId: string, expiry: string, reason: WriteOffReason, note?: string) => Promise<void>;
}

const REASONS: WriteOffReason[] = ['Expired', 'Damaged', 'Other'];

const inputClass =
    'w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/50 text-sm text-slate-700 '
    + 'transition-all focus:bg-white focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10';

/**
 * Confirm removing a whole lot from stock.
 *
 * Destructive and irreversible from the UI (there is no un-write-off; the only
 * correction is a manual batch adjustment), so the dialog states exactly what
 * leaves — units, rupees at cost, and VP — before the button is available.
 * Mirrors ConfirmationModal's isDestructive/isLoading treatment.
 */
const WriteOffModal: React.FC<WriteOffModalProps> = ({ isOpen, onClose, batch, product, onConfirm }) => {
    const [reason, setReason] = useState<WriteOffReason>('Expired');
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setReason('Expired');
        setNote('');
        setError(null);
    }, [isOpen, batch]);

    if (!batch) return null;

    const value = batch.quantity * (product?.price50 ?? 0);
    const vp    = roundVp(batch.quantity * (product?.vp ?? 0));
    const name  = product?.name ?? batch.productName ?? batch.productId;

    const handleConfirm = async () => {
        setSaving(true);
        setError(null);
        try {
            await onConfirm(batch.productId, batch.expiryDate, reason, note.trim() || undefined);
            onClose();
        } catch (err) {
            // 409 BATCH_EMPTY lands here when the lot was emptied elsewhere
            // first. Keep the dialog open so the message is readable.
            setError(err instanceof Error ? err.message : 'Could not write off this batch. Try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={saving ? () => {} : onClose}
            title="Write off stock"
            hideFooterOnly
            hideCloseButton={saving}
        >
            <div className="space-y-4">
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <div className="flex items-start gap-3">
                        <FontAwesomeIcon icon={faTriangleExclamation} className="text-red-600 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                            <p className="font-bold text-slate-800 text-sm">{name}</p>
                            <p className="text-xs text-slate-600 mt-0.5 font-mono">
                                Expires {formatIsoDate(batch.expiryDate)}
                            </p>
                            <dl className="grid grid-cols-3 gap-3 mt-3">
                                <div>
                                    <dt className="text-[11px] text-slate-500">Units removed</dt>
                                    <dd className="font-mono font-bold text-red-700 text-lg">{batch.quantity}</dd>
                                </div>
                                <div>
                                    <dt className="text-[11px] text-slate-500">Value at cost</dt>
                                    <dd className="font-mono font-bold text-red-700 text-lg">{formatInr(value)}</dd>
                                </div>
                                <div>
                                    <dt className="text-[11px] text-slate-500">VP</dt>
                                    <dd className="font-mono font-bold text-red-700 text-lg">{formatVp(vp)}</dd>
                                </div>
                            </dl>
                        </div>
                    </div>
                </div>

                <p className="text-sm text-slate-600">
                    This zeroes the batch and records a <span className="font-mono text-xs">WRITE_OFF</span> movement.
                    The lot stops counting towards stock value. It stays in the movement log for audit.
                </p>

                <div>
                    <label htmlFor="w-reason" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">Reason</label>
                    <select id="w-reason" className={`${inputClass} cursor-pointer`} value={reason}
                        onChange={e => setReason(e.target.value as WriteOffReason)}>
                        {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>

                <div>
                    <label htmlFor="w-note" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">
                        Note <span className="font-normal normal-case text-slate-400">(optional)</span>
                    </label>
                    <input id="w-note" className={inputClass} value={note}
                        onChange={e => setNote(e.target.value)} placeholder="Crushed in transit" />
                </div>

                {error && (
                    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-1">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button variant="danger" onClick={handleConfirm} isLoading={saving} disabled={saving}>
                        Write off {batch.quantity} units
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

export default WriteOffModal;
