import React from 'react';
import { useToast } from '../../context/ToastContext';
import Toast from './Toast';

const ToastContainer: React.FC = () => {
    const { toasts, hideToast } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div
            className="fixed top-4 right-4 z-[100] flex flex-col gap-3 pointer-events-none"
            aria-label="Notifications"
        >
            {toasts.map(toast => (
                <div key={toast.id} className="pointer-events-auto">
                    <Toast toast={toast} onClose={hideToast} />
                </div>
            ))}
        </div>
    );
};

export default ToastContainer;