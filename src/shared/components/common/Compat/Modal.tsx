import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes } from '@fortawesome/free-solid-svg-icons';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    hideCloseButton?: boolean;
    hideFooterOnly?: boolean;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, hideCloseButton = false, hideFooterOnly = false }) => {
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    // Render into document.body so ancestor transforms (e.g. animate-fade-in-up)
    // can't trap `position: fixed` inside a smaller containing block.
    return createPortal(
        <div className="fixed inset-0 z-[100] overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center p-4 text-center sm:p-0">
                <div className="fixed inset-0 bg-slate-900 bg-opacity-75 transition-opacity backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

                <div className="relative transform overflow-hidden rounded-3xl bg-white text-left shadow-2xl transition-all w-full max-w-lg sm:my-8 sm:w-full border border-slate-200">
                    <div className="bg-white px-4 pb-4 pt-5 sm:p-8 sm:pb-6">
                        <div className="sm:flex sm:items-start">
                            <div className="text-center sm:ml-0 sm:mt-0 sm:text-left w-full">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-xl font-black leading-6 text-slate-900" id="modal-title">
                                        {title}
                                    </h3>
                                    {!hideCloseButton && (
                                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                                            <FontAwesomeIcon icon={faTimes} className="text-lg" />
                                        </button>
                                    )}
                                </div>
                                <div className="mt-2">
                                    {children}
                                </div>
                            </div>
                        </div>
                    </div>
                    {!hideCloseButton && !hideFooterOnly && (
                        <div className="bg-slate-50 px-6 py-4 sm:flex sm:flex-row-reverse sm:px-8 border-t border-slate-100">
                            <Button
                                onClick={onClose}
                            >
                                Close
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};