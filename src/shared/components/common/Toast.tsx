import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faCheckCircle,
    faExclamationCircle,
    faExclamationTriangle,
    faInfoCircle,
    faTimes
} from '@fortawesome/free-solid-svg-icons';
import type { Toast as ToastType, ToastType as ToastVariant } from '../../context/ToastContext';

interface ToastProps {
    toast: ToastType;
    onClose: (id: string) => void;
}

const toastConfig: Record<ToastVariant, {
    icon: typeof faCheckCircle;
    bgClass: string;
    iconClass: string;
    borderClass: string;
}> = {
    success: {
        icon: faCheckCircle,
        bgClass: 'bg-gradient-to-r from-emerald-50 to-green-50',
        iconClass: 'text-emerald-500',
        borderClass: 'border-emerald-200'
    },
    error: {
        icon: faExclamationCircle,
        bgClass: 'bg-gradient-to-r from-red-50 to-rose-50',
        iconClass: 'text-red-500',
        borderClass: 'border-red-200'
    },
    warning: {
        icon: faExclamationTriangle,
        bgClass: 'bg-gradient-to-r from-amber-50 to-yellow-50',
        iconClass: 'text-amber-500',
        borderClass: 'border-amber-200'
    },
    info: {
        icon: faInfoCircle,
        bgClass: 'bg-gradient-to-r from-blue-50 to-indigo-50',
        iconClass: 'text-blue-500',
        borderClass: 'border-blue-200'
    }
};

const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
    const config = toastConfig[toast.type];

    return (
        <div
            className={`
                ${config.bgClass} ${config.borderClass}
                border rounded-xl shadow-lg p-4 pr-10
                flex items-start gap-3
                min-w-[320px] max-w-[420px]
                animate-slide-in-right
                relative
                transition-all duration-300 ease-out
            `}
            role="alert"
            aria-live="assertive"
        >
            {/* Icon */}
            <div className={`${config.iconClass} text-xl mt-0.5 flex-shrink-0`}>
                <FontAwesomeIcon icon={config.icon} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 text-sm leading-tight">
                    {toast.title}
                </p>
                {toast.message && (
                    <p className="text-slate-600 text-sm mt-1 leading-snug">
                        {toast.message}
                    </p>
                )}
            </div>

            {/* Close Button */}
            <button
                onClick={() => onClose(toast.id)}
                className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 transition-colors p-1"
                aria-label="Dismiss notification"
            >
                <FontAwesomeIcon icon={faTimes} className="text-sm" />
            </button>
        </div>
    );
};

export default Toast;