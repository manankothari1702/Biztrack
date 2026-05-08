import React from 'react';
import { OrgLevel } from '../../types';

interface BusinessLevelLegendProps {
    className?: string;
}

const levelColors: Record<OrgLevel, string> = {
    [OrgLevel.Root]: 'bg-slate-500',
    [OrgLevel.Supervisor]: 'bg-green-500',
    [OrgLevel.WorldTeam]: 'bg-orange-400',
    [OrgLevel.ActiveWorldTeam]: 'bg-red-400',
    [OrgLevel.GET]: 'bg-red-600',
    [OrgLevel.GET2500]: 'bg-rose-700',
    [OrgLevel.Millionaire]: 'bg-emerald-600',
    [OrgLevel.Mill7500]: 'bg-teal-700',
    [OrgLevel.President]: 'bg-indigo-400',
    [OrgLevel.Chairman]: 'bg-slate-300',
    [OrgLevel.Founder]: 'bg-yellow-200',
};

export const BusinessLevelLegend: React.FC<BusinessLevelLegendProps> = ({ className = '' }) => {
    // Filter out 'Root' from legend if desired, or keep it. Usually Root is special.
    // Let's filter Root out to match the selector behavior requested.
    const levels = Object.values(OrgLevel).filter(l => l !== OrgLevel.Root);

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-slate-200 p-3 ${className}`}>
            <div className="flex flex-wrap gap-x-4 gap-y-2 items-center justify-center sm:justify-start">
                {levels.map((level) => (
                    <div key={level} className="flex items-center gap-1.5">
                        <div className={`w-2.5 h-2.5 rounded-full ${levelColors[level]}`}></div>
                        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">
                            {level.replace(' Team', '').replace(' Club', '').replace(' Circle', '')}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};