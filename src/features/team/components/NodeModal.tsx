import React, { useState, useEffect } from 'react';
import { OrgLevel } from '../../../shared/types';
import type { OrgNode } from '../../../shared/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes } from '@fortawesome/free-solid-svg-icons';
import { Button } from '../../../shared/components/common/Compat/Button';

interface NodeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (node: Partial<OrgNode>) => void;
    initialNode: OrgNode | null;
}

const NodeModal: React.FC<NodeModalProps> = ({ isOpen, onClose, onSave, initialNode }) => {
    const [name, setName] = useState('');
    const [level, setLevel] = useState<OrgLevel>(OrgLevel.Supervisor);

    useEffect(() => {
        if (initialNode) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setName(initialNode.name);
            setLevel(initialNode.level);
        } else {
            setName('');
            setLevel(OrgLevel.Supervisor);
        }
    }, [initialNode, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Auto-assign role based on level
        const role = level;

        onSave({
            id: initialNode?.id,
            name,
            role,
            level,
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md animate-fade-in">
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                    <h2 className="text-xl font-bold text-slate-900">{initialNode ? 'Edit Team Member' : 'Add Team Member'}</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <FontAwesomeIcon icon={faTimes} className="text-xl" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div>
                        <label className="block text-sm font-bold text-slate-900 mb-2">Name <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            required
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            placeholder="Enter member name"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-slate-900 mb-2">Business Level</label>
                        <div className="relative">
                            <select
                                value={level}
                                onChange={e => setLevel(e.target.value as OrgLevel)}
                                className="w-full px-4 py-3 border border-slate-200 rounded-xl outline-none appearance-none bg-white focus:ring-2 focus:ring-blue-500 transition-all"
                            >
                                {Object.values(OrgLevel).filter(l => l !== OrgLevel.Root).map(l => (
                                    <option key={l} value={l}>{l}</option>
                                ))}
                            </select>
                            <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-slate-500">
                                <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd"></path></svg>
                            </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                            Role/Title will be automatically assigned based on the selected level.
                        </p>
                    </div>

                    <div className="pt-2 flex justify-end gap-3">
                        <Button variant="ghost" onClick={onClose} type="button">
                            Cancel
                        </Button>
                        <Button variant="primary" type="submit">
                            {initialNode ? 'Update Member' : 'Add Member'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default NodeModal;