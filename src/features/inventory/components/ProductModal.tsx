import React, { useEffect, useState } from 'react';
import { Modal } from '../../../shared/components/common/Compat/Modal';
import { Button } from '../../../shared/components/common/Compat/Button';
import { PRODUCT_CATEGORIES } from '../../../shared/constants/productCategories';
import type { Product, ProductCategory } from '../../../shared/types';

interface ProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (product: Product) => Promise<void>;
    initialProduct: Product | null;
}

interface FormState {
    name: string; stockNo: string; category: ProductCategory; unit: string;
    vp: string; retail: string; price25: string; price35: string;
    price42: string; price50: string; reorderLevel: string; notes: string;
}

const BLANK: FormState = {
    name: '', stockNo: '', category: 'Other', unit: 'units',
    vp: '', retail: '', price25: '', price35: '', price42: '', price50: '',
    reorderLevel: '0', notes: '',
};

const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const PRICE_FIELDS: { key: keyof FormState; label: string; hint?: string }[] = [
    { key: 'retail',  label: 'Retail (0%)', hint: 'Full price' },
    { key: 'price25', label: '25%' },
    { key: 'price35', label: '35%' },
    { key: 'price42', label: '42%' },
    { key: 'price50', label: '50%', hint: 'Your cost' },
];

const inputClass =
    'w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/50 text-sm text-slate-700 '
    + 'transition-all focus:bg-white focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10';

/**
 * Add or edit CATALOGUE details only — never stock.
 *
 * `totalQuantity` / `earliestExpiry` are not editable here and are not sent:
 * the server drops them from the body and restores them from the stored row,
 * so a rename can never move stock.
 */
const ProductModal: React.FC<ProductModalProps> = ({ isOpen, onClose, onSave, initialProduct }) => {
    const [form, setForm] = useState<FormState>(BLANK);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setError(null);
        setForm(initialProduct
            ? {
                name:         initialProduct.name ?? '',
                stockNo:      initialProduct.stockNo ?? '',
                category:     initialProduct.category ?? 'Other',
                unit:         initialProduct.unit ?? 'units',
                vp:           String(initialProduct.vp ?? ''),
                retail:       String(initialProduct.retail ?? ''),
                price25:      String(initialProduct.price25 ?? ''),
                price35:      String(initialProduct.price35 ?? ''),
                price42:      String(initialProduct.price42 ?? ''),
                price50:      String(initialProduct.price50 ?? ''),
                reorderLevel: String(initialProduct.reorderLevel ?? 0),
                notes:        initialProduct.notes ?? '',
            }
            : BLANK);
    }, [isOpen, initialProduct]);

    const set = (key: keyof FormState, value: string) =>
        setForm(prev => ({ ...prev, [key]: value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) { setError('Product name is required.'); return; }

        const reorder = num(form.reorderLevel);
        if (!Number.isInteger(reorder) || reorder < 0) {
            setError('Reorder level must be a whole number of units, zero or more.');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await onSave({
                ...(initialProduct ?? {}),
                id:           initialProduct?.id ?? crypto.randomUUID(),
                name:         form.name.trim(),
                stockNo:      form.stockNo.trim() || undefined,
                category:     form.category,
                unit:         form.unit.trim() || 'units',
                vp:           num(form.vp),
                retail:       num(form.retail),
                price25:      num(form.price25),
                price35:      num(form.price35),
                price42:      num(form.price42),
                price50:      num(form.price50),
                reorderLevel: reorder,
                notes:        form.notes.trim() || undefined,
                totalQuantity: initialProduct?.totalQuantity ?? 0,
                createdAt:     initialProduct?.createdAt ?? new Date().toISOString(),
            } as Product);
            onClose();
        } catch (err) {
            // Stay open with everything the user typed intact — retyping a
            // 12-field form because the network blipped is unacceptable.
            setError(err instanceof Error ? err.message : 'Could not save the product. Try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={saving ? () => {} : onClose}
            title={initialProduct ? 'Edit product' : 'Add product'}
            hideFooterOnly
            hideCloseButton={saving}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-xs text-slate-500">
                    Catalogue details only. Stock arrives through purchase invoices — editing
                    here never changes quantities.
                </p>

                <div>
                    <label htmlFor="p-name" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">Name</label>
                    <input id="p-name" className={inputClass} value={form.name}
                        onChange={e => set('name', e.target.value)} autoFocus required />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label htmlFor="p-stockno" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">Stock no.</label>
                        <input id="p-stockno" className={inputClass} value={form.stockNo}
                            onChange={e => set('stockNo', e.target.value)} placeholder="1239" />
                    </div>
                    <div>
                        <label htmlFor="p-category" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">Category</label>
                        <select id="p-category" className={`${inputClass} cursor-pointer`} value={form.category}
                            onChange={e => set('category', e.target.value)}>
                            {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <div>
                        <label htmlFor="p-vp" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">VP / piece</label>
                        <input id="p-vp" className={inputClass} value={form.vp} inputMode="decimal"
                            onChange={e => set('vp', e.target.value)} placeholder="21.75" />
                    </div>
                    <div>
                        <label htmlFor="p-unit" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">Unit</label>
                        <input id="p-unit" className={inputClass} value={form.unit}
                            onChange={e => set('unit', e.target.value)} placeholder="units" />
                    </div>
                    <div>
                        <label htmlFor="p-reorder" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">Reorder at</label>
                        <input id="p-reorder" className={inputClass} value={form.reorderLevel} inputMode="numeric"
                            onChange={e => set('reorderLevel', e.target.value)} />
                    </div>
                </div>

                <fieldset className="border border-slate-200 rounded-xl p-3">
                    <legend className="text-xs font-bold text-slate-600 px-1 font-mono uppercase tracking-wide">Price tiers (₹)</legend>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-1">
                        {PRICE_FIELDS.map(f => (
                            <div key={f.key}>
                                <label htmlFor={`p-${f.key}`} className="block text-[11px] text-slate-500 mb-1">{f.label}</label>
                                <input id={`p-${f.key}`} className={inputClass} inputMode="numeric"
                                    value={form[f.key]} onChange={e => set(f.key, e.target.value)} />
                                {f.hint && <p className="text-[10px] text-slate-400 mt-0.5">{f.hint}</p>}
                            </div>
                        ))}
                    </div>
                </fieldset>

                <div>
                    <label htmlFor="p-notes" className="block text-xs font-bold text-slate-600 mb-1 font-mono uppercase tracking-wide">Notes</label>
                    <textarea id="p-notes" className={inputClass} rows={2} value={form.notes}
                        onChange={e => set('notes', e.target.value)} />
                </div>

                {error && (
                    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-1">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button type="submit" variant="primary" isLoading={saving} disabled={saving}>
                        {initialProduct ? 'Save changes' : 'Add product'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

export default ProductModal;
