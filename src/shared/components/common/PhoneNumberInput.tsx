import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faSearch, faCheck } from '@fortawesome/free-solid-svg-icons';
import { countryList, type Country } from '../../constants/countryList';

interface PhoneNumberInputProps {
    value?: string;
    onChange: (fullNumber: string, data: { country: string, countryCode: string, number: string }) => void;
    error?: string;
    placeholder?: string;
    hideLabel?: boolean;
}

const PhoneNumberInput: React.FC<PhoneNumberInputProps> = ({
    value = '',
    onChange,
    error,
    placeholder = 'Phone number',
    hideLabel = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCountry, setSelectedCountry] = useState<Country>(countryList.find(c => c.code === 'IN') || countryList[0]);
    const [phoneNumber, setPhoneNumber] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Initialize from value if provided
    useEffect(() => {
        if (value) {
            // Try to find the country from the value (assuming it starts with +)
            const matchingCountry = countryList.reduce((prev, current) => {
                if (value.startsWith(current.dial_code)) {
                    // Pick the one with the longer dial_code to avoid partial matches
                    return (prev && prev.dial_code.length > current.dial_code.length) ? prev : current;
                }
                return prev;
            }, null as Country | null);

            if (matchingCountry) {
                // Determine raw number by stripping dial code
                const rawNumber = value.substring(matchingCountry.dial_code.length).trim();

                // Only update if inconsistent to avoid typing loops
                if (matchingCountry.code !== selectedCountry.code || rawNumber !== phoneNumber) {
                    // eslint-disable-next-line react-hooks/set-state-in-effect
                    setSelectedCountry(matchingCountry);
                    setPhoneNumber(rawNumber);
                }
            } else {
                // Fallback if no country match found
                const rawNumber = value.trim();
                if (rawNumber !== phoneNumber) {
                    setPhoneNumber(rawNumber);
                }
            }
        } else if (!value && phoneNumber) {
            // Reset if value is cleared externally
            setPhoneNumber('');
        }
    }, [value]);


    // Filter countries based on search
    const filteredCountries = useMemo(() => {
        const lowerQuery = searchQuery.toLowerCase();
        return countryList.filter(c =>
            c.name.toLowerCase().includes(lowerQuery) ||
            c.dial_code.includes(lowerQuery) ||
            c.code.toLowerCase().includes(lowerQuery)
        );
    }, [searchQuery]);

    // Handle outside click to close dropdown
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Focus search input when dropdown opens
    useEffect(() => {
        if (isOpen && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [isOpen]);

    const handleCountrySelect = (country: Country) => {
        setSelectedCountry(country);
        setIsOpen(false);
        setSearchQuery('');

        // Trigger onChange with new country code
        const fullNumber = `${country.dial_code}${phoneNumber}`;
        onChange(fullNumber, {
            country: country.name,
            countryCode: country.dial_code,
            number: phoneNumber
        });
    };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // Allow only numbers and spaces
        const val = e.target.value.replace(/[^\d\s]/g, '');
        setPhoneNumber(val);

        const fullNumber = val ? `${selectedCountry.dial_code}${val}` : '';
        onChange(fullNumber, {
            country: selectedCountry.name,
            countryCode: selectedCountry.dial_code,
            number: val
        });
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {!hideLabel && (
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Phone number <span className="text-red-500">*</span>
                </label>
            )}

            <div className={`flex items-center border rounded-xl bg-white transition-all ${error ? 'border-red-300 ring-2 ring-red-100' : 'border-slate-200 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10'
                }`}>
                {/* Combined Prefix Container */}
                <div className="flex items-center pl-4 py-3 flex-shrink-0">
                    <button
                        type="button"
                        onClick={() => setIsOpen(!isOpen)}
                        className="flex items-center gap-2 hover:bg-slate-50 transition-colors rounded-lg px-1.5 py-1 -ml-1"
                    >
                        <span className="text-xl leading-none">{selectedCountry.flag}</span>

                        <FontAwesomeIcon icon={faChevronDown} className={`text-slate-400 text-[10px] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Gap and Dial Code */}
                    <span className="ml-2.5 text-slate-700 font-semibold text-sm">{selectedCountry.dial_code.replace(/\s/g, '')}</span>

                    {/* Divider Line */}
                    <div className="h-6 w-px bg-slate-200 mx-3"></div>
                </div>

                {/* Phone Input */}
                <input
                    type="tel"
                    value={phoneNumber}
                    onChange={handlePhoneChange}
                    placeholder={placeholder}
                    className="flex-grow pr-4 py-3 outline-none text-slate-700 font-medium placeholder:text-slate-300 bg-transparent"
                />
            </div>

            {/* Error Message */}
            {error && <p className="text-red-500 text-xs mt-1 font-medium">{error}</p>}

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute z-50 top-full left-0 mt-2 w-[320px] bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden animate-fade-in-up">
                    {/* Search Field */}
                    <div className="p-3 border-b border-slate-100 bg-slate-50/50 sticky top-0">
                        <div className="relative">
                            <FontAwesomeIcon icon={faSearch} className="absolute left-3 top-3 text-slate-400 text-sm" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search for countries"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all"
                            />
                        </div>
                    </div>

                    {/* Countries List */}
                    <div className="max-h-[240px] overflow-y-auto custom-scrollbar">
                        {filteredCountries.length > 0 ? (
                            filteredCountries.map((country) => (
                                <button
                                    key={country.code}
                                    type="button"
                                    onClick={() => handleCountrySelect(country)}
                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 transition-colors ${selectedCountry.code === country.code ? 'bg-blue-50/50 text-blue-700' : 'text-slate-700'
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-xl">{country.flag}</span>
                                        <span className="text-sm font-medium">{country.name}</span>
                                        <span className="text-sm text-slate-400">({country.dial_code.replace(/\s/g, '')})</span>
                                    </div>
                                    {selectedCountry.code === country.code && (
                                        <FontAwesomeIcon icon={faCheck} className="text-blue-600 text-sm" />
                                    )}
                                </button>
                            ))
                        ) : (
                            <div className="p-4 text-center text-slate-400 text-sm">
                                No countries found
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PhoneNumberInput;