import React from 'react';
import type { ClientType } from '../../../shared/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch } from '@fortawesome/free-solid-svg-icons';

interface ClientFiltersProps {
    filterType: ClientType | 'All';
    setFilterType: (type: ClientType | 'All') => void;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

const ClientFilters: React.FC<ClientFiltersProps> = ({ filterType, setFilterType, searchQuery, setSearchQuery, searchInputRef }) => {
    const tabs: (ClientType | 'All')[] = ['All', 'Prospect', 'User', 'Associate', 'Supervisor'];

    return (
        <div className="flex flex-col md:flex-row gap-4 justify-between items-center w-full shadow-sm p-1 rounded-2xl bg-white border border-slate-100">
            {/* Filter Tabs - Pill Style */}
            <div className="flex bg-slate-50 p-1 rounded-xl w-full md:w-auto overflow-x-auto custom-scrollbar no-scrollbar border border-slate-100">
                {tabs.map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setFilterType(tab)}
                        className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all duration-200 whitespace-nowrap font-mono ${filterType === tab
                            ? 'bg-white text-primary shadow-sm ring-1 ring-slate-100'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* Search Input */}
            <div className="w-full md:w-72 relative">
                <FontAwesomeIcon icon={faSearch} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search database..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all font-medium text-slate-700 text-sm placeholder:text-slate-400"
                />
            </div>
        </div>
    );
};

export default ClientFilters;