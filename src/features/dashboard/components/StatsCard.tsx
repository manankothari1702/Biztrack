import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

interface StatsCardProps {
    title: string;
    value: number | string;
    icon: IconDefinition;
    color: string;
    trend?: string;
}

const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    orange: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
};

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon, color, trend }) => {
    const iconBgClass = colorClasses[color] ?? 'bg-slate-100 text-slate-600';

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between min-h-[140px] shadow-sm hover:shadow-md transition-all duration-200 group">
            <div className="flex justify-between items-start gap-4">
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-heading font-bold text-slate-500 uppercase tracking-tight mb-2">
                        {title}
                    </p>
                    <p className="text-3xl font-bold text-slate-900 tabular-nums tracking-tight font-sans">
                        {value}
                    </p>
                    {trend && (
                        <p className="text-xs text-slate-400 mt-2 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50"></span>
                            {trend}
                        </p>
                    )}
                </div>
                <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 ${iconBgClass}`}
                    aria-hidden
                >
                    <FontAwesomeIcon icon={icon} className="text-xl" />
                </div>
            </div>
        </div>
    );
};

export default StatsCard;