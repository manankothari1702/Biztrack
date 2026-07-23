import React, { useEffect, useState } from 'react';
import { Modal } from '../../../shared/components/common/Compat/Modal';
import { Button } from '../../../shared/components/common/Compat/Button';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight } from '@fortawesome/free-solid-svg-icons';
import { formatIsoDate } from '../../../shared/utils/inventory';
import type { AdjustBatchBody } from '../../../shared/services/apiService';
import type { Batch } from '../../../shared/types';

interface BatchModalProps {
    isOpen: boolean;
    onClose: () => void;
    batch: Batch | null;
    productName?: string;
    onSave: (productId: string, expiry: string, body: AdjustBatchBody) => Promise<void>;
}

const inputClass =
    'w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/50 text-sm text-slate-700 '
    + 'transition-all focus:bg-white focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Manual batch correction — the rare path. Normal stock movement is via invoices.
 *
 * Quantity is ABSOLUTE: the user states what the lot actually holds and the
 * server derives the delta. Changing the expiry re-keys the lot (expiry is part
 * of the sort key), which the form calls out explicitly because it moves stock
 * between rows and merges if the target already exists.
 */
const BatchModal: React.FC<BatchModalProps> = ({ isOpen, onClose, batch, productName, onSave }) => {
    const [quantity, setQuantity] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen || !batch) return;
        setQuantity(String(batch.quantity));
        setExpiryDate(batch.expiryDate);
        setNote('');
        setError(null);
    }, [isOpen, batch]);

    if (!batch) return null;

    const reKeying = expiryDate !== batch.expiryDate && ISO_DATE.test(expiryDate);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const qty = Number(quantity);
        if (!Number.isInteger(qty) || qty < 0) {
            setError('Quantity must be a whole number of units, zero or more.');
            return;
        }
        if (!ISO_DATE.test(expiryDate)) {
            setError('Expiry must be a date in YYYY-MM-DD form.');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await onSave(batch.productId, batch.expiryDate, {
                quantity: qty,
                ...(expiryDate !== batch.expiryDate ? { expiryDate } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
            });
            onClose();
        } catch (err) {
            // A 409 means the lot changed under us. Keep the form exactly as
            // typed so the user can re-read and adjust rather than start over.
            setError(err instanceof Error ? err.message : 'Could not save the correction. Try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={saving ? () => {} : onClose}
            title="Correct batch"
            hideFooterOnly
            hideCloseButton={saving}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
                    <p className="font-bold text-slate-800 text-sm">{productName ?? batch.productName ?? batch.productId}</p>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono">
                        {formatIsoDate(batch.expiryDate)} · {batch.quantity} on hand
                    </p>
                </div>

                <div>
                    <label htmlFor="b-qty" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">
                        Actual quantity
                    </label>
                    <input id="b-qty" className={inputClass} value={quantity} inputMode="numeric"
                        onChange={e => setQuantity(e.target.value)} autoFocus required />
                    <p className="text-[11px] text-slate-400 mt-1">
                        What the lot really holds — not the difference. Logged as an ADJUST movement.
                    </p>
                </div>

                <div>
                    <label htmlFor="b-expiry" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">
                        Expiry date
                    </label>
                    <input id="b-expiry" type="date" className={inputClass} value={expiryDate}
                        onChange={e => setExpiryDate(e.target.value)} required />
                    {reKeying && (
                        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                            <FontAwesomeIcon icon={faArrowRight} className="mt-0.5 shrink-0" />
                            <span>
                                Moves this stock from <strong>{formatIsoDate(batch.expiryDate)}</strong> to{' '}
                                <strong>{formatIsoDate(expiryDate)}</strong>. If a batch already exists at
                                the new date the quantities merge; the old row stays at zero as history.
                            </span>
                        </div>
                    )}
                </div>

                <div>
                    <label htmlFor="b-note" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">
                        Note <span className="font-normal normal-case text-slate-400">(optional)</span>
                    </label>
                    <input id="b-note" className={inputClass} value={note}
                        onChange={e => setNote(e.target.value)} placeholder="Recount after stock check" />
                </div>

                {error && (
                    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-1">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button type="submit" variant="primary" isLoading={saving} disabled={saving}>Save correction</Button>
                </div>
            </form>
        </Modal>
    );
};

export default BatchModal;
