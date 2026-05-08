import React from 'react';
import { OrgLevel } from '../../types';

interface BusinessLevelSelectorProps {
    currentLevel: OrgLevel;
    onLevelSelect: (level: OrgLevel) => void;
    className?: string;
}

const levelColors: Record<OrgLevel, string> = {
    [OrgLevel.Root]: 'bg-slate-500', // Should not be selectable usually
    [OrgLevel.Supervisor]: 'bg-green-500',
    [OrgLevel.WorldTeam]: 'bg-orange-400',
    [OrgLevel.ActiveWorldTeam]: 'bg-red-400', // Adjusted to distinguish
    [OrgLevel.GET]: 'bg-red-600',
    [OrgLevel.GET2500]: 'bg-rose-700',
    [OrgLevel.Millionaire]: 'bg-emerald-600',
    [OrgLevel.Mill7500]: 'bg-teal-700',
    [OrgLevel.President]: 'bg-indigo-400',
    [OrgLevel.Chairman]: 'bg-slate-300',
    [OrgLevel.Founder]: 'bg-yellow-200',
};

export const BusinessLevelSelector: React.FC<BusinessLevelSelectorProps> = ({ currentLevel, onLevelSelect, className = '' }) => {
    // Filter out 'Root' from selectable options and potentially sort/filter others if needed
    const selectableLevels = Object.values(OrgLevel).filter(l => l !== OrgLevel.Root);

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-slate-200 p-4 ${className}`}>
            <div className="flex flex-wrap gap-x-6 gap-y-3 justify-center sm:justify-start">
                {selectableLevels.map((level) => (
                    <label key={level} className="flex items-center gap-2 cursor-pointer group">
                        <div className="relative flex items-center justify-center">
                            <input
                                type="radio"
                                name="businessLevel"
                                value={level}
                                checked={currentLevel === level}
                                onChange={() => onLevelSelect(level)}
                                className="peer appearance-none w-4 h-4 rounded-full border-2 border-slate-300 checked:border-blue-600 transition-all cursor-pointer"
                            />
                            <div className="absolute w-2 h-2 rounded-full bg-blue-600 opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"></div>
                        </div>

                        <div className={`w-3 h-3 rounded-full ${levelColors[level]}`}></div>

                        <span className={`text-[10px] font-black uppercase tracking-wider transition-colors ${currentLevel === level ? 'text-slate-900' : 'text-slate-400 group-hover:text-slate-600'
                            }`}>
                            {level.replace(' Team', '').replace(' Club', '').replace(' Circle', '')}
                        </span>
                    </label>
                ))}
            </div>
        </div>
    );
};